const mongoose = require('mongoose');
const User = require('./models/User'); // Adjust the path as needed

async function setUsernameAsAdmin(username) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://Ben:iOBkvnsCXWpoGMFp@cluster0.l4xjq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Find user by username
    const user = await User.findOne({ userName: username });

    if (!user) {
      console.error(`User with username ${username} not found`);
      await mongoose.connection.close();
      return null;
    }

    // Set user as admin
    user.isAdmin = true;
    await user.save();

    console.log(`User with username ${username} has been granted admin privileges`);
    
    // Close the connection
    await mongoose.connection.close();
    console.log('MongoDB connection closed');

    return user;
  } catch (error) {
    console.error('Error setting admin:', error);
    
    // Ensure connection is closed in case of error
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
    
    throw error;
  }
}

// Example usage
setUsernameAsAdmin('Saint2talk')
  .then(adminUser => {
    if (adminUser) {
      console.log('Admin user successfully created:', adminUser);
    }
  })
  .catch(error => {
    console.error('Failed to set admin:', error);
  });

module.exports = { setUsernameAsAdmin };