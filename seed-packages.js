require('dotenv').config();
require('dotenv').config();
const mongoose = require('mongoose');
const SharePackage = require('./models/SharePackage');

const packages = [
  { name:'Basic', type:'regular', priceNaira:30000, priceUSDT:30, ownershipPct:'0.00001%', earningKobo:'6k', benefits:['Standard voting rights','Dividend distributions'], displayOrder:1 },
  { name:'Standard', type:'regular', priceNaira:40000, priceUSDT:40, ownershipPct:'0.000021%', earningKobo:'14k', benefits:['Standard voting rights','Dividend distributions'], displayOrder:2 },
  { name:'Premium', type:'regular', priceNaira:75000, priceUSDT:75, ownershipPct:'0.00005%', earningKobo:'30k', benefits:['Standard voting rights','Dividend distributions'], displayOrder:3 },
  { name:'Elite', type:'cofounder', priceNaira:800000, priceUSDT:800, ownershipPct:'0.000462%', earningKobo:'14k', benefits:['0.000462% total ownership','Enhanced voting & priority dividends'], displayOrder:4 },
  { name:'Platinum', type:'cofounder', priceNaira:2000000, priceUSDT:2000, ownershipPct:'0.00135%', earningKobo:'—', benefits:['0.00135% total ownership','Enhanced voting & priority dividends'], displayOrder:5 },
  { name:'Supreme', type:'cofounder', priceNaira:3500000, priceUSDT:3500, ownershipPct:'0.003%', earningKobo:'—', benefits:['0.003% total ownership','Enhanced voting & priority dividends','Leadership access'], displayOrder:6 },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI);
  await SharePackage.deleteMany({});
  const inserted = await SharePackage.insertMany(packages);
  console.log(`Seeded ${inserted.length} packages:`);
  inserted.forEach(p => console.log(`  [${p._id}] ${p.name} (${p.type})`));
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
