/**
 * updateUserTransactions.js
 * Script to update user transactions with corrected values
 * 
 * Usage: node scripts/updateUserTransactions.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

// User ID from your data
const USER_ID = "68b6dc19ecc12436f0b38be0";

// Updated transactions data based on your target values
const updatedTransactions = {
  // PaymentTransaction updates
  paymentTransactions: [
    {
      transactionId: "TXN-277DF77F-326451",
      updates: {
        amount: 800000,
        shares: 22,
        ownershipPct: 0.00000462,  // 0.000462%
        earningKobo: 308,
        earningNaira: "3.08"
      }
    },
    {
      transactionId: "TXN-BA67256A-113514",
      updates: {
        amount: 5000000,
        shares: 60,
        ownershipPct: 0.00003,  // 0.003%
        earningKobo: 1800,
        earningNaira: "18.00"
      }
    },
    {
      transactionId: "TXN-C51A756F-600204",
      updates: {
        amount: 2500000,
        shares: 27,
        ownershipPct: 0.0000135,  // 0.00135%
        earningKobo: 810,
        earningNaira: "8.10"
      }
    },
    {
      transactionId: "TXN-526361A3-882930",
      updates: {
        amount: 100000,
        shares: 2,
        ownershipPct: 0.000001,  // 0.0001%
        earningKobo: 60,
        earningNaira: "0.60"
      }
    },
    {
      transactionId: "CFD-28ADC821-672358",
      updates: {
        amount: 2000000,
        shares: 29,
        ownershipPct: 0.0000145,  // 0.00145%
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "CFD-75AD1BF6-989674",
      updates: {
        amount: 2500000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "69268bd0947f62a7279fb435",
      updates: {
        amount: 2000000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "CFD-92AEC484-840293",
      updates: {
        amount: 2100000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "CFD-65D2B42C-838636",
      updates: {
        amount: 3500000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "68ea4729918c41c434d186b3",
      updates: {
        amount: 4350000,
        shares: 60,
        ownershipPct: 0.00003,
        earningKobo: 1800,
        earningNaira: "18.00"
      }
    },
    {
      transactionId: "CFD-9BA1E97C-105556",
      updates: {
        amount: 3000000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "TXN-81CDBB4C-984454",
      updates: {
        amount: 55000,
        shares: 1,
        ownershipPct: 0.0000005,
        earningKobo: 30,
        earningNaira: "0.30"
      }
    }
  ],
  
  // UserShare updates
  userShares: [
    {
      transactionId: "692c6340ab0d7b19e7a3bd9c",
      updates: {
        amount: 2000000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "692aaefd68d8f5e1dac2d30e",
      updates: {
        amount: 2500000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    },
    {
      transactionId: "690c9f162e36ed2c65cf919d",
      updates: {
        amount: 3000000,
        shares: 29,
        ownershipPct: 0.0000145,
        earningKobo: 870,
        earningNaira: "8.70"
      }
    }
  ]
};

async function updateTransactions() {
  try {
    // Get MongoDB URI
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    
    if (!mongoURI) {
      console.error('❌ No MongoDB URI found in .env file');
      console.log('Please add MONGO_URI or MONGODB_URI to your .env file');
      process.exit(1);
    }
    
    console.log('🔌 Connecting to MongoDB...');
    console.log(`URI: ${mongoURI.substring(0, 50)}...`);
    
    await mongoose.connect(mongoURI);
    console.log('✅ Connected\n');

    // Show current database
    const dbName = mongoose.connection.db.databaseName;
    console.log(`📀 Database: ${dbName}`);
    console.log(`👤 User ID: ${USER_ID}\n`);

    // Check if user exists
    const userTransactions = await PaymentTransaction.find({ userId: USER_ID }).lean();
    console.log(`📊 Found ${userTransactions.length} PaymentTransactions for this user\n`);

    // Show what will be updated
    console.log('📋 PREVIEW OF UPDATES:');
    console.log('=' .repeat(70));
    console.log('PaymentTransactions to update:');
    updatedTransactions.paymentTransactions.forEach(tx => {
      console.log(`  ${tx.transactionId.padEnd(30)} -> ${tx.updates.shares} shares, ${(tx.updates.ownershipPct * 100).toFixed(6)}%, ₦${tx.updates.earningNaira}`);
    });
    
    console.log('\nUserShares to update:');
    updatedTransactions.userShares.forEach(tx => {
      console.log(`  ${tx.transactionId.padEnd(30)} -> ${tx.updates.shares} shares, ${(tx.updates.ownershipPct * 100).toFixed(6)}%, ₦${tx.updates.earningNaira}`);
    });
    console.log('=' .repeat(70));

    // Ask for confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('\n⚠️  Do you want to proceed with these updates? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Update cancelled.');
        rl.close();
        await mongoose.disconnect();
        process.exit(0);
      }

      await performUpdates();
      rl.close();
    });

  } catch (error) {
    console.error('❌ Connection error:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Check your .env file has MONGO_URI');
    console.log('2. Make sure MongoDB is running');
    console.log('3. Check your network connection');
    process.exit(1);
  }
}

async function performUpdates() {
  try {
    console.log(`\n📝 Updating transactions...\n`);

    // Update PaymentTransactions
    console.log('💰 Updating PaymentTransactions...');
    let ptUpdated = 0;
    let ptNotFound = 0;
    
    for (const tx of updatedTransactions.paymentTransactions) {
      const result = await PaymentTransaction.findOneAndUpdate(
        { 
          transactionId: tx.transactionId,
          userId: USER_ID 
        },
        { $set: tx.updates },
        { new: true }
      );
      
      if (result) {
        ptUpdated++;
        console.log(`  ✅ ${tx.transactionId}`);
        console.log(`     Shares: ${result.shares} | Ownership: ${(result.ownershipPct * 100).toFixed(6)}% | Earning: ₦${result.earningNaira}`);
      } else {
        ptNotFound++;
        console.log(`  ❌ Not found: ${tx.transactionId}`);
      }
    }
    console.log(`\n✅ Updated ${ptUpdated}/${updatedTransactions.paymentTransactions.length} PaymentTransactions\n`);

    // Update UserShares
    console.log('👥 Updating UserShares...');
    let usUpdated = 0;
    let usNotFound = 0;
    
    for (const tx of updatedTransactions.userShares) {
      // Find the UserShare document containing this transaction
      const userShareDoc = await UserShare.findOne({
        'transactions.transactionId': tx.transactionId
      });
      
      if (userShareDoc) {
        // Find the specific transaction in the array
        const transactionIndex = userShareDoc.transactions.findIndex(
          t => t.transactionId === tx.transactionId
        );
        
        if (transactionIndex !== -1) {
          // Update the transaction
          Object.assign(userShareDoc.transactions[transactionIndex], tx.updates);
          await userShareDoc.save();
          usUpdated++;
          console.log(`  ✅ ${tx.transactionId}`);
          console.log(`     Shares: ${tx.updates.shares} | Ownership: ${(tx.updates.ownershipPct * 100).toFixed(6)}% | Earning: ₦${tx.updates.earningNaira}`);
        } else {
          usNotFound++;
          console.log(`  ❌ Transaction not found in array: ${tx.transactionId}`);
        }
      } else {
        usNotFound++;
        console.log(`  ❌ UserShare document not found: ${tx.transactionId}`);
      }
    }
    console.log(`\n✅ Updated ${usUpdated}/${updatedTransactions.userShares.length} UserShare transactions\n`);

    // Verify updates
    console.log('🔍 Verifying updates...');
    
    const verifyPT = await PaymentTransaction.find({ 
      userId: USER_ID,
      transactionId: { $in: updatedTransactions.paymentTransactions.map(t => t.transactionId) }
    }).lean();
    
    console.log(`\n📊 Verification Results:`);
    console.log(`   Updated PaymentTransactions: ${verifyPT.length}`);
    
    // Calculate totals
    const totalShares = verifyPT.reduce((sum, tx) => sum + (tx.shares || 0), 0);
    const totalAmount = verifyPT.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const avgOwnership = verifyPT.reduce((sum, tx) => sum + (tx.ownershipPct || 0), 0) / verifyPT.length;
    
    console.log(`\n📈 Summary for User:`);
    console.log(`   Total Shares: ${totalShares}`);
    console.log(`   Total Amount: ₦${totalAmount.toLocaleString()}`);
    console.log(`   Average Ownership: ${(avgOwnership * 100).toFixed(6)}%`);
    console.log(`   Average per Share: ₦${(totalAmount / totalShares).toFixed(2)}`);
    
    // Show any transactions that still have null shares
    const nullShares = verifyPT.filter(tx => !tx.shares);
    if (nullShares.length > 0) {
      console.log(`\n⚠️  Transactions still with null shares:`);
      nullShares.forEach(tx => {
        console.log(`   - ${tx.transactionId}`);
      });
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Update complete!');
    
  } catch (error) {
    console.error('❌ Error during update:', error.message);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the update
updateTransactions();