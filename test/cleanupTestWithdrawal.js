// test/forceCleanup.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Withdrawal = require('../models/Withdrawal');
const Referral = require('../models/Referral');

const USER_ID = '6745f752ce52dd63c0758370';

async function forceCleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Connected\n');

  // Find ALL stuck withdrawals for this user regardless of reference prefix
  const stuck = await Withdrawal.find({
    user: USER_ID,
    status: { $in: ['pending', 'processing'] }
  });

  console.log(`Found ${stuck.length} stuck withdrawal(s):`);

  for (const w of stuck) {
    console.log(`\n  ID:     ${w._id}`);
    console.log(`  Ref:    ${w.clientReference}`);
    console.log(`  Amount: ₦${w.amount}`);
    console.log(`  Status: ${w.status}`);

    const updated = await Referral.findOneAndUpdate(
      { user: w.user },
      { $inc: { pendingWithdrawals: -w.amount } },
      { new: true }
    );

    await Withdrawal.findByIdAndDelete(w._id);
    console.log(`  ✅ Deleted | pendingWithdrawals now: ₦${updated.pendingWithdrawals}`);
  }

  // Confirm final state
  const referral = await Referral.findOne({ user: USER_ID });
  console.log('\n📊 Final Balance State:');
  console.log(`   Total Earnings:      ₦${referral.totalEarnings}`);
  console.log(`   Total Withdrawn:     ₦${referral.totalWithdrawn}`);
  console.log(`   Pending Withdrawals: ₦${referral.pendingWithdrawals}`);
  console.log(`   Processing:          ₦${referral.processingWithdrawals}`);
  console.log(`   Available:           ₦${referral.totalEarnings - referral.totalWithdrawn - referral.pendingWithdrawals - referral.processingWithdrawals}`);

  await mongoose.disconnect();
  console.log('\n✅ Force cleanup complete. Run the test now.');
}

forceCleanup().catch(console.error);