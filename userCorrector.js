// User Correction Script - userCorrector.js
const { UserReferralAnalyzer, connectToDatabase, loadModels } = require('./userAnalyzer');
const mongoose = require('mongoose');

// Import models (will be loaded by loadModels function)
let User, Referral, ReferralTransaction, UserShare, PaymentTransaction;

class UserCorrector {
  constructor() {
    this.corrections = {
      duplicatesFixed: 0,
      commissionsCreated: 0,
      amountsCorrected: 0,
      statsRecalculated: 0,
      errors: []
    };
  }

  async correctUserIssues(userId, executeMode = false) {
    console.log(`🔧 ${executeMode ? 'CORRECTING' : 'SIMULATING CORRECTIONS FOR'} USER: ${userId}`);
    console.log('===============================================');
    
    try {
      // First, run the analyzer to identify issues
      const analyzer = new UserReferralAnalyzer();
      const analysisResults = await analyzer.analyzeUser(userId, { skipReport: true });
      
      if (analysisResults.issuesFound === 0) {
        console.log('✅ No issues found for this user. No corrections needed.');
        return this.corrections;
      }
      
      console.log(`🚨 Found ${analysisResults.issuesFound} issues to correct`);
      
      // Apply corrections
      if (analysisResults.duplicateCommissions.length > 0) {
        await this.fixDuplicateCommissions(analysisResults.duplicateCommissions, executeMode);
      }
      
      if (analysisResults.missingCommissions.length > 0) {
        await this.createMissingCommissions(analysisResults.missingCommissions, executeMode);
      }
      
      if (analysisResults.incorrectAmounts.length > 0) {
        await this.fixIncorrectAmounts(analysisResults.incorrectAmounts, executeMode);
      }
      
      if (executeMode) {
        await this.recalculateUserStats(userId);
      }
      
      this.generateCorrectionReport(userId, executeMode);
      
      return this.corrections;
      
    } catch (error) {
      console.error('💥 Error during corrections:', error);
      this.corrections.errors.push(error.message);
      throw error;
    }
  }

  async fixDuplicateCommissions(duplicateCommissions, executeMode) {
    console.log(`\n🔄 Fixing ${duplicateCommissions.length} sets of duplicate commissions...`);
    
    for (const duplicateSet of duplicateCommissions) {
      console.log(`  Processing duplicate set: ${duplicateSet.count} transactions`);
      
      // Sort by creation date, keep the first one
      const sortedTransactions = duplicateSet.transactions.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );
      
      // Mark all except the first as duplicates
      for (let i = 1; i < sortedTransactions.length; i++) {
        const duplicate = sortedTransactions[i];
        
        if (executeMode) {
          try {
            await ReferralTransaction.findByIdAndUpdate(duplicate.id, {
              status: 'duplicate',
              markedDuplicateAt: new Date(),
              duplicateReason: 'User correction script - duplicate transaction'
            });
            
            console.log(`    ✅ Marked transaction ${duplicate.id} as duplicate`);
            this.corrections.duplicatesFixed++;
            
          } catch (error) {
            console.error(`    ❌ Error marking duplicate ${duplicate.id}:`, error.message);
            this.corrections.errors.push(`Failed to mark duplicate ${duplicate.id}: ${error.message}`);
          }
        } else {
          console.log(`    📋 Would mark transaction ${duplicate.id} as duplicate (₦${duplicate.amount})`);
        }
      }
    }
  }

  async createMissingCommissions(missingCommissions, executeMode) {
    console.log(`\n➕ Creating ${missingCommissions.length} missing commissions...`);
    
    for (const missing of missingCommissions) {
      console.log(`  Creating Gen${missing.generation} commission: ₦${missing.amount.toFixed(2)}`);
      
      if (executeMode) {
        try {
          const referralTxData = {
            beneficiary: missing.beneficiary,
            referredUser: missing.userId,
            amount: missing.amount,
            currency: missing.currency,
            generation: missing.generation,
            purchaseType: missing.purchaseType,
            sourceTransaction: missing.sourceTransaction,
            sourceTransactionModel: missing.sourceTransactionModel,
            status: 'completed',
            createdAt: new Date(),
            commissionDetails: {
              baseAmount: missing.sourceAmount,
              commissionRate: missing.rate,
              calculatedAt: new Date(),
              userCorrection: true
            }
          };
          
          const referralTransaction = new ReferralTransaction(referralTxData);
          await referralTransaction.save();
          
          console.log(`    ✅ Created commission ${referralTransaction._id}`);
          this.corrections.commissionsCreated++;
          
        } catch (error) {
          console.error(`    ❌ Error creating commission:`, error.message);
          this.corrections.errors.push(`Failed to create commission: ${error.message}`);
        }
      } else {
        console.log(`    📋 Would create Gen${missing.generation} commission of ₦${missing.amount.toFixed(2)}`);
      }
    }
  }

  async fixIncorrectAmounts(incorrectAmounts, executeMode) {
    console.log(`\n💰 Fixing ${incorrectAmounts.length} incorrect commission amounts...`);
    
    for (const incorrect of incorrectAmounts) {
      console.log(`  Fixing commission ${incorrect.commissionId}`);
      console.log(`    Current: ₦${incorrect.actualAmount.toFixed(2)}`);
      console.log(`    Should be: ₦${incorrect.expectedAmount.toFixed(2)}`);
      console.log(`    Difference: ₦${incorrect.difference.toFixed(2)}`);
      
      if (executeMode) {
        try {
          await ReferralTransaction.findByIdAndUpdate(incorrect.commissionId, {
            amount: incorrect.expectedAmount,
            correctedAt: new Date(),
            previousAmount: incorrect.actualAmount,
            correctionReason: 'User correction script - amount calculation fix'
          });
          
          console.log(`    ✅ Updated commission amount`);
          this.corrections.amountsCorrected++;
          
        } catch (error) {
          console.error(`    ❌ Error updating amount:`, error.message);
          this.corrections.errors.push(`Failed to update amount for ${incorrect.commissionId}: ${error.message}`);
        }
      } else {
        console.log(`    📋 Would update amount to ₦${incorrect.expectedAmount.toFixed(2)}`);
      }
    }
  }

  async recalculateUserStats(userId) {
    console.log(`\n🔢 Recalculating user statistics...`);
    
    try {
      // Get all completed commissions for users who benefited from this user's transactions
      const beneficiaries = await ReferralTransaction.distinct('beneficiary', {
        referredUser: userId,
        status: 'completed'
      });
      
      console.log(`  Recalculating stats for ${beneficiaries.length} beneficiaries...`);
      
      for (const beneficiaryId of beneficiaries) {
        await this.recalculateIndividualUserStats(beneficiaryId);
      }
      
      this.corrections.statsRecalculated += beneficiaries.length;
      
    } catch (error) {
      console.error('❌ Error recalculating user stats:', error);
      this.corrections.errors.push(`Failed to recalculate stats: ${error.message}`);
    }
  }

  async recalculateIndividualUserStats(userId) {
    try {
      const objectId = new mongoose.Types.ObjectId(userId);
      
      // Calculate total earnings by generation
      const earnings = await ReferralTransaction.aggregate([
        {
          $match: {
            beneficiary: objectId,
            status: 'completed'
          }
        },
        {
          $group: {
            _id: '$generation',
            totalEarnings: { $sum: '$amount' }
          }
        }
      ]);
      
      // Calculate unique user counts by generation
      const counts = await ReferralTransaction.aggregate([
        {
          $match: {
            beneficiary: objectId,
            status: 'completed'
          }
        },
        {
          $group: {
            _id: {
              generation: '$generation',
              referredUser: '$referredUser'
            }
          }
        },
        {
          $group: {
            _id: '$_id.generation',
            uniqueUsers: { $sum: 1 }
          }
        }
      ]);
      
      // Update or create referral stats
      let referralStats = await Referral.findOne({ user: userId });
      
      if (!referralStats) {
        referralStats = new Referral({
          user: userId,
          referredUsers: 0,
          totalEarnings: 0,
          generation1: { count: 0, earnings: 0 },
          generation2: { count: 0, earnings: 0 },
          generation3: { count: 0, earnings: 0 }
        });
      }
      
      // Reset all values
      referralStats.totalEarnings = 0;
      referralStats.generation1 = { count: 0, earnings: 0 };
      referralStats.generation2 = { count: 0, earnings: 0 };
      referralStats.generation3 = { count: 0, earnings: 0 };
      
      // Update earnings
      for (const earning of earnings) {
        referralStats.totalEarnings += earning.totalEarnings;
        referralStats[`generation${earning._id}`].earnings = earning.totalEarnings;
      }
      
      // Update counts
      for (const count of counts) {
        referralStats[`generation${count._id}`].count = count.uniqueUsers;
        
        if (count._id === 1) {
          referralStats.referredUsers = count.uniqueUsers;
        }
      }
      
      await referralStats.save();
      
    } catch (error) {
      console.error(`Error recalculating stats for user ${userId}:`, error);
      throw error;
    }
  }

  generateCorrectionReport(userId, executeMode) {
    console.log('\n📊 CORRECTION REPORT');
    console.log('===================');
    
    console.log(`\nUser ID: ${userId}`);
    console.log(`Mode: ${executeMode ? 'EXECUTE' : 'SIMULATION'}`);
    
    console.log('\n✅ CORRECTIONS APPLIED:');
    console.log(`• Duplicates fixed: ${this.corrections.duplicatesFixed}`);
    console.log(`• Commissions created: ${this.corrections.commissionsCreated}`);
    console.log(`• Amounts corrected: ${this.corrections.amountsCorrected}`);
    console.log(`• Stats recalculated: ${this.corrections.statsRecalculated}`);
    
    if (this.corrections.errors.length > 0) {
      console.log('\n❌ ERRORS ENCOUNTERED:');
      this.corrections.errors.forEach((error, index) => {
        console.log(`${index + 1}. ${error}`);
      });
    }
    
    const totalCorrections = this.corrections.duplicatesFixed + 
                           this.corrections.commissionsCreated + 
                           this.corrections.amountsCorrected;
    
    console.log(`\n📈 SUMMARY:`);
    console.log(`Total corrections: ${totalCorrections}`);
    console.log(`Success rate: ${totalCorrections > 0 ? ((totalCorrections - this.corrections.errors.length) / totalCorrections * 100).toFixed(1) : 100}%`);
    
    if (!executeMode && totalCorrections > 0) {
      console.log('\n⚠️  THIS WAS A SIMULATION. To apply corrections, use executeMode = true');
    }
  }
}

// Main functions
async function correctUser(userId, executeMode = false) {
  console.log(`🚀 Starting user correction for: ${userId}`);
  console.log(`Execute Mode: ${executeMode ? 'YES - WILL MAKE CHANGES' : 'NO - SIMULATION ONLY'}`);
  
  try {
    const connected = await connectToDatabase();
    if (!connected) throw new Error('Failed to connect to database');
    
    const modelsLoaded = await loadModels();
    if (!modelsLoaded) throw new Error('Failed to load models');
    
    // Load models into this script's scope
    const path = require('path');
    const modelPath = path.resolve('./models') || path.resolve('../models');
    
    User = require(path.join(modelPath, 'User'));
    Referral = require(path.join(modelPath, 'Referral'));
    ReferralTransaction = require(path.join(modelPath, 'ReferralTransaction'));
    UserShare = require(path.join(modelPath, 'UserShare'));
    PaymentTransaction = require(path.join(modelPath, 'Transaction'));
    
    const corrector = new UserCorrector();
    const results = await corrector.correctUserIssues(userId, executeMode);
    
    console.log('\n🎯 User correction completed!');
    
    return results;
    
  } catch (error) {
    console.error('💥 User correction failed:', error);
    throw error;
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log('🔌 Database connection closed');
    }
  }
}

async function simulateCorrections(userId) {
  console.log(`🔍 Simulating corrections for user: ${userId}`);
  return await correctUser(userId, false);
}

async function applyCorrections(userId) {
  console.log(`🔧 Applying corrections for user: ${userId}`);
  return await correctUser(userId, true);
}

// Export functions
module.exports = {
  UserCorrector,
  correctUser,
  simulateCorrections,
  applyCorrections
};

// Command line execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'simulate') {
    const userId = args[1];
    if (!userId) {
      console.log('❌ Please provide user ID: node userCorrector.js simulate <userId>');
      process.exit(1);
    }
    
    simulateCorrections(userId)
      .then(results => {
        console.log('\n✅ Simulation completed');
        process.exit(0);
      })
      .catch(error => {
        console.error('💥 Simulation failed:', error);
        process.exit(1);
      });
      
  } else if (command === 'apply') {
    const userId = args[1];
    if (!userId) {
      console.log('❌ Please provide user ID: node userCorrector.js apply <userId>');
      process.exit(1);
    }
    
    applyCorrections(userId)
      .then(results => {
        console.log('\n✅ Corrections applied');
        process.exit(0);
      })
      .catch(error => {
        console.error('💥 Corrections failed:', error);
        process.exit(1);
      });
      
  } else {
    console.log('📖 USER CORRECTION SCRIPT USAGE:');
    console.log('================================');
    console.log('');
    console.log('Command line usage:');
    console.log('  node userCorrector.js simulate <userId>   # Simulate corrections (safe)');
    console.log('  node userCorrector.js apply <userId>      # Apply corrections (changes data)');
    console.log('');
    console.log('Programmatic usage:');
    console.log('  const { simulateCorrections, applyCorrections } = require("./userCorrector");');
    console.log('  await simulateCorrections("userId");      # Simulate corrections');
    console.log('  await applyCorrections("userId");         # Apply corrections');
    console.log('');
    console.log('Examples:');
    console.log('  node userCorrector.js simulate 507f1f77bcf86cd799439011');
    console.log('  node userCorrector.js apply 507f1f77bcf86cd799439011');
    console.log('');
    console.log('⚠️  IMPORTANT:');
    console.log('• Always run "simulate" first to see what changes will be made');
    console.log('• Only use "apply" after reviewing the simulation results');
    console.log('• This script will automatically recalculate referral statistics');
    console.log('• Make sure to backup your database before applying corrections');
  }
}