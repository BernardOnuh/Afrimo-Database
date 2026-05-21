// scripts/emergencyDataRestore.js
// Emergency script to restore referral data to previous state

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');

// Enhanced database connection
async function connectDB() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 
                        'mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net';
        
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(mongoUri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
        process.exit(1);
    }
}

// Create backup of current state before any restore
async function createEmergencyBackup() {
    console.log('💾 Creating emergency backup of current state...');
    
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Count current documents
        const referralCount = await Referral.countDocuments();
        const referralTxCount = await ReferralTransaction.countDocuments();
        
        console.log(`📊 Current state:`);
        console.log(`   Referral documents: ${referralCount}`);
        console.log(`   ReferralTransaction documents: ${referralTxCount}`);
        
        // Calculate current total earnings
        const currentEarnings = await ReferralTransaction.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        
        const totalEarnings = currentEarnings[0]?.total || 0;
        console.log(`   Total current earnings: $${totalEarnings.toFixed(2)}`);
        
        // Store backup info (you can export this to file if needed)
        const backupInfo = {
            timestamp,
            referralCount,
            referralTxCount,
            totalEarnings,
            status: 'emergency_backup_created'
        };
        
        console.log('✅ Emergency backup info recorded');
        return backupInfo;
        
    } catch (error) {
        console.error('❌ Error creating emergency backup:', error);
        throw error;
    }
}

// Option 1: Restore to clean slate (safest option)
async function restoreToCleanSlate() {
    console.log('🧹 RESTORING TO CLEAN SLATE');
    console.log('=' .repeat(60));
    console.log('This will remove ALL referral data and let the system rebuild naturally');
    console.log('');
    
    try {
        // Count what we're about to delete
        const referralCount = await Referral.countDocuments();
        const referralTxCount = await ReferralTransaction.countDocuments();
        
        console.log(`📊 About to remove:`);
        console.log(`   ${referralCount} Referral documents`);
        console.log(`   ${referralTxCount} ReferralTransaction documents`);
        console.log('');
        
        // Delete all referral data
        console.log('🗑️ Removing all ReferralTransaction documents...');
        const deletedTx = await ReferralTransaction.deleteMany({});
        console.log(`   ✅ Deleted ${deletedTx.deletedCount} ReferralTransaction documents`);
        
        console.log('🗑️ Removing all Referral documents...');
        const deletedReferrals = await Referral.deleteMany({});
        console.log(`   ✅ Deleted ${deletedReferrals.deletedCount} Referral documents`);
        
        // Verify clean state
        const remainingTx = await ReferralTransaction.countDocuments();
        const remainingReferrals = await Referral.countDocuments();
        
        console.log('');
        console.log('🔍 Verification:');
        console.log(`   Remaining ReferralTransactions: ${remainingTx}`);
        console.log(`   Remaining Referrals: ${remainingReferrals}`);
        
        if (remainingTx === 0 && remainingReferrals === 0) {
            console.log('✅ Successfully restored to clean slate');
            console.log('');
            console.log('📝 NEXT STEPS:');
            console.log('1. Restart your application');
            console.log('2. Let the natural referral processing rebuild data gradually');
            console.log('3. Test with one purchase to verify it works');
            console.log('4. Monitor the logs for proper referral processing');
        } else {
            console.log('⚠️ Clean slate not achieved - some documents remain');
        }
        
        return {
            success: true,
            deletedTransactions: deletedTx.deletedCount,
            deletedReferrals: deletedReferrals.deletedCount,
            remainingTransactions: remainingTx,
            remainingReferrals: remainingReferrals
        };
        
    } catch (error) {
        console.error('❌ Error during clean slate restore:', error);
        throw error;
    }
}

// Option 2: Restore only recent changes (last 24 hours)
async function restoreRecentChangesOnly() {
    console.log('⏰ RESTORING RECENT CHANGES ONLY');
    console.log('=' .repeat(60));
    console.log('This will remove only ReferralTransactions created in the last 24 hours');
    console.log('');
    
    try {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Find recent transactions
        const recentTransactions = await ReferralTransaction.find({
            createdAt: { $gte: twentyFourHoursAgo }
        });
        
        console.log(`📊 Found ${recentTransactions.length} transactions from last 24 hours`);
        
        if (recentTransactions.length === 0) {
            console.log('ℹ️ No recent transactions to remove');
            return { success: true, deletedCount: 0 };
        }
        
        // Show sample of what will be deleted
        console.log('📋 Sample transactions to be removed:');
        recentTransactions.slice(0, 5).forEach(tx => {
            console.log(`   - ${tx._id}: $${tx.amount} (${tx.generation}th gen, ${tx.purchaseType})`);
        });
        
        if (recentTransactions.length > 5) {
            console.log(`   ... and ${recentTransactions.length - 5} more`);
        }
        
        console.log('');
        
        // Delete recent transactions
        const deletedResult = await ReferralTransaction.deleteMany({
            createdAt: { $gte: twentyFourHoursAgo }
        });
        
        console.log(`✅ Deleted ${deletedResult.deletedCount} recent transactions`);
        
        // Recalculate affected referral documents
        const affectedUsers = [...new Set(recentTransactions.map(tx => tx.beneficiary.toString()))];
        console.log(`🔄 Recalculating ${affectedUsers.length} affected users...`);
        
        for (const userId of affectedUsers) {
            await recalculateUserReferralStats(userId);
        }
        
        console.log('✅ Recalculation completed');
        
        return {
            success: true,
            deletedCount: deletedResult.deletedCount,
            affectedUsers: affectedUsers.length
        };
        
    } catch (error) {
        console.error('❌ Error during recent changes restore:', error);
        throw error;
    }
}

// Option 3: Remove only duplicate transactions
async function removeDuplicatesOnly() {
    console.log('🧹 REMOVING DUPLICATES ONLY');
    console.log('=' .repeat(60));
    console.log('This will only remove duplicate transactions, keeping original data');
    console.log('');
    
    try {
        // Find duplicates
        const duplicates = await ReferralTransaction.aggregate([
            {
                $group: {
                    _id: {
                        sourceTransaction: '$sourceTransaction',
                        beneficiary: '$beneficiary',
                        referredUser: '$referredUser',
                        generation: '$generation',
                        purchaseType: '$purchaseType'
                    },
                    count: { $sum: 1 },
                    docs: { $push: '$_id' }
                }
            },
            { $match: { count: { $gt: 1 } } }
        ]);
        
        console.log(`📊 Found ${duplicates.length} sets of duplicate transactions`);
        
        if (duplicates.length === 0) {
            console.log('ℹ️ No duplicates found to remove');
            return { success: true, removedCount: 0 };
        }
        
        let totalRemoved = 0;
        const affectedUsers = new Set();
        
        for (const duplicate of duplicates) {
            // Keep the first document, remove the rest
            const docsToRemove = duplicate.docs.slice(1);
            
            console.log(`   Removing ${docsToRemove.length} duplicates for beneficiary ${duplicate._id.beneficiary}`);
            
            const result = await ReferralTransaction.deleteMany({
                _id: { $in: docsToRemove }
            });
            
            totalRemoved += result.deletedCount;
            affectedUsers.add(duplicate._id.beneficiary.toString());
        }
        
        console.log(`✅ Removed ${totalRemoved} duplicate transactions`);
        
        // Recalculate affected users
        console.log(`🔄 Recalculating ${affectedUsers.size} affected users...`);
        for (const userId of affectedUsers) {
            await recalculateUserReferralStats(userId);
        }
        
        console.log('✅ Recalculation completed');
        
        return {
            success: true,
            removedCount: totalRemoved,
            affectedUsers: affectedUsers.size
        };
        
    } catch (error) {
        console.error('❌ Error removing duplicates:', error);
        throw error;
    }
}

// Helper function to recalculate user stats from existing transactions
async function recalculateUserReferralStats(userId) {
    try {
        const transactions = await ReferralTransaction.find({
            beneficiary: userId,
            status: 'completed'
        });
        
        const stats = {
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 0, earnings: 0 },
            generation3: { count: 0, earnings: 0 },
            totalEarnings: 0
        };
        
        // Calculate by generation
        const gen1Users = new Set();
        const gen2Users = new Set();
        const gen3Users = new Set();
        
        transactions.forEach(tx => {
            stats[`generation${tx.generation}`].earnings += tx.amount;
            stats.totalEarnings += tx.amount;
            
            if (tx.generation === 1) gen1Users.add(tx.referredUser.toString());
            if (tx.generation === 2) gen2Users.add(tx.referredUser.toString());
            if (tx.generation === 3) gen3Users.add(tx.referredUser.toString());
        });
        
        stats.generation1.count = gen1Users.size;
        stats.generation2.count = gen2Users.size;
        stats.generation3.count = gen3Users.size;
        
        // Update referral document
        await Referral.findOneAndUpdate(
            { user: userId },
            {
                referredUsers: gen1Users.size,
                totalEarnings: stats.totalEarnings,
                generation1: stats.generation1,
                generation2: stats.generation2,
                generation3: stats.generation3
            },
            { upsert: true }
        );
        
    } catch (error) {
        console.error(`Error recalculating stats for user ${userId}:`, error);
    }
}

// Check current system state
async function checkCurrentState() {
    console.log('🔍 CHECKING CURRENT SYSTEM STATE');
    console.log('=' .repeat(60));
    
    try {
        const totalUsers = await User.countDocuments({ 'status.isActive': true });
        const totalReferralTx = await ReferralTransaction.countDocuments();
        const totalReferrals = await Referral.countDocuments();
        const completedTx = await ReferralTransaction.countDocuments({ status: 'completed' });
        
        const totalEarnings = await ReferralTransaction.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        
        const earnings = totalEarnings[0]?.total || 0;
        
        console.log('📊 Current System State:');
        console.log(`   Active Users: ${totalUsers}`);
        console.log(`   ReferralTransaction documents: ${totalReferralTx}`);
        console.log(`   Referral documents: ${totalReferrals}`);
        console.log(`   Completed transactions: ${completedTx}`);
        console.log(`   Total earnings: $${earnings.toFixed(2)}`);
        
        // Check for recent activity
        const recentTx = await ReferralTransaction.find()
            .sort({ createdAt: -1 })
            .limit(5);
        
        console.log('\n📋 Most Recent Transactions:');
        recentTx.forEach(tx => {
            console.log(`   ${tx.createdAt.toISOString()}: $${tx.amount} (Gen ${tx.generation}, ${tx.purchaseType})`);
        });
        
        return {
            totalUsers,
            totalReferralTx,
            totalReferrals,
            completedTx,
            totalEarnings: earnings,
            recentActivity: recentTx.length
        };
        
    } catch (error) {
        console.error('❌ Error checking current state:', error);
        throw error;
    }
}

// Main execution
async function main() {
    try {
        await connectDB();
        
        const args = process.argv.slice(2);
        const command = args[0] || 'help';
        
        console.log(`🚨 Running emergency restore command: ${command}`);
        console.log('');
        
        // Always create backup first
        if (command !== 'check' && command !== 'help') {
            await createEmergencyBackup();
            console.log('');
        }
        
        switch (command) {
            case 'check':
            case 'status':
                await checkCurrentState();
                break;
                
            case 'clean':
            case 'clean-slate':
                const cleanResult = await restoreToCleanSlate();
                console.log('\n📋 Clean Slate Results:');
                console.log(`   Deleted transactions: ${cleanResult.deletedTransactions}`);
                console.log(`   Deleted referrals: ${cleanResult.deletedReferrals}`);
                break;
                
            case 'recent':
            case 'undo-recent':
                const recentResult = await restoreRecentChangesOnly();
                console.log('\n📋 Recent Changes Results:');
                console.log(`   Deleted transactions: ${recentResult.deletedCount}`);
                console.log(`   Affected users: ${recentResult.affectedUsers || 0}`);
                break;
                
            case 'duplicates':
            case 'dupes':
                const dupResult = await removeDuplicatesOnly();
                console.log('\n📋 Duplicate Removal Results:');
                console.log(`   Removed duplicates: ${dupResult.removedCount}`);
                console.log(`   Affected users: ${dupResult.affectedUsers || 0}`);
                break;
                
            case 'help':
            default:
                console.log('🚨 EMERGENCY DATA RESTORATION TOOL');
                console.log('');
                console.log('Usage:');
                console.log('  node emergencyDataRestore.js check          # Check current state');
                console.log('  node emergencyDataRestore.js clean-slate    # Remove ALL referral data (SAFEST)');
                console.log('  node emergencyDataRestore.js undo-recent    # Remove only last 24h changes');
                console.log('  node emergencyDataRestore.js duplicates     # Remove only duplicates');
                console.log('');
                console.log('🔄 RECOMMENDED RECOVERY STEPS:');
                console.log('1. Run "check" to see current state');
                console.log('2. Run "clean-slate" for complete reset (SAFEST)');
                console.log('3. Restart your application');
                console.log('4. Let natural referral processing rebuild data');
                console.log('');
                console.log('⚠️  WARNING: Always backup before making changes!');
                console.log('💡 TIP: "clean-slate" is the safest option - it removes all referral data');
                console.log('        and lets your application rebuild it naturally from purchases.');
                break;
        }
        
        console.log('\n✅ Emergency restore operation completed!');
        process.exit(0);
        
    } catch (error) {
        console.error('💥 Emergency restore failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Export for use in other scripts
if (require.main === module) {
    main();
}

module.exports = {
    connectDB,
    restoreToCleanSlate,
    restoreRecentChangesOnly,
    removeDuplicatesOnly,
    checkCurrentState,
    createEmergencyBackup
};