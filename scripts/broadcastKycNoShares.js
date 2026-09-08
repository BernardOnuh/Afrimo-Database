// scripts/broadcastKycNoShares.js
// One-off CLI to email all AfriMobile users who DON'T own shares yet,
// telling them AfriMobile is moving forward with KYC and it's not too late
// to join the train by buying shares.
//
// Usage (from the repo root):
//   node scripts/broadcastKycNoShares.js --test            # send test to TEST_TO (no DB, no broadcast)
//   node scripts/broadcastKycNoShares.js --dry-run         # count recipients, send nothing
//   node scripts/broadcastKycNoShares.js --confirm         # actually broadcast to qualifying users
//
// Env used (from .env or Heroku config):
//   MONGODB_URI  - database connection
//   EMAIL_USER / EMAIL_PASS - SMTP credentials (fall back to defaults in emailService)
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const User = require('../models/User');
const UserShare = require('../models/UserShare');
const UserShareV2 = require('../models/UserShareV2');
const { sendEmail } = require('../utils/emailService');
const { SUBJECT, buildHtml, buildText } = require('../utils/broadcastTemplateNoShares');

const TEST_TO = process.env.TEST_TO || 'onuhbernard4@gmail.com';

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isDryRun = args.includes('--dry-run');
  const isConfirm = args.includes('--confirm');

  if (!isTest && !isDryRun && !isConfirm) {
    console.log('Usage:');
    console.log('  node scripts/broadcastKycNoShares.js --test');
    console.log('  node scripts/broadcastKycNoShares.js --dry-run');
    console.log('  node scripts/broadcastKycNoShares.js --confirm');
    process.exit(0);
  }

  if (isTest) {
    console.log(`🧪 TEST MODE — sending test email to ${TEST_TO} ...`);
    const ok = await sendEmail({
      email: TEST_TO,
      subject: SUBJECT,
      text: buildText('Bernardo'),
      html: buildHtml('Bernardo'),
      priority: 'normal',
    });
    console.log(ok ? '✅ Test email sent.' : '❌ Test email FAILED. Check SMTP credentials.');
    process.exit(ok ? 0 : 1);
  }

  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    console.error('❌ No MONGODB_URI found. Run from Heroku (`heroku run node scripts/...`) or with a local .env.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 15000,
  });
  console.log('📊 Connected to MongoDB');

  // Determine whether a user actually owns shares (regular or co-founder).
  // Checks the maintained ownership snapshots (UserShareV2 and legacy
  // UserShare) as well as the stats counter, so we only email true
  // non-shareholders.
  async function userHasShares(user) {
    if (Number(user.stats && user.stats.totalShares) > 0) return true;

    const [v2, legacy] = await Promise.all([
      UserShareV2.findOne({ user: user._id })
        .select('totalOwnershipPct')
        .lean(),
      UserShare.findOne({ user: user._id }).select('totalOwnershipPct transactions').lean(),
    ]);

    if (v2 && v2.totalOwnershipPct > 0) return true;
    if (legacy && legacy.totalOwnershipPct > 0) return true;
    if (legacy && Array.isArray(legacy.transactions)) {
      return legacy.transactions.some(
        (t) => t.status === 'completed' && (Number(t.shares) > 0 || Number(t.ownershipPct) > 0)
      );
    }
    return false;
  }

  // Load all users, then keep only those who truly own no shares.
  const allUsers = await User.find({}).select('name email stats.totalShares').lean();

  const holdShares = new Set();
  const CHECK_BATCH = 200;
  for (let i = 0; i < allUsers.length; i += CHECK_BATCH) {
    const chunk = allUsers.slice(i, i + CHECK_BATCH);
    const results = await Promise.all(chunk.map(async (u) => [String(u._id), await userHasShares(u)]));
    results.forEach(([id, has]) => { if (has) holdShares.add(id); });
  }

  const nonShareholders = allUsers.filter((u) => !holdShares.has(String(u._id)));

  const validEmails = nonShareholders
    .filter((u) => u.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u.email))
    .map((u) => ({ email: u.email, name: u.name }));
  const unique = Array.from(new Map(validEmails.map((u) => [u.email, u])).values());

  console.log(`👥 Total users: ${allUsers.length}`);
  console.log(`👤 Users with no shares: ${nonShareholders.length}`);
  console.log(`📧 Valid unique emails: ${unique.length}`);

  if (isDryRun) {
    console.log('🔍 DRY RUN — no emails sent.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log('🚀 BROADCASTING to users without shares. Sending emails...');
  let sent = 0;
  let failed = 0;
  let failures = [];

  for (const u of unique) {
    const firstName = (u.name || '').split(' ')[0] || 'there';
    const ok = await sendEmail({
      email: u.email,
      subject: SUBJECT,
      text: buildText(firstName),
      html: buildHtml(firstName),
      priority: 'normal',
    });
    if (ok) sent++;
    else {
      failed++;
      failures.push(u.email);
    }
    // Be polite to Gmail rate limits; the transporter already throttles to 5/15s.
    await new Promise((r) => setTimeout(r, 1000));
    if ((sent + failed) % 20 === 0) console.log(`  ...${sent + failed}/${unique.length} done (${sent} sent)`);
  }

  console.log(`\n✅ Done. Sent: ${sent} | Failed: ${failed}${failed ? '\n❌ Failed emails:\n  ' + failures.join('\n  ') : ''}`);
  await mongoose.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('Fatal error:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
