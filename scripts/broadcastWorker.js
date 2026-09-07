// scripts/broadcastWorker.js - Persisted background broadcaster for Heroku.
//
// Sends the KYC + shares email to all users in bounded batches (default 200
// emails every 6 hours), pausing automatically to respect Gmail's ~500/day
// sending cap so the account doesn't get flagged. State lives in the
// EmailBroadcast collection, so if the dyno is restarted or we disconnect,
// the worker simply resumes where it left off (no double sends).
//
// Runs two ways:
//   1) Inside the web app: set ENABLE_BROADCAST_WORKER=1 on Heroku and the
//      worker starts automatically after boot.
//   2) Standalone: node scripts/broadcastWorker.js
//
// Config (env):
//   BROADCAST_BATCH_SIZE      default 200   - emails per batch
//   BROADCAST_INTERVAL_MS     default 6h    - delay between batches
//   BROADCAST_MAX_PER_DAY     default 450   - hard daily cap (safe under 500)
//   BROADCAST_EMAIL_PACE_MS   default 3000  - pause between each send
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const EmailBroadcast = require('../models/EmailBroadcast');
const { sendEmail } = require('../utils/emailService');
const { SUBJECT, buildHtml, buildText } = require('../utils/broadcastTemplate');

const BATCH_SIZE = parseInt(process.env.BROADCAST_BATCH_SIZE || '200', 10);
const INTERVAL_MS = parseInt(process.env.BROADCAST_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);
const MAX_PER_DAY = parseInt(process.env.BROADCAST_MAX_PER_DAY || '450', 10);
const EMAIL_PACE_MS = parseInt(process.env.BROADCAST_EMAIL_PACE_MS || '3000', 10);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Load all users' emails into the tracking collection (idempotent upsert).
async function seedRecipients() {
  const users = await User.find({}).select('name email').lean();
  const uniq = new Map();
  for (const u of users) {
    if (u.email && EMAIL_RE.test(u.email)) uniq.set(u.email, u.name || '');
  }
  const ops = [...uniq].map(([email, name]) => ({
    updateOne: {
      filter: { email },
      update: { $setOnInsert: { email, name, status: 'pending' } },
      upsert: true,
    },
  }));
  if (ops.length) {
    await EmailBroadcast.bulkWrite(ops, { ordered: false });
  }
  return uniq.size;
}

// How many sends (success or failure) already happened in the last 24h.
async function countRecentSends() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return EmailBroadcast.countDocuments({
    status: { $in: ['sent', 'failed'] },
    // updatedAt is set on status transitions (timestamps)
    updatedAt: { $gte: since },
  });
}

async function sendBatch() {
  await seedRecipients();

  const pending = await EmailBroadcast.find({ status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  if (!pending.length) return 0;

  let sent = 0;

  for (const rec of pending) {
    // Respect Gmail's daily cap: if we'd cross it in the next 24h window,
    // stop and wait for slots to free up.
    const recent = await countRecentSends();
    if (recent >= MAX_PER_DAY) {
      console.log(`⏸️ Daily cap reached (${recent}/${MAX_PER_DAY}). Waiting 30 min...`);
      break;
    }

    const firstName = (rec.name || '').split(' ')[0] || '';
    const ok = await sendEmail({
      email: rec.email,
      subject: SUBJECT,
      text: buildText(firstName),
      html: buildHtml(firstName),
      priority: 'normal',
    });

    await EmailBroadcast.updateOne(
      { _id: rec._id },
      ok
        ? { $set: { status: 'sent', sentAt: new Date(), error: '' } }
        : { $set: { status: 'failed', error: 'send failed' } }
    );

    if (ok) sent++;
    console.log(`  ${ok ? '✅' : '❌'} ${rec.email}${ok ? '' : ' (failed)'}`);

    await sleep(EMAIL_PACE_MS);
  }

  return sent;
}

async function run() {
  console.log(`🚀 Broadcast worker started. Batch=${BATCH_SIZE}, interval=${INTERVAL_MS / 3600000}h, cap=${MAX_PER_DAY}/day`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const sent = await sendBatch();
      const total = await EmailBroadcast.countDocuments();
      const done = await EmailBroadcast.countDocuments({ status: 'sent' });
      const failed = await EmailBroadcast.countDocuments({ status: 'failed' });
      console.log(`📬 Batch finished: ${sent} sent this run. ${done} sent / ${failed} failed / ${total} total.`);

      if (sent === 0) {
        const remaining = await EmailBroadcast.countDocuments({ status: 'pending' });
        if (remaining === 0) {
          console.log('🎉 All recipients processed. Sleeping until new users appear...');
        } else {
          console.log(`⏸️ Cap or empty batch — ${remaining} still pending. Waiting...`);
        }
        await sleep(30 * 60 * 1000);
      } else {
        await sleep(INTERVAL_MS);
      }
    } catch (err) {
      console.error('⚠️ Worker error:', err.message);
      await sleep(60 * 1000);
    }
  }
}

async function startBroadcastWorker() {
  run().catch((err) => console.error('Fatal worker error:', err));
}

if (require.main === module) {
  (async () => {
    if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
      console.error('❌ No MONGODB_URI. Provide via .env or Heroku config.');
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
    });
    console.log('📊 Connected to MongoDB');
    startBroadcastWorker();
  })().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}

module.exports = { startBroadcastWorker };