#!/usr/bin/env node
// ===================================================================
// QUICK USER SHARES DIAGNOSTIC - Interactive Version
// ===================================================================
// Run with: node diagnose-user-quick.js
// It will prompt for MongoDB URI and User ID
// ===================================================================

const mongoose = require('mongoose');
const readline = require('readline');

// Create readline interface for interactive input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('\n=== USER SHARES DIAGNOSTIC (Quick Version) ===\n');
  
  // Get MongoDB URI
  const mongoUri = await question('Enter MongoDB Connection String: ');
  
  if (!mongoUri || mongoUri.trim() === '') {
    console.error('❌ MongoDB URI is required!');
    process.exit(1);
  }
  
  // Get User ID (with default)
  const defaultUserId = '6745f752ce52dd63c0758370';
  const userIdInput = await question(`Enter User ID (default: ${defaultUserId}): `);
  const userId = userIdInput.trim() || defaultUserId;
  
  rl.close();
  
  console.log('\nConnecting to database...');
  
  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
    
    // Import models after connection
    const Transaction = mongoose.model('PaymentTransaction') || require('./models/Transaction');
    const UserShare = mongoose.model('UserShare') || require('./models/UserShare');
    const User = mongoose.model('User') || require('./models/User');
    
    // Run the actual diagnosis
    await diagnoseUser(userId, User, Transaction, UserShare);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

async function diagnoseUser(userId, User, Transaction, UserShare) {
  console.log('🔍 DIAGNOSING USER SHARES...\n');
  console.log('User ID:', userId);
  console.log('='.repeat(70));
  
  // Get user info
  const user = await User.findById(userId);
  if (!user) {
    console.log('❌ User not found!');
    return;
  }
  
  console.log('User:', user.name || user.userName || user.email);
  console.log('Email:', user.email);
  console.log('');
  
  // ============ CHECK TRANSACTIONS ============
  console.log('1. CHECKING TRANSACTIONS');
  console.log('-'.repeat(70));
  
  const allTransactions = await Transaction.find({ userId });
  console.log(`Total Transactions: ${allTransactions.length}\n`);
  
  if (allTransactions.length === 0) {
    console.log('❌ No transactions found for this user!');
  } else {
    // Group by status
    const byStatus = {};
    const byType = {};
    
    allTransactions.forEach(tx => {
      const status = tx.status || 'unknown';
      const type = tx.type || 'unknown';
      
      byStatus[status] = (byStatus[status] || 0) + 1;
      byType[type] = (byType[type] || 0) + 1;
    });
    
    console.log('Transactions by STATUS:');
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`  ${status}: ${count}`);
    });
    
    console.log('\nTransactions by TYPE:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
    
    // Show sample transactions
    console.log('\n📋 Sample Transactions (first 5):');
    allTransactions.slice(0, 5).forEach((tx, idx) => {
      console.log(`\n${idx + 1}. Transaction ${tx.transactionId || tx._id}`);
      console.log(`   Type: ${tx.type || 'N/A'}`);
      console.log(`   Status: ${tx.status || 'N/A'}`);
      console.log(`   Shares: ${tx.shares || 0}`);
      console.log(`   Amount: ${tx.amount || tx.totalAmount || 0}`);
      console.log(`   Currency: ${tx.currency || 'N/A'}`);
      console.log(`   Date: ${tx.createdAt}`);
      console.log(`   Payment Method: ${tx.paymentMethod || 'N/A'}`);
    });
    
    // Count shares by status
    console.log('\n📊 SHARES COUNT BY STATUS:');
    const sharesByStatus = {};
    allTransactions.forEach(tx => {
      const status = tx.status || 'unknown';
      if (!sharesByStatus[status]) {
        sharesByStatus[status] = { count: 0, shares: 0 };
      }
      sharesByStatus[status].count += 1;
      sharesByStatus[status].shares += (tx.shares || 0);
    });
    
    Object.entries(sharesByStatus).forEach(([status, data]) => {
      console.log(`  ${status}: ${data.shares} shares (from ${data.count} transactions)`);
    });
  }
  
  // ============ CHECK USERSHARE MODEL ============
  console.log('\n\n2. CHECKING USERSHARE MODEL');
  console.log('-'.repeat(70));
  
  const userShare = await UserShare.findOne({ user: userId });
  
  if (!userShare) {
    console.log('❌ No UserShare record found for this user!');
    console.log('   This means shares may not have been allocated yet.');
  } else {
    console.log('✅ UserShare record found!');
    console.log('\nUserShare Details:');
    console.log(`  Total Shares: ${userShare.totalShares || 0}`);
    console.log(`  Transactions in record: ${userShare.transactions?.length || 0}`);
    
    if (userShare.transactions && userShare.transactions.length > 0) {
      console.log('\n📋 Transactions in UserShare:');
      userShare.transactions.forEach((tx, idx) => {
        console.log(`\n  ${idx + 1}. ${tx.transactionId}`);
        console.log(`     Shares: ${tx.shares || 0}`);
        console.log(`     Status: ${tx.status || 'N/A'}`);
        console.log(`     Co-Founder: ${tx.coFounderShares || 0}`);
        console.log(`     Amount: ${tx.totalAmount || 0}`);
      });
    }
  }
  
  // ============ INVESTIGATION FINDINGS ============
  console.log('\n\n3. INVESTIGATION FINDINGS');
  console.log('='.repeat(70));
  
  const completedTxs = allTransactions.filter(tx => tx.status === 'completed');
  const completedShares = completedTxs.reduce((sum, tx) => sum + (tx.shares || 0), 0);
  
  if (allTransactions.length > 0 && completedShares === 0) {
    console.log('\n❌ ISSUE IDENTIFIED:');
    console.log('   User has transactions BUT no completed transactions with shares!');
    console.log('\n🔍 Possible Causes:');
    console.log('   1. Transactions are pending/processing (not completed)');
    console.log('   2. Transactions were completed but shares not added to UserShare');
    console.log('   3. Transaction.shares field is not being set properly');
    console.log('   4. Using wrong status value (approved vs completed)');
    
    // Check which statuses have shares
    console.log('\n📋 Transactions with shares > 0:');
    const txsWithShares = allTransactions.filter(tx => (tx.shares || 0) > 0);
    if (txsWithShares.length === 0) {
      console.log('   ❌ NONE of the transactions have shares recorded!');
      console.log('   This is the root cause - shares field is not being populated.');
    } else {
      txsWithShares.forEach(tx => {
        console.log(`   - ${tx.transactionId}: ${tx.shares} shares (status: ${tx.status})`);
      });
    }
  }
  
  if (userShare && userShare.totalShares > 0) {
    console.log('\n✅ GOOD NEWS:');
    console.log(`   User DOES have ${userShare.totalShares} shares in UserShare model!`);
    console.log('\n🔧 FIX NEEDED:');
    console.log('   The admin overview controller should also check UserShare.totalShares');
    console.log('   Not just Transaction records.');
  }
  
  // ============ RECOMMENDATIONS ============
  console.log('\n\n4. RECOMMENDATIONS');
  console.log('='.repeat(70));
  
  if (userShare && userShare.totalShares > 0) {
    console.log('\n✅ PRIMARY FIX:');
    console.log('   Update the controller to use UserShare.totalShares as the source of truth');
    console.log('   for the user\'s current share balance.');
  } else if (allTransactions.length > 0) {
    console.log('\n🔧 REQUIRED ACTIONS:');
    console.log('   1. Check why transactions don\'t have "completed" status');
    console.log('   2. Verify share allocation workflow is working');
    console.log('   3. Consider manually allocating shares if transactions were successful');
  } else {
    console.log('\n❓ No transactions and no shares - user may not have purchased yet.');
  }
  
  console.log('\n' + '='.repeat(70));
}

// Run the script
main().catch(console.error);