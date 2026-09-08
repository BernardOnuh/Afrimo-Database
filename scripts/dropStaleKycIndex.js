// scripts/dropStaleKycIndex.js
// One-off maintenance script: drops the stale unique `jobId_1` index (and any
// other unexpected unique indexes) on the `kycverifications` collection left
// over from an older schema. The current KycVerification model has no `jobId`
// field, so the leftover unique index causes E11000 dup-key errors on null
// whenever a new record is inserted/upserted.
//
// Usage (from Heroku):
//   heroku run node scripts/dropStaleKycIndex.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// Indexes to remove if present. 'jobId_1' is the known leftover.
const STALE_INDEXES = ['jobId_1'];

async function main() {
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
    console.error('❌ No MONGODB_URI. Provide via .env or Heroku config.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log('📊 Connected to MongoDB');

  const db = mongoose.connection.db;
  const col = db.collection('kycverifications');

  const indexes = await col.indexes();
  console.log('🔎 Current indexes on kycverifications:');
  for (const idx of indexes) {
    console.log(`   - ${idx.name} => ${JSON.stringify(idx.key)} unique=${!!idx.unique}`);
  }

  for (const name of STALE_INDEXES) {
    const exists = indexes.some((idx) => idx.name === name);
    if (!exists) {
      console.log(`ℹ️ Index "${name}" not present — nothing to drop.`);
      continue;
    }
    try {
      await col.dropIndex(name);
      console.log(`✅ Dropped stale index "${name}".`);
    } catch (err) {
      console.error(`❌ Failed to drop index "${name}":`, err.message);
    }
  }

  await mongoose.disconnect();
  console.log('✅ Done.');
}

main().catch(async (e) => {
  console.error('Fatal:', e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});