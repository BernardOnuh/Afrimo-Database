// scripts/leaderboardDiagnosticFix.js
// Diagnostic and fix for leaderboard display issues

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

// Diagnose leaderboard data inconsistencies
async function diagnoseLeaderboardData() {
    console.log('🔍 DIAGNOSING LEADERBOARD DATA ISSUES');
    console.log('=' .repeat(60));

    try {
        // 1. Check ReferralTransaction data
        console.log('📊 Checking ReferralTransaction data...');
        
        const totalTransactions = await ReferralTransaction.countDocuments();
        const completedTransactions = await ReferralTransaction.countDocuments({ status: 'completed' });
        const totalEarnings = await ReferralTransaction.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        
        const uniqueBeneficiaries = await ReferralTransaction.distinct('beneficiary', { status: 'completed' });
        
        console.log(`   Total ReferralTransactions: ${totalTransactions}`);
        console.log(`   Completed transactions: ${completedTransactions}`);
        console.log(`   Total earnings: $${(totalEarnings[0]?.total || 0).toFixed(2)}`);
        console.log(`   Unique beneficiaries: ${uniqueBeneficiaries.length}`);

        // 2. Check Referral documents
        console.log('\n📋 Checking Referral documents...');
        
        const totalReferralDocs = await Referral.countDocuments();
        const referralDocsWithEarnings = await Referral.countDocuments({ totalEarnings: { $gt: 0 } });
        const totalReferralEarnings = await Referral.aggregate([
            { $group: { _id: null, total: { $sum: '$totalEarnings' } } }
        ]);
        
        console.log(`   Total Referral documents: ${totalReferralDocs}`);
        console.log(`   Referral docs with earnings > 0: ${referralDocsWithEarnings}`);
        console.log(`   Total Referral earnings: $${(totalReferralEarnings[0]?.total || 0).toFixed(2)}`);

        // 3. Check User collection for referral data
        console.log('\n👥 Checking User collection...');
        
        const totalUsers = await User.countDocuments({ 'status.isActive': true });
        console.log(`   Total active users: ${totalUsers}`);

        // 4. Test leaderboard aggregation
        console.log('\n🧪 Testing leaderboard aggregation...');
        
        const testResults = await User.aggregate([
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
                $match: {
                    totalEarnings: { $gt: 0 }
                }
            },
            {
                $sort: { totalEarnings: -1 }
            },
            {
                $limit: 10
            },
            {
                $project: {
                    name: 1,
                    userName: 1,
                    totalEarnings: 1,
                    referralData: 1
                }
            }
        ]);

        console.log(`   Leaderboard test found: ${testResults.length} users with earnings`);
        
        if (testResults.length > 0) {
            console.log('\n🏆 Top earners from test:');
            testResults.forEach((user, index) => {
                console.log(`   ${index + 1}. ${user.userName}: $${user.totalEarnings.toFixed(2)}`);
            });
        }

        // 5. Check for data inconsistencies
        console.log('\n🔍 Checking for data inconsistencies...');
        
        const inconsistentUsers = [];
        
        for (const beneficiaryId of uniqueBeneficiaries.slice(0, 10)) { // Check first 10
            const actualTransactionTotal = await ReferralTransaction.aggregate([
                { $match: { beneficiary: beneficiaryId, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);
            
            const actualTotal = actualTransactionTotal[0]?.total || 0;
            
            const referralDoc = await Referral.findOne({ user: beneficiaryId });
            const storedTotal = referralDoc?.totalEarnings || 0;
            
            if (Math.abs(actualTotal - storedTotal) > 0.01) {
                const user = await User.findById(beneficiaryId).select('userName name');
                inconsistentUsers.push({
                    userName: user?.userName || 'Unknown',
                    actualTotal,
                    storedTotal,
                    difference: actualTotal - storedTotal
                });
            }
        }
        
        if (inconsistentUsers.length > 0) {
            console.log(`   ❌ Found ${inconsistentUsers.length} users with inconsistent data:`);
            inconsistentUsers.forEach(user => {
                console.log(`     ${user.userName}: Actual $${user.actualTotal.toFixed(2)}, Stored $${user.storedTotal.toFixed(2)}`);
            });
        } else {
            console.log(`   ✅ No inconsistencies found in sample`);
        }

        // 6. Check for missing Referral documents
        console.log('\n🔍 Checking for missing Referral documents...');
        
        const missingReferralDocs = [];
        for (const beneficiaryId of uniqueBeneficiaries.slice(0, 10)) {
            const referralDoc = await Referral.findOne({ user: beneficiaryId });
            if (!referralDoc) {
                const user = await User.findById(beneficiaryId).select('userName name');
                missingReferralDocs.push({
                    userId: beneficiaryId,
                    userName: user?.userName || 'Unknown'
                });
            }
        }
        
        if (missingReferralDocs.length > 0) {
            console.log(`   ❌ Found ${missingReferralDocs.length} users missing Referral documents:`);
            missingReferralDocs.forEach(user => {
                console.log(`     ${user.userName} (${user.userId})`);
            });
        } else {
            console.log(`   ✅ All users have Referral documents`);
        }

        return {
            totalTransactions,
            completedTransactions,
            totalEarnings: totalEarnings[0]?.total || 0,
            uniqueBeneficiaries: uniqueBeneficiaries.length,
            totalReferralDocs,
            referralDocsWithEarnings,
            totalReferralEarnings: totalReferralEarnings[0]?.total || 0,
            leaderboardTestResults: testResults.length,
            inconsistentUsers: inconsistentUsers.length,
            missingReferralDocs: missingReferralDocs.length,
            issues: [
                ...(inconsistentUsers.length > 0 ? ['Inconsistent earnings data'] : []),
                ...(missingReferralDocs.length > 0 ? ['Missing Referral documents'] : []),
                ...(testResults.length === 0 ? ['Leaderboard aggregation returns no results'] : [])
            ]
        };

    } catch (error) {
        console.error('❌ Error during diagnosis:', error);
        throw error;
    }
}

// Fix Referral documents to match ReferralTransaction totals
async function fixReferralDocuments() {
    console.log('🔧 FIXING REFERRAL DOCUMENTS');
    console.log('=' .repeat(60));

    try {
        // Get all users who have completed referral transactions
        const uniqueBeneficiaries = await ReferralTransaction.distinct('beneficiary', { status: 'completed' });
        
        console.log(`📊 Found ${uniqueBeneficiaries.length} users with referral earnings to fix`);

        let fixedCount = 0;
        let createdCount = 0;
        let errorCount = 0;

        for (const beneficiaryId of uniqueBeneficiaries) {
            try {
                // Calculate actual earnings from transactions
                const transactionStats = await ReferralTransaction.aggregate([
                    { $match: { beneficiary: beneficiaryId, status: 'completed' } },
                    {
                        $group: {
                            _id: '$generation',
                            totalEarnings: { $sum: '$amount' },
                            count: { $sum: 1 }
                        }
                    }
                ]);

                // Calculate generation-wise stats
                const generationStats = {
                    generation1: { count: 0, earnings: 0 },
                    generation2: { count: 0, earnings: 0 },
                    generation3: { count: 0, earnings: 0 }
                };

                let totalEarnings = 0;

                transactionStats.forEach(stat => {
                    const genKey = `generation${stat._id}`;
                    if (generationStats[genKey]) {
                        generationStats[genKey].earnings = stat.totalEarnings;
                        generationStats[genKey].count = stat.count;
                        totalEarnings += stat.totalEarnings;
                    }
                });

                // Get unique referred users by generation
                const gen1Count = await ReferralTransaction.distinct('referredUser', {
                    beneficiary: beneficiaryId,
                    generation: 1,
                    status: 'completed'
                });

                const gen2Count = await ReferralTransaction.distinct('referredUser', {
                    beneficiary: beneficiaryId,
                    generation: 2,
                    status: 'completed'
                });

                const gen3Count = await ReferralTransaction.distinct('referredUser', {
                    beneficiary: beneficiaryId,
                    generation: 3,
                    status: 'completed'
                });

                generationStats.generation1.count = gen1Count.length;
                generationStats.generation2.count = gen2Count.length;
                generationStats.generation3.count = gen3Count.length;

                // Update or create Referral document
                let referralDoc = await Referral.findOne({ user: beneficiaryId });

                if (!referralDoc) {
                    referralDoc = new Referral({
                        user: beneficiaryId,
                        referredUsers: gen1Count.length,
                        totalEarnings: totalEarnings,
                        generation1: generationStats.generation1,
                        generation2: generationStats.generation2,
                        generation3: generationStats.generation3
                    });
                    createdCount++;
                } else {
                    referralDoc.referredUsers = gen1Count.length;
                    referralDoc.totalEarnings = totalEarnings;
                    referralDoc.generation1 = generationStats.generation1;
                    referralDoc.generation2 = generationStats.generation2;
                    referralDoc.generation3 = generationStats.generation3;
                    fixedCount++;
                }

                await referralDoc.save();

                if ((fixedCount + createdCount) % 10 === 0) {
                    console.log(`   Progress: ${fixedCount + createdCount}/${uniqueBeneficiaries.length} processed`);
                }

            } catch (error) {
                errorCount++;
                console.error(`   ❌ Error fixing user ${beneficiaryId}:`, error.message);
            }
        }

        console.log('\n✅ REFERRAL DOCUMENT FIX COMPLETED');
        console.log(`   Fixed existing documents: ${fixedCount}`);
        console.log(`   Created new documents: ${createdCount}`);
        console.log(`   Errors: ${errorCount}`);

        return { fixedCount, createdCount, errorCount };

    } catch (error) {
        console.error('❌ Error fixing referral documents:', error);
        throw error;
    }
}

// Test leaderboard after fix
async function testLeaderboardAfterFix() {
    console.log('🧪 TESTING LEADERBOARD AFTER FIX');
    console.log('=' .repeat(60));

    try {
        // Test the exact aggregation used in leaderboard
        const leaderboardResults = await User.aggregate([
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
                $match: {
                    totalEarnings: { $gt: 0 }
                }
            },
            {
                $sort: { totalEarnings: -1 }
            },
            {
                $limit: 10
            },
            {
                $project: {
                    name: 1,
                    userName: 1,
                    totalEarnings: 1
                }
            }
        ]);

        console.log(`🏆 Found ${leaderboardResults.length} users with earnings in leaderboard`);

        if (leaderboardResults.length > 0) {
            console.log('\n🥇 Top 10 Earners:');
            leaderboardResults.forEach((user, index) => {
                console.log(`   ${index + 1}. ${user.userName}: $${user.totalEarnings.toFixed(2)}`);
            });
        } else {
            console.log('❌ Still no users found in leaderboard test');
        }

        return leaderboardResults;

    } catch (error) {
        console.error('❌ Error testing leaderboard:', error);
        throw error;
    }
}

// Main execution
async function main() {
    try {
        await connectDB();

        const args = process.argv.slice(2);
        const command = args[0] || 'diagnose';

        switch (command) {
            case 'diagnose':
            case 'diag':
                const diagnosis = await diagnoseLeaderboardData();
                
                console.log('\n📋 DIAGNOSIS SUMMARY');
                console.log('=' .repeat(60));
                console.log(`ReferralTransactions: ${diagnosis.completedTransactions} completed, $${diagnosis.totalEarnings.toFixed(2)} total`);
                console.log(`Referral documents: ${diagnosis.referralDocsWithEarnings} with earnings, $${diagnosis.totalReferralEarnings.toFixed(2)} total`);
                console.log(`Leaderboard test: ${diagnosis.leaderboardTestResults} users found`);
                
                if (diagnosis.issues.length > 0) {
                    console.log('\n⚠️ Issues found:');
                    diagnosis.issues.forEach(issue => console.log(`   - ${issue}`));
                } else {
                    console.log('\n✅ No issues found');
                }
                break;

            case 'fix':
                console.log('🔧 Starting leaderboard fix...');
                
                // First diagnose
                await diagnoseLeaderboardData();
                
                // Then fix
                const fixResults = await fixReferralDocuments();
                
                // Test after fix
                const testResults = await testLeaderboardAfterFix();
                
                console.log('\n🎉 LEADERBOARD FIX COMPLETED');
                console.log(`   Documents fixed/created: ${fixResults.fixedCount + fixResults.createdCount}`);
                console.log(`   Users now showing in leaderboard: ${testResults.length}`);
                break;

            case 'test':
                await testLeaderboardAfterFix();
                break;

            default:
                console.log('🔍 LEADERBOARD DIAGNOSTIC & FIX TOOL');
                console.log('');
                console.log('Usage:');
                console.log('  node leaderboardDiagnosticFix.js diagnose    # Diagnose issues');
                console.log('  node leaderboardDiagnosticFix.js fix         # Fix leaderboard data');
                console.log('  node leaderboardDiagnosticFix.js test        # Test leaderboard');
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

// Export for use in other scripts
if (require.main === module) {
    main();
}

module.exports = {
    connectDB,
    diagnoseLeaderboardData,
    fixReferralDocuments,
    testLeaderboardAfterFix
};