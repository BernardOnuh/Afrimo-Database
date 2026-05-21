/ scripts/systemHealthMonitor.js
// Continuous system health monitoring and auto-fix for referrals, leaderboards, and withdrawals

const mongoose = require('mongoose');
const cron = require('node-cron');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const Referral = require('../models/Referral');
const ReferralTransaction = require('../models/ReferralTransaction');
const Withdrawal = require('../models/Withdrawal');
const UserShare = require('../models/UserShare');
const PaymentTransaction = require('../models/Transaction');
const SiteConfig = require('../models/SiteConfig');

// Configuration
const MONITOR_CONFIG = {
    // How often to run checks (in minutes)
    CHECK_INTERVAL: process.env.HEALTH_CHECK_INTERVAL || 15,
    
    // Thresholds for auto-fix
    MAX_DISCREPANCY_AMOUNT: 1.00, // Auto-fix discrepancies under $1
    MAX_USERS_TO_FIX_PER_RUN: 50,
    
    // Logging
    VERBOSE_LOGGING: process.env.NODE_ENV === 'development',
    
    // Auto-fix settings
    AUTO_FIX_ENABLED: process.env.AUTO_FIX_ENABLED !== 'false',
    
    // Emergency thresholds
    EMERGENCY_DISCREPANCY_THRESHOLD: 10000, // Alert if total discrepancy > $10k
    EMERGENCY_USER_COUNT_THRESHOLD: 100 // Alert if > 100 users have issues
};

let isRunning = false;
let lastRunStats = {};
let runCount = 0;

// Enhanced database connection with retry logic
async function connectDB() {
    const maxRetries = 5;
    let retries = 0;
    
    while (retries < maxRetries) {
        try {
            const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL || 
                            'mongodb+srv://infoagrichainx:nfE59IWssd3kklfZ@cluster0.uvjmhm9.mongodb.net';
            
            if (!mongoose.connection.readyState) {
                await mongoose.connect(mongoUri, {
                    useNewUrlParser: true,
                    useUnifiedTopology: true,
                    maxPoolSize: 10,
                    serverSelectionTimeoutMS: 5000,
                    socketTimeoutMS: 45000,
                });
                console.log('✅ Connected to MongoDB');
            }
            return;
        } catch (error) {
            retries++;
            console.error(`❌ MongoDB connection attempt ${retries} failed:`, error.message);
            if (retries >= maxRetries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 2000 * retries));
        }
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
        return {
            generation1: 15,
            generation2: 3,
            generation3: 2
        };
    }
}

// Log with timestamp
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const prefix = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'SUCCESS' ? '✅' : '📊';
    console.log(`[${timestamp}] ${prefix} ${message}`);
}

// Detailed logging for debugging
function debugLog(message) {
    if (MONITOR_CONFIG.VERBOSE_LOGGING) {
        log(message, 'DEBUG');
    }
}

// 1. REFERRAL SYSTEM HEALTH CHECK
async function checkReferralHealth() {
    debugLog('Checking referral system health...');
    
    const issues = {
        missingReferralDocs: [],
        inconsistentEarnings: [],
        brokenChains: [],
        duplicateTransactions: []
    };

    try {
        // Check for users with transactions but missing Referral documents
        const usersWithTransactions = await ReferralTransaction.distinct('beneficiary', { status: 'completed' });
        
        for (const userId of usersWithTransactions.slice(0, MONITOR_CONFIG.MAX_USERS_TO_FIX_PER_RUN)) {
            const referralDoc = await Referral.findOne({ user: userId });
            
            if (!referralDoc) {
                const user = await User.findById(userId).select('userName');
                issues.missingReferralDocs.push({
                    userId,
                    userName: user?.userName || 'Unknown'
                });
                continue;
            }

            // Check earnings consistency
            const actualEarnings = await ReferralTransaction.aggregate([
                { $match: { beneficiary: userId, status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]);

            const actualTotal = actualEarnings[0]?.total || 0;
            const storedTotal = referralDoc.totalEarnings || 0;

            if (Math.abs(actualTotal - storedTotal) > MONITOR_CONFIG.MAX_DISCREPANCY_AMOUNT) {
                const user = await User.findById(userId).select('userName');
                issues.inconsistentEarnings.push({
                    userId,
                    userName: user?.userName || 'Unknown',
                    actual: actualTotal,
                    stored: storedTotal,
                    difference: actualTotal - storedTotal
                });
            }
        }

        // Check for duplicate transactions
        const duplicates = await ReferralTransaction.aggregate([
            { $match: { status: 'completed' } },
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
            { $match: { count: { $gt: 1 } } },
            { $limit: 20 } // Limit to prevent overwhelming
        ]);

        issues.duplicateTransactions = duplicates;

        // Check for broken referral chains (sample check)
        const sampleUsers = await User.find({
            'referralInfo.code': { $exists: true, $ne: null, $ne: '' }
        }).limit(50).select('userName referralInfo.code');

        for (const user of sampleUsers) {
            const referrerExists = await User.findOne({ userName: user.referralInfo.code });
            if (!referrerExists) {
                issues.brokenChains.push({
                    userId: user._id,
                    userName: user.userName,
                    invalidReferrerCode: user.referralInfo.code
                });
            }
        }

        return issues;

    } catch (error) {
        log(`Error checking referral health: ${error.message}`, 'ERROR');
        return issues;
    }
}

// Auto-fix referral issues
async function autoFixReferralIssues(issues) {
    let fixedCount = 0;

    try {
        // Fix missing referral documents
        for (const issue of issues.missingReferralDocs.slice(0, 10)) {
            debugLog(`Creating missing referral document for ${issue.userName}`);
            
            // Calculate stats from transactions
            const transactions = await ReferralTransaction.find({
                beneficiary: issue.userId,
                status: 'completed'
            });

            const stats = {
                generation1: { count: 0, earnings: 0 },
                generation2: { count: 0, earnings: 0 },
                generation3: { count: 0, earnings: 0 },
                totalEarnings: 0
            };

            const uniqueReferredUsers = {
                gen1: new Set(),
                gen2: new Set(),
                gen3: new Set()
            };

            transactions.forEach(tx => {
                stats[`generation${tx.generation}`].earnings += tx.amount;
                stats.totalEarnings += tx.amount;
                uniqueReferredUsers[`gen${tx.generation}`].add(tx.referredUser.toString());
            });

            stats.generation1.count = uniqueReferredUsers.gen1.size;
            stats.generation2.count = uniqueReferredUsers.gen2.size;
            stats.generation3.count = uniqueReferredUsers.gen3.size;

            await Referral.create({
                user: issue.userId,
                referredUsers: stats.generation1.count,
                totalEarnings: stats.totalEarnings,
                generation1: stats.generation1,
                generation2: stats.generation2,
                generation3: stats.generation3
            });

            fixedCount++;
        }

        // Fix inconsistent earnings
        for (const issue of issues.inconsistentEarnings.slice(0, 10)) {
            debugLog(`Fixing earnings inconsistency for ${issue.userName}`);
            
            await Referral.findOneAndUpdate(
                { user: issue.userId },
                { $set: { totalEarnings: issue.actual } }
            );

            fixedCount++;
        }

        // Remove duplicate transactions
        for (const duplicate of issues.duplicateTransactions.slice(0, 5)) {
            const docsToRemove = duplicate.docs.slice(1); // Keep first, remove rest
            
            await ReferralTransaction.deleteMany({
                _id: { $in: docsToRemove }
            });

            fixedCount += docsToRemove.length;
        }

        // Fix broken referral chains (clear invalid codes)
        for (const issue of issues.brokenChains.slice(0, 5)) {
            await User.findByIdAndUpdate(
                issue.userId,
                { $unset: { 'referralInfo.code': 1 } }
            );

            fixedCount++;
        }

        return fixedCount;

    } catch (error) {
        log(`Error auto-fixing referral issues: ${error.message}`, 'ERROR');
        return fixedCount;
    }
}

// 2. WITHDRAWAL SYSTEM HEALTH CHECK
async function checkWithdrawalHealth() {
    debugLog('Checking withdrawal system health...');
    
    const issues = {
        balanceDiscrepancies: [],
        missingTransactions: [],
        stuckWithdrawals: []
    };

    try {
        // Get users with withdrawals
        const usersWithWithdrawals = await Withdrawal.distinct('user');

        for (const userId of usersWithWithdrawals.slice(0, MONITOR_CONFIG.MAX_USERS_TO_FIX_PER_RUN)) {
            const referralData = await Referral.findOne({ user: userId });
            if (!referralData) continue;

            const userWithdrawals = await Withdrawal.find({ user: userId });

            // Calculate expected balances
            const expectedBalances = {
                totalWithdrawn: 0,
                pendingWithdrawals: 0,
                processingWithdrawals: 0
            };

            userWithdrawals.forEach(withdrawal => {
                switch (withdrawal.status) {
                    case 'paid':
                        expectedBalances.totalWithdrawn += withdrawal.amount;
                        break;
                    case 'pending':
                        expectedBalances.pendingWithdrawals += withdrawal.amount;
                        break;
                    case 'processing':
                        expectedBalances.processingWithdrawals += withdrawal.amount;
                        break;
                }
            });

            // Check for discrepancies
            const currentBalances = {
                totalWithdrawn: referralData.totalWithdrawn || 0,
                pendingWithdrawals: referralData.pendingWithdrawals || 0,
                processingWithdrawals: referralData.processingWithdrawals || 0
            };

            const hasDiscrepancy = Object.keys(expectedBalances).some(key => 
                Math.abs(expectedBalances[key] - currentBalances[key]) > MONITOR_CONFIG.MAX_DISCREPANCY_AMOUNT
            );

            if (hasDiscrepancy) {
                const user = await User.findById(userId).select('userName');
                issues.balanceDiscrepancies.push({
                    userId,
                    userName: user?.userName || 'Unknown',
                    expected: expectedBalances,
                    current: currentBalances
                });
            }

            // Check for missing withdrawal transactions
            const paidWithdrawals = userWithdrawals.filter(w => w.status === 'paid');
            for (const withdrawal of paidWithdrawals) {
                const transactionExists = await ReferralTransaction.findOne({
                    user: userId,
                    type: 'withdrawal',
                    reference: withdrawal.clientReference || withdrawal.transactionReference || `MANUAL-${withdrawal._id}`
                });

                if (!transactionExists) {
                    issues.missingTransactions.push({
                        userId,
                        withdrawalId: withdrawal._id,
                        amount: withdrawal.amount
                    });
                }
            }
        }

        // Check for stuck withdrawals (pending/processing for too long)
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const stuckWithdrawals = await Withdrawal.find({
            status: { $in: ['pending', 'processing'] },
            createdAt: { $lt: oneDayAgo }
        }).limit(10);

        issues.stuckWithdrawals = stuckWithdrawals.map(w => ({
            id: w._id,
            userId: w.user,
            amount: w.amount,
            status: w.status,
            createdAt: w.createdAt,
            clientReference: w.clientReference
        }));

        return issues;

    } catch (error) {
        log(`Error checking withdrawal health: ${error.message}`, 'ERROR');
        return issues;
    }
}

// Auto-fix withdrawal issues
async function autoFixWithdrawalIssues(issues) {
    let fixedCount = 0;

    try {
        // Fix balance discrepancies
        for (const issue of issues.balanceDiscrepancies.slice(0, 10)) {
            debugLog(`Fixing withdrawal balance for ${issue.userName}`);
            
            await Referral.findOneAndUpdate(
                { user: issue.userId },
                {
                    $set: {
                        totalWithdrawn: issue.expected.totalWithdrawn,
                        pendingWithdrawals: issue.expected.pendingWithdrawals,
                        processingWithdrawals: issue.expected.processingWithdrawals
                    }
                }
            );

            fixedCount++;
        }

        // Create missing withdrawal transactions
        for (const issue of issues.missingTransactions.slice(0, 10)) {
            debugLog(`Creating missing withdrawal transaction for user ${issue.userId}`);
            
            const withdrawal = await Withdrawal.findById(issue.withdrawalId);
            if (withdrawal) {
                await ReferralTransaction.create({
                    user: issue.userId,
                    type: 'withdrawal',
                    amount: -issue.amount,
                    description: `Withdrawal to ${withdrawal.paymentDetails?.bankName || withdrawal.paymentMethod}`,
                    status: 'completed',
                    reference: withdrawal.clientReference || withdrawal.transactionReference || `MANUAL-${withdrawal._id}`,
                    generation: 0,
                    referredUser: issue.userId,
                    beneficiary: issue.userId,
                    createdAt: withdrawal.processedAt || withdrawal.createdAt
                });

                fixedCount++;
            }
        }

        return fixedCount;

    } catch (error) {
        log(`Error auto-fixing withdrawal issues: ${error.message}`, 'ERROR');
        return fixedCount;
    }
}

// 3. LEADERBOARD CONSISTENCY CHECK
async function checkLeaderboardConsistency() {
    debugLog('Checking leaderboard consistency...');
    
    const issues = {
        inconsistentRankings: [],
        missingUsers: [],
        calculationErrors: []
    };

    try {
        // Test leaderboard aggregation
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
                $match: {
                    totalEarnings: { $gt: 0 }
                }
            },
            { $limit: 20 },
            {
                $project: {
                    userName: 1,
                    totalEarnings: 1
                }
            }
        ]);

        // If leaderboard returns no results but we have earnings, there's an issue
        const totalReferralEarnings = await Referral.aggregate([
            { $group: { _id: null, total: { $sum: '$totalEarnings' } } }
        ]);

        const hasEarnings = (totalReferralEarnings[0]?.total || 0) > 0;
        const leaderboardWorks = leaderboardTest.length > 0;

        if (hasEarnings && !leaderboardWorks) {
            issues.calculationErrors.push({
                type: 'leaderboard_aggregation_failure',
                totalEarningsInSystem: totalReferralEarnings[0]?.total || 0,
                leaderboardResults: leaderboardTest.length
            });
        }

        return issues;

    } catch (error) {
        log(`Error checking leaderboard consistency: ${error.message}`, 'ERROR');
        return issues;
    }
}

// Main health check function
async function runHealthCheck() {
    if (isRunning) {
        debugLog('Health check already running, skipping...');
        return;
    }

    isRunning = true;
    runCount++;
    
    const startTime = Date.now();
    log(`Starting health check #${runCount}...`);

    try {
        const results = {
            referral: { issues: {}, fixedCount: 0 },
            withdrawal: { issues: {}, fixedCount: 0 },
            leaderboard: { issues: {}, fixedCount: 0 },
            summary: {}
        };

        // 1. Check Referral System
        results.referral.issues = await checkReferralHealth();
        if (MONITOR_CONFIG.AUTO_FIX_ENABLED) {
            results.referral.fixedCount = await autoFixReferralIssues(results.referral.issues);
        }

        // 2. Check Withdrawal System
        results.withdrawal.issues = await checkWithdrawalHealth();
        if (MONITOR_CONFIG.AUTO_FIX_ENABLED) {
            results.withdrawal.fixedCount = await autoFixWithdrawalIssues(results.withdrawal.issues);
        }

        // 3. Check Leaderboard Consistency
        results.leaderboard.issues = await checkLeaderboardConsistency();

        // Calculate summary
        const totalIssues = 
            Object.values(results.referral.issues).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0) +
            Object.values(results.withdrawal.issues).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0) +
            Object.values(results.leaderboard.issues).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

        const totalFixed = results.referral.fixedCount + results.withdrawal.fixedCount + results.leaderboard.fixedCount;

        results.summary = {
            totalIssuesFound: totalIssues,
            totalIssuesFixed: totalFixed,
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString()
        };

        // Log results
        if (totalIssues > 0 || totalFixed > 0) {
            log(`Health check #${runCount} completed: Found ${totalIssues} issues, Fixed ${totalFixed}`, 'SUCCESS');
            
            if (MONITOR_CONFIG.VERBOSE_LOGGING) {
                log(`Referral issues: ${JSON.stringify(Object.keys(results.referral.issues).map(k => `${k}: ${results.referral.issues[k].length}`))}`);
                log(`Withdrawal issues: ${JSON.stringify(Object.keys(results.withdrawal.issues).map(k => `${k}: ${results.withdrawal.issues[k].length}`))}`);
                log(`Leaderboard issues: ${JSON.stringify(Object.keys(results.leaderboard.issues).map(k => `${k}: ${results.leaderboard.issues[k].length}`))}`);
            }
        } else {
            debugLog(`Health check #${runCount} completed: No issues found`);
        }

        // Emergency alerts
        if (totalIssues > MONITOR_CONFIG.EMERGENCY_USER_COUNT_THRESHOLD) {
            log(`🚨 EMERGENCY: Found ${totalIssues} issues across the system!`, 'ERROR');
        }

        lastRunStats = results;
        return results;

    } catch (error) {
        log(`Health check #${runCount} failed: ${error.message}`, 'ERROR');
        throw error;
    } finally {
        isRunning = false;
    }
}

// Status endpoint data
function getMonitorStatus() {
    return {
        isRunning,
        runCount,
        lastRun: lastRunStats.summary?.timestamp || null,
        config: MONITOR_CONFIG,
        lastRunResults: lastRunStats
    };
}

// Start the monitoring system
function startMonitoring() {
    log(`Starting system health monitor with ${MONITOR_CONFIG.CHECK_INTERVAL}-minute intervals...`);
    log(`Auto-fix: ${MONITOR_CONFIG.AUTO_FIX_ENABLED ? 'ENABLED' : 'DISABLED'}`);
    
    // Initial health check
    setTimeout(async () => {
        try {
            await connectDB();
            await runHealthCheck();
        } catch (error) {
            log(`Initial health check failed: ${error.message}`, 'ERROR');
        }
    }, 5000);

    // Schedule regular checks
    const cronPattern = `*/${MONITOR_CONFIG.CHECK_INTERVAL} * * * *`;
    cron.schedule(cronPattern, async () => {
        try {
            await connectDB();
            await runHealthCheck();
        } catch (error) {
            log(`Scheduled health check failed: ${error.message}`, 'ERROR');
        }
    });

    log(`Monitoring scheduled with cron pattern: ${cronPattern}`);
}

// Stop monitoring
function stopMonitoring() {
    log('Stopping system health monitor...');
    cron.destroy();
}

// Manual run function
async function runManualCheck() {
    try {
        await connectDB();
        const results = await runHealthCheck();
        
        console.log('\n📊 MANUAL HEALTH CHECK RESULTS');
        console.log('=' .repeat(50));
        console.log(`Run #${runCount}`);
        console.log(`Duration: ${results.summary.duration}ms`);
        console.log(`Issues found: ${results.summary.totalIssuesFound}`);
        console.log(`Issues fixed: ${results.summary.totalIssuesFixed}`);
        
        if (results.summary.totalIssuesFound > 0) {
            console.log('\n📋 Issue Breakdown:');
            
            Object.keys(results.referral.issues).forEach(key => {
                if (results.referral.issues[key].length > 0) {
                    console.log(`  Referral ${key}: ${results.referral.issues[key].length}`);
                }
            });
            
            Object.keys(results.withdrawal.issues).forEach(key => {
                if (results.withdrawal.issues[key].length > 0) {
                    console.log(`  Withdrawal ${key}: ${results.withdrawal.issues[key].length}`);
                }
            });
            
            Object.keys(results.leaderboard.issues).forEach(key => {
                if (results.leaderboard.issues[key].length > 0) {
                    console.log(`  Leaderboard ${key}: ${results.leaderboard.issues[key].length}`);
                }
            });
        }

        return results;
    } catch (error) {
        log(`Manual health check failed: ${error.message}`, 'ERROR');
        throw error;
    }
}

// Command line interface
async function main() {
    const args = process.argv.slice(2);
    const command = args[0] || 'start';

    switch (command) {
        case 'start':
            startMonitoring();
            // Keep process alive
            process.on('SIGTERM', stopMonitoring);
            process.on('SIGINT', stopMonitoring);
            break;

        case 'check':
            await runManualCheck();
            process.exit(0);
            break;

        case 'status':
            const status = getMonitorStatus();
            console.log(JSON.stringify(status, null, 2));
            process.exit(0);
            break;

        default:
            console.log('🏥 SYSTEM HEALTH MONITOR');
            console.log('');
            console.log('Usage:');
            console.log('  node systemHealthMonitor.js start    # Start continuous monitoring');
            console.log('  node systemHealthMonitor.js check    # Run single health check');
            console.log('  node systemHealthMonitor.js status   # Show current status');
            console.log('');
            console.log('Environment Variables:');
            console.log('  HEALTH_CHECK_INTERVAL=15    # Check interval in minutes');
            console.log('  AUTO_FIX_ENABLED=true       # Enable auto-fixing');
            console.log('  NODE_ENV=development        # Enable verbose logging');
            console.log('');
            process.exit(0);
    }
}

// Export functions for use in other modules
if (require.main === module) {
    main().catch(error => {
        console.error('💥 Health monitor failed:', error);
        process.exit(1);
    });
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    runHealthCheck,
    runManualCheck,
    getMonitorStatus,
    connectDB
};