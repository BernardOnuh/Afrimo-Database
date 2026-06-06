/**
 * fixUserShareData.js
 * Sync UserShare records to match PaymentTransaction data
 * 
 * Usage: node scripts/fixUserShareData.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');

const USER_ID = "68b6dc19ecc12436f0b38be0";

// Mapping of old UserShare transactions to new values based on your data
const userShareFixes = {
  "692c6340ab0d7b19e7a3bd9c": {
    // This should match CFD-28ADC821-672358 (₦2M, 29 shares)
    newAmount: 2000000,
    newShares: 29,
    newOwnershipPct: 0.0000145,
    newEarningKobo: 870,
    newEarningNaira: "8.70"
  },
  "692aaefd68d8f5e1dac2d30e": {
    // This should match CFD-75AD1BF6-989674 (₦2.5M, 29 shares)
    newAmount: 2500000,
    newShares: 29,
    newOwnershipPct: 0.0000145,
    newEarningKobo: 870,
    newEarningNaira: "8.70"
  },
  "690c9f162e36ed2c65cf919d": {
    // This should match CFD-9BA1E97C-105556 (₦3M, 29 shares)
    newAmount: 3000000,
    newShares: 29,
    newOwnershipPct: 0.0000145,
    newEarningKobo: 870,
    newEarningNaira: "8.70"
  }
};

async function fixUserShare() {
  try {
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error('❌ No MongoDB URI found');
      process.exit(1);
    }

    console.log('🔌 Connecting...');
    await mongoose.connect(mongoURI);
    console.log('✅ Connected\n');

    // Find the user's UserShare document
    const userShareDoc = await UserShare.findOne({ user: USER_ID });
    
    if (!userShareDoc) {
      console.log('❌ No UserShare document found for this user');
      process.exit(1);
    }

    console.log(`📄 Found UserShare document with ${userShareDoc.transactions.length} transactions\n`);
    
    // Show current vs target
    console.log('📊 CURRENT VALUES:');
    userShareDoc.transactions.forEach(tx => {
      console.log(`  ${tx.transactionId}`);
      console.log(`    Amount: ₦${tx.amount}, Shares: ${tx.shares}, Ownership: ${(tx.ownershipPct * 100).toFixed(6)}%`);
    });
    
    console.log('\n🎯 TARGET VALUES:');
    Object.entries(userShareFixes).forEach(([id, fix]) => {
      console.log(`  ${id}`);
      console.log(`    Amount: ₦${fix.newAmount}, Shares: ${fix.newShares}, Ownership: ${(fix.newOwnershipPct * 100).toFixed(6)}%`);
    });
    
    // Ask for confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\n⚠️  Update UserShare records? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Cancelled');
        rl.close();
        await mongoose.disconnect();
        process.exit(0);
      }
      
      // Update each transaction
      let updated = 0;
      for (const tx of userShareDoc.transactions) {
        const fix = userShareFixes[tx.transactionId];
        if (fix) {
          tx.amount = fix.newAmount;
          tx.shares = fix.newShares;
          tx.ownershipPct = fix.newOwnershipPct;
          tx.earningKobo = fix.newEarningKobo;
          tx.earningNaira = fix.newEarningNaira;
          updated++;
          console.log(`✅ Updated: ${tx.transactionId}`);
        }
      }
      
      // Recalculate total for the UserShare document
      userShareDoc.totalOwnershipPct = userShareDoc.transactions.reduce(
        (sum, tx) => sum + (tx.ownershipPct || 0), 0
      );
      userShareDoc.totalEarningKobo = userShareDoc.transactions.reduce(
        (sum, tx) => sum + (tx.earningKobo || 0), 0
      );
      
      await userShareDoc.save();
      
      console.log(`\n✅ Updated ${updated} UserShare transactions`);
      console.log(`📊 New totals: ${(userShareDoc.totalOwnershipPct * 100).toFixed(6)}% ownership, ₦${(userShareDoc.totalEarningKobo / 100).toFixed(2)} earnings`);
      
      await mongoose.disconnect();
      console.log('\n✅ Done!');
      rl.close();
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixUserShare();