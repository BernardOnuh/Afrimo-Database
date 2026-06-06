// ============================================================
// checkDatabase.js - Diagnostic Script
// ============================================================

const mongoose = require('mongoose');
require('dotenv').config();

async function checkDatabase() {
  try {
    console.log('\n========================================');
    console.log('🔍 Checking /test Database');
    console.log('========================================\n');
    
    // Connect without defining models
    const connection = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/test',
      {
        serverSelectionTimeoutMS: 20000
      }
    );
    
    console.log('✅ Connected to /test database\n');

    // Get all collections
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    
    console.log('📚 Available Collections:');
    console.log('----------------------------------------');
    collections.forEach((col, i) => {
      console.log(`${i + 1}. ${col.name}`);
    });
    console.log('----------------------------------------\n');

    // Search for transactions in each collection
    console.log('🔎 Searching for transactions...\n');
    
    for (const col of collections) {
      const collection = db.collection(col.name);
      
      // Check if any document has a transactionId field
      const hasTransactionId = await collection.findOne({ transactionId: { $exists: true } });
      
      if (hasTransactionId) {
        console.log(`✅ Found transactions in: "${col.name}"`);
        
        // Show sample transaction
        const sample = await collection.findOne({ transactionId: "TXN-277DF77F-326451" });
        if (sample) {
          console.log(`   ✓ TXN-277DF77F-326451 EXISTS`);
          console.log(`   Fields: ${Object.keys(sample).join(', ')}\n`);
        } else {
          // Count total transactions
          const count = await collection.countDocuments({ transactionId: { $exists: true } });
          console.log(`   Total transactions: ${count}\n`);
        }
      }
    }

    // Also check specific collections
    const commonNames = ['paymenttransactions', 'PaymentTransaction', 'transactions', 'Transaction'];
    console.log('📍 Checking common collection names:');
    console.log('----------------------------------------');
    
    for (const name of commonNames) {
      try {
        const collection = db.collection(name);
        const count = await collection.countDocuments();
        console.log(`${name}: ${count} documents`);
      } catch (err) {
        console.log(`${name}: not found`);
      }
    }
    console.log('----------------------------------------\n');

    await mongoose.connection.close();
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkDatabase();