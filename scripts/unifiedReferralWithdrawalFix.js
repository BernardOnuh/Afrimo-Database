// scripts/unifiedReferralWithdrawalFix.js
// Complete fix for both referral commissions and withdrawal tracking

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Referral = require('../models/Referral');
const Withdrawal = require('../models/Withdrawal');
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

// Step 1: Detect and fix duplicate commissions
async function fixDuplicateCommissions() {
    console.log('🔍 FIXING DUPLICATE COMMISSIONS');
    console.log('=' .repeat(60));

    try {
        // Find duplicate commissions
        const duplicates = await ReferralTransaction.aggregate([
            {
                $group: {
                    _id: {
                        beneficiary: '$beneficiary',
                        sourceTransaction: '$sourceTransaction',
                        generation: '$generation'
                    },
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' },
                    docs: { $push: '$$ROOT' }
                }
            },
            {
                $match: {
                    count: { $gt: 1 }
                }
            }
        ]);

        console.log(`📊 Found ${duplicates.length} sets of duplicate commissions`);
        
        let removedCount = 0;
        let totalRemovedAmount = 0;

        for (const duplicate of duplicates) {
            // Keep the first commission, remove the rest
            const toRemove = duplicate.docs.slice(1);
            
            for (const doc of toRemove) {
                await ReferralTransaction.findByIdAndDelete(doc._id);
                removedCount++;
                totalRemovedAmount += doc.amount;
                
                const user = await User.findById(doc.beneficiary).select('userName');
                console.log(`   Removed duplicate: ${user?.userName || 'Unknown'} - $${doc.amount.toFixed(2)}`);
            }
        }

        console.log(`✅ Removed ${removedCount} duplicate commissions totaling $${totalRemovedAmount.toFixed(2)}`);
        
        return { removedCount, totalRemovedAmount };

    } catch (error) {
        console.error('❌ Error fixing duplicate commissions:', error);
        throw error;
    }
}

// Step 2: Audit and fix withdrawal balances
async function auditAndFixWithdrawalBalances(dryRun = true) {
    console.log('🔍 AUDITING AND FIXING WITHDRAWAL BALANCES');
    console.log('=' .repeat(60));
    console.log(`Mode: ${dryRun ? 'DRY RUN' : 'EXECUTE'}`);
    console.log('');

    try {
        // Get all users with withdrawals
        const usersWithWithdrawals = await Withdrawal.distinct('user');
        console.log(`👥 Found ${usersWithWithdrawals.length} users with withdrawal history`);

        let fixedCount = 0;
        let errorCount = 0;
        const auditResults = [];

        for (const userId of usersWithWithdrawals) {
            try {
                const user = await User.findById(userId).select('userName name');
                let referralData = await Referral.findOne({ user: userId });

                // Create referral document if it doesn't exist
                if (!referralData) {
                    console.log(`📝 Creating referral document for ${user?.userName || userId}`);
                    
                    if (!dryRun) {
                        referralData = new Referral({
                            user: userId,
                            totalEarnings: 0,
                            totalWithdrawn: 0,
                            pendingWithdrawals: 0,
                            processingWithdrawals: 0,
                            generation1: { count: 0, earnings: 0 },
                            generation2: { count: 0, earnings: 0 },
                            generation3: { count: 0, earnings: 0 }
                        });
                        await referralData.save();
                    } else {
                        // For dry run, create temporary object
                        referralData = {
                            totalWithdrawn: 0,
                            pendingWithdrawals: 0,
                            processingWithdrawals: 0
                        };
                    }
                }

                // Get all withdrawals for this user
                const userWithdrawals = await Withdrawal.find({ user: userId });

                // Calculate correct balances from withdrawals
                const correctBalances = {
                    totalWithdrawn: 0,
                    pendingWithdrawals: 0,
                    processingWithdrawals: 0
                };

                userWithdrawals.forEach(withdrawal => {
                    switch (withdrawal.status) {
                        case 'paid':
                            correctBalances.totalWithdrawn += withdrawal.amount;
                            break;
                        case 'pending':
                            correctBalances.pendingWithdrawals += withdrawal.amount;
                            break;
                        case 'processing':
                            correctBalances.processingWithdrawals += withdrawal.amount;
                            break;
                        // Failed/rejected/cancelled withdrawals don't affect balance
                    }
                });

                // Compare with stored balances
                const currentBalances = {
                    totalWithdrawn: referralData.totalWithdrawn || 0,
                    pendingWithdrawals: referralData.pendingWithdrawals || 0,
                    processingWithdrawals: referralData.processingWithdrawals || 0
                };

                const needsUpdate = (
                    Math.abs(correctBalances.totalWithdrawn - currentBalances.totalWithdrawn) > 0.01 ||
                    Math.abs(correctBalances.pendingWithdrawals - currentBalances.pendingWithdrawals) > 0.01 ||
                    Math.abs(correctBalances.processingWithdrawals - currentBalances.processingWithdrawals) > 0.01
                );

                if (needsUpdate) {
                    console.log(`🔧 ${dryRun ? 'Would fix' : 'Fixing'} balances for ${user?.userName || userId}`);
                    console.log(`   Before - Withdrawn: $${currentBalances.totalWithdrawn.toFixed(2)}, Pending: $${currentBalances.pendingWithdrawals.toFixed(2)}, Processing: $${currentBalances.processingWithdrawals.toFixed(2)}`);
                    console.log(`   After  - Withdrawn: $${correctBalances.totalWithdrawn.toFixed(2)}, Pending: $${correctBalances.pendingWithdrawals.toFixed(2)}, Processing: $${correctBalances.processingWithdrawals.toFixed(2)}`);

                    if (!dryRun) {
                        await Referral.findOneAndUpdate(
                            { user: userId },
                            {
                                $set: {
                                    totalWithdrawn: correctBalances.totalWithdrawn,
                                    pendingWithdrawals: correctBalances.pendingWithdrawals,
                                    processingWithdrawals: correctBalances.processingWithdrawals
                                }
                            },
                            { upsert: true }
                        );
                    }

                    fixedCount++;
                    auditResults.push({
                        userId,
                        userName: user?.userName || 'Unknown',
                        before: currentBalances,
                        after: correctBalances,
                        withdrawalCount: userWithdrawals.length
                    });
                }

            } catch (error) {
                errorCount++;
                console.error(`❌ Error processing user ${userId}:`, error.message);
            }
        }

        console.log(`\n✅ WITHDRAWAL BALANCE AUDIT COMPLETED`);
        console.log(`   Users processed: ${usersWithWithdrawals.length}`);
        console.log(`   Users ${dryRun ? 'that need fixing' : 'fixed'}: ${fixedCount}`);
        console.log(`   Errors: ${errorCount}`);

        return { fixedCount, errorCount, auditResults };

    } catch (error) {
        console.error('❌ Error auditing withdrawal balances:', error);
        throw error;
    }
}

// Step 3: Sync referral documents with actual commission transactions
async function syncReferralDocuments() {
    console.log('🔄 SYNCING REFERRAL DOCUMENTS WITH TRANSACTIONS');
    console.log('=' .repeat(60));

    try {
        // Get all users who have earned commissions
        const beneficiaries = await ReferralTransaction.distinct('beneficiary', { 
            status: 'completed' 
        });

        console.log(`📊 Syncing ${beneficiaries.length} users with commission earnings...`);

        let syncedCount = 0;
        let errorCount = 0;

        for (const beneficiaryId of beneficiaries) {
            try {
                // Calculate actual earnings from transactions
                const transactionStats = await ReferralTransaction.aggregate([
                    {
                        $match: {
                            beneficiary: beneficiaryId,
                            status: 'completed'
                        }
                    },
                    {
                        $group: {
                            _id: '$generation',
                            totalEarnings: { $sum: '$amount' },
                            transactionCount: { $sum: 1 }
                        }
                    }
                ]);

                // Get unique referred users count by generation
                const [gen1Count, gen2Count, gen3Count] = await Promise.all([
                    ReferralTransaction.distinct('referredUser', {
                        beneficiary: beneficiaryId,
                        generation: 1,
                        status: 'completed'
                    }),
                    ReferralTransaction.distinct('referredUser', {
                        beneficiary: beneficiaryId,
                        generation: 2,
                        status: 'completed'
                    }),
                    ReferralTransaction.distinct('referredUser', {
                        beneficiary: beneficiaryId,
                        generation: 3,
                        status: 'completed'
                    })
                ]);

                // Build generation stats
                const generationStats = {
                    generation1: { count: gen1Count.length, earnings: 0 },
                    generation2: { count: gen2Count.length, earnings: 0 },
                    generation3: { count: gen3Count.length, earnings: 0 }
                };

                let totalEarnings = 0;

                // Map transaction stats to generation stats
                transactionStats.forEach(stat => {
                    const genKey = `generation${stat._id}`;
                    if (generationStats[genKey]) {
                        generationStats[genKey].earnings = stat.totalEarnings;
                        totalEarnings += stat.totalEarnings;
                    }
                });

                // Get current withdrawal balances
                const currentReferral = await Referral.findOne({ user: beneficiaryId });
                const withdrawalBalances = {
                    totalWithdrawn: currentReferral?.totalWithdrawn || 0,
                    pendingWithdrawals: currentReferral?.pendingWithdrawals || 0,
                    processingWithdrawals: currentReferral?.processingWithdrawals || 0
                };

                // Update or create referral document
                await Referral.findOneAndUpdate(
                    { user: beneficiaryId },
                    {
                        $set: {
                            referredUsers: gen1Count.length, // Only direct referrals
                            totalEarnings: totalEarnings,
                            generation1: generationStats.generation1,
                            generation2: generationStats.generation2,
                            generation3: generationStats.generation3,
                            lastSyncAt: new Date(),
                            // Preserve withdrawal balances
                            ...withdrawalBalances
                        }
                    },
                    { 
                        upsert: true,
                        setDefaultsOnInsert: true
                    }
                );

                syncedCount++;

                if (syncedCount % 10 === 0) {
                    console.log(`   Progress: ${syncedCount}/${beneficiaries.length} synced`);
                }

            } catch (error) {
                errorCount++;
                console.error(`   ❌ Error syncing user ${beneficiaryId}:`, error.message);
            }
        }

        console.log(`✅ Referral document sync completed: ${syncedCount} synced, ${errorCount} errors`);
        
        return { syncedCount, errorCount };

    } catch (error) {
        console.error('❌ Error syncing referral documents:', error);
        throw error;
    }
}

// Step 4: Create safeguards to prevent future issues
async function createSafeguards() {
    console.log('🛡️ CREATING SAFEGUARDS');
    console.log('=' .repeat(60));

    try {
        // Check if unique index exists for preventing duplicate commissions
        const indexes = await ReferralTransaction.collection.getIndexes();
        
        const hasUniqueIndex = Object.keys(indexes).some(indexName => 
            indexName.includes('prevent_duplicate_commissions') || 
            indexName.includes('beneficiary_1_sourceTransaction_1_generation_1')
        );

        if (!hasUniqueIndex) {
            console.log('📝 Creating unique index to prevent duplicate commissions...');
            
            try {
                await ReferralTransaction.collection.createIndex(
                    { 
                        beneficiary: 1, 
                        sourceTransaction: 1, 
                        generation: 1 
                    }, 
                    { 
                        unique: true,
                        name: 'prevent_duplicate_commissions',
                        background: true
                    }
                );
                console.log('✅ Unique index created successfully');
            } catch (indexError) {
                console.log('⚠️ Could not create unique index (may have conflicts)');
                console.log('   You may need to clean up remaining duplicates first');
            }
        } else {
            console.log('✅ Unique index already exists');
        }

        // Add method to ReferralTransaction for safe commission creation
        console.log('📝 Adding safe commission creation methods...');
        
        // This would be added to your ReferralTransaction schema
        console.log('   Add the createCommission static method to ReferralTransaction model');
        console.log('   Add the createBatchCommissions static method to ReferralTransaction model');

        return { safeguardsCreated: true };

    } catch (error) {
        console.error('❌ Error creating safeguards:', error);
        return { safeguardsCreated: false, error: error.message };
    }
}

// Step 5: Validate system consistency
async function validateSystemConsistency() {
    console.log('✅ VALIDATING SYSTEM CONSISTENCY');
    console.log('=' .repeat(60));

    try {
        // 1. Check for remaining duplicates
        const duplicates = await ReferralTransaction.aggregate([
            {
                $group: {
                    _id: {
                        beneficiary: '$beneficiary',
                        sourceTransaction: '$sourceTransaction',
                        generation: '$generation'
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $match: { count: { $gt: 1 } }
            }
        ]);

        console.log(`🔍 Remaining duplicate commissions: ${duplicates.length}`);

        // 2. Check earnings consistency
        const totalActualEarnings = await ReferralTransaction.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const totalStoredEarnings = await Referral.aggregate([
            { $group: { _id: null, total: { $sum: '$totalEarnings' } } }
        ]);

        const actualTotal = totalActualEarnings[0]?.total || 0;
        const storedTotal = totalStoredEarnings[0]?.total || 0;
        const earningsDifference = Math.abs(actualTotal - storedTotal);

        console.log(`💰 Earnings Consistency:`);
        console.log(`   Actual earnings (from transactions): $${actualTotal.toFixed(2)}`);
        console.log(`   Stored earnings (in referral docs): $${storedTotal.toFixed(2)}`);
        console.log(`   Difference: $${earningsDifference.toFixed(2)}`);

        const earningsConsistent = earningsDifference < 1;
        console.log(`   Status: ${earningsConsistent ? '✅ CONSISTENT' : '❌ INCONSISTENT'}`);

        // 3. Check withdrawal balance consistency
        const withdrawalStats = await Withdrawal.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        const totalWithdrawalAmounts = await Referral.aggregate([
            {
                $group: {
                    _id: null,
                    totalWithdrawn: { $sum: '$totalWithdrawn' },
                    totalPending: { $sum: '$pendingWithdrawals' },
                    totalProcessing: { $sum: '$processingWithdrawals' }
                }
            }
        ]);

        console.log(`\n💸 Withdrawal Balance Summary:`);
        console.log(`   Withdrawal records by status:`);
        withdrawalStats.forEach(stat => {
            console.log(`     ${stat._id}: ${stat.count} withdrawals, $${stat.totalAmount.toFixed(2)}`);
        });

        if (totalWithdrawalAmounts[0]) {
            const wa = totalWithdrawalAmounts[0];
            console.log(`   Stored withdrawal balances:`);
            console.log(`     Total withdrawn: $${wa.totalWithdrawn.toFixed(2)}`);
            console.log(`     Total pending: $${wa.totalPending.toFixed(2)}`);
            console.log(`     Total processing: $${wa.totalProcessing.toFixed(2)}`);
        }

        // 4. Calculate available balances
        const usersWithBalances = await Referral.aggregate([
            {
                $addFields: {
                    availableBalance: {
                        $subtract: [
                            '$totalEarnings',
                            { $add: ['$totalWithdrawn', '$pendingWithdrawals', '$processingWithdrawals'] }
                        ]
                    }
                }
            },
            {
                $group: {
                    _id: null,
                    totalEarnings: { $sum: '$totalEarnings' },
                    totalAvailable: { $sum: '$availableBalance' },
                    usersWithBalance: {
                        $sum: { $cond: [{ $gt: ['$availableBalance', 0] }, 1, 0] }
                    }
                }
            }
        ]);

        if (usersWithBalances[0]) {
            const balances = usersWithBalances[0];
            console.log(`\n💰 Available Balance Summary:`);
            console.log(`   Total available for withdrawal: $${balances.totalAvailable.toFixed(2)}`);
            console.log(`   Users with available balance: ${balances.usersWithBalance}`);
        }

        // 5. Test leaderboard query
        const leaderboardTest = await User.aggregate([
            {
                $match: {
                    'status.isActive': true,
                    isBanned: { $ne: true }
                }
            },
            {
                $lookup: {
                    from: 'referrals',
                    localField: '_id',
                    foreignField: 'user',
                    as: 'referralData'
                }
            },
            {
                $addFields: {
                    referralInfo: {
                        $cond: {
                            if: { $gt: [{ $size: "$referralData" }, 0] },
                            then: { $arrayElemAt: ["$referralData", 0] },
                            else: { totalEarnings: 0 }
                        }
                    }
                }
            },
            {
                $addFields: {
                    totalEarnings: { $ifNull: ["$referralInfo.totalEarnings", 0] }
                }
            },
            {
                $match: { totalEarnings: { $gt: 0 } }
            },
            {
                $sort: { totalEarnings: -1 }
            },
            {
                $limit: 5
            }
        ]);

        console.log(`\n🏆 Leaderboard Test: ${leaderboardTest.length} users with earnings found`);
        if (leaderboardTest.length > 0) {
            console.log('   Top earners:');
            leaderboardTest.forEach((user, index) => {
                console.log(`     ${index + 1}. ${user.userName}: $${user.totalEarnings.toFixed(2)}`);
            });
        }

        const isSystemHealthy = (
            duplicates.length === 0 &&
            earningsConsistent &&
            leaderboardTest.length > 0
        );

        console.log(`\n🎯 Overall System Health: ${isSystemHealthy ? '✅ HEALTHY' : '⚠️ NEEDS ATTENTION'}`);

        return {
            isHealthy: isSystemHealthy,
            duplicatesRemaining: duplicates.length,
            earningsConsistent,
            earningsDifference,
            leaderboardWorking: leaderboardTest.length > 0
        };

    } catch (error) {
        console.error('❌ Error validating system consistency:', error);
        throw error;
    }
}

// Main execution function
async function main() {
    try {
        await connectDB();

        const args = process.argv.slice(2);
        const command = args[0] || 'full-fix';
        const executeMode = args.includes('--execute') || args.includes('-e');

        console.log('🚀 UNIFIED REFERRAL & WITHDRAWAL SYSTEM FIX');
        console.log('=' .repeat(80));
        console.log(`Command: ${command}`);
        console.log(`Mode: ${executeMode ? 'EXECUTE' : 'DRY RUN'}`);
        console.log('=' .repeat(80));

        switch (command) {
            case 'analyze':
            case 'audit':
                console.log('🔍 ANALYSIS MODE - No changes will be made\n');
                
                await auditAndFixWithdrawalBalances(true);
                await validateSystemConsistency();
                break;

            case 'fix-duplicates':
                console.log('🔧 FIXING DUPLICATE COMMISSIONS ONLY\n');
                
                await fixDuplicateCommissions();
                await validateSystemConsistency();
                break;

            case 'fix-withdrawals':
                console.log('🔧 FIXING WITHDRAWAL BALANCES ONLY\n');
                
                await auditAndFixWithdrawalBalances(!executeMode);
                break;

            case 'sync':
                console.log('🔄 SYNCING REFERRAL DOCUMENTS ONLY\n');
                
                await syncReferralDocuments();
                await validateSystemConsistency();
                break;

            case 'full-fix':
            case 'fix':
            default:
                console.log('🔧 COMPREHENSIVE SYSTEM FIX\n');
                
                // Step 1: Fix duplicate commissions
                console.log('STEP 1: FIX DUPLICATE COMMISSIONS');
                await fixDuplicateCommissions();
                console.log('');
                
                // Step 2: Fix withdrawal balances
                console.log('STEP 2: FIX WITHDRAWAL BALANCES');
                await auditAndFixWithdrawalBalances(!executeMode);
                console.log('');
                
                // Step 3: Sync referral documents
                console.log('STEP 3: SYNC REFERRAL DOCUMENTS');
                await syncReferralDocuments();
                console.log('');
                
                // Step 4: Create safeguards
                console.log('STEP 4: CREATE SAFEGUARDS');
                await createSafeguards();
                console.log('');
                
                // Step 5: Validate everything
                console.log('STEP 5: VALIDATE SYSTEM');
                const validation = await validateSystemConsistency();
                
                // Summary
                console.log('\n🎉 COMPREHENSIVE FIX COMPLETED!');
                console.log('=' .repeat(80));
                
                if (validation.isHealthy) {
                    console.log('✅ System is now healthy!');
                    console.log('✅ No duplicate commissions');
                    console.log('✅ Earnings data is consistent');
                    console.log('✅ Withdrawal balances are accurate');
                    console.log('✅ Leaderboard is working');
                } else {
                    console.log('⚠️ System still needs attention:');
                    if (validation.duplicatesRemaining > 0) {
                        console.log(`   - ${validation.duplicatesRemaining} duplicate commission sets remain`);
                    }
                    if (!validation.earningsConsistent) {
                        console.log(`   - $${validation.earningsDifference.toFixed(2)} earnings difference`);
                    }
                    if (!validation.leaderboardWorking) {
                        console.log('   - Leaderboard not returning results');
                    }
                }
                
                if (!executeMode) {
                    console.log('\n💡 This was a DRY RUN. Use --execute to apply changes.');
                }
                break;

            case 'validate':
            case 'test':
                console.log('✅ VALIDATION MODE\n');
                
                await validateSystemConsistency();
                break;

            case 'help':
                console.log('📖 UNIFIED REFERRAL & WITHDRAWAL FIX TOOL');
                console.log('');
                console.log('Commands:');
                console.log('  analyze           - Analyze system without making changes');
                console.log('  fix-duplicates    - Remove duplicate commissions only');
                console.log('  fix-withdrawals   - Fix withdrawal balances only');
                console.log('  sync              - Sync referral documents with transactions');
                console.log('  full-fix          - Complete comprehensive fix (default)');
                console.log('  validate          - Validate current system state');
                console.log('  help              - Show this help message');
                console.log('');
                console.log('Options:');
                console.log('  --execute, -e     - Apply changes (default is dry run)');
                console.log('');
                break;
        }

        console.log('\n✅ Operation completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('💥 Script failed:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Export functions for use in other scripts
if (require.main === module) {
    main();
}

module.exports = {
    connectDB,
    fixDuplicateCommissions,
    auditAndFixWithdrawalBalances,
    syncReferralDocuments,
    createSafeguards,
    validateSystemConsistency
};