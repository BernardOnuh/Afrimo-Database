const { MongoClient } = require('mongodb');

const uri = 'mongodb://localhost:27017';
const dbName = 'test'; // Change to your actual DB name

async function forceFixTiers() {
  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('tierconfigs');
    
    // First, check what exists
    const existing = await collection.findOne();
    console.log('📋 Before update:', JSON.stringify(existing?.tiers, null, 2));
    
    // Complete tier configuration
    const tiers = {
      basic: {
        name: "Basic",
        type: "share",
        priceNGN: 30000,
        priceUSD: 30,
        percentPerShare: 0.0000001,
        earningPerPhone: 6,
        sharesIncluded: 1,
        active: true,
        description: "Entry-level share package",
        createdAt: new Date(),
        updatedAt: new Date()
      },
      standard: {
        name: "Standard",
        type: "share",
        priceNGN: 50000,
        priceUSD: 50,
        percentPerShare: 0.00000021,
        earningPerPhone: 14,
        sharesIncluded: 1,
        active: true,
        description: "Standard share package",
        createdAt: new Date(),
        updatedAt: new Date()
      },
      premium: {
        name: "Premium",
        type: "share",
        priceNGN: 100000,
        priceUSD: 100,
        percentPerShare: 0.0000005,
        earningPerPhone: 30,
        sharesIncluded: 1,
        active: true,
        description: "Premium share package",
        createdAt: new Date(),
        updatedAt: new Date()
      },
      elite: {
        name: "Elite Co-Founder",
        type: "co-founder",
        priceNGN: 1000000,
        priceUSD: 1000,
        percentPerShare: 0.00000462,
        earningPerPhone: 308,
        sharesIncluded: 22,
        active: true,
        description: "Elite Co-Founder package - Includes 22 regular shares",
        createdAt: new Date(),
        updatedAt: new Date()
      },
      platinum: {
        name: "Platinum Co-Founder",
        type: "co-founder",
        priceNGN: 2500000,
        priceUSD: 2500,
        percentPerShare: 0.0000135,
        earningPerPhone: 810,
        sharesIncluded: 27,
        active: true,
        description: "Platinum Co-Founder package - Includes 27 regular shares",
        createdAt: new Date(),
        updatedAt: new Date()
      },
      supreme: {
        name: "Supreme Co-Founder",
        type: "co-founder",
        priceNGN: 5000000,
        priceUSD: 5000,
        percentPerShare: 0.00003,
        earningPerPhone: 1800,
        sharesIncluded: 60,
        active: true,
        description: "Supreme Co-Founder package - Includes 60 regular shares",
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
    
    // Replace the entire tiers object
    const result = await collection.updateOne(
      {}, // Match any document
      {
        $set: {
          tiers: tiers,
          coFounderToRegularRatio: 22,
          totalSupply: 10000,
          lastUpdated: new Date(),
          version: 3
        }
      },
      { upsert: true } // Create if doesn't exist
    );
    
    console.log('\n✅ Update result:', result);
    
    // Verify the update
    const updated = await collection.findOne();
    console.log('\n📊 After update:');
    for (const [key, tier] of Object.entries(updated.tiers)) {
      console.log(`\n${key}:`);
      console.log(`  - active: ${tier.active}`);
      console.log(`  - type: ${tier.type}`);
      console.log(`  - percentPerShare: ${tier.percentPerShare}`);
      console.log(`  - earningPerPhone: ${tier.earningPerPhone}`);
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
  }
}

forceFixTiers();