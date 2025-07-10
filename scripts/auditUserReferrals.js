// scripts/auditUserReferrals.js
// Script to audit individual user referral commissions

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');
const SiteConfig = require('../models/SiteConfig');
const CoFounderShare = require('../models/CoFounderShare');

// Connect to database
async function connectDB() {
    try {
        const mongoUri = 'mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net';
        
        if (!mongoUri) {
            console.error('❌ No MongoDB connection string found!');
            console.error('Please set one of these environment variables:');
            console.error('  - MONGODB_URI');
            console.error('  - MONGO_URI'); 
            console.error('  - DATABASE_URL');
            console.error('');
            console.error('Example:');
            console.error('  export MONGODB_URI="mongodb://localhost:27017/your-database"');
            console.error('  # or add to your .env file:');
            console.error('  MONGODB_URI=mongodb://localhost:27017/your-database');
            process.exit(1);
        }

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

// Get commission rates
async function getCommissionRates() {
    try {
        const siteConfig = await SiteConfig.getCurrentConfig();
        return siteConfig.referralCommission || {
            generation1: 15,
            generation2: 3,
            generation3: 2
        };
    } catch (error) {
        return {
            generation1: 15,
            generation2: 3,
            generation3: 2
        };
    }
}

// Get co-founder ratio
async function getCofounderRatio() {
    try {
        const coFounderConfig = await CoFounderShare.findOne();
        return coFounderConfig?.shareToRegularRatio || 29;
    } catch (error) {
        return 29;
    }
}

// Calculate what the user's referral earnings SHOULD be
async function calculateExpectedEarnings(userId, commissionRates) {
    const user = await User.findById(userId);
    if (!user) {
        throw new Error('User not found');
    }

    let expectedEarnings = 0;
    const expectedStats = {
        generation1: { count: 0, earnings: 0, transactions: [] },
        generation2: { count: 0, earnings: 0, transactions: [] },
        generation3: { count: 0, earnings: 0, transactions: [] }
    };

    // Process Generation 1 referrals
    const gen1Users = await User.find({ 'referralInfo.code': user.userName });
    expectedStats.generation1.count = gen1Users.length;

    for (const gen1User of gen1Users) {
        // Regular share transactions
        const userShare = await UserShare.findOne({ user: gen1User._id });
        if (userShare && userShare.transactions) {
            const completedTransactions = userShare.transactions.filter(tx => tx.status === 'completed');
            
            for (const tx of completedTransactions) {
                if (tx.totalAmount > 0) {
                    const commission = (tx.totalAmount * commissionRates.generation1) / 100;
                    expectedStats.generation1.earnings += commission;
                    expectedEarnings += commission;
                    expectedStats.generation1.transactions.push({
                        type: 'share',
                        referredUser: gen1User.userName,
                        amount: tx.totalAmount,
                        commission: commission,
                        date: tx.createdAt
                    });
                }
            }
        }

        // Co-founder transactions
        const cofounderTransactions = await PaymentTransaction.find({
            userId: gen1User._id,
            type: 'co-founder',
            status: 'completed'
        });

        for (const tx of cofounderTransactions) {
            if (tx.amount > 0) {
                const commission = (tx.amount * commissionRates.generation1) / 100;
                expectedStats.generation1.earnings += commission;
                expectedEarnings += commission;
                expectedStats.generation1.transactions.push({
                    type: 'cofounder',
                    referredUser: gen1User.userName,
                    amount: tx.amount,
                    shares: tx.shares,
                    commission: commission,
                    date: tx.createdAt
                });
            }
        }

        // Process Generation 2
        const gen2Users = await User.find({ 'referralInfo.code': gen1User.userName });
        expectedStats.generation2.count += gen2Users.length;

        for (const gen2User of gen2Users) {
            // Regular share transactions
            const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
            if (gen2UserShare && gen2UserShare.transactions) {
                const completedTransactions = gen2UserShare.transactions.filter(tx => tx.status === 'completed');
                
                for (const tx of completedTransactions) {
                    if (tx.totalAmount > 0) {
                        const commission = (tx.totalAmount * commissionRates.generation2) / 100;
                        expectedStats.generation2.earnings += commission;
                        expectedEarnings += commission;
                        expectedStats.generation2.transactions.push({
                            type: 'share',
                            referredUser: gen2User.userName,
                            amount: tx.totalAmount,
                            commission: commission,
                            date: tx.createdAt
                        });
                    }
                }
            }

            // Co-founder transactions
            const gen2CofounderTransactions = await PaymentTransaction.find({
                userId: gen2User._id,
                type: 'co-founder',
                status: 'completed'
            });

            for (const tx of gen2CofounderTransactions) {
                if (tx.amount > 0) {
                    const commission = (tx.amount * commissionRates.generation2) / 100;
                    expectedStats.generation2.earnings += commission;
                    expectedEarnings += commission;
                    expectedStats.generation2.transactions.push({
                        type: 'cofounder',
                        referredUser: gen2User.userName,
                        amount: tx.amount,
                        shares: tx.shares,
                        commission: commission,
                        date: tx.createdAt
                    });
                }
            }

            // Process Generation 3
            const gen3Users = await User.find({ 'referralInfo.code': gen2User.userName });
            expectedStats.generation3.count += gen3Users.length;

            for (const gen3User of gen3Users) {
                // Regular share transactions
                const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
                if (gen3UserShare && gen3UserShare.transactions) {
                    const completedTransactions = gen3UserShare.transactions.filter(tx => tx.status === 'completed');
                    
                    for (const tx of completedTransactions) {
                        if (tx.totalAmount > 0) {
                            const commission = (tx.totalAmount * commissionRates.generation3) / 100;
                            expectedStats.generation3.earnings += commission;
                            expectedEarnings += commission;
                            expectedStats.generation3.transactions.push({
                                type: 'share',
                                referredUser: gen3User.userName,
                                amount: tx.totalAmount,
                                commission: commission,
                                date: tx.createdAt
                            });
                        }
                    }
                }

                // Co-founder transactions
                const gen3CofounderTransactions = await PaymentTransaction.find({
                    userId: gen3User._id,
                    type: 'co-founder',
                    status: 'completed'
                });

                for (const tx of gen3CofounderTransactions) {
                    if (tx.amount > 0) {
                        const commission = (tx.amount * commissionRates.generation3) / 100;
                        expectedStats.generation3.earnings += commission;
                        expectedEarnings += commission;
                        expectedStats.generation3.transactions.push({
                            type: 'cofounder',
                            referredUser: gen3User.userName,
                            amount: tx.amount,
                            shares: tx.shares,
                            commission: commission,
                            date: tx.createdAt
                        });
                    }
                }
            }
        }
    }

    return {
        totalEarnings: expectedEarnings,
        generationStats: expectedStats
    };
}

// Get actual current earnings from database
async function getCurrentEarnings(userId) {
    const referralData = await Referral.findOne({ user: userId });
    const referralTransactions = await ReferralTransaction.find({ 
        beneficiary: userId,
        status: 'completed'
    }).populate('referredUser', 'userName name');

    // Group transactions by generation
    const actualStats = {
        generation1: { count: 0, earnings: 0, transactions: [] },
        generation2: { count: 0, earnings: 0, transactions: [] },
        generation3: { count: 0, earnings: 0, transactions: [] }
    };

    let actualTotalEarnings = 0;

    for (const tx of referralTransactions) {
        actualTotalEarnings += tx.amount;
        const genKey = `generation${tx.generation}`;
        actualStats[genKey].earnings += tx.amount;
        actualStats[genKey].transactions.push({
            type: tx.purchaseType,
            referredUser: tx.referredUser?.userName || 'Unknown',
            amount: tx.amount,
            date: tx.createdAt,
            transactionId: tx._id
        });
    }

    // Count unique referred users per generation
    const gen1Refs = await ReferralTransaction.distinct('referredUser', {
        beneficiary: userId,
        generation: 1,
        status: 'completed'
    });
    const gen2Refs = await ReferralTransaction.distinct('referredUser', {
        beneficiary: userId,
        generation: 2,
        status: 'completed'
    });
    const gen3Refs = await ReferralTransaction.distinct('referredUser', {
        beneficiary: userId,
        generation: 3,
        status: 'completed'
    });

    actualStats.generation1.count = gen1Refs.length;
    actualStats.generation2.count = gen2Refs.length;
    actualStats.generation3.count = gen3Refs.length;

    return {
        totalEarnings: actualTotalEarnings,
        referralData: referralData,
        generationStats: actualStats,
        transactionCount: referralTransactions.length
    };
}

// Main audit function
async function auditUserReferrals(userIdentifier) {
    try {
        // Find user by username, name, or ID
        let user;
        
        if (mongoose.Types.ObjectId.isValid(userIdentifier)) {
            user = await User.findById(userIdentifier);
        } else {
            user = await User.findOne({
                $or: [
                    { userName: { $regex: new RegExp(`^${userIdentifier}$`, 'i') } },
                    { name: { $regex: new RegExp(userIdentifier, 'i') } },
                    { email: { $regex: new RegExp(`^${userIdentifier}$`, 'i') } }
                ]
            });
        }

        if (!user) {
            return {
                success: false,
                error: `User not found: ${userIdentifier}`
            };
        }

        console.log(`🔍 AUDITING REFERRAL COMMISSIONS`);
        console.log(`👤 User: ${user.name} (@${user.userName})`);
        console.log(`📧 Email: ${user.email}`);
        console.log(`🆔 ID: ${user._id}`);
        console.log('=' .repeat(60));

        // Get configuration
        const commissionRates = await getCommissionRates();
        const cofounderRatio = await getCofounderRatio();

        console.log(`📊 Commission Rates: Gen1: ${commissionRates.generation1}%, Gen2: ${commissionRates.generation2}%, Gen3: ${commissionRates.generation3}%`);
        console.log(`🔗 Co-founder Ratio: 1:${cofounderRatio}`);
        console.log('');

        // Calculate expected vs actual
        const expected = await calculateExpectedEarnings(user._id, commissionRates);
        const actual = await getCurrentEarnings(user._id);

        // Compare results
        const isCorrect = Math.abs(expected.totalEarnings - actual.totalEarnings) < 0.01;
        const difference = actual.totalEarnings - expected.totalEarnings;

        console.log(`📈 EARNINGS ANALYSIS:`);
        console.log(`   Expected total: $${expected.totalEarnings.toFixed(2)}`);
        console.log(`   Actual total:   $${actual.totalEarnings.toFixed(2)}`);
        console.log(`   Difference:     $${difference.toFixed(2)}`);
        console.log(`   Status:         ${isCorrect ? '✅ CORRECT' : '❌ INCORRECT'}`);
        console.log('');

        // Generation breakdown
        console.log(`📊 GENERATION BREAKDOWN:`);
        ['generation1', 'generation2', 'generation3'].forEach((gen, index) => {
            const genNum = index + 1;
            const expectedGen = expected.generationStats[gen];
            const actualGen = actual.generationStats[gen];
            const genDiff = actualGen.earnings - expectedGen.earnings;
            const genCorrect = Math.abs(genDiff) < 0.01;

            console.log(`   Gen ${genNum}: Expected ${expectedGen.earnings.toFixed(2)} (${expectedGen.count} users), Actual ${actualGen.earnings.toFixed(2)} (${actualGen.count} users) ${genCorrect ? '✅' : '❌'}`);
            
            if (!genCorrect) {
                console.log(`        → Difference: ${genDiff.toFixed(2)}`);
            }
        });

        console.log('');

        // Detailed transaction analysis
        if (!isCorrect) {
            console.log(`🔍 DETAILED ANALYSIS:`);
            
            // Show missing transactions
            const missingTransactions = [];
            const extraTransactions = [];

            ['generation1', 'generation2', 'generation3'].forEach(gen => {
                const expectedTxs = expected.generationStats[gen].transactions;
                const actualTxs = actual.generationStats[gen].transactions;

                // Find expected transactions that are missing
                expectedTxs.forEach(expectedTx => {
                    const found = actualTxs.find(actualTx => 
                        actualTx.referredUser === expectedTx.referredUser &&
                        Math.abs(actualTx.amount - expectedTx.commission) < 0.01 &&
                        actualTx.type === expectedTx.type
                    );
                    
                    if (!found) {
                        missingTransactions.push({
                            ...expectedTx,
                            generation: gen
                        });
                    }
                });

                // Find actual transactions that shouldn't exist
                actualTxs.forEach(actualTx => {
                    const found = expectedTxs.find(expectedTx => 
                        actualTx.referredUser === expectedTx.referredUser &&
                        Math.abs(actualTx.amount - expectedTx.commission) < 0.01 &&
                        actualTx.type === expectedTx.type
                    );
                    
                    if (!found) {
                        extraTransactions.push({
                            ...actualTx,
                            generation: gen
                        });
                    }
                });
            });

            if (missingTransactions.length > 0) {
                console.log(`   ❌ MISSING TRANSACTIONS (${missingTransactions.length}):`);
                missingTransactions.forEach(tx => {
                    console.log(`      ${tx.generation} - ${tx.type}: ${tx.referredUser} → ${tx.commission.toFixed(2)} (from ${tx.amount} purchase)`);
                });
                console.log('');
            }

            if (extraTransactions.length > 0) {
                console.log(`   ⚠️  EXTRA TRANSACTIONS (${extraTransactions.length}):`);
                extraTransactions.forEach(tx => {
                    console.log(`      ${tx.generation} - ${tx.type}: ${tx.referredUser} → ${tx.amount.toFixed(2)}`);
                });
                console.log('');
            }
        }

        // Referral data consistency check
        console.log(`📋 REFERRAL DATA CONSISTENCY:`);
        if (actual.referralData) {
            const dataCorrect = Math.abs(actual.referralData.totalEarnings - actual.totalEarnings) < 0.01;
            console.log(`   Referral.totalEarnings: ${actual.referralData.totalEarnings.toFixed(2)} ${dataCorrect ? '✅' : '❌'}`);
            console.log(`   Direct referrals: ${actual.referralData.referredUsers}`);
            
            ['generation1', 'generation2', 'generation3'].forEach((gen, index) => {
                const genNum = index + 1;
                const storedGen = actual.referralData[gen];
                const actualGen = actual.generationStats[gen];
                
                if (storedGen) {
                    const earningsMatch = Math.abs(storedGen.earnings - actualGen.earnings) < 0.01;
                    const countMatch = storedGen.count === actualGen.count;
                    
                    console.log(`   Gen ${genNum} stored: ${storedGen.earnings.toFixed(2)} (${storedGen.count} users) ${earningsMatch && countMatch ? '✅' : '❌'}`);
                }
            });
        } else {
            console.log(`   ❌ No Referral document found`);
        }

        console.log('');

        // Summary and recommendations
        console.log(`📝 SUMMARY:`);
        console.log(`   Overall Status: ${isCorrect ? '✅ CORRECT' : '❌ NEEDS FIXING'}`);
        console.log(`   Transaction Count: ${actual.transactionCount}`);
        console.log(`   Referral Data: ${actual.referralData ? '✅ EXISTS' : '❌ MISSING'}`);

        if (!isCorrect) {
            console.log('');
            console.log(`🔧 RECOMMENDED ACTIONS:`);
            console.log(`   1. Run the fix script for this user`);
            console.log(`   2. Verify all purchase transactions are completed`);
            console.log(`   3. Check referral chain integrity`);
            
            if (Math.abs(difference) > 10) {
                console.log(`   ⚠️  Large discrepancy detected (${Math.abs(difference).toFixed(2)})`);
            }
        }

        return {
            success: true,
            user: {
                id: user._id,
                name: user.name,
                userName: user.userName,
                email: user.email
            },
            audit: {
                isCorrect,
                difference,
                expected: expected.totalEarnings,
                actual: actual.totalEarnings,
                hasReferralData: !!actual.referralData,
                transactionCount: actual.transactionCount,
                generationBreakdown: {
                    generation1: {
                        expected: expected.generationStats.generation1,
                        actual: actual.generationStats.generation1,
                        correct: Math.abs(expected.generationStats.generation1.earnings - actual.generationStats.generation1.earnings) < 0.01
                    },
                    generation2: {
                        expected: expected.generationStats.generation2,
                        actual: actual.generationStats.generation2,
                        correct: Math.abs(expected.generationStats.generation2.earnings - actual.generationStats.generation2.earnings) < 0.01
                    },
                    generation3: {
                        expected: expected.generationStats.generation3,
                        actual: actual.generationStats.generation3,
                        correct: Math.abs(expected.generationStats.generation3.earnings - actual.generationStats.generation3.earnings) < 0.01
                    }
                }
            }
        };

    } catch (error) {
        console.error('❌ Error during audit:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Quick audit function for multiple users
async function quickAuditMultipleUsers(userIdentifiers) {
    console.log(`🔍 QUICK AUDIT: ${userIdentifiers.length} users`);
    console.log('=' .repeat(60));

    const results = [];

    for (let i = 0; i < userIdentifiers.length; i++) {
        const userIdentifier = userIdentifiers[i];
        console.log(`[${i + 1}/${userIdentifiers.length}] Auditing ${userIdentifier}...`);

        try {
            const result = await auditUserReferrals(userIdentifier);
            
            if (result.success) {
                const status = result.audit.isCorrect ? '✅' : '❌';
                const diff = result.audit.difference;
                console.log(`   ${status} ${result.user.userName}: Expected ${result.audit.expected.toFixed(2)}, Actual ${result.audit.actual.toFixed(2)}, Diff: ${diff.toFixed(2)}`);
                
                results.push({
                    userName: result.user.userName,
                    status: result.audit.isCorrect ? 'CORRECT' : 'INCORRECT',
                    difference: diff,
                    expected: result.audit.expected,
                    actual: result.audit.actual
                });
            } else {
                console.log(`   ❌ ${userIdentifier}: ${result.error}`);
                results.push({
                    userName: userIdentifier,
                    status: 'ERROR',
                    error: result.error
                });
            }
        } catch (error) {
            console.log(`   💥 ${userIdentifier}: ${error.message}`);
            results.push({
                userName: userIdentifier,
                status: 'ERROR',
                error: error.message
            });
        }
    }

    console.log('');
    console.log('📊 QUICK AUDIT SUMMARY:');
    const correct = results.filter(r => r.status === 'CORRECT').length;
    const incorrect = results.filter(r => r.status === 'INCORRECT').length;
    const errors = results.filter(r => r.status === 'ERROR').length;

    console.log(`   ✅ Correct: ${correct}`);
    console.log(`   ❌ Incorrect: ${incorrect}`);
    console.log(`   💥 Errors: ${errors}`);

    if (incorrect > 0) {
        console.log('');
        console.log('❌ Users needing fixes:');
        results.filter(r => r.status === 'INCORRECT').forEach(r => {
            console.log(`   ${r.userName}: ${r.difference.toFixed(2)} difference`);
        });
    }

    return results;
}

// Command line interface
async function main() {
    try {
        await connectDB();

        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log('');
            console.log('🔍 REFERRAL AUDIT TOOL');
            console.log('');
            console.log('Usage:');
            console.log('  node auditUserReferrals.js <username>     # Audit single user');
            console.log('  node auditUserReferrals.js user1 user2    # Audit multiple users');
            console.log('');
            console.log('Examples:');
            console.log('  node auditUserReferrals.js john_doe');
            console.log('  node auditUserReferrals.js "John Doe"');
            console.log('  node auditUserReferrals.js john@email.com');
            console.log('  node auditUserReferrals.js 60f7b3b3b3b3b3b3b3b3b3b3');
            console.log('');
            process.exit(0);
        }

        if (args.length === 1) {
            // Single user audit
            const result = await auditUserReferrals(args[0]);
            
            if (!result.success) {
                console.error(`❌ ${result.error}`);
                process.exit(1);
            }
        } else {
            // Multiple user quick audit
            await quickAuditMultipleUsers(args);
        }

        console.log('');
        console.log('✅ Audit completed!');
        process.exit(0);

    } catch (error) {
        console.error('💥 Script failed:', error);
        process.exit(1);
    }
}

// Export for use in other scripts
if (require.main === module) {
    main();
}

module.exports = {
    auditUserReferrals,
    quickAuditMultipleUsers,
    calculateExpectedEarnings,
    getCurrentEarnings,
    connectDB
};