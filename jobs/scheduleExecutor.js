require('dotenv').config();
const mongoose = require('mongoose');
const WithdrawalSchedule = require('../models/WithdrawalSchedule');
const WithdrawalConfig = require('../models/WithdrawalConfig');
const WithdrawalAuditLog = require('../models/WithdrawalAuditLog');

async function setConfig(key, value, adminId, reason) {
  return WithdrawalConfig.findOneAndUpdate(
    { key },
    { value, updatedBy: adminId, updatedAt: new Date(), reason },
    { upsert: true, new: true }
  );
}

async function ensureConnection(timeoutMs = 30000) {
  if (mongoose.connection.readyState === 1) return true;
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) return false;
  const start = Date.now();
  while (mongoose.connection.readyState !== 1) {
    if (mongoose.connection.readyState === 0) {
      try {
        await mongoose.connect(mongoUri);
      } catch (err) {
        console.error('[SCHEDULER] Connection attempt failed:', err.message);
      }
    }
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return true;
}

async function run() {
  let connected = false;
  try {
    if (mongoose.connection.readyState !== 1) {
      connected = await ensureConnection();
      if (!connected) {
        console.error('[SCHEDULER] Database not available, will retry on next interval');
        return;
      }
    }
    const due = await WithdrawalSchedule.find({
      executed: false,
      cancelled: false,
      scheduledFor: { $lte: new Date() }
    });
    if (due.length === 0) {
      if (connected) await mongoose.disconnect();
      return;
    }
    for (const schedule of due) {
      try {
        switch (schedule.action) {
          case 'RESUME_ALL':
            await Promise.all([
              setConfig('global_paused', false, schedule.createdBy, schedule.reason),
              setConfig('global_pause_reason', null, schedule.createdBy, schedule.reason)
            ]);
            await WithdrawalAuditLog.create({
              action: 'SCHEDULED_RESUME',
              performedBy: schedule.createdBy,
              reason: schedule.reason,
              metadata: { scheduleId: schedule._id, executedAt: new Date() }
            });
            break;
          case 'PAUSE_ALL':
            await Promise.all([
              setConfig('global_paused', true, schedule.createdBy, schedule.reason),
              setConfig('global_pause_reason', schedule.reason, schedule.createdBy, schedule.reason)
            ]);
            break;
          case 'ENABLE_BANK':
            await setConfig('bank_withdrawals_enabled', true, schedule.createdBy, schedule.reason);
            break;
          case 'DISABLE_BANK':
            await setConfig('bank_withdrawals_enabled', false, schedule.createdBy, schedule.reason);
            break;
          case 'ENABLE_CRYPTO':
            await setConfig('crypto_withdrawals_enabled', true, schedule.createdBy, schedule.reason);
            break;
          case 'DISABLE_CRYPTO':
            await setConfig('crypto_withdrawals_enabled', false, schedule.createdBy, schedule.reason);
            break;
        }
        schedule.executed = true;
        schedule.executedAt = new Date();
        await schedule.save();
        console.log(`[SCHEDULER] Executed: ${schedule.action}`);
      } catch (err) {
        console.error(`[SCHEDULER] Failed: ${schedule.action}:`, err.message);
      }
    }
    if (connected) await mongoose.disconnect();
  } catch (err) {
    console.error('[SCHEDULER] Fatal error:', err.message);
    if (require.main === module && connected) await mongoose.disconnect();
  }
}

function startInterval(intervalMs = 60000) {
  console.log(`[SCHEDULER] Starting in-process executor, interval: ${intervalMs / 1000}s`);
  setInterval(run, intervalMs);
  run();
}

module.exports = { run, startInterval };

if (require.main === module) {
  run().then(() => process.exit(0));
}
