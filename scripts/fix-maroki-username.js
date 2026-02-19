/**
 * Fix username for Ikuyajolu Olorunjuwon Taiwo
 * - Change userName from "Maroki property" to "Marokiproperty"
 * - Ensure downline "Nurudeen Kazeem Gboyega" is linked correctly
 * 
 * Run: node scripts/fix-maroki-username.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  // 1. Find the user with space in username
  const user = await User.findOne({
    $or: [
      { userName: /maroki\s*property/i },
      { name: /Ikuyajolu/i },
      { name: /Olorunjuwon/i }
    ]
  });

  if (!user) {
    console.log('❌ Could not find user "Maroki property" or "Ikuyajolu". Listing similar users:');
    const similar = await User.find({ userName: /maroki/i }).select('name userName email phone referralInfo.code');
    console.log(similar);
    await mongoose.disconnect();
    return;
  }

  console.log('✅ Found user:', {
    id: user._id,
    name: user.name,
    userName: user.userName,
    email: user.email,
    referralCode: user.referralInfo?.code,
    referralCount: user.referralCount
  });

  // 2. Fix username
  const oldUsername = user.userName;
  user.userName = 'Marokiproperty';
  await user.save();
  console.log(`✅ Username updated: "${oldUsername}" → "Marokiproperty"`);

  // 3. Find the downline user
  const downline = await User.findOne({
    $or: [
      { name: /Nurudeen.*Kazeem/i },
      { name: /Kazeem.*Gboyega/i },
      { name: /Nurudeen.*Gboyega/i }
    ]
  });

  if (!downline) {
    console.log('⚠️ Could not find downline "Nurudeen Kazeem Gboyega". Searching broader:');
    const similar = await User.find({ name: /Nurudeen/i }).select('name userName email referralInfo');
    console.log(similar);
  } else {
    console.log('✅ Found downline:', {
      id: downline._id,
      name: downline.name,
      userName: downline.userName,
      email: downline.email,
      referredBy: downline.referralInfo?.code
    });

    // Check if downline's referral points to Maroki
    if (downline.referralInfo?.code !== user.referralInfo?.code) {
      console.log(`⚠️ Downline's referral code: "${downline.referralInfo?.code}" vs Maroki's code: "${user.referralInfo?.code}"`);
      console.log('Updating downline referral info...');
      downline.referralInfo = {
        ...downline.referralInfo,
        code: user.referralInfo?.code,
        source: 'referral'
      };
      await downline.save();
      console.log('✅ Downline referral updated');
    }

    // Check if downline is in user's referrals array
    const alreadyLinked = user.referrals?.some(r => r.userId?.toString() === downline._id.toString());
    if (!alreadyLinked) {
      console.log('Adding downline to referrals array...');
      user.referrals.push({
        userId: downline._id,
        email: downline.email,
        date: downline.createdAt || new Date()
      });
      user.referralCount = (user.referralCount || 0) + 1;
      await user.save();
      console.log('✅ Downline added to referrals');
    } else {
      console.log('✅ Downline already linked in referrals array');
    }
  }

  console.log('\n🎉 Done!');
  await mongoose.disconnect();
}

fix().catch(err => {
  console.error('Error:', err);
  mongoose.disconnect();
});
