// scripts/withdrawalAuditFix.js
// Audit and fix withdrawal deductions to ensure accurate balances

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

// Comprehensive withdrawal audit
async function auditWithdrawals() {
    console.log('🔍 AUDITING WITHDRAWAL DEDUCTIONS');
    console.log('=' .repeat(60));

    try {
        // 1. Get all withdrawal statistics
        const withdrawalStats = await Withdrawal.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        console.log('📊 Withdrawal Statistics:');
        withdrawalStats.forEach(stat => {
            console.log(`   ${stat._id}: ${stat.count} withdrawals, $${stat.totalAmount.toFixed(2)} total`);
        });

        // 2. Check users with withdrawals
        const usersWithWithdrawals = await Withdrawal.distinct('user');
        console.log(`\n👥 Found ${usersWithWithdrawals.length} users with withdrawal history`);

        // 3. Audit each user's withdrawal balance
        const auditResults = [];
        let usersWithIssues = 0;

        for (const userId of usersWithWithdrawals) {
            const user = await User.findById(userId).select('userName name');
            const referralData = await Referral.findOne({ user: userId });

            if (!referralData) {
                console.log(`⚠️ User ${user?.userName || userId} has withdrawals but no referral data`);
                continue;
            }

            // Get all withdrawals for this user
            const userWithdrawals = await Withdrawal.find({ user: userId });

            // Calculate expected balances from withdrawals
            const calculatedBalances = {
                totalWithdrawn: 0,
                pendingWithdrawals: 0,
                processingWithdrawals: 0
            };

            userWithdrawals.forEach(withdrawal => {
                switch (withdrawal.status) {
                    case 'paid':
                        calculatedBalances.totalWithdrawn += withdrawal.amount;
                        break;
                    case 'pending':
                        calculatedBalances.pendingWithdrawals += withdrawal.amount;
                        break;
                    case 'processing':
                        calculatedBalances.processingWithdrawals += withdrawal.amount;
                        break;
                    // Failed/rejected withdrawals should not affect balance
                }
            });

            // Compare with stored balances
            const storedBalances = {
                totalWithdrawn: referralData.totalWithdrawn || 0,
                pendingWithdrawals: referralData.pendingWithdrawals || 0,
                processingWithdrawals: referralData.processingWithdrawals || 0
            };

            // Check for discrepancies
            const discrepancies = {
                totalWithdrawn: Math.abs(calculatedBalances.totalWithdrawn - storedBalances.totalWithdrawn),
                pendingWithdrawals: Math.abs(calculatedBalances.pendingWithdrawals - storedBalances.pendingWithdrawals),
                processingWithdrawals: Math.abs(calculatedBalances.processingWithdrawals - storedBalances.processingWithdrawals)
            };

            const hasDiscrepancies = Object.values(discrepancies).some(diff => diff > 0.01);

            if (hasDiscrepancies) {
                usersWithIssues++;
                auditResults.push({
                    userId,
                    userName: user?.userName || 'Unknown',
                    calculated: calculatedBalances,
                    stored: storedBalances,
                    discrepancies,
                    withdrawals: userWithdrawals.map(w => ({
                        id: w._id,
                        amount: w.amount,
                        status: w.status,
                        createdAt: w.createdAt
                    }))
                });
            }
        }

        console.log(`\n🔍 Audit Results:`);
        console.log(`   Users with correct balances: ${usersWithWithdrawals.length - usersWithIssues}`);
        console.log(`   Users with balance issues: ${usersWithIssues}`);

        if (usersWithIssues > 0) {
            console.log(`\n❌ Users with withdrawal balance discrepancies:`);
            auditResults.slice(0, 10).forEach(result => {
                console.log(`\n   ${result.userName}:`);
                console.log(`     Withdrawn - Calculated: $${result.calculated.totalWithdrawn.toFixed(2)}, Stored: $${result.stored.totalWithdrawn.toFixed(2)}`);
                console.log(`     Pending - Calculated: $${result.calculated.pendingWithdrawals.toFixed(2)}, Stored: $${result.stored.pendingWithdrawals.toFixed(2)}`);
                console.log(`     Processing - Calculated: $${result.calculated.processingWithdrawals.toFixed(2)}, Stored: $${result.stored.processingWithdrawals.toFixed(2)}`);
            });

            if (auditResults.length > 10) {
                console.log(`     ... and ${auditResults.length - 10} more users with issues`);
            }
        }

        // 4. Check for withdrawal transactions
        const withdrawalTransactions = await ReferralTransaction.countDocuments({
            type: 'withdrawal',
            status: 'completed'
        });

        const totalWithdrawalTransactions = await ReferralTransaction.aggregate([
            { $match: { type: 'withdrawal', status: 'completed' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        console.log(`\n📝 Withdrawal Transactions:`);
        console.log(`   Count: ${withdrawalTransactions}`);
        console.log(`   Total amount: $${(totalWithdrawalTransactions[0]?.total || 0).toFixed(2)}`);

        return {
            totalUsers: usersWithWithdrawals.length,
            usersWithIssues,
            auditResults,
            withdrawalStats,
            withdrawalTransactions
        };

    } catch (error) {
        console.error('❌ Error during withdrawal audit:', error);
        throw error;
    }
}

// Fix withdrawal balance discrepancies
async function fixWithdrawalBalances(dryRun = true) {
    console.log('🔧 FIXING WITHDRAWAL BALANCE DISCREPANCIES');
    console.log('=' .repeat(60));
    console.log(`Dry run: ${dryRun}`);
    console.log('');

    try {
        // Get users with withdrawals
        const usersWithWithdrawals = await Withdrawal.distinct('user');
        
        let fixedCount = 0;
        let errorCount = 0;
        const fixResults = [];

        for (const userId of usersWithWithdrawals) {
            try {
                const user = await User.findById(userId).select('userName name');
                const referralData = await Referral.findOne({ user: userId });

                if (!referralData) {
                    console.log(`⚠️ Skipping user ${user?.userName || userId} - no referral data`);
                    continue;
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
                        // Failed/rejected withdrawals don't affect balance
                    }
                });

                // Check if update is needed
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
                    console.log(`🔧 Fixing balances for ${user?.userName || userId}`);
                    console.log(`   Before - Withdrawn: $${currentBalances.totalWithdrawn.toFixed(2)}, Pending: $${currentBalances.pendingWithdrawals.toFixed(2)}, Processing: $${currentBalances.processingWithdrawals.toFixed(2)}`);
                    console.log(`   After  - Withdrawn: $${correctBalances.totalWithdrawn.toFixed(2)}, Pending: $${correctBalances.pendingWithdrawals.toFixed(2)}, Processing: $${correctBalances.processingWithdrawals.toFixed(2)}`);

                    if (!dryRun) {
                        // Update the referral document
                        await Referral.findOneAndUpdate(
                            { user: userId },
                            {
                                $set: {
                                    totalWithdrawn: correctBalances.totalWithdrawn,
                                    pendingWithdrawals: correctBalances.pendingWithdrawals,
                                    processingWithdrawals: correctBalances.processingWithdrawals
                                }
                            }
                        );
                    }

                    fixedCount++;
                    fixResults.push({
                        userId,
                        userName: user?.userName || 'Unknown',
                        before: currentBalances,
                        after: correctBalances,
                        withdrawalCount: userWithdrawals.length
                    });
                }

            } catch (error) {
                errorCount++;
                console.error(`❌ Error fixing user ${userId}:`, error.message);
            }
        }

        console.log(`\n✅ WITHDRAWAL BALANCE FIX COMPLETED`);
        console.log(`   Users processed: ${usersWithWithdrawals.length}`);
        console.log(`   Users fixed: ${fixedCount}`);
        console.log(`   Errors: ${errorCount}`);

        if (dryRun && fixedCount > 0) {
            console.log(`\n💡 Run with --execute flag to apply these fixes`);
        }

        return { fixedCount, errorCount, fixResults };

    } catch (error) {
        console.error('❌ Error fixing withdrawal balances:', error);
        throw error;
    }
}

// Create missing withdrawal transactions
async function createMissingWithdrawalTransactions(dryRun = true) {
    console.log('📝 CREATING MISSING WITHDRAWAL TRANSACTIONS');
    console.log('=' .repeat(60));
    console.log(`Dry run: ${dryRun}`);
    console.log('');

    try {
        // Get all paid withdrawals
        const paidWithdrawals = await Withdrawal.find({ status: 'paid' });
        
        let createdCount = 0;
        let skippedCount = 0;

        for (const withdrawal of paidWithdrawals) {
            // Check if transaction already exists
            const existingTransaction = await ReferralTransaction.findOne({
                user: withdrawal.user,
                type: 'withdrawal',
                reference: withdrawal.clientReference || withdrawal.transactionReference || `MANUAL-${withdrawal._id}`
            });

            if (existingTransaction) {
                skippedCount++;
                continue;
            }

            const user = await User.findById(withdrawal.user).select('userName');
            console.log(`📝 Creating withdrawal transaction for ${user?.userName || withdrawal.user}`);
            console.log(`   Amount: -$${withdrawal.amount.toFixed(2)}, Date: ${withdrawal.processedAt || withdrawal.createdAt}`);

            if (!dryRun) {
                const transaction = new ReferralTransaction({
                    user: withdrawal.user,
                    type: 'withdrawal',
                    amount: -withdrawal.amount, // Negative amount for withdrawal
                    description: `Withdrawal to ${withdrawal.paymentDetails?.bankName || withdrawal.paymentMethod} - ${withdrawal.paymentDetails?.accountNumber || 'N/A'}`,
                    status: 'completed',
                    reference: withdrawal.clientReference || withdrawal.transactionReference || `MANUAL-${withdrawal._id}`,
                    generation: 0, // Withdrawals don't have generation
                    referredUser: withdrawal.user,
                    beneficiary: withdrawal.user,
                    createdAt: withdrawal.processedAt || withdrawal.createdAt
                });

                await transaction.save();
            }

            createdCount++;
        }

        console.log(`\n✅ WITHDRAWAL TRANSACTION CREATION COMPLETED`);
        console.log(`   Paid withdrawals found: ${paidWithdrawals.length}`);
        console.log(`   Transactions created: ${createdCount}`);
        console.log(`   Already existed: ${skippedCount}`);

        if (dryRun && createdCount > 0) {
            console.log(`\n💡 Run with --execute flag to create these transactions`);
        }

        return { createdCount, skippedCount };

    } catch (error) {
        console.error('❌ Error creating withdrawal transactions:', error);
        throw error;
    }
}

// Recalculate available balances
async function recalculateAvailableBalances() {
    console.log('🧮 RECALCULATING AVAILABLE BALANCES');
    console.log('=' .repeat(60));

    try {
        const usersWithReferrals = await Referral.find({}).select('user totalEarnings totalWithdrawn pendingWithdrawals processingWithdrawals');
        
        console.log(`📊 Calculating available balances for ${usersWithReferrals.length} users...`);

        const balanceStats = {
            totalEarnings: 0,
            totalWithdrawn: 0,
            totalPending: 0,
            totalProcessing: 0,
            totalAvailable: 0,
            usersWithBalance: 0
        };

        usersWithReferrals.forEach(referral => {
            const totalEarnings = referral.totalEarnings || 0;
            const totalWithdrawn = referral.totalWithdrawn || 0;
            const pendingWithdrawals = referral.pendingWithdrawals || 0;
            const processingWithdrawals = referral.processingWithdrawals || 0;
            
            const availableBalance = totalEarnings - totalWithdrawn - pendingWithdrawals - processingWithdrawals;

            balanceStats.totalEarnings += totalEarnings;
            balanceStats.totalWithdrawn += totalWithdrawn;
            balanceStats.totalPending += pendingWithdrawals;
            balanceStats.totalProcessing += processingWithdrawals;
            balanceStats.totalAvailable += availableBalance;

            if (availableBalance > 0) {
                balanceStats.usersWithBalance++;
            }
        });

        console.log(`\n💰 System Balance Summary:`);
        console.log(`   Total Earnings: $${balanceStats.totalEarnings.toFixed(2)}`);
        console.log(`   Total Withdrawn: $${balanceStats.totalWithdrawn.toFixed(2)}`);
        console.log(`   Pending Withdrawals: $${balanceStats.totalPending.toFixed(2)}`);
        console.log(`   Processing Withdrawals: $${balanceStats.totalProcessing.toFixed(2)}`);
        console.log(`   Total Available: $${balanceStats.totalAvailable.toFixed(2)}`);
        console.log(`   Users with available balance: ${balanceStats.usersWithBalance}`);

        // Verify math
        const calculatedAvailable = balanceStats.totalEarnings - balanceStats.totalWithdrawn - balanceStats.totalPending - balanceStats.totalProcessing;
        const balanceCorrect = Math.abs(calculatedAvailable - balanceStats.totalAvailable) < 0.01;

        console.log(`\n✅ Balance calculation: ${balanceCorrect ? 'CORRECT' : 'INCORRECT'}`);
        if (!balanceCorrect) {
            console.log(`   Expected: $${calculatedAvailable.toFixed(2)}, Calculated: $${balanceStats.totalAvailable.toFixed(2)}`);
        }

        return balanceStats;

    } catch (error) {
        console.error('❌ Error recalculating balances:', error);
        throw error;
    }
}

// Main execution
async function main() {
    try {
        await connectDB();

        const args = process.argv.slice(2);
        const command = args[0] || 'audit';
        const executeMode = args.includes('--execute') || args.includes('-e');

        switch (command) {
            case 'audit':
                await auditWithdrawals();
                break;

            case 'fix-balances':
                await fixWithdrawalBalances(!executeMode);
                break;

            case 'fix-transactions':
                await createMissingWithdrawalTransactions(!executeMode);
                break;

            case 'recalculate':
                await recalculateAvailableBalances();
                break;

            case 'fix-all':
                console.log('🚀 COMPREHENSIVE WITHDRAWAL FIX');
                console.log('=' .repeat(60));
                
                // 1. Audit first
                await auditWithdrawals();
                console.log('');
                
                // 2. Fix balances
                await fixWithdrawalBalances(!executeMode);
                console.log('');
                
                // 3. Create missing transactions
                await createMissingWithdrawalTransactions(!executeMode);
                console.log('');
                
                // 4. Recalculate final balances
                await recalculateAvailableBalances();
                break;

            default:
                console.log('🔍 WITHDRAWAL AUDIT & FIX TOOL');
                console.log('');
                console.log('Usage:');
                console.log('  node withdrawalAuditFix.js audit                    # Audit withdrawal balances');
                console.log('  node withdrawalAuditFix.js fix-balances [--execute] # Fix balance discrepancies');
                console.log('  node withdrawalAuditFix.js fix-transactions [--execute] # Create missing withdrawal transactions');
                console.log('  node withdrawalAuditFix.js recalculate              # Show balance summary');
                console.log('  node withdrawalAuditFix.js fix-all [--execute]      # Run all fixes');
                console.log('');
                console.log('Options:');
                console.log('  --execute, -e    Apply changes (default is dry run)');
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
    auditWithdrawals,
    fixWithdrawalBalances,
    createMissingWithdrawalTransactions,
    recalculateAvailableBalances
};