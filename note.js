// Add this to server.js (optional — only use if you need to reset packages)
app.get('/api/admin/seed-packages', async (req, res) => {
  try {
    const SharePackage = require('./models/SharePackage');
    
    console.log('🌱 Starting package seed...');

    // Clear old ones first
    const deleteResult = await SharePackage.deleteMany({});
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} old packages`);

    // Insert YOUR existing packages
    const packagesToInsert = [
      // REGULAR SHARES
      { name: 'Basic',    type: 'share',   priceNaira: 30000,   priceUSDT: 30,  ownershipPct: '0.00001%',  earningKobo: '6k',  benefits: ['Standard voting rights', 'Dividend distributions'], displayOrder: 1 },
      { name: 'Standard', type: 'share',   priceNaira: 40000,   priceUSDT: 40,  ownershipPct: '0.000021%', earningKobo: '14k', benefits: ['Standard voting rights', 'Dividend distributions'], displayOrder: 2 },
      { name: 'Premium',  type: 'share',   priceNaira: 75000,   priceUSDT: 75,  ownershipPct: '0.00005%',  earningKobo: '30k', benefits: ['Standard voting rights', 'Dividend distributions'], displayOrder: 3 },
      
      // CO-FOUNDER PACKAGES
      { name: 'Elite',    type: 'co-founder', priceNaira: 800000,  priceUSDT: 800, ownershipPct: '0.000462%', earningKobo: '14k', benefits: ['0.000462% total ownership', 'Enhanced voting & priority dividends'], displayOrder: 4 },
      { name: 'Platinum', type: 'co-founder', priceNaira: 2000000, priceUSDT: 2000, ownershipPct: '0.00135%', earningKobo: '—', benefits: ['0.00135% total ownership', 'Enhanced voting & priority dividends'], displayOrder: 5 },
      { name: 'Supreme',  type: 'co-founder', priceNaira: 3500000, priceUSDT: 3500, ownershipPct: '0.003%',  earningKobo: '—', benefits: ['0.003% total ownership', 'Enhanced voting & priority dividends', 'Leadership access'], displayOrder: 6 },
    ];

    console.log(`📦 Inserting ${packagesToInsert.length} packages:`);
    packagesToInsert.forEach((pkg, idx) => {
      console.log(`  ${idx + 1}. ${pkg.name} (${pkg.type}) - ₦${pkg.priceNaira.toLocaleString()}`);
    });

    const insertResult = await SharePackage.insertMany(packagesToInsert);
    
    console.log(`✅ Successfully inserted ${insertResult.length} packages`);
    console.log('\n📋 Inserted packages:');
    insertResult.forEach((pkg) => {
      console.log(`  • ${pkg.name} (${pkg.type})`);
      console.log(`    - Price: ₦${pkg.priceNaira.toLocaleString()} / $${pkg.priceUSDT}`);
      console.log(`    - Ownership: ${pkg.ownershipPct}`);
      console.log(`    - Earning: ${pkg.earningKobo}`);
      console.log(`    - ID: ${pkg._id}`);
    });

    res.json({ 
      success: true, 
      message: 'Packages seeded successfully',
      count: insertResult.length,
      packages: insertResult 
    });
  } catch (error) {
    console.error('❌ Seed error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});