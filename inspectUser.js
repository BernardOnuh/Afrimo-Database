require('dotenv').config();
const mongoose = require('mongoose');

const email = 'onuhbernard4@gmail.com';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const usersCollection = mongoose.connection.db.collection('users'); // adjust if your collection name differs

  const user = await usersCollection.findOne({ email });

  if (!user) {
    console.log('User not found:', email);
    return mongoose.connection.close();
  }

  console.log('--- RAW USER DOCUMENT ---');
  console.log(user);

  mongoose.connection.close();
}).catch(console.error);
