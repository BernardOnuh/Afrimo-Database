// scripts/fixAllReferralMistakes.js
// Script to fix all previous referral commission mistakes

const mongoose = require('mongoose');
const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const PaymentTransaction = require('../models/Transaction');
const UserShare = require('../models/UserShare');
const SiteConfig = require('../models/SiteConfig');
const CoFounderShare = require('../models/CoFounderShare');

// Connect to database (using the same connection from your audit script)
async function connectDB() {
    try {
        await mongoose.connect('mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net', {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error);
        process.exit(1);
    }
}

// Get commission rates from config
async function getCommissionRates() {
    try {
        const siteConfig = await SiteConfig.getCurrentConfig();
        return siteConfig.referralCommission || {
            generation1: 15,
            generation2: 3,
            generation3: 2
        };
    } catch (error) {
        console.log('⚠️ Using default commission rates');
        return {
            generation1: 15,
            generation2: 3,
            generation3: 2
        };
    }
}

// Get co-founder share ratio
async function getCofounderRatio() {
    try {
        const coFounderConfig = await CoFounderShare.findOne();
        return coFounderConfig?.shareToRegularRatio || 29;
    } catch (error) {
        console.log('⚠️ Using default co-founder ratio: 29');
        return 29;
    }
}

// Fix individual user's referral commissions
async function fixUserReferralCommissions(userId, commissionRates, cofounderRatio, userName = null) {
    try {
        const user = await User.findById(userId);
        if (!user) {
            return { success: false, error: 'User not found' };
        }

        console.log(`🔧 Fixing referral commissions for ${user.userName} (${user.name})`);

        // Delete existing referral transactions for this user as beneficiary
        const deletedCount = await ReferralTransaction.deleteMany({ beneficiary: userId });
        console.log(`   ✅ Cleared ${deletedCount.deletedCount} existing referral transactions`);

        let totalEarnings = 0;
        const generationStats = {
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 0, earnings: 0 },
            generation3: { count: 0, earnings: 0 }
        };

        // Process Generation 1 referrals
        const gen1Users = await User.find({ 'referralInfo.code': user.userName });
        generationStats.generation1.count = gen1Users.length;

        console.log(`   📊 Found ${gen1Users.length} Generation 1 referrals`);

        for (const gen1User of gen1Users) {
            // Process regular share transactions
            const userShare = await UserShare.findOne({ user: gen1User._id });
            if (userShare && userShare.transactions) {
                const completedTransactions = userShare.transactions.filter(tx => tx.status === 'completed');
                
                for (const tx of completedTransactions) {
                    if (tx.totalAmount > 0) {
                        const commission = (tx.totalAmount * commissionRates.generation1) / 100;
                        
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
                        
                        generationStats.generation1.earnings += commission;
                        totalEarnings += commission;
                        console.log(`     Gen1 Share: ${gen1User.userName} → $${commission.toFixed(2)} (from $${tx.totalAmount})`);
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
                    
                    generationStats.generation1.earnings += commission;
                    totalEarnings += commission;
                    console.log(`     Gen1 Cofounder: ${gen1User.userName} → $${commission.toFixed(2)} (from $${tx.amount}, ${tx.shares} shares)`);
                }
            }

            // Process Generation 2
            const gen2Users = await User.find({ 'referralInfo.code': gen1User.userName });
            for (const gen2User of gen2Users) {
                // Increment Gen 2 count for this beneficiary
                generationStats.generation2.count++;

                // Process regular share transactions
                const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
                if (gen2UserShare && gen2UserShare.transactions) {
                    const completedTransactions = gen2UserShare.transactions.filter(tx => tx.status === 'completed');
                    
                    for (const tx of completedTransactions) {
                        if (tx.totalAmount > 0) {
                            const commission = (tx.totalAmount * commissionRates.generation2) / 100;
                            
                            await ReferralTransaction.create({
                                beneficiary: userId,
                                referredUser: gen2User._id,
                                amount: commission,
                                currency: tx.currency || 'USD',
                                generation: 2,
                                purchaseType: 'share',
                                sourceTransactionModel: 'UserShare',
                                status: 'completed',
                                createdAt: tx.createdAt || new Date()
                            });
                            
                            generationStats.generation2.earnings += commission;
                            totalEarnings += commission;
                            console.log(`     Gen2 Share: ${gen2User.userName} → $${commission.toFixed(2)} (from $${tx.totalAmount})`);
                        }
                    }
                }

                // Process co-founder transactions
                const gen2CofounderTransactions = await PaymentTransaction.find({
                    userId: gen2User._id,
                    type: 'co-founder',
                    status: 'completed'
                });

                for (const tx of gen2CofounderTransactions) {
                    if (tx.amount > 0) {
                        const commission = (tx.amount * commissionRates.generation2) / 100;
                        
                        await ReferralTransaction.create({
                            beneficiary: userId,
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
                        
                        generationStats.generation2.earnings += commission;
                        totalEarnings += commission;
                        console.log(`     Gen2 Cofounder: ${gen2User.userName} → $${commission.toFixed(2)} (from $${tx.amount}, ${tx.shares} shares)`);
                    }
                }

                // Process Generation 3
                const gen3Users = await User.find({ 'referralInfo.code': gen2User.userName });
                for (const gen3User of gen3Users) {
                    // Increment Gen 3 count for this beneficiary
                    generationStats.generation3.count++;

                    // Process regular share transactions
                    const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
                    if (gen3UserShare && gen3UserShare.transactions) {
                        const completedTransactions = gen3UserShare.transactions.filter(tx => tx.status === 'completed');
                        
                        for (const tx of completedTransactions) {
                            if (tx.totalAmount > 0) {
                                const commission = (tx.totalAmount * commissionRates.generation3) / 100;
                                
                                await ReferralTransaction.create({
                                    beneficiary: userId,
                                    referredUser: gen3User._id,
                                    amount: commission,
                                    currency: tx.currency || 'USD',
                                    generation: 3,
                                    purchaseType: 'share',
                                    sourceTransactionModel: 'UserShare',
                                    status: 'completed',
                                    createdAt: tx.createdAt || new Date()
                                });
                                
                                generationStats.generation3.earnings += commission;
                                totalEarnings += commission;
                                console.log(`     Gen3 Share: ${gen3User.userName} → $${commission.toFixed(2)} (from $${tx.totalAmount})`);
                            }
                        }
                    }

                    // Process co-founder transactions
                    const gen3CofounderTransactions = await PaymentTransaction.find({
                        userId: gen3User._id,
                        type: 'co-founder',
                        status: 'completed'
                    });

                    for (const tx of gen3CofounderTransactions) {
                        if (tx.amount > 0) {
                            const commission = (tx.amount * commissionRates.generation3) / 100;
                            
                            await ReferralTransaction.create({
                                beneficiary: userId,
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
                            
                            generationStats.generation3.earnings += commission;
                            totalEarnings += commission;
                            console.log(`     Gen3 Cofounder: ${gen3User.userName} → $${commission.toFixed(2)} (from $${tx.amount}, ${tx.shares} shares)`);
                        }
                    }
                }
            }
        }

        // Update or create referral stats
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

        console.log(`   ✅ FIXED SUMMARY:`);
        console.log(`     Gen1: ${generationStats.generation1.count} users, $${generationStats.generation1.earnings.toFixed(2)}`);
        console.log(`     Gen2: ${generationStats.generation2.count} users, $${generationStats.generation2.earnings.toFixed(2)}`);
        console.log(`     Gen3: ${generationStats.generation3.count} users, $${generationStats.generation3.earnings.toFixed(2)}`);
        console.log(`     TOTAL: $${totalEarnings.toFixed(2)}`);

        return {
            success: true,
            stats: {
                totalEarnings,
                generationStats,
                userName: user.userName,
                name: user.name
            }
        };

    } catch (error) {
        console.error(`❌ Error fixing user ${userId}:`, error);
        return { success: false, error: error.message };
    }
}

// Fix single user by username/email/id
async function fixSingleUser(userIdentifier) {
    console.log('🔧 SINGLE USER REFERRAL FIX');
    console.log('=' .repeat(50));

    try {
        // Find user
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
            console.error(`❌ User not found: ${userIdentifier}`);
            return { success: false, error: 'User not found' };
        }

        // Get configuration
        const commissionRates = await getCommissionRates();
        const cofounderRatio = await getCofounderRatio();

        console.log(`👤 Fixing: ${user.name} (@${user.userName})`);
        console.log(`📊 Rates: Gen1: ${commissionRates.generation1}%, Gen2: ${commissionRates.generation2}%, Gen3: ${commissionRates.generation3}%`);
        console.log('');

        // Fix the user
        const result = await fixUserReferralCommissions(user._id, commissionRates, cofounderRatio, user.userName);

        if (result.success) {
            console.log('');
            console.log('🎉 SINGLE USER FIX COMPLETED!');
            console.log(`✅ ${user.userName} is now fixed with correct commissions`);
        }

        return result;

    } catch (error) {
        console.error('💥 Error in single user fix:', error);
        return { success: false, error: error.message };
    }
}

// Main fix function for all users
async function fixAllReferralMistakes() {
    console.log('🚀 Starting comprehensive referral commission fix...');
    console.log('=' .repeat(60));

    const startTime = Date.now();
    
    try {
        // Get configuration
        const commissionRates = await getCommissionRates();
        const cofounderRatio = await getCofounderRatio();
        
        console.log('📊 Configuration:');
        console.log(`   Commission rates: Gen1: ${commissionRates.generation1}%, Gen2: ${commissionRates.generation2}%, Gen3: ${commissionRates.generation3}%`);
        console.log(`   Co-founder ratio: 1:${cofounderRatio}`);
        console.log('');

        // Get all users who could potentially have referral earnings
        const allUsers = await User.find({
            'status.isActive': true,
            isBanned: { $ne: true }
        }).select('userName name _id').sort({ createdAt: 1 });

        console.log(`👥 Found ${allUsers.length} active users to process`);
        console.log('');

        const results = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            errors: [],
            summary: {
                totalEarningsFixed: 0,
                totalTransactionsCreated: 0,
                usersWithEarnings: 0
            }
        };

        // Process each user
        for (let i = 0; i < allUsers.length; i++) {
            const user = allUsers[i];
            
            console.log(`[${i + 1}/${allUsers.length}] Processing ${user.userName}...`);
            
            const result = await fixUserReferralCommissions(user._id, commissionRates, cofounderRatio);
            
            results.totalProcessed++;
            
            if (result.success) {
                results.successful++;
                if (result.stats.totalEarnings > 0) {
                    results.summary.usersWithEarnings++;
                    results.summary.totalEarningsFixed += result.stats.totalEarnings;
                }
            } else {
                results.failed++;
                results.errors.push({
                    userName: user.userName,
                    error: result.error
                });
                console.log(`   ❌ Failed: ${result.error}`);
            }
            
            // Add small delay to prevent overwhelming the database
            if (i % 10 === 0 && i > 0) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Count total referral transactions created
        const totalTransactions = await ReferralTransaction.countDocuments();
        results.summary.totalTransactionsCreated = totalTransactions;

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        console.log('');
        console.log('🎉 REFERRAL COMMISSION FIX COMPLETED!');
        console.log('=' .repeat(60));
        console.log(`⏱️  Duration: ${duration} seconds`);
        console.log(`📊 Results:`);
        console.log(`   Total users processed: ${results.totalProcessed}`);
        console.log(`   Successful fixes: ${results.successful}`);
        console.log(`   Failed fixes: ${results.failed}`);
        console.log(`   Users with earnings: ${results.summary.usersWithEarnings}`);
        console.log(`   Total earnings fixed: $${results.summary.totalEarningsFixed.toFixed(2)}`);
        console.log(`   Total transactions created: ${results.summary.totalTransactionsCreated}`);

        if (results.failed > 0) {
            console.log('');
            console.log('❌ Errors encountered:');
            results.errors.forEach(error => {
                console.log(`   ${error.userName}: ${error.error}`);
            });
        }

        return results;

    } catch (error) {
        console.error('💥 Critical error in fix process:', error);
        throw error;
    }
}

// Command line interface
async function main() {
    try {
        await connectDB();

        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log('');
            console.log('🔧 REFERRAL COMMISSION FIX TOOL');
            console.log('');
            console.log('Usage:');
            console.log('  node fixAllReferralMistakes.js                    # Fix ALL users');
            console.log('  node fixAllReferralMistakes.js <username>         # Fix single user');
            console.log('');
            console.log('Examples:');
            console.log('  node fixAllReferralMistakes.js                    # Fix everyone');
            console.log('  node fixAllReferralMistakes.js Ipresino           # Fix just Ipresino');
            console.log('  node fixAllReferralMistakes.js "Iprete Johnson"   # Fix by name');
            console.log('  node fixAllReferralMistakes.js iprestyno100@gmail.com # Fix by email');
            console.log('');
            console.log('⚠️  WARNING: This will recalculate ALL referral commissions!');
            console.log('💡 TIP: Test with single user first, then run for everyone');
            console.log('');
            
            // Ask for confirmation
            const readline = require('readline');
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout
            });
            
            rl.question('Do you want to fix ALL users? (y/N): ', (answer) => {
                rl.close();
                if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                    fixAllReferralMistakes().then(() => {
                        console.log('✅ Fix completed successfully!');
                        process.exit(0);
                    }).catch(error => {
                        console.error('💥 Script failed:', error);
                        process.exit(1);
                    });
                } else {
                    console.log('❌ Fix cancelled');
                    process.exit(0);
                }
            });
            
            return;
        }

        if (args.length === 1) {
            // Single user fix
            const result = await fixSingleUser(args[0]);
            
            if (!result.success) {
                console.error(`❌ ${result.error}`);
                process.exit(1);
            }
        } else {
            console.log('❌ Too many arguments. Provide either no arguments (fix all) or one argument (username/email/id)');
            process.exit(1);
        }

        console.log('');
        console.log('✅ Fix completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('💥 Script failed:', error);
        process.exit(1);
    }
}

// Export for use in other scripts or direct execution
if (require.main === module) {
    main();
}

module.exports = {
    fixAllReferralMistakes,
    fixSingleUser,
    fixUserReferralCommissions,
    connectDB
};