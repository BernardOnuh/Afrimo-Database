// ============================================================
// updateShares.js - Complete Script for /test Database
// ============================================================

const mongoose = require('mongoose');
require('dotenv').config();

// Define Transaction schema (matches actual schema)
const transactionSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  type: String,
  transactionId: { type: String, required: true, unique: true, index: true },
  amount: Number,
  currency: String,
  paymentMethod: String,
  paymentProofPath: String,
  paymentProofFilename: String,
  paymentProofOriginalName: String,
  manualPaymentDetails: mongoose.Schema.Types.Mixed,
  tier: String,
  tierBreakdown: mongoose.Schema.Types.Mixed,
  adminNotes: String,
  verifiedBy: mongoose.Schema.Types.ObjectId,
  verifiedAt: Date,
  shares: Number,
  status: String,
  earningKobo: Number,
  ownershipPct: Number,
  verified: Boolean,
  notes: String,
  adminProcessed: Boolean,
  packageLabel: String,
  packageId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: Date
}, { collection: 'transactions' });

const Transaction = mongoose.model('Transaction', transactionSchema);

// Data to update
const updates = [
  { transactionId: "TXN-277DF77F-326451", shares: 22 },
  { transactionId: "TXN-BA67256A-113514", shares: 60 },
  { transactionId: "TXN-C51A756F-600204", shares: 27 },
  { transactionId: "68ea4729918c41c434d186b3", shares: 60 }
];

async function updateShares() {
  let connection;
  
  try {
    // Step 1: Connect to MongoDB
    console.log('\n========================================');
    console.log('🔄 Connecting to MongoDB /test database...');
    console.log('========================================\n');
    
    connection = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/test',
      {
        serverSelectionTimeoutMS: 20000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 20000
      }
    );
    
    console.log('✅ Successfully connected to /test database');
    console.log('📍 Collection: transactions\n');

    // Step 2: Update each transaction
    console.log('📝 Starting updates...\n');
    let successCount = 0;
    let failCount = 0;

    for (const item of updates) {
      try {
        const result = await Transaction.updateOne(
          { transactionId: item.transactionId },
          { $set: { shares: item.shares } }
        );
        
        if (result.matchedCount > 0) {
          console.log(`   ✅ ${item.transactionId}`);
          console.log(`      Shares updated to: ${item.shares}`);
          console.log(`      Modified: ${result.modifiedCount} document(s)\n`);
          successCount++;
        } else {
          console.log(`   ⚠️  ${item.transactionId}`);
          console.log(`      Transaction NOT FOUND in database\n`);
          failCount++;
        }
      } catch (err) {
        console.log(`   ❌ ${item.transactionId}`);
        console.log(`      Error: ${err.message}\n`);
        failCount++;
      }
    }

    // Step 3: Summary
    console.log('========================================');
    console.log('📊 Update Summary');
    console.log('========================================');
    console.log(`✅ Successful: ${successCount}/${updates.length}`);
    console.log(`❌ Failed: ${failCount}/${updates.length}`);
    console.log('========================================\n');

    // Step 4: Close connection
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed\n');
    process.exit(successCount === updates.length ? 0 : 1);

  } catch (error) {
    console.error('\n❌ FATAL ERROR:');
    console.error('========================================');
    console.error(`Error Type: ${error.name}`);
    console.error(`Message: ${error.message}`);
    console.error('========================================\n');

    if (connection) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the update
updateShares();