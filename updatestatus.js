const mongoose = require('mongoose');
const User = require('./models/User');
const UserShare = require('./models/UserShare');

async function updateBethelTransaction() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://Ben:iOBkvnsCXWpoGMFp@cluster0.l4xjq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Find Bethel Onyema's user record
    const user = await User.findOne({ email: 'bethelonyema64@gmail.com' });
    
    if (!user) {
      console.log('User not found with email: bethelonyema64@gmail.com');
      await mongoose.connection.close();
      return;
    }

    console.log(`Found user: ${user.name} (${user._id})`);

    // Find the user's share record
    const userShare = await UserShare.findOne({ user: user._id });
    
    if (!userShare) {
      console.log('No share record found for this user');
      await mongoose.connection.close();
      return;
    }

    // Find the pending transaction
    const pendingTransaction = userShare.transactions.find(tx => tx.status === 'pending');
    
    if (!pendingTransaction) {
      console.log('No pending transaction found for this user');
      await mongoose.connection.close();
      return;
    }

    console.log('Found pending transaction:');
    console.log(`- Transaction ID: ${pendingTransaction.transactionId}`);
    console.log(`- Shares: ${pendingTransaction.shares}`);
    console.log(`- Amount: ${pendingTransaction.totalAmount} ${pendingTransaction.currency}`);
    console.log(`- Status: ${pendingTransaction.status}`);

    // Update the transaction status to 'completed'
    const updateResult = await UserShare.updateOne(
      { 
        'user': user._id,
        'transactions.transactionId': pendingTransaction.transactionId
      },
      {
        $set: { 'transactions.$.status': 'completed' }
      }
    );

    console.log(`Update result: ${JSON.stringify(updateResult)}`);
    
    if (updateResult.modifiedCount > 0) {
      console.log('Transaction status updated to completed successfully');
    } else {
      console.log('Failed to update transaction status');
    }

    // Verify the update
    const updatedUserShare = await UserShare.findOne({ user: user._id });
    const updatedTransaction = updatedUserShare.transactions.find(
      tx => tx.transactionId === pendingTransaction.transactionId
    );
    
    console.log('Updated transaction status:', updatedTransaction.status);

    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (error) {
    console.error('Error updating transaction status:', error);
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  }
}

// Run the function
updateBethelTransaction()
  .then(() => console.log('Update process completed'))
  .catch(error => console.error('Update failed:', error));