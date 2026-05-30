require('dotenv').config();
const mongoose = require('mongoose');
const SharePackage = require('../models/SharePackage');

async function seed() {
  try {
    console.log('Connecting...');
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('Connected.\n');

    await SharePackage.deleteMany({});
    console.log('Cleared existing packages.');

    const packages = await SharePackage.insertMany([
      // Regular shares
      { label: 'Basic',    type: 'share',      priceNaira: 30000,   priceUSDT: 30,   ownershipPct: 0.00001,  earningKobo: 6000  },
      { label: 'Standard', type: 'share',      priceNaira: 50000,   priceUSDT: 50,   ownershipPct: 0.000021, earningKobo: 14000 },
      { label: 'Premium',  type: 'share',      priceNaira: 100000,  priceUSDT: 100,  ownershipPct: 0.00005,  earningKobo: 30000 },
      // Co-founder packages
      { label: 'Elite',    type: 'co-founder', priceNaira: 800000,  priceUSDT: 800,  ownershipPct: 0.000462, earningKobo: 14000 },
      { label: 'Platinum', type: 'co-founder', priceNaira: 2500000, priceUSDT: 2500, ownershipPct: 0.00135,  earningKobo: 14000 },
      { label: 'Supreme',  type: 'co-founder', priceNaira: 5000000, priceUSDT: 5000, ownershipPct: 0.003,    earningKobo: 14000 },
    ]);

    console.log(`\nSeeded ${packages.length} packages:\n`);
    packages.forEach(p => {
      console.log(`  ${p.type.padEnd(12)} | ${p.label.padEnd(10)} | ₦${String(p.priceNaira).padEnd(8)} | ${p.ownershipPct}%`);
    });

    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected.');
  }
}

seed();