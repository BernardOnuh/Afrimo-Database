// migrations/add_cofounder_ratio.js
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') }); // Load environment variables

// Import your models - adjust paths based on your project structure
const CoFounderShare = require('../models/CoFounderShare');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction'); // Adjust if different

console.log('='.repeat(60));
console.log('CO-FOUNDER SHARE RATIO MIGRATION');
console.log('Adding 29:1 ratio support to existing records');
console.log('='.repeat(60));

async function migrateCoFounderShares() {
  let connection;
  
  try {
    console.log('🔌 Connecting to database...');
    
    // Connect to database
    connection = await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('✅ Connected to database successfully');
    console.log(`📊 Database: ${mongoose.connection.name}`);
    console.log();
    
    // ===========================================
    // STEP 1: Update CoFounderShare Collection
    // ===========================================
    console.log('📝 STEP 1: Updating CoFounderShare collection...');
    
    // Check existing CoFounderShare records
    const existingCoFounderShares = await CoFounderShare.find({});
    console.log(`   Found ${existingCoFounderShares.length} CoFounderShare record(s)`);
    
    // Update records that don't have shareToRegularRatio
    const coFounderUpdate = await CoFounderShare.updateMany(
      { shareToRegularRatio: { $exists: false } },
      { $set: { shareToRegularRatio: 29 } }
    );
    
    console.log(`   ✅ Updated ${coFounderUpdate.modifiedCount} CoFounderShare record(s) with ratio: 29`);
    
    // If no CoFounderShare record exists, create default one
    if (existingCoFounderShares.length === 0) {
      const defaultCoFounderShare = new CoFounderShare({
        totalShares: 500,
        sharesSold: 0,
        shareToRegularRatio: 29,
        pricing: {
          priceNaira: 1000000,
          priceUSDT: 1000
        }
      });
      await defaultCoFounderShare.save();
      console.log('   ✅ Created default CoFounderShare record');
    }
    
    console.log();
    
    // ===========================================
    // STEP 2: Update UserShare Collection
    // ===========================================
    console.log('📝 STEP 2: Updating UserShare collection...');
    
    // Check existing UserShare records
    const existingUserShares = await UserShare.find({});
    console.log(`   Found ${existingUserShares.length} UserShare record(s)`);
    
    // Update UserShare records that don't have the new fields
    const userShareUpdate = await UserShare.updateMany(
      { 
        $or: [
          { coFounderShares: { $exists: false } },
          { equivalentRegularShares: { $exists: false } }
        ]
      },
      { 
        $set: { 
          coFounderShares: 0,
          equivalentRegularShares: 0
        }
      }
    );
    
    console.log(`   ✅ Updated ${userShareUpdate.modifiedCount} UserShare record(s) with new fields`);
    console.log();
    
    // ===========================================
    // STEP 3: Update Existing Co-Founder Transactions in UserShare
    // ===========================================
    console.log('📝 STEP 3: Updating existing co-founder transactions in UserShare...');
    
    // Find all users who have co-founder transactions
    const userSharesWithCoFounderTxns = await UserShare.find({
      'transactions.paymentMethod': { $in: ['co-founder', 'cofounder'] }
    });
    
    console.log(`   Found ${userSharesWithCoFounderTxns.length} UserShare record(s) with co-founder transactions`);
    
    let transactionUpdates = 0;
    let userUpdates = 0;
    
    for (const userShare of userSharesWithCoFounderTxns) {
      let updated = false;
      
      for (const transaction of userShare.transactions) {
        // Check if this is a co-founder transaction that needs updating
        if ((transaction.paymentMethod === 'co-founder' || transaction.paymentMethod === 'cofounder') 
            && !transaction.shareToRegularRatio) {
          
          // Add ratio information to existing transactions
          transaction.shareToRegularRatio = 29;
          transaction.coFounderShares = transaction.shares;
          transaction.equivalentRegularShares = transaction.shares * 29;
          
          updated = true;
          transactionUpdates++;
        }
      }
      
      if (updated) {
        // Recalculate user's total co-founder shares and equivalent regular shares
        userShare.coFounderShares = userShare.transactions
          .filter(t => t.status === 'completed' && (t.paymentMethod === 'co-founder' || t.paymentMethod === 'cofounder'))
          .reduce((sum, t) => sum + (t.coFounderShares || 0), 0);
          
        userShare.equivalentRegularShares = userShare.transactions
          .filter(t => t.status === 'completed' && (t.paymentMethod === 'co-founder' || t.paymentMethod === 'cofounder'))
          .reduce((sum, t) => sum + (t.equivalentRegularShares || 0), 0);
        
        // Update the total shares to include equivalent regular shares
        const regularShares = userShare.transactions
          .filter(t => t.status === 'completed' && t.paymentMethod !== 'co-founder' && t.paymentMethod !== 'cofounder')
          .reduce((sum, t) => sum + (t.shares || 0), 0);
        
        userShare.totalShares = regularShares + userShare.equivalentRegularShares;
        
        await userShare.save();
        userUpdates++;
      }
    }
    
    console.log(`   ✅ Updated ${transactionUpdates} co-founder transaction(s)`);
    console.log(`   ✅ Updated ${userUpdates} UserShare record(s) with recalculated totals`);
    console.log();
    
    // ===========================================
    // STEP 4: Update PaymentTransaction Collection
    // ===========================================
    console.log('📝 STEP 4: Updating PaymentTransaction collection...');
    
    // Find co-founder transactions in PaymentTransaction collection
    const coFounderTransactions = await PaymentTransaction.find({
      type: 'co-founder'
    });
    
    console.log(`   Found ${coFounderTransactions.length} co-founder PaymentTransaction record(s)`);
    
    let paymentTxnUpdates = 0;
    
    for (const transaction of coFounderTransactions) {
      let needsUpdate = false;
      
      // Add shareToRegularRatio if missing
      if (!transaction.shareToRegularRatio) {
        transaction.shareToRegularRatio = 29;
        needsUpdate = true;
      }
      
      // Add coFounderShares if missing
      if (!transaction.coFounderShares) {
        transaction.coFounderShares = transaction.shares;
        needsUpdate = true;
      }
      
      // Add equivalentRegularShares if missing
      if (!transaction.equivalentRegularShares) {
        transaction.equivalentRegularShares = transaction.shares * 29;
        needsUpdate = true;
      }
      
      if (needsUpdate) {
        await transaction.save();
        paymentTxnUpdates++;
      }
    }
    
    console.log(`   ✅ Updated ${paymentTxnUpdates} PaymentTransaction record(s)`);
    console.log();
    
    // ===========================================
    // STEP 5: Verification
    // ===========================================
    console.log('📝 STEP 5: Verifying migration results...');
    
    // Verify CoFounderShare
    const updatedCoFounderShares = await CoFounderShare.find({});
    const coFounderSharesWithRatio = await CoFounderShare.countDocuments({
      shareToRegularRatio: { $exists: true }
    });
    
    console.log(`   CoFounderShare: ${coFounderSharesWithRatio}/${updatedCoFounderShares.length} have shareToRegularRatio`);
    
    // Verify UserShare
    const totalUserShares = await UserShare.countDocuments({});
    const userSharesWithNewFields = await UserShare.countDocuments({
      coFounderShares: { $exists: true },
      equivalentRegularShares: { $exists: true }
    });
    
    console.log(`   UserShare: ${userSharesWithNewFields}/${totalUserShares} have new co-founder fields`);
    
    // Verify PaymentTransaction
    const totalCoFounderTxns = await PaymentTransaction.countDocuments({ type: 'co-founder' });
    const coFounderTxnsWithRatio = await PaymentTransaction.countDocuments({
      type: 'co-founder',
      shareToRegularRatio: { $exists: true }
    });
    
    console.log(`   PaymentTransaction: ${coFounderTxnsWithRatio}/${totalCoFounderTxns} co-founder transactions have ratio fields`);
    console.log();
    
    // ===========================================
    // SUMMARY
    // ===========================================
    console.log('🎉 MIGRATION COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log('Summary of changes:');
    console.log(`✅ CoFounderShare records updated: ${coFounderUpdate.modifiedCount}`);
    console.log(`✅ UserShare records updated: ${userShareUpdate.modifiedCount}`);
    console.log(`✅ Co-founder transactions updated: ${transactionUpdates}`);
    console.log(`✅ PaymentTransaction records updated: ${paymentTxnUpdates}`);
    console.log(`✅ User totals recalculated: ${userUpdates}`);
    console.log();
    console.log('🔧 Ratio configuration:');
    console.log('   1 Co-Founder Share = 29 Regular Shares');
    console.log();
    console.log('📋 Next steps:');
    console.log('   1. Deploy your updated models and controllers');
    console.log('   2. Test the co-founder share functionality');
    console.log('   3. Verify user share calculations are correct');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('❌ MIGRATION FAILED!');
    console.error('Error details:', error);
    console.log();
    console.log('🔧 Troubleshooting:');
    console.log('   1. Check your database connection string');
    console.log('   2. Ensure your models are properly imported');
    console.log('   3. Verify you have the required permissions');
    console.log('   4. Check the error message above for specific issues');
    
    throw error;
  } finally {
    // Close database connection
    if (connection) {
      console.log('🔌 Closing database connection...');
      await mongoose.connection.close();
      console.log('✅ Database connection closed');
    }
  }
}

// Function to check if migration is needed
async function checkMigrationStatus() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    
    const coFounderSharesNeedUpdate = await CoFounderShare.countDocuments({
      shareToRegularRatio: { $exists: false }
    });
    
    const userSharesNeedUpdate = await UserShare.countDocuments({
      $or: [
        { coFounderShares: { $exists: false } },
        { equivalentRegularShares: { $exists: false } }
      ]
    });
    
    const transactionsNeedUpdate = await PaymentTransaction.countDocuments({
      type: 'co-founder',
      shareToRegularRatio: { $exists: false }
    });
    
    const needsMigration = coFounderSharesNeedUpdate > 0 || userSharesNeedUpdate > 0 || transactionsNeedUpdate > 0;
    
    console.log('Migration Status Check:');
    console.log(`CoFounderShare records needing update: ${coFounderSharesNeedUpdate}`);
    console.log(`UserShare records needing update: ${userSharesNeedUpdate}`);
    console.log(`PaymentTransaction records needing update: ${transactionsNeedUpdate}`);
    console.log(`Migration needed: ${needsMigration ? 'YES' : 'NO'}`);
    
    await mongoose.connection.close();
    
    return needsMigration;
  } catch (error) {
    console.error('Error checking migration status:', error);
    await mongoose.connection.close();
    return true; // Assume migration is needed if we can't check
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--check')) {
    // Just check if migration is needed
    await checkMigrationStatus();
    process.exit(0);
  } else if (args.includes('--force') || args.includes('--migrate')) {
    // Force run migration
    await migrateCoFounderShares();
    process.exit(0);
  } else {
    // Check if migration is needed, then prompt
    const needsMigration = await checkMigrationStatus();
    
    if (needsMigration) {
      console.log();
      console.log('⚠️  Migration is required!');
      console.log('Run with --migrate flag to execute the migration:');
      console.log('   node migrations/add_cofounder_ratio.js --migrate');
      process.exit(1);
    } else {
      console.log();
      console.log('✅ No migration needed. All records are up to date.');
      process.exit(0);
    }
  }
}

// Run only if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for use in other scripts
module.exports = {
  migrateCoFounderShares,
  checkMigrationStatus
};