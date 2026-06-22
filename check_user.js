// checkUser.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const user = await User.findById('6745f752ce52dd63c0758370').lean();
  console.log(JSON.stringify(user, null, 2));
  await mongoose.disconnect();
})();