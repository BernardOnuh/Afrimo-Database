#!/usr/bin/env node

/**
 * Migration Script: Tier-Based to Percentage-Based Share Allocation
 * 
 * This script migrates CoFounderShare records from the old tierBreakdown structure
 * to the new percentage-based shareAllocation structure.
 * 
 * Usage:
 *   node migrate-to-percentage-allocation.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const CoFounderShare = require('./models/CoFounderShare');

async function migrate() {
  try {
    console.log('🔄 Starting migration from tier-based to percentage-based allocation...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/afrimobile');
    console.log('✅ Connected to MongoDB\n');

    // Fetch all CoFounderShare records
    const coFounderShares = await CoFounderShare.find({});
    console.log(`📊 Found ${coFounderShares.length} CoFounderShare record(s)\n`);

    if (coFounderShares.length === 0) {
      console.log('ℹ️  No records to migrate. Creating default record...');
      const newCFS = new CoFounderShare({
        totalShares: 500,
        shareToRegularRatio: 29,
        shareAllocation: new Map([
          ['allocation_1', { percentage: 0.00, shares: 0, sold: 0 }]
        ]),
        pricing: {
          priceNaira: 0,
          priceUSDT: 0
        }
      });
      await newCFS.save();
      console.log('✅ Default CoFounderShare record created\n');
      process.exit(0);
    }

    // Migrate each record
    for (const record of coFounderShares) {
      console.log(`Processing record ID: ${record._id}`);
      console.log(`  Current totalShares: ${record.totalShares}`);
      console.log(`  Current shareToRegularRatio: ${record.shareToRegularRatio}`);

      // Remove old tierBreakdown if it exists
      if (record.tierBreakdown) {
        console.log(`  ⚠️  Found legacy tierBreakdown - removing...`);
        await CoFounderShare.updateOne(
          { _id: record._id },
          { $unset: { tierBreakdown: 1 } }
        );
      }

      // Set new shareAllocation structure if not already set
      if (!record.shareAllocation || record.shareAllocation.size === 0) {
        console.log(`  Setting default percentage allocation...`);
        record.shareAllocation = new Map([
          ['allocation_1', { percentage: 0.00, shares: 0, sold: 0 }]
        ]);
        await record.save();
      }

      console.log(`  ✅ Record migrated successfully\n`);
    }

    console.log('✅ Migration completed successfully!\n');

    // Verify the migration
    console.log('🔍 Verifying migration...\n');
    const verifyRecords = await CoFounderShare.find({});
    
    for (const record of verifyRecords) {
      console.log(`Record ID: ${record._id}`);
      console.log(`  Total Shares: ${record.totalShares}`);
      console.log(`  Share Allocations:`);
      
      const allocations = Object.fromEntries(record.shareAllocation);
      Object.entries(allocations).forEach(([name, allocation]) => {
        console.log(`    ${name}:`);
        console.log(`      - Percentage: ${allocation.percentage}%`);
        console.log(`      - Shares: ${allocation.shares}`);
        console.log(`      - Sold: ${allocation.sold}`);
      });
      console.log();
    }

    console.log('✅ Verification complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Connection closed.');
    process.exit(0);
  }
}

// Run migration
migrate();