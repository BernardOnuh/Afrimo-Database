/**
 * fixUserSharesDirect.js
 * Direct update script for UserShare records
 * 
 * Usage: node scripts/fixUserSharesDirect.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const USER_ID = "68b6dc19ecc12436f0b38be0";

async function fixUserShares() {
  try {
    const mongoURI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoURI) {
      console.error('❌ No MongoDB URI found');
      process.exit(1);
    }

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(mongoURI);
    console.log('✅ Connected\n');

    // Get the UserShare model
    const UserShare = mongoose.model('UserShare');
    
    // Find the document
    const userShare = await UserShare.findOne({ user: USER_ID });
    
    if (!userShare) {
      console.log('❌ UserShare document not found');
      process.exit(1);
    }
    
    console.log('📄 Current UserShare transactions:');
    userShare.transactions.forEach(tx => {
      console.log(`  ${tx.transactionId}: ${tx.shares} shares, ₦${tx.amount}`);
    });
    
    // Update each transaction
    let updated = 0;
    
    for (let i = 0; i < userShare.transactions.length; i++) {
      const tx = userShare.transactions[i];
      
      if (tx.transactionId === "692c6340ab0d7b19e7a3bd9c") {
        console.log(`\n✏️ Updating ${tx.transactionId}:`);
        console.log(`   Before: ${tx.shares} shares, ₦${tx.amount}`);
        
        tx.amount = 2000000;
        tx.shares = 29;
        tx.ownershipPct = 0.0000145;
        tx.earningKobo = 870;
        tx.earningNaira = "8.70";
        
        console.log(`   After:  ${tx.shares} shares, ₦${tx.amount}`);
        updated++;
      }
      
      if (tx.transactionId === "692aaefd68d8f5e1dac2d30e") {
        console.log(`\n✏️ Updating ${tx.transactionId}:`);
        console.log(`   Before: ${tx.shares} shares, ₦${tx.amount}`);
        
        tx.amount = 2500000;
        tx.shares = 29;
        tx.ownershipPct = 0.0000145;
        tx.earningKobo = 870;
        tx.earningNaira = "8.70";
        
        console.log(`   After:  ${tx.shares} shares, ₦${tx.amount}`);
        updated++;
      }
      
      if (tx.transactionId === "690c9f162e36ed2c65cf919d") {
        console.log(`\n✏️ Updating ${tx.transactionId}:`);
        console.log(`   Before: ${tx.shares} shares, ₦${tx.amount}`);
        
        tx.amount = 3000000;
        tx.shares = 29;
        tx.ownershipPct = 0.0000145;
        tx.earningKobo = 870;
        tx.earningNaira = "8.70";
        
        console.log(`   After:  ${tx.shares} shares, ₦${tx.amount}`);
        updated++;
      }
    }
    
    // Recalculate totals
    const totalOwnershipPct = userShare.transactions.reduce((sum, tx) => sum + (tx.ownershipPct || 0), 0);
    const totalEarningKobo = userShare.transactions.reduce((sum, tx) => sum + (tx.earningKobo || 0), 0);
    
    userShare.totalOwnershipPct = totalOwnershipPct;
    userShare.totalEarningKobo = totalEarningKobo;
    
    // Save the document
    await userShare.save();
    
    console.log(`\n✅ Updated ${updated} transactions`);
    console.log(`📊 New totals: ${(totalOwnershipPct * 100).toFixed(6)}% ownership`);
    console.log(`💰 Total earnings: ₦${(totalEarningKobo / 100).toFixed(2)}`);
    
    // Verify
    const verify = await UserShare.findOne({ user: USER_ID });
    console.log('\n🔍 Verification:');
    verify.transactions.forEach(tx => {
      if (tx.transactionId.includes("692")) {
        console.log(`  ${tx.transactionId}: ${tx.shares} shares, ₦${tx.amount}`);
      }
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixUserShares();