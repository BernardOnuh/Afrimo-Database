#!/usr/bin/env node

/**
 * WITHDRAWAL TEST SCRIPT
 * Creates test withdrawal data for various scenarios
 * 
 * Usage:
 *   node testWithdrawals.js --create    (create test withdrawals)
 *   node testWithdrawals.js --list      (list all test withdrawals)
 *   node testWithdrawals.js --cleanup   (remove test withdrawals)
 *   node testWithdrawals.js --user=email (specify user)
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Models
const User = require(path.join(__dirname, 'models', 'User'));
const Withdrawal = require(path.join(__dirname, 'models', 'Withdrawal'));
const Referral = require(path.join(__dirname, 'models', 'Referral'));

// Color output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

const log = {
  error: (msg) => console.error(`${colors.red}${colors.bright}❌ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}${colors.bright}✅ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ  ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠  ${msg}${colors.reset}`),
  section: (msg) => console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════${colors.reset}\n${colors.bright}${msg}${colors.reset}\n${colors.cyan}═══════════════════════════════════${colors.reset}\n`),
  table: (data) => console.table(data),
  highlight: (msg) => console.log(`${colors.magenta}${colors.bright}✦ ${msg}${colors.reset}`)
};

// Parse command line arguments
const args = process.argv.slice(2);
const command = args.find(arg => arg.startsWith('--')) || '--help';
const userIdentifier = args.find(arg => arg.startsWith('--user='))?.split('=')[1];
const count = parseInt(args.find(arg => arg.startsWith('--count='))?.split('=')[1]) || 5;
const amount = parseFloat(args.find(arg => arg.startsWith('--amount='))?.split('=')[1]) || 1000;

// Test data generators
const generateTestWithdrawal = (user, status, index) => {
  const baseAmount = amount + (index * 500);
  const now = new Date();
  const statuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
  const withdrawalTypes = ['bank', 'crypto'];
  const banks = ['GTBank', 'Access Bank', 'First Bank', 'Zenith Bank', 'UBA'];
  const cryptoTypes = ['Bitcoin', 'Ethereum', 'USDT', 'Solana'];
  
  // For specific status tests, use the provided status
  const finalStatus = status || statuses[index % statuses.length];
  
  // Create different dates for variety
  const createdAt = new Date(now);
  createdAt.setDate(createdAt.getDate() - (index * 2));
  
  const type = withdrawalTypes[index % withdrawalTypes.length];
  
  return {
    user: user._id,
    amount: baseAmount,
    status: finalStatus,
    withdrawalType: type,
    transactionReference: `TEST-WTH-${Date.now()}-${index}`,
    paymentMethod: type === 'bank' ? 'bank_transfer' : 'crypto_transfer',
    paymentDetails: type === 'bank' ? {
      bankName: banks[index % banks.length],
      accountNumber: `0${Math.floor(Math.random() * 10000000000).toString().padStart(10, '0')}`,
      accountName: `${user.name} Account`
    } : {
      cryptoType: cryptoTypes[index % cryptoTypes.length],
      walletAddress: `0x${Math.random().toString(16).substring(2, 42)}`
    },
    rejectionReason: finalStatus === 'failed' ? 'Insufficient balance' : null,
    adminNotes: finalStatus === 'cancelled' ? 'Test cancellation' : null,
    createdAt: createdAt,
    updatedAt: createdAt,
    completedAt: finalStatus === 'completed' ? new Date(createdAt.getTime() + 3600000) : null
  };
};

/**
 * Find user by identifier
 */
async function findUserByIdentifier(identifier) {
  if (mongoose.Types.ObjectId.isValid(identifier)) {
    const user = await User.findById(identifier);
    if (user) return user;
  }
  return User.findOne({
    $or: [
      { email: identifier },
      { username: identifier }
    ]
  });
}

/**
 * Get or create test user
 */
async function getOrCreateTestUser() {
  if (userIdentifier) {
    const user = await findUserByIdentifier(userIdentifier);
    if (user) return user;
    log.error(`User not found: ${userIdentifier}`);
    return null;
  }
  
  // Find or create a test user
  let testUser = await User.findOne({ email: 'test.withdrawal@afrimobile.com' });
  
  if (!testUser) {
    log.info('Creating test user...');
    testUser = await User.create({
      name: 'Test Withdrawal User',
      email: 'test.withdrawal@afrimobile.com',
      username: 'testwithdrawal',
      password: 'Test123!@#', // This should be hashed in real scenario
      role: 'user',
      isVerified: true
    });
    log.success('Created test user');
  }
  
  // Ensure referral record exists
  let referral = await Referral.findOne({ user: testUser._id });
  if (!referral) {
    referral = await Referral.create({
      user: testUser._id,
      referralCode: `TEST${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      pendingWithdrawals: 0,
      processingWithdrawals: 0
    });
    log.success('Created referral record');
  }
  
  return testUser;
}

/**
 * Create test withdrawals
 */
async function createTestWithdrawals(user) {
  log.section('CREATING TEST WITHDRAWALS');
  log.info(`Creating ${count} test withdrawals for ${user.name} (${user.email})`);
  
  const withdrawals = [];
  const statuses = ['pending', 'processing', 'pending', 'processing', 'completed', 'failed'];
  
  // Create withdrawals with various statuses
  for (let i = 0; i < count; i++) {
    const status = statuses[i % statuses.length];
    const withdrawalData = generateTestWithdrawal(user, status, i);
    const withdrawal = await Withdrawal.create(withdrawalData);
    withdrawals.push(withdrawal);
    
    // Update referral counters for pending/processing
    if (status === 'pending') {
      await Referral.findOneAndUpdate(
        { user: user._id },
        { $inc: { pendingWithdrawals: withdrawal.amount } }
      );
    } else if (status === 'processing') {
      await Referral.findOneAndUpdate(
        { user: user._id },
        { $inc: { processingWithdrawals: withdrawal.amount } }
      );
    }
    
    log.info(`Created ${status} withdrawal #${i+1}: ₦${withdrawal.amount.toLocaleString()}`);
  }
  
  log.success(`Created ${withdrawals.length} test withdrawals`);
  
  // Show summary
  const summary = withdrawals.reduce((acc, w) => {
    acc[w.status] = (acc[w.status] || 0) + 1;
    return acc;
  }, {});
  
  console.log('\n📊 Summary:');
  Object.entries(summary).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  
  return withdrawals;
}

/**
 * List test withdrawals
 */
async function listTestWithdrawals(user) {
  log.section('TEST WITHDRAWALS');
  
  const query = user ? { user: user._id } : {};
  const withdrawals = await Withdrawal.find(query)
    .populate('user', 'name email')
    .sort({ createdAt: -1 });
  
  if (withdrawals.length === 0) {
    log.info('No withdrawals found');
    return;
  }
  
  // Filter to show test withdrawals (those with TEST- prefix)
  const testWithdrawals = withdrawals.filter(w => 
    w.transactionReference?.startsWith('TEST-')
  );
  
  if (testWithdrawals.length === 0) {
    log.info('No test withdrawals found');
    return;
  }
  
  const tableData = testWithdrawals.map(w => ({
    ID: w._id.toString().substring(0, 8),
    Reference: w.transactionReference,
    Amount: `₦${w.amount.toLocaleString()}`,
    Status: w.status,
    Type: w.withdrawalType,
    Created: new Date(w.createdAt).toLocaleDateString(),
    User: w.user?.email || 'Unknown'
  }));
  
  log.table(tableData);
  log.info(`Total: ${testWithdrawals.length} test withdrawals`);
  
  // Show summary by status
  const summary = testWithdrawals.reduce((acc, w) => {
    acc[w.status] = (acc[w.status] || 0) + 1;
    return acc;
  }, {});
  
  console.log('\n📊 Status Summary:');
  Object.entries(summary).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  
  return testWithdrawals;
}

/**
 * Cleanup test withdrawals
 */
async function cleanupTestWithdrawals(user) {
  log.section('CLEANING UP TEST WITHDRAWALS');
  
  const query = {
    transactionReference: { $regex: /^TEST-/ }
  };
  
  if (user) {
    query.user = user._id;
  }
  
  // Get withdrawals to clean up
  const withdrawals = await Withdrawal.find(query);
  
  if (withdrawals.length === 0) {
    log.info('No test withdrawals found to clean up');
    return;
  }
  
  log.warning(`Found ${withdrawals.length} test withdrawals to remove`);
  
  // Show what will be removed
  const summary = withdrawals.reduce((acc, w) => {
    acc[w.status] = (acc[w.status] || 0) + 1;
    return acc;
  }, {});
  
  console.log('\n📊 Will remove:');
  Object.entries(summary).forEach(([status, count]) => {
    console.log(`  ${status}: ${count}`);
  });
  
  // Ask for confirmation
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const confirmed = await new Promise((resolve) => {
    rl.question(`${colors.yellow}Delete these test withdrawals? (yes/no): ${colors.reset}`, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
  
  if (!confirmed) {
    log.info('Cleanup cancelled');
    return;
  }
  
  // Delete withdrawals
  const result = await Withdrawal.deleteMany(query);
  log.success(`Deleted ${result.deletedCount} test withdrawals`);
  
  // Update referral counters
  if (user) {
    const referral = await Referral.findOne({ user: user._id });
    if (referral) {
      referral.pendingWithdrawals = 0;
      referral.processingWithdrawals = 0;
      await referral.save();
      log.success('Reset referral counters');
    }
  }
}

/**
 * Create specific test scenario
 */
async function createTestScenario(user) {
  log.section('CREATING TEST SCENARIO');
  
  const scenarios = {
    'pending-multiple': async () => {
      log.info('Creating multiple pending withdrawals...');
      for (let i = 0; i < 3; i++) {
        const amount = 1000 + (i * 2000);
        await Withdrawal.create({
          user: user._id,
          amount: amount,
          status: 'pending',
          withdrawalType: 'bank',
          transactionReference: `TEST-PENDING-${Date.now()}-${i}`,
          paymentMethod: 'bank_transfer',
          paymentDetails: {
            bankName: 'GTBank',
            accountNumber: `01234567${i}`,
            accountName: `${user.name} Account`
          }
        });
        await Referral.findOneAndUpdate(
          { user: user._id },
          { $inc: { pendingWithdrawals: amount } }
        );
        log.info(`Created pending withdrawal #${i+1}: ₦${amount.toLocaleString()}`);
      }
    },
    
    'mixed-status': async () => {
      log.info('Creating mixed status withdrawals...');
      const statuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
      for (let i = 0; i < statuses.length; i++) {
        const amount = 1500 + (i * 1000);
        await Withdrawal.create({
          user: user._id,
          amount: amount,
          status: statuses[i],
          withdrawalType: i % 2 === 0 ? 'bank' : 'crypto',
          transactionReference: `TEST-MIXED-${Date.now()}-${i}`,
          paymentMethod: i % 2 === 0 ? 'bank_transfer' : 'crypto_transfer',
          paymentDetails: i % 2 === 0 ? {
            bankName: 'Access Bank',
            accountNumber: `09876543${i}`,
            accountName: `${user.name} Account`
          } : {
            cryptoType: 'Bitcoin',
            walletAddress: `0x${Math.random().toString(16).substring(2, 42)}`
          },
          rejectionReason: statuses[i] === 'failed' ? 'Insufficient funds' : null
        });
        log.info(`Created ${statuses[i]} withdrawal: ₦${amount.toLocaleString()}`);
        
        if (statuses[i] === 'pending') {
          await Referral.findOneAndUpdate(
            { user: user._id },
            { $inc: { pendingWithdrawals: amount } }
          );
        } else if (statuses[i] === 'processing') {
          await Referral.findOneAndUpdate(
            { user: user._id },
            { $inc: { processingWithdrawals: amount } }
          );
        }
      }
    },
    
    'large-amount': async () => {
      log.info('Creating large amount withdrawal...');
      await Withdrawal.create({
        user: user._id,
        amount: 50000,
        status: 'pending',
        withdrawalType: 'bank',
        transactionReference: `TEST-LARGE-${Date.now()}`,
        paymentMethod: 'bank_transfer',
        paymentDetails: {
          bankName: 'Zenith Bank',
          accountNumber: '1234567890',
          accountName: `${user.name} Account`
        }
      });
      await Referral.findOneAndUpdate(
        { user: user._id },
        { $inc: { pendingWithdrawals: 50000 } }
      );
      log.success('Created large withdrawal: ₦50,000');
    }
  };
  
  // Show available scenarios
  console.log(`${colors.bright}Available scenarios:${colors.reset}`);
  console.log('  1. pending-multiple - Create multiple pending withdrawals');
  console.log('  2. mixed-status - Create withdrawals with all statuses');
  console.log('  3. large-amount - Create a single large withdrawal');
  console.log('  4. all - Run all scenarios');
  
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const choice = await new Promise((resolve) => {
    rl.question(`${colors.cyan}Select scenario (1-4): ${colors.reset}`, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
  
  switch(choice) {
    case '1':
      await scenarios['pending-multiple']();
      break;
    case '2':
      await scenarios['mixed-status']();
      break;
    case '3':
      await scenarios['large-amount']();
      break;
    case '4':
      for (const key of ['pending-multiple', 'mixed-status', 'large-amount']) {
        await scenarios[key]();
      }
      break;
    default:
      log.error('Invalid choice');
  }
  
  log.success('Scenario created!');
}

/**
 * Main execution
 */
async function main() {
  try {
    // Connect to MongoDB
    log.section('CONNECTING TO DATABASE');
    
    if (!process.env.MONGODB_URI) {
      log.error('MONGODB_URI not set in environment variables');
      process.exit(1);
    }
    
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    log.success('Connected to MongoDB');
    
    // Get or create test user
    const user = await getOrCreateTestUser();
    if (!user) {
      log.error('Failed to get or create test user');
      process.exit(1);
    }
    
    // Execute command
    switch(command) {
      case '--create':
        await createTestWithdrawals(user);
        break;
        
      case '--list':
        await listTestWithdrawals(user);
        break;
        
      case '--cleanup':
        await cleanupTestWithdrawals(user);
        break;
        
      case '--scenario':
        await createTestScenario(user);
        break;
        
      case '--help':
      default:
        console.log(`
${colors.bright}Withdrawal Test Script${colors.reset}

${colors.bright}Usage:${colors.reset}
  node testWithdrawals.js --create                Create test withdrawals
  node testWithdrawals.js --list                  List all test withdrawals
  node testWithdrawals.js --cleanup               Remove test withdrawals
  node testWithdrawals.js --scenario              Create specific test scenario
  node testWithdrawals.js --help                  Show this help

${colors.bright}Options:${colors.reset}
  --user=email          Specify user by email or ID
  --count=N             Number of withdrawals to create (default: 5)
  --amount=N            Base amount for withdrawals (default: 1000)

${colors.bright}Examples:${colors.reset}
  node testWithdrawals.js --create --count=10
  node testWithdrawals.js --list --user=test@email.com
  node testWithdrawals.js --scenario
  node testWithdrawals.js --cleanup
        `);
    }
    
    await mongoose.connection.close();
    log.success('Database connection closed');
    
  } catch (error) {
    log.error('Error:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script
main();