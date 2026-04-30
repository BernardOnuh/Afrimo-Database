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

async function run() {
  let connected = false;
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
      connected = true;
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
    if (connected) await mongoose.disconnect();
    process.exit(1);
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
