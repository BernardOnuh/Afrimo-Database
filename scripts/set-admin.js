const mongoose = require('mongoose');
const User = require('../models/User');

// Use the MongoDB URI from your environment variables or directly
const MONGODB_URI = 'mongodb+srv://Ben:iOBkvnsCXWpoGMFp@cluster0.l4xjq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => {
  console.log('MongoDB connection established successfully');
})
.catch((error) => {
  console.error('MongoDB connection error:', error);
});

async function setUserAsAdmin(email) {
  try {
    // Find user by email
    const user = await User.findOne({ email: 'onuhbernard4@gmail.com' });
    
    if (!user) {
      console.error(`User with email onuhbernard4@gmail.com not found`);
      return null;
    }
    
    // Set user as admin using save with validation bypass
    user.isAdmin = true;
    await user.save({ validateBeforeSave: false });
    
    console.log(`User with email onuhbernard4@gmail.com has been granted admin privileges`);
    return user;
  } catch (error) {
    console.error('Error setting admin:', error);
    throw error;
  } finally {
    // Close database connection
    mongoose.connection.close();
  }
}

// Execute the function
setUserAsAdmin()
  .then(adminUser => {
    if (adminUser) {
      console.log('Admin user successfully created:', adminUser);
    }
  })
  .catch(error => {
    console.error('Failed to set admin:', error);
  });