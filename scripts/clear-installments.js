// scripts/clear-installments.js
// Clears all old installment plan data so users start fresh
require('dotenv').config();
const mongoose = require('mongoose');

async function clearInstallments() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Clear the installmentplans collection
    const result = await mongoose.connection.db.collection('installmentplans').deleteMany({});
    console.log(`✅ Deleted ${result.deletedCount} installment plans`);

    // Also check for old cofounder installment collection if it exists
    const collections = await mongoose.connection.db.listCollections().toArray();
    const collNames = collections.map(c => c.name);
    
    if (collNames.includes('cofounderinstallmentplans')) {
      const result2 = await mongoose.connection.db.collection('cofounderinstallmentplans').deleteMany({});
      console.log(`✅ Deleted ${result2.deletedCount} cofounder installment plans`);
    }

    console.log('🎉 All installment data cleared. Users can start fresh.');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

clearInstallments();
