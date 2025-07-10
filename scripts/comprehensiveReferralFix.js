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

// Enhanced database connection
async function connectDB() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 
                        'mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net';
        
        if (!mongoUri) {
            console.error('❌ No MongoDB connection string found!');
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

// Get configuration with fallbacks
async function getConfiguration() {
    try {
        const siteConfig = await SiteConfig.getCurrentConfig();
        const coFounderConfig = await CoFounderShare.findOne();
        
        return {
            commissionRates: siteConfig?.referralCommission || {
                generation1: 15,
                generation2: 3,
                generation3: 2
            },
            cofounderRatio: coFounderConfig?.shareToRegularRatio || 29
        };
    } catch (error) {
        console.log('⚠️ Using default configuration');
        return {
            commissionRates: {
                generation1: 15,
                generation2: 3,
                generation3: 2
            },
            cofounderRatio: 29
        };
    }
}

// Deep diagnostic function
async function runDeepDiagnostic() {
    console.log('🔍 RUNNING DEEP DIAGNOSTIC ANALYSIS');
    console.log('=' .repeat(60));

    const diagnostic = {
        issues: [],
        warnings: [],
        summary: {},
        recommendations: []
    };

    try {
        // 1. Check basic data integrity
        console.log('📊 Checking basic data integrity...');
        
        const totalUsers = await User.countDocuments();
        const usersWithReferrers = await User.countDocuments({ 
            'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
        });
        const usersWithUserNames = await User.countDocuments({ 
            userName: { $exists: true, $ne: null, $ne: '' }
        });
        const totalUserShares = await UserShare.countDocuments();
        const totalReferralTransactions = await ReferralTransaction.countDocuments();
        const totalReferrals = await Referral.countDocuments();

        diagnostic.summary.basicStats = {
            totalUsers,
            usersWithReferrers,
            usersWithUserNames,
            totalUserShares,
            totalReferralTransactions,
            totalReferrals
        };

        console.log(`   Users: ${totalUsers}, With referrers: ${usersWithReferrers}, With usernames: ${usersWithUserNames}`);
        console.log(`   UserShares: ${totalUserShares}, ReferralTransactions: ${totalReferralTransactions}, Referrals: ${totalReferrals}`);

        // 2. Check for data inconsistencies
        console.log('🔍 Checking for data inconsistencies...');
        
        // Check for users with invalid referrer codes
        const invalidReferrers = await User.find({
            'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
        });

        let brokenReferralChains = 0;
        for (const user of invalidReferrers) {
            const referrerExists = await User.findOne({ userName: user.referralInfo.code });
            if (!referrerExists) {
                brokenReferralChains++;
                if (brokenReferralChains <= 5) { // Log first 5 broken chains
                    diagnostic.issues.push(`User ${user.userName} has invalid referrer code: ${user.referralInfo.code}`);
                }
            }
        }

        if (brokenReferralChains > 0) {
            diagnostic.issues.push(`Found ${brokenReferralChains} users with broken referral chains`);
        }

        // 3. Check UserShare transactions
        console.log('💰 Analyzing UserShare transactions...');
        
        const userSharesWithTransactions = await UserShare.find({
            'transactions.0': { $exists: true }
        });

        let totalCompletedTransactions = 0;
        let totalCompletedAmount = 0;
        let usersWithCompletedTransactions = 0;

        for (const userShare of userSharesWithTransactions) {
            const completedTxs = userShare.transactions.filter(tx => tx.status === 'completed');
            if (completedTxs.length > 0) {
                usersWithCompletedTransactions++;
                totalCompletedTransactions += completedTxs.length;
                totalCompletedAmount += completedTxs.reduce((sum, tx) => sum + (tx.totalAmount || 0), 0);
            }
        }

        diagnostic.summary.userShareStats = {
            usersWithCompletedTransactions,
            totalCompletedTransactions,
            totalCompletedAmount
        };

        console.log(`   Users with completed transactions: ${usersWithCompletedTransactions}`);
        console.log(`   Total completed transactions: ${totalCompletedTransactions}`);
        console.log(`   Total completed amount: $${totalCompletedAmount.toFixed(2)}`);

        // 4. Check PaymentTransaction (co-founder transactions)
        console.log('🏆 Analyzing co-founder transactions...');
        
        const cofounderTransactions = await PaymentTransaction.find({
            type: 'co-founder',
            status: 'completed'
        });

        const totalCofounderAmount = cofounderTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

        diagnostic.summary.cofounderStats = {
            totalCofounderTransactions: cofounderTransactions.length,
            totalCofounderAmount
        };

        console.log(`   Co-founder transactions: ${cofounderTransactions.length}`);
        console.log(`   Total co-founder amount: $${totalCofounderAmount.toFixed(2)}`);

        // 5. Calculate expected vs actual referral transactions
        console.log('🧮 Calculating expected referral transactions...');
        
        const { commissionRates } = await getConfiguration();
        
        // Expected transactions from UserShares
        let expectedRegularCommissions = 0;
        for (const userShare of userSharesWithTransactions) {
            const user = await User.findById(userShare.user);
            if (user?.referralInfo?.code) {
                const completedTxs = userShare.transactions.filter(tx => tx.status === 'completed');
                for (const tx of completedTxs) {
                    expectedRegularCommissions += (tx.totalAmount || 0) * commissionRates.generation1 / 100;
                    // Add gen 2 and 3 calculations...
                }
            }
        }

        // Expected transactions from co-founder purchases
        let expectedCofounderCommissions = 0;
        for (const cofounderTx of cofounderTransactions) {
            const user = await User.findById(cofounderTx.userId);
            if (user?.referralInfo?.code) {
                expectedCofounderCommissions += (cofounderTx.amount || 0) * commissionRates.generation1 / 100;
                // Add gen 2 and 3 calculations...
            }
        }

        const totalExpectedCommissions = expectedRegularCommissions + expectedCofounderCommissions;
        const actualCommissions = await ReferralTransaction.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const actualTotal = actualCommissions[0]?.total || 0;

        diagnostic.summary.commissionComparison = {
            expectedRegular: expectedRegularCommissions,
            expectedCofounder: expectedCofounderCommissions,
            totalExpected: totalExpectedCommissions,
            actualTotal,
            difference: actualTotal - totalExpectedCommissions
        };

        console.log(`   Expected regular commissions: $${expectedRegularCommissions.toFixed(2)}`);
        console.log(`   Expected co-founder commissions: $${expectedCofounderCommissions.toFixed(2)}`);
        console.log(`   Total expected: $${totalExpectedCommissions.toFixed(2)}`);
        console.log(`   Actual total: $${actualTotal.toFixed(2)}`);
        console.log(`   Difference: $${(actualTotal - totalExpectedCommissions).toFixed(2)}`);

        if (Math.abs(actualTotal - totalExpectedCommissions) > 1) {
            diagnostic.issues.push(`Large discrepancy in commission calculations: Expected $${totalExpectedCommissions.toFixed(2)}, Actual $${actualTotal.toFixed(2)}`);
        }

        // 6. Check for duplicate transactions
        console.log('🔍 Checking for duplicate referral transactions...');
        
        const duplicates = await ReferralTransaction.aggregate([
            {
                $group: {
                    _id: {
                        sourceTransaction: '$sourceTransaction',
                        beneficiary: '$beneficiary',
                        generation: '$generation'
                    },
                    count: { $sum: 1 },
                    docs: { $push: '$_id' }
                }
            },
            { $match: { count: { $gt: 1 } } }
        ]);

        if (duplicates.length > 0) {
            diagnostic.issues.push(`Found ${duplicates.length} sets of duplicate referral transactions`);
        }

        // 7. Check Referral document consistency
        console.log('📋 Checking Referral document consistency...');
        
        const referralDocs = await Referral.find();
        let inconsistentReferralDocs = 0;

        for (const referralDoc of referralDocs) {
            const actualTransactions = await ReferralTransaction.find({
                beneficiary: referralDoc.user,
                status: 'completed'
            });

            const actualTotal = actualTransactions.reduce((sum, tx) => sum + tx.amount, 0);
            
            if (Math.abs(referralDoc.totalEarnings - actualTotal) > 0.01) {
                inconsistentReferralDocs++;
                if (inconsistentReferralDocs <= 5) {
                    diagnostic.issues.push(`Referral doc inconsistency for user ${referralDoc.user}: stored ${referralDoc.totalEarnings}, actual ${actualTotal}`);
                }
            }
        }

        if (inconsistentReferralDocs > 0) {
            diagnostic.issues.push(`Found ${inconsistentReferralDocs} referral documents with incorrect totals`);
        }

        // Generate recommendations
        if (brokenReferralChains > 0) {
            diagnostic.recommendations.push('Fix broken referral chains by updating or removing invalid referrer codes');
        }
        
        if (duplicates.length > 0) {
            diagnostic.recommendations.push('Remove duplicate referral transactions to prevent double-counting');
        }
        
        if (inconsistentReferralDocs > 0) {
            diagnostic.recommendations.push('Recalculate and update Referral document totals');
        }
        
        if (Math.abs(actualTotal - totalExpectedCommissions) > 1) {
            diagnostic.recommendations.push('Run comprehensive referral commission recalculation');
        }

        console.log('✅ Deep diagnostic completed');
        return diagnostic;

    } catch (error) {
        console.error('❌ Error during diagnostic:', error);
        diagnostic.issues.push(`Diagnostic error: ${error.message}`);
        return diagnostic;
    }
}

// Enhanced fix function that addresses specific issues
async function comprehensiveFix(options = {}) {
    const {
        fixDuplicates = true,
        fixBrokenChains = true,
        recalculateAll = true,
        dryRun = false
    } = options;

    console.log('🔧 STARTING COMPREHENSIVE REFERRAL FIX');
    console.log('=' .repeat(60));
    console.log(`Dry run: ${dryRun}`);
    console.log(`Fix duplicates: ${fixDuplicates}`);
    console.log(`Fix broken chains: ${fixBrokenChains}`);
    console.log(`Recalculate all: ${recalculateAll}`);
    console.log('');

    const results = {
        duplicatesFixed: 0,
        brokenChainsFixed: 0,
        usersRecalculated: 0,
        errors: [],
        warnings: []
    };

    try {
        const { commissionRates, cofounderRatio } = await getConfiguration();

        // 1. Fix duplicate transactions
        if (fixDuplicates) {
            console.log('🧹 Removing duplicate referral transactions...');
            
            const duplicates = await ReferralTransaction.aggregate([
                {
                    $group: {
                        _id: {
                            sourceTransaction: '$sourceTransaction',
                            beneficiary: '$beneficiary',
                            generation: '$generation'
                        },
                        count: { $sum: 1 },
                        docs: { $push: '$_id' }
                    }
                },
                { $match: { count: { $gt: 1 } } }
            ]);

            for (const duplicate of duplicates) {
                // Keep the first document, remove the rest
                const docsToRemove = duplicate.docs.slice(1);
                
                if (!dryRun) {
                    await ReferralTransaction.deleteMany({ _id: { $in: docsToRemove } });
                }
                
                results.duplicatesFixed += docsToRemove.length;
                console.log(`   Removed ${docsToRemove.length} duplicate transactions for ${JSON.stringify(duplicate._id)}`);
            }
        }

        // 2. Fix broken referral chains
        if (fixBrokenChains) {
            console.log('🔗 Fixing broken referral chains...');
            
            const usersWithBrokenChains = await User.find({
                'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
            });

            for (const user of usersWithBrokenChains) {
                const referrerExists = await User.findOne({ userName: user.referralInfo.code });
                
                if (!referrerExists) {
                    console.log(`   Found broken chain: ${user.userName} -> ${user.referralInfo.code} (does not exist)`);
                    
                    if (!dryRun) {
                        // Option 1: Clear the referral code
                        user.referralInfo.code = null;
                        await user.save();
                        
                        // Option 2: Try to find a similar username (commented out)
                        // const similarUser = await User.findOne({ 
                        //     userName: { $regex: new RegExp(user.referralInfo.code, 'i') }
                        // });
                        // if (similarUser) {
                        //     user.referralInfo.code = similarUser.userName;
                        //     await user.save();
                        // }
                    }
                    
                    results.brokenChainsFixed++;
                }
            }
        }

        // 3. Comprehensive recalculation
        if (recalculateAll) {
            console.log('🧮 Starting comprehensive recalculation...');
            
            // Clear all existing referral transactions and referral documents
            if (!dryRun) {
                await ReferralTransaction.deleteMany({});
                await Referral.deleteMany({});
                console.log('   Cleared existing referral data');
            }

            // Get all users who could potentially earn commissions
            const allUsers = await User.find({
                'status.isActive': true,
                isBanned: { $ne: true }
            }).select('userName _id').sort({ createdAt: 1 });

            console.log(`   Processing ${allUsers.length} users...`);

            for (let i = 0; i < allUsers.length; i++) {
                const user = allUsers[i];
                
                if (i % 100 === 0) {
                    console.log(`   Progress: ${i}/${allUsers.length} users processed`);
                }

                try {
                    await recalculateUserReferralEarnings(user._id, commissionRates, dryRun);
                    results.usersRecalculated++;
                } catch (error) {
                    results.errors.push(`Error processing user ${user.userName}: ${error.message}`);
                    console.error(`   Error processing ${user.userName}:`, error.message);
                }
            }
        }

        console.log('✅ Comprehensive fix completed');
        return results;

    } catch (error) {
        console.error('❌ Error during comprehensive fix:', error);
        results.errors.push(`Fix error: ${error.message}`);
        return results;
    }
}

// Enhanced user referral earnings recalculation
async function recalculateUserReferralEarnings(userId, commissionRates, dryRun = false) {
    const user = await User.findById(userId);
    if (!user) return;

    let totalEarnings = 0;
    const generationStats = {
        generation1: { count: 0, earnings: 0 },
        generation2: { count: 0, earnings: 0 },
        generation3: { count: 0, earnings: 0 }
    };

    // Process Generation 1 referrals
    const gen1Users = await User.find({ 'referralInfo.code': user.userName });
    generationStats.generation1.count = gen1Users.length;

    for (const gen1User of gen1Users) {
        // Process regular share transactions
        const userShare = await UserShare.findOne({ user: gen1User._id });
        if (userShare?.transactions) {
            const completedTransactions = userShare.transactions.filter(tx => tx.status === 'completed');
            
            for (const tx of completedTransactions) {
                if (tx.totalAmount > 0) {
                    const commission = (tx.totalAmount * commissionRates.generation1) / 100;
                    
                    if (!dryRun) {
                        await ReferralTransaction.create({
                            beneficiary: userId,
                            referredUser: gen1User._id,
                            amount: commission,
                            currency: tx.currency || 'USD',
                            generation: 1,
                            purchaseType: 'share',
                            sourceTransactionModel: 'UserShare',
                            status: 'completed',
                            createdAt: tx.createdAt || new Date()
                        });
                    }
                    
                    generationStats.generation1.earnings += commission;
                    totalEarnings += commission;
                }
            }
        }

        // Process co-founder transactions
        const cofounderTransactions = await PaymentTransaction.find({
            userId: gen1User._id,
            type: 'co-founder',
            status: 'completed'
        });

        for (const tx of cofounderTransactions) {
            if (tx.amount > 0) {
                const commission = (tx.amount * commissionRates.generation1) / 100;
                
                if (!dryRun) {
                    await ReferralTransaction.create({
                        beneficiary: userId,
                        referredUser: gen1User._id,
                        amount: commission,
                        currency: tx.currency || 'USD',
                        generation: 1,
                        purchaseType: 'cofounder',
                        sourceTransaction: tx._id,
                        sourceTransactionModel: 'PaymentTransaction',
                        status: 'completed',
                        metadata: {
                            shares: tx.shares,
                            originalAmount: tx.amount,
                            commissionRate: commissionRates.generation1
                        },
                        createdAt: tx.createdAt
                    });
                }
                
                generationStats.generation1.earnings += commission;
                totalEarnings += commission;
            }
        }

        // Process Generation 2 and 3 similarly...
        // (Implementation similar to above but for gen2 and gen3)
        await processGeneration2And3(gen1User, userId, commissionRates, generationStats, dryRun);
    }

    // Update or create referral stats
    if (!dryRun) {
        let referralStats = await Referral.findOne({ user: userId });
        
        if (!referralStats) {
            referralStats = new Referral({
                user: userId,
                referredUsers: generationStats.generation1.count,
                totalEarnings: totalEarnings,
                generation1: generationStats.generation1,
                generation2: generationStats.generation2,
                generation3: generationStats.generation3
            });
        } else {
            referralStats.referredUsers = generationStats.generation1.count;
            referralStats.totalEarnings = totalEarnings;
            referralStats.generation1 = generationStats.generation1;
            referralStats.generation2 = generationStats.generation2;
            referralStats.generation3 = generationStats.generation3;
        }
        
        await referralStats.save();
    }

    return { totalEarnings, generationStats };
}

// Helper function for generation 2 and 3 processing
async function processGeneration2And3(gen1User, originalUserId, commissionRates, generationStats, dryRun) {
    // Process Generation 2
    const gen2Users = await User.find({ 'referralInfo.code': gen1User.userName });
    generationStats.generation2.count += gen2Users.length;

    for (const gen2User of gen2Users) {
        // Regular share transactions for gen2
        const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
        if (gen2UserShare?.transactions) {
            const completedTransactions = gen2UserShare.transactions.filter(tx => tx.status === 'completed');
            
            for (const tx of completedTransactions) {
                if (tx.totalAmount > 0) {
                    const commission = (tx.totalAmount * commissionRates.generation2) / 100;
                    
                    if (!dryRun) {
                        await ReferralTransaction.create({
                            beneficiary: originalUserId,
                            referredUser: gen2User._id,
                            amount: commission,
                            currency: tx.currency || 'USD',
                            generation: 2,
                            purchaseType: 'share',
                            sourceTransactionModel: 'UserShare',
                            status: 'completed',
                            createdAt: tx.createdAt || new Date()
                        });
                    }
                    
                    generationStats.generation2.earnings += commission;
                }
            }
        }

        // Co-founder transactions for gen2
        const gen2CofounderTxs = await PaymentTransaction.find({
            userId: gen2User._id,
            type: 'co-founder',
            status: 'completed'
        });

        for (const tx of gen2CofounderTxs) {
            if (tx.amount > 0) {
                const commission = (tx.amount * commissionRates.generation2) / 100;
                
                if (!dryRun) {
                    await ReferralTransaction.create({
                        beneficiary: originalUserId,
                        referredUser: gen2User._id,
                        amount: commission,
                        currency: tx.currency || 'USD',
                        generation: 2,
                        purchaseType: 'cofounder',
                        sourceTransaction: tx._id,
                        sourceTransactionModel: 'PaymentTransaction',
                        status: 'completed',
                        metadata: {
                            shares: tx.shares,
                            originalAmount: tx.amount,
                            commissionRate: commissionRates.generation2
                        },
                        createdAt: tx.createdAt
                    });
                }
                
                generationStats.generation2.earnings += commission;
            }
        }

        // Process Generation 3
        const gen3Users = await User.find({ 'referralInfo.code': gen2User.userName });
        generationStats.generation3.count += gen3Users.length;

        for (const gen3User of gen3Users) {
            // Regular share transactions for gen3
            const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
            if (gen3UserShare?.transactions) {
                const completedTransactions = gen3UserShare.transactions.filter(tx => tx.status === 'completed');
                
                for (const tx of completedTransactions) {
                    if (tx.totalAmount > 0) {
                        const commission = (tx.totalAmount * commissionRates.generation3) / 100;
                        
                        if (!dryRun) {
                            await ReferralTransaction.create({
                                beneficiary: originalUserId,
                                referredUser: gen3User._id,
                                amount: commission,
                                currency: tx.currency || 'USD',
                                generation: 3,
                                purchaseType: 'share',
                                sourceTransactionModel: 'UserShare',
                                status: 'completed',
                                createdAt: tx.createdAt || new Date()
                            });
                        }
                        
                        generationStats.generation3.earnings += commission;
                    }
                }
            }

            // Co-founder transactions for gen3
            const gen3CofounderTxs = await PaymentTransaction.find({
                userId: gen3User._id,
                type: 'co-founder',
                status: 'completed'
            });

            for (const tx of gen3CofounderTxs) {
                if (tx.amount > 0) {
                    const commission = (tx.amount * commissionRates.generation3) / 100;
                    
                    if (!dryRun) {
                        await ReferralTransaction.create({
                            beneficiary: originalUserId,
                            referredUser: gen3User._id,
                            amount: commission,
                            currency: tx.currency || 'USD',
                            generation: 3,
                            purchaseType: 'cofounder',
                            sourceTransaction: tx._id,
                            sourceTransactionModel: 'PaymentTransaction',
                            status: 'completed',
                            metadata: {
                                shares: tx.shares,
                                originalAmount: tx.amount,
                                commissionRate: commissionRates.generation3
                            },
                            createdAt: tx.createdAt
                        });
                    }
                    
                    generationStats.generation3.earnings += commission;
                }
            }
        }
    }
}

// Main execution function
async function main() {
    try {
        await connectDB();

        const args = process.argv.slice(2);
        const command = args[0] || 'diagnostic';

        console.log(`🚀 Running command: ${command}`);
        console.log('');

        switch (command) {
            case 'diagnostic':
            case 'diag':
                const diagnostic = await runDeepDiagnostic();
                
                console.log('\n📊 DIAGNOSTIC SUMMARY');
                console.log('=' .repeat(60));
                console.log('Issues Found:');
                diagnostic.issues.forEach(issue => console.log(`   ❌ ${issue}`));
                
                console.log('\nWarnings:');
                diagnostic.warnings.forEach(warning => console.log(`   ⚠️ ${warning}`));
                
                console.log('\nRecommendations:');
                diagnostic.recommendations.forEach(rec => console.log(`   💡 ${rec}`));
                
                if (diagnostic.issues.length === 0) {
                    console.log('   ✅ No critical issues found!');
                }
                break;

            case 'fix':
                const dryRun = args.includes('--dry-run');
                const options = {
                    dryRun,
                    fixDuplicates: !args.includes('--no-duplicates'),
                    fixBrokenChains: !args.includes('--no-chains'),
                    recalculateAll: !args.includes('--no-recalc')
                };

                const fixResults = await comprehensiveFix(options);
                
                console.log('\n🎉 FIX RESULTS');
                console.log('=' .repeat(60));
                console.log(`Duplicates fixed: ${fixResults.duplicatesFixed}`);
                console.log(`Broken chains fixed: ${fixResults.brokenChainsFixed}`);
                console.log(`Users recalculated: ${fixResults.usersRecalculated}`);
                console.log(`Errors: ${fixResults.errors.length}`);
                
                if (fixResults.errors.length > 0) {
                    console.log('\nErrors:');
                    fixResults.errors.forEach(error => console.log(`   ❌ ${error}`));
                }
                break;

            default:
                console.log('🔧 COMPREHENSIVE REFERRAL DIAGNOSTIC & FIX TOOL');
                console.log('');
                console.log('Usage:');
                console.log('  node comprehensiveReferralFix.js diagnostic     # Run diagnostic only');
                console.log('  node comprehensiveReferralFix.js fix            # Run full fix');
                console.log('  node comprehensiveReferralFix.js fix --dry-run  # Preview changes');
                console.log('');
                console.log('Fix options:');
                console.log('  --dry-run          Preview changes without applying');
                console.log('  --no-duplicates    Skip duplicate removal');
                console.log('  --no-chains        Skip broken chain fixes');
                console.log('  --no-recalc        Skip recalculation');
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
    runDeepDiagnostic,
    comprehensiveFix,
    recalculateUserReferralEarnings,
    getConfiguration
};
    