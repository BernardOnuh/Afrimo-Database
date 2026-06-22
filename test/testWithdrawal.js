// test/testWithdrawal.js
/**
 * TEST WITHDRAWAL FUNCTION - REMOVE IN PRODUCTION
 * Tests a ₦1,000 withdrawal by temporarily bypassing minimum amount check
 */
const mongoose = require('mongoose');
const axios = require('axios');           // ← ADD THIS
const User = require('../models/User');
const Referral = require('../models/Referral');
const Payment = require('../models/Payment');
const Withdrawal = require('../models/Withdrawal');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const TEST_AMOUNT = 500; // ₦1,000 test amount

async function testWithdrawal(userId) {
  console.log('\n========== WITHDRAWAL TEST START ==========');
  console.log(`User ID: ${userId}`);
  console.log(`Test Amount: ₦${TEST_AMOUNT.toLocaleString()}`);
  console.log('==========================================\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ DB connected\n');

    // ---- STEP 1: Check user exists ----
    const user = await User.findById(userId);
    if (!user) throw new Error(`User not found: ${userId}`);
    console.log(`✅ User found: ${user.name} (${user.email})`);

    // ---- STEP 2: Check referral/balance ----
    const referralData = await Referral.findOne({ user: userId });
    if (!referralData) throw new Error('No referral data found for user');

    const availableBalance =
      referralData.totalEarnings -
      (referralData.totalWithdrawn || 0) -
      (referralData.pendingWithdrawals || 0) -
      (referralData.processingWithdrawals || 0);

    console.log(`\n📊 Balance Summary:`);
    console.log(`   Total Earnings:       ₦${referralData.totalEarnings?.toLocaleString()}`);
    console.log(`   Total Withdrawn:      ₦${(referralData.totalWithdrawn || 0).toLocaleString()}`);
    console.log(`   Pending Withdrawals:  ₦${(referralData.pendingWithdrawals || 0).toLocaleString()}`);
    console.log(`   Processing:           ₦${(referralData.processingWithdrawals || 0).toLocaleString()}`);
    console.log(`   Available Balance:    ₦${availableBalance.toLocaleString()}`);

    if (availableBalance < TEST_AMOUNT) {
      throw new Error(`Insufficient balance. Available: ₦${availableBalance}, Needed: ₦${TEST_AMOUNT}`);
    }
    console.log(`✅ Balance sufficient for ₦${TEST_AMOUNT} test\n`);

    // ---- STEP 3: Check bank details ----
    const paymentData = await Payment.findOne({ user: userId });
    if (!paymentData?.bankAccount) throw new Error('No bank account found. Add bank details first.');
    if (!paymentData.bankAccount.verified) throw new Error('Bank account not verified.');

    console.log(`✅ Bank Account: ${paymentData.bankAccount.bankName} - ****${paymentData.bankAccount.accountNumber.slice(-4)}`);
    console.log(`   Account Name: ${paymentData.bankAccount.accountName}\n`);

    // ---- STEP 4: Check for existing pending withdrawals ----
    const existingWithdrawal = await Withdrawal.findOne({
      user: userId,
      status: { $in: ['pending', 'processing'] }
    });

    if (existingWithdrawal) {
      throw new Error(`Existing ${existingWithdrawal.status} withdrawal found (ID: ${existingWithdrawal._id}). Resolve it first.`);
    }
    console.log('✅ No conflicting pending withdrawals\n');

    // ---- STEP 5: Create withdrawal record ----
    const clientReference = `TEST-WD-${userId.toString().substr(-6)}-${Date.now()}`;

    const withdrawal = new Withdrawal({
      user: userId,
      amount: TEST_AMOUNT,
      withdrawalType: 'bank',
      paymentMethod: 'bank',
      paymentDetails: {
        bankName: paymentData.bankAccount.bankName,
        accountName: paymentData.bankAccount.accountName,
        accountNumber: paymentData.bankAccount.accountNumber,
        bankCode: paymentData.bankAccount.bankCode
      },
      notes: 'TEST WITHDRAWAL - ₦1,000 integration test',
      status: 'pending',
      clientReference
    });

    await withdrawal.save();
    console.log(`✅ Withdrawal record created: ${withdrawal._id}`);
    console.log(`   Reference: ${clientReference}\n`);

    // Update pending balance
    await Referral.findOneAndUpdate(
      { user: userId },
      { $inc: { pendingWithdrawals: TEST_AMOUNT } }
    );

    // ---- STEP 6: Call Lenco API ----
    console.log('🔄 Calling Lenco API...');
    const lencoPayload = {
      accountId: process.env.LENCO_ACCOUNT_ID,
      accountNumber: paymentData.bankAccount.accountNumber,
      bankCode: paymentData.bankAccount.bankCode,
      amount: TEST_AMOUNT.toString(),
      narration: 'Afrimobile Test Withdrawal',
      reference: clientReference,
      senderName: 'Afrimobile'
    };

    console.log('   Payload:', JSON.stringify(lencoPayload, null, 2));

    const response = await axios.post(
      'https://api.lenco.co/access/v1/transactions',
      lencoPayload,
      {
        headers: {
          Authorization: `Bearer ${process.env.LENCO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('\n📨 Lenco Response:');
    console.log(JSON.stringify(response.data, null, 2));

    // ---- STEP 7: Handle response ----
    if (response.data?.status) {
      const txStatus = response.data.data?.status;
      const txRef = response.data.data?.transactionReference;

      withdrawal.transactionReference = txRef;

      if (txStatus === 'successful') {
        withdrawal.status = 'paid';
        withdrawal.processedAt = new Date();
        await Referral.findOneAndUpdate(
          { user: userId },
          { $inc: { pendingWithdrawals: -TEST_AMOUNT, totalWithdrawn: TEST_AMOUNT } }
        );
        console.log('\n✅ SUCCESS - Withdrawal paid!');
      } else if (txStatus === 'processing') {
        withdrawal.status = 'processing';
        await Referral.findOneAndUpdate(
          { user: userId },
          { $inc: { pendingWithdrawals: -TEST_AMOUNT, processingWithdrawals: TEST_AMOUNT } }
        );
        console.log('\n⏳ PROCESSING - Transfer in progress');
      } else if (txStatus === 'failed' || txStatus === 'declined') {
        withdrawal.status = 'failed';
        withdrawal.rejectionReason = response.data.data?.reasonForFailure || 'Transaction failed';
        await Referral.findOneAndUpdate(
          { user: userId },
          { $inc: { pendingWithdrawals: -TEST_AMOUNT } }
        );
        console.log('\n❌ FAILED -', withdrawal.rejectionReason);
      }

      await withdrawal.save();

      console.log('\n========== TEST RESULT ==========');
      console.log(`Status:          ${withdrawal.status.toUpperCase()}`);
      console.log(`Withdrawal ID:   ${withdrawal._id}`);
      console.log(`Client Ref:      ${clientReference}`);
      console.log(`Transaction Ref: ${txRef || 'N/A'}`);
      console.log(`Amount:          ₦${TEST_AMOUNT.toLocaleString()}`);
      console.log('=================================\n');

      return { success: true, withdrawal, lencoResponse: response.data };
    } else {
      throw new Error('Invalid response from Lenco API');
    }
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.response) {
      console.error('   Lenco Error:', JSON.stringify(error.response.data, null, 2));
    }
    return { success: false, error: error.message };
  } finally {
    await mongoose.disconnect();
    console.log('\nDB disconnected. Test complete.');
  }
}

// Run the test
const USER_ID = process.argv[2]; // Pass user ID as CLI argument

if (!USER_ID) {
  console.error('❌ Please provide a user ID: node testWithdrawal.js <userId>');
  process.exit(1);
}

testWithdrawal(USER_ID);