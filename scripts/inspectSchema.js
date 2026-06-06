'use strict';

/**
 * inspectSchema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Inspects the PaymentTransaction schema to understand how shares is stored
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const mongoose = require('mongoose');

const PaymentTransaction = require('../models/Transaction');

async function main() {
  console.log('🔌  Connecting to MongoDB…\n');
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const txId = 'TXN-5150D4C2-611005';

  console.log('📋  PaymentTransaction Schema:\n');
  const schema = PaymentTransaction.schema;

  // Show all paths
  console.log('All schema paths:');
  const paths = schema.paths;
  for (const [pathName, pathObj] of Object.entries(paths)) {
    if (pathName.includes('share') || pathName.includes('earning') || pathName.includes('qty') || pathName.includes('quantity')) {
      console.log(`  ${pathName}:`);
      console.log(`    type: ${pathObj.instance}`);
      console.log(`    options: ${JSON.stringify(pathObj.options)}`);
    }
  }

  console.log('\n---\n');

  // Get actual document
  console.log('📄  Actual Document (raw):');
  const ptDoc = await PaymentTransaction.findOne({ transactionId: txId }).lean();
  console.log(JSON.stringify(ptDoc, null, 2));

  console.log('\n---\n');

  // Try to find fields that might contain share quantity
  console.log('🔍  Searching for share-related fields in document:\n');
  function findShareFields(obj, prefix = '') {
    if (!obj || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (key.toLowerCase().includes('share') || 
          key.toLowerCase().includes('qty') || 
          key.toLowerCase().includes('quantity') ||
          key.toLowerCase().includes('earning') ||
          (typeof value === 'number' && (key === 'shares' || key === 'qty' || key === 'quantity'))) {
        console.log(`  ${fullKey}: ${JSON.stringify(value)}`);
      }
      if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
        findShareFields(value, fullKey);
      }
    }
  }
  findShareFields(ptDoc);

  console.log('\n---\n');

  // Try alternative field names
  console.log('💡  Trying alternative update approaches:\n');

  const testFields = [
    { shares: 2 },
    { 'shares': 2 },
    { qty: 2 },
    { quantity: 2 },
    { shareCount: 2 },
    { numberOfShares: 2 },
    { $set: { shares: 2 } },
  ];

  for (const update of testFields) {
    try {
      const result = await PaymentTransaction.updateOne(
        { _id: ptDoc._id },
        update
      );
      console.log(`  Update with ${JSON.stringify(update)}: modifiedCount=${result.modifiedCount}`);
    } catch (err) {
      console.log(`  Update with ${JSON.stringify(update)}: ERROR - ${err.message}`);
    }
  }

  console.log('\n');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  mongoose.disconnect();
  process.exit(1);
});