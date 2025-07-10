// scripts/emergencyReferralFix.js
// Quick emergency fix for the most common referral issues

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

// Get commission rates
async function getCommissionRates() {
    try {
        const siteConfig = await SiteConfig.getCurrentConfig();
        return siteConfig?.referralCommission || {
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

// Emergency fix for a specific user
async function emergencyFixUser(userId, commissionRates) {
    try {
        const user = await User.findById(userId);
        if (!user) {
            console.log(`❌ User ${userId} not found`);
            return { success: false, error: 'User not found' };
        }

        console.log(`🔧 Emergency fixing user: ${user.userName} (${user.name})`);

        // Step 1: Delete all existing referral transactions for this user
        const deletedResult = await ReferralTransaction.deleteMany({ beneficiary: userId });
        console.log(`   🧹 Deleted ${deletedResult.deletedCount} existing referral transactions`);

        // Step 2: Recalculate from scratch
        let totalEarnings = 0;
        const stats = {
            generation1: { count: 0, earnings: 0 },
            generation2: { count: 0, earnings: 0 },
            generation3: { count: 0, earnings: 0 }
        };

        // Get Generation 1 referrals
        const gen1Users = await User.find({ 
            'referralInfo.code': user.userName,
            'status.isActive': true,
            isBanned: { $ne: true }
        });

        stats.generation1.count = gen1Users.length;
        console.log(`   📊 Found ${gen1Users.length} Generation 1 users`);

        for (const gen1User of gen1Users) {
            // Process regular share purchases
            const userShare = await UserShare.findOne({ user: gen1User._id });
            if (userShare?.transactions) {
                const completedTxs = userShare.transactions.filter(tx => 
                    tx.status === 'completed' && tx.totalAmount > 0
                );

                for (const tx of completedTxs) {
                    const commission = (tx.totalAmount * commissionRates.generation1) / 100;
                    
                    const newTransaction = await ReferralTransaction.create({
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

                    stats.generation1.earnings += commission;
                    totalEarnings += commission;
                    console.log(`     ✅ Gen1 Share: ${gen1User.userName} → $${commission.toFixed(2)}`);
                }
            }

            // Process co-founder purchases
            const cofounderTxs = await PaymentTransaction.find({
                userId: gen1User._id,
                type: 'co-founder',
                status: 'completed'
            });

            for (const tx of cofounderTxs) {
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

                    stats.generation1.earnings += commission;
                    totalEarnings += commission;
                    console.log(`     ✅ Gen1 CoFounder: ${gen1User.userName} → $${commission.toFixed(2)}`);
                }
            }

            // Process Generation 2
            const gen2Users = await User.find({ 
                'referralInfo.code': gen1User.userName,
                'status.isActive': true,
                isBanned: { $ne: true }
            });

            stats.generation2.count += gen2Users.length;

            for (const gen2User of gen2Users) {
                // Gen2 regular shares
                const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
                if (gen2UserShare?.transactions) {
                    const completedTxs = gen2UserShare.transactions.filter(tx => 
                        tx.status === 'completed' && tx.totalAmount > 0
                    );

                    for (const tx of completedTxs) {
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

                        stats.generation2.earnings += commission;
                        totalEarnings += commission;
                        console.log(`     ✅ Gen2 Share: ${gen2User.userName} → $${commission.toFixed(2)}`);
                    }
                }

                // Gen2 co-founder
                const gen2CofounderTxs = await PaymentTransaction.find({
                    userId: gen2User._id,
                    type: 'co-founder',
                    status: 'completed'
                });

                for (const tx of gen2CofounderTxs) {
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

                        stats.generation2.earnings += commission;
                        totalEarnings += commission;
                        console.log(`     ✅ Gen2 CoFounder: ${gen2User.userName} → $${commission.toFixed(2)}`);
                    }
                }

                // Process Generation 3
                const gen3Users = await User.find({ 
                    'referralInfo.code': gen2User.userName,
                    'status.isActive': true,
                    isBanned: { $ne: true }
                });

                stats.generation3.count += gen3Users.length;

                for (const gen3User of gen3Users) {
                    // Gen3 regular shares
                    const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
                    if (gen3UserShare?.transactions) {
                        const completedTxs = gen3UserShare.transactions.filter(tx => 
                            tx.status === 'completed' && tx.totalAmount > 0
                        );

                        for (const tx of completedTxs) {
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

                            stats.generation3.earnings += commission;
                            totalEarnings += commission;
                            console.log(`     ✅ Gen3 Share: ${gen3User.userName} → $${commission.toFixed(2)}`);
                        }
                    }

                    // Gen3 co-founder
                    const gen3CofounderTxs = await PaymentTransaction.find({
                        userId: gen3User._id,
                        type: 'co-founder',
                        status: 'completed'
                    });

                    for (const tx of gen3CofounderTxs) {
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

                            stats.generation3.earnings += commission;
                            totalEarnings += commission;
                            console.log(`     ✅ Gen3 CoFounder: ${gen3User.userName} → $${commission.toFixed(2)}`);
                        }
                    }
                }
            }
        }

        // Step 3: Update Referral document
        let referralDoc = await Referral.findOne({ user: userId });
        
        if (!referralDoc) {
            referralDoc = new Referral({
                user: userId,
                referredUsers: stats.generation1.count,
                totalEarnings: totalEarnings,
                generation1: stats.generation1,
                generation2: stats.generation2,
                generation3: stats.generation3
            });
        } else {
            referralDoc.referredUsers = stats.generation1.count;
            referralDoc.totalEarnings = totalEarnings;
            referralDoc.generation1 = stats.generation1;
            referralDoc.generation2 = stats.generation2;
            referralDoc.generation3 = stats.generation3;
        }

        await referralDoc.save();

        console.log(`   ✅ Updated Referral document: $${totalEarnings.toFixed(2)} total earnings`);
        console.log(`   📊 Gen1: ${stats.generation1.count} users, $${stats.generation1.earnings.toFixed(2)}`);
        console.log(`   📊 Gen2: ${stats.generation2.count} users, $${stats.generation2.earnings.toFixed(2)}`);
        console.log(`   📊 Gen3: ${stats.generation3.count} users, $${stats.generation3.earnings.toFixed(2)}`);

        return {
            success: true,
            user: user.userName,
            totalEarnings,
            stats
        };

    } catch (error) {
        console.error(`❌ Error fixing user ${userId}:`, error);
        return { success: false, error: error.message };
    }
}

// Fix all users with referral issues
async function emergencyFixAll() {
    console.log('🚨 EMERGENCY REFERRAL FIX - FIXING ALL USERS');
    console.log('=' .repeat(60));

    try {
        const commissionRates = await getCommissionRates();
        console.log(`📊 Commission rates: Gen1: ${commissionRates.generation1}%, Gen2: ${commissionRates.generation2}%, Gen3: ${commissionRates.generation3}%`);

        // Get all users who could potentially have referral earnings
        const allUsers = await User.find({
            'status.isActive': true,
            isBanned: { $ne: true }
        }).select('userName _id').sort({ createdAt: 1 });

        console.log(`👥 Found ${allUsers.length} active users to process`);
        
        const results = {
            totalProcessed: 0,
            successful: 0,
            failed: 0,
            totalEarningsFixed: 0,
            errors: []
        };

        // Process users in batches to avoid overwhelming the database
        const batchSize = 10;
        for (let i = 0; i < allUsers.length; i += batchSize) {
            const batch = allUsers.slice(i, i + batchSize);
            
            console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allUsers.length/batchSize)} (users ${i + 1}-${Math.min(i + batchSize, allUsers.length)})`);

            const batchPromises = batch.map(async (user) => {
                try {
                    const result = await emergencyFixUser(user._id, commissionRates);
                    results.totalProcessed++;
                    
                    if (result.success) {
                        results.successful++;
                        results.totalEarningsFixed += result.totalEarnings;
                        console.log(`   ✅ ${user.userName}: $${result.totalEarnings.toFixed(2)}`);
                    } else {
                        results.failed++;
                        results.errors.push({ userName: user.userName, error: result.error });
                        console.log(`   ❌ ${user.userName}: ${result.error}`);
                    }
                } catch (error) {
                    results.failed++;
                    results.errors.push({ userName: user.userName, error: error.message });
                    console.log(`   💥 ${user.userName}: ${error.message}`);
                }
            });

            // Wait for batch to complete
            await Promise.all(batchPromises);
            
            // Small delay between batches
            if (i + batchSize < allUsers.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        console.log('\n🎉 EMERGENCY FIX COMPLETED!');
        console.log('=' .repeat(60));
        console.log(`📊 Results:`);
        console.log(`   Total processed: ${results.totalProcessed}`);
        console.log(`   Successful: ${results.successful}`);
        console.log(`   Failed: ${results.failed}`);
        console.log(`   Total earnings fixed: $${results.totalEarningsFixed.toFixed(2)}`);
        
        if (results.failed > 0) {
            console.log(`\n❌ Failed users (${results.failed}):`);
            results.errors.slice(0, 10).forEach(error => {
                console.log(`   ${error.userName}: ${error.error}`);
            });
            if (results.errors.length > 10) {
                console.log(`   ... and ${results.errors.length - 10} more`);
            }
        }

        return results;

    } catch (error) {
        console.error('💥 Emergency fix failed:', error);
        throw error;
    }
}

// Remove duplicate referral transactions
async function removeDuplicates() {
    console.log('🧹 REMOVING DUPLICATE REFERRAL TRANSACTIONS');
    console.log('=' .repeat(60));

    try {
        // Find duplicates based on key fields
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

        console.log(`Found ${duplicates.length} sets of duplicate transactions`);

        let totalRemoved = 0;
        for (const duplicate of duplicates) {
            // Keep the first document, remove the rest
            const docsToRemove = duplicate.docs.slice(1);
            
            const result = await ReferralTransaction.deleteMany({ 
                _id: { $in: docsToRemove } 
            });
            
            totalRemoved += result.deletedCount;
            console.log(`   Removed ${result.deletedCount} duplicates for beneficiary ${duplicate._id.beneficiary}`);
        }

        console.log(`✅ Removed ${totalRemoved} duplicate transactions`);
        return totalRemoved;

    } catch (error) {
        console.error('❌ Error removing duplicates:', error);
        throw error;
    }
}

// Quick health check
async function quickHealthCheck() {
    console.log('🏥 QUICK HEALTH CHECK');
    console.log('=' .repeat(60));

    try {
        const totalUsers = await User.countDocuments({ 'status.isActive': true });
        const totalReferralTransactions = await ReferralTransaction.countDocuments();
        const totalReferralDocs = await Referral.countDocuments();
        const completedTransactions = await ReferralTransaction.countDocuments({ status: 'completed' });
        
        const totalEarnings = await ReferralTransaction.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        const usersWithCompletedShares = await UserShare.countDocuments({
            'transactions': {
                $elemMatch: { status: 'completed' }
            }
        });

        const cofounderTransactions = await PaymentTransaction.countDocuments({
            type: 'co-founder',
            status: 'completed'
        });

        console.log('📊 System Statistics:');
        console.log(`   Active users: ${totalUsers}`);
        console.log(`   Referral transactions: ${totalReferralTransactions}`);
        console.log(`   Referral documents: ${totalReferralDocs}`);
        console.log(`   Completed transactions: ${completedTransactions}`);
        console.log(`   Total earnings: $${(totalEarnings[0]?.total || 0).toFixed(2)}`);
        console.log(`   Users with completed shares: ${usersWithCompletedShares}`);
        console.log(`   Co-founder transactions: ${cofounderTransactions}`);

        // Check for potential issues
        const issues = [];
        
        if (totalReferralTransactions === 0 && usersWithCompletedShares > 0) {
            issues.push('No referral transactions found despite completed share purchases');
        }
        
        if (totalReferralDocs === 0 && totalReferralTransactions > 0) {
            issues.push('No referral documents found despite referral transactions');
        }

        if (issues.length > 0) {
            console.log('\n⚠️ Potential Issues:');
            issues.forEach(issue => console.log(`   ❌ ${issue}`));
        } else {
            console.log('\n✅ No obvious issues detected');
        }

        return {
            totalUsers,
            totalReferralTransactions,
            totalReferralDocs,
            completedTransactions,
            totalEarnings: totalEarnings[0]?.total || 0,
            usersWithCompletedShares,
            cofounderTransactions,
            issues
        };

    } catch (error) {
        console.error('❌ Health check failed:', error);
        throw error;
    }
}

// Main execution
async function main() {
    try {
        await connectDB();

        const args = process.argv.slice(2);
        const command = args[0] || 'help';

        console.log(`🚀 Running emergency command: ${command}`);
        console.log('');

        switch (command) {
            case 'health':
            case 'check':
                await quickHealthCheck();
                break;

            case 'duplicates':
            case 'dupes':
                await removeDuplicates();
                break;

            case 'fix-all':
            case 'emergency':
                const results = await emergencyFixAll();
                console.log('\n📋 Final Summary:');
                console.log(`   Success rate: ${((results.successful / results.totalProcessed) * 100).toFixed(1)}%`);
                break;

            case 'fix-user':
                const userIdentifier = args[1];
                if (!userIdentifier) {
                    console.log('❌ Please provide a user identifier (username, email, or ID)');
                    process.exit(1);
                }

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
                    console.log(`❌ User not found: ${userIdentifier}`);
                    process.exit(1);
                }

                const commissionRates = await getCommissionRates();
                const userResult = await emergencyFixUser(user._id, commissionRates);
                
                if (userResult.success) {
                    console.log(`\n✅ Successfully fixed ${user.userName}: $${userResult.totalEarnings.toFixed(2)}`);
                } else {
                    console.log(`\n❌ Failed to fix ${user.userName}: ${userResult.error}`);
                }
                break;

            case 'help':
            default:
                console.log('🚨 EMERGENCY REFERRAL FIX TOOL');
                console.log('');
                console.log('Usage:');
                console.log('  node emergencyReferralFix.js health           # Quick health check');
                console.log('  node emergencyReferralFix.js duplicates       # Remove duplicates only');
                console.log('  node emergencyReferralFix.js fix-all          # Fix all users (FULL FIX)');
                console.log('  node emergencyReferralFix.js fix-user <user>  # Fix specific user');
                console.log('');
                console.log('Examples:');
                console.log('  node emergencyReferralFix.js health');
                console.log('  node emergencyReferralFix.js fix-user Ipresino');
                console.log('  node emergencyReferralFix.js fix-all');
                console.log('');
                console.log('⚠️  WARNING: fix-all will recalculate ALL referral data!');
                console.log('💡 TIP: Run health check first to see current state');
                break;
        }

        console.log('\n✅ Emergency operation completed!');
        process.exit(0);

    } catch (error) {
        console.error('💥 Emergency script failed:', error);
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
    emergencyFixUser,
    emergencyFixAll,
    removeDuplicates,
    quickHealthCheck,
    getCommissionRates
};