// referralCronJobs.js
// Complete referral earnings sync with co-founder support and bug fixes

const cron = require('node-cron');
const mongoose = require('mongoose');

// Processing state management
let isProcessing = false;
let lastProcessedTime = null;

async function fixAllUsersReferralEarnings() {
  // Prevent overlapping executions
  if (isProcessing) {
    console.log('⚠️ Referral sync already in progress, skipping...');
    return { skipped: true, reason: 'Already processing' };
  }

  isProcessing = true;
  const startTime = Date.now();

  try {
    console.log('\n======================================');
    console.log('REFERRAL EARNINGS SYNC JOB STARTED');
    console.log('======================================');
    console.log('Time:', new Date().toISOString());
    
    // Import models with error handling
    let User, Referral, ReferralTransaction, UserShare, SiteConfig, PaymentTransaction;
    
    try {
      User = require('./models/User');
      Referral = require('./models/Referral');
      ReferralTransaction = require('./models/ReferralTransaction');
      UserShare = require('./models/UserShare');
      SiteConfig = require('./models/SiteConfig');
      PaymentTransaction = require('./models/Transaction');
    } catch (modelError) {
      console.error('Error loading models:', modelError.message);
      throw new Error(`Failed to load required models: ${modelError.message}`);
    }

    // Get commission rates from site config
    let commissionRates;
    
    try {
      const siteConfig = await SiteConfig.getCurrentConfig();
      
      if (!siteConfig || !siteConfig.referralCommission) {
        console.log('Using default commission rates');
        commissionRates = {
          generation1: 15,
          generation2: 3,
          generation3: 2
        };
      } else {
        commissionRates = siteConfig.referralCommission;
      }
    } catch (configError) {
      console.log('Error loading config, using defaults:', configError.message);
      commissionRates = {
        generation1: 15,
        generation2: 3,
        generation3: 2
      };
    }

    console.log(`Commission rates: Gen1: ${commissionRates.generation1}%, Gen2: ${commissionRates.generation2}%, Gen3: ${commissionRates.generation3}%`);

    // Find all users who could potentially be referrers
    const allPotentialReferrers = await User.find({ 
      userName: { $exists: true, $ne: null, $ne: '' },
      'status.isActive': true,
      isBanned: { $ne: true }
    }).select('_id name userName email').sort({ createdAt: 1 });
    
    console.log(`Processing ${allPotentialReferrers.length} potential referrers`);

    const stats = {
      totalProcessed: 0,
      usersWithReferrals: 0,
      totalReferralTransactions: 0,
      totalEarningsGenerated: 0,
      processingErrors: 0,
      skippedUsers: 0,
      shareTransactionsProcessed: 0,
      cofounderTransactionsProcessed: 0
    };

    // Process each potential referrer
    for (const referrer of allPotentialReferrers) {
      try {
        console.log(`\n[${stats.totalProcessed + 1}/${allPotentialReferrers.length}] Processing: ${referrer.name} (${referrer.userName})`);
        
        // Find users who have this person as their referrer
        const gen1Users = await User.find({ 
          'referralInfo.code': referrer.userName 
        }).select('_id name userName email referralInfo');
        
        if (gen1Users.length === 0) {
          console.log(`  No referred users found, skipping`);
          stats.totalProcessed++;
          stats.skippedUsers++;
          continue;
        }

        console.log(`  Found ${gen1Users.length} generation 1 referred users`);
        stats.usersWithReferrals++;
        
        const userStats = {
          gen1Earnings: 0,
          gen2Earnings: 0,
          gen3Earnings: 0,
          totalEarnings: 0,
          transactions: 0
        };

        // Clean up existing referral transactions for this user
        try {
          const deletedCount = await ReferralTransaction.deleteMany({ beneficiary: referrer._id });
          console.log(`  Cleaned up ${deletedCount.deletedCount} existing referral transactions`);
        } catch (deleteError) {
          console.error(`  Error cleaning up existing transactions: ${deleteError.message}`);
        }

        // ========================================
        // PROCESS GENERATION 1 USERS
        // ========================================
        for (const user of gen1Users) {
          try {
            console.log(`    Processing Gen1 user: ${user.name} (${user.userName})`);
            
            // Process regular share transactions
            const userShare = await UserShare.findOne({ user: user._id });
            
            if (userShare && userShare.transactions) {
              const completedTransactions = userShare.transactions.filter(tx => 
                tx && tx.status === 'completed' && tx.totalAmount && tx.totalAmount > 0
              );
              
              if (completedTransactions.length > 0) {
                console.log(`      Found ${completedTransactions.length} completed share transactions`);
                
                for (const transaction of completedTransactions) {
                  try {
                    const commissionAmount = (transaction.totalAmount * commissionRates.generation1) / 100;
                    
                    if (commissionAmount > 0) {
                      const referralTxData = {
                        beneficiary: referrer._id,
                        referredUser: user._id,
                        amount: commissionAmount,
                        currency: transaction.currency || 'NGN',
                        generation: 1,
                        purchaseType: 'share',
                        sourceTransactionModel: 'UserShare',
                        status: 'completed',
                        createdAt: transaction.createdAt || new Date()
                      };
                      
                      await ReferralTransaction.create(referralTxData);
                      
                      userStats.transactions++;
                      userStats.gen1Earnings += commissionAmount;
                      userStats.totalEarnings += commissionAmount;
                      
                      stats.totalReferralTransactions++;
                      stats.totalEarningsGenerated += commissionAmount;
                      stats.shareTransactionsProcessed++;
                      
                      console.log(`      Gen1 Share: $${commissionAmount.toFixed(2)} from $${transaction.totalAmount}`);
                    }
                  } catch (txError) {
                    console.error(`      Error creating Gen 1 share referral transaction: ${txError.message}`);
                    stats.processingErrors++;
                  }
                }
              }
            }

            // Process co-founder transactions
            try {
              const cofounderTransactions = await PaymentTransaction.find({
                userId: user._id,
                type: 'co-founder',
                status: 'completed'
              });

              if (cofounderTransactions.length > 0) {
                console.log(`      Found ${cofounderTransactions.length} completed co-founder transactions`);

                for (const tx of cofounderTransactions) {
                  try {
                    if (tx.amount && tx.amount > 0) {
                      const commission = (tx.amount * commissionRates.generation1) / 100;
                      
                      const cofounderReferralTxData = {
                        beneficiary: referrer._id,
                        referredUser: user._id,
                        amount: commission,
                        currency: tx.currency || 'USD',
                        generation: 1,
                        purchaseType: 'cofounder',
                        sourceTransaction: tx._id,
                        sourceTransactionModel: 'PaymentTransaction',
                        status: 'completed',
                        metadata: {
                          shares: tx.shares,
                          originalAmount: tx.amount,
                          commissionRate: commissionRates.generation1
                        },
                        createdAt: tx.createdAt
                      };
                      
                      await ReferralTransaction.create(cofounderReferralTxData);
                      
                      userStats.transactions++;
                      userStats.gen1Earnings += commission;
                      userStats.totalEarnings += commission;
                      
                      stats.totalReferralTransactions++;
                      stats.totalEarningsGenerated += commission;
                      stats.cofounderTransactionsProcessed++;
                      
                      console.log(`      Gen1 Cofounder: $${commission.toFixed(2)} from $${tx.amount} (${tx.shares} shares)`);
                    }
                  } catch (cofounderTxError) {
                    console.error(`      Error creating Gen 1 co-founder referral transaction: ${cofounderTxError.message}`);
                    stats.processingErrors++;
                  }
                }
              }
            } catch (cofounderError) {
              console.error(`    Error processing co-founder transactions for ${user.userName}: ${cofounderError.message}`);
              stats.processingErrors++;
            }
            
          } catch (userError) {
            console.error(`    Error processing Gen1 user ${user.name}: ${userError.message}`);
            stats.processingErrors++;
          }
        }

        // ========================================
        // PROCESS GENERATION 2 REFERRALS
        // ========================================
        let gen2Count = 0;
        for (const gen1User of gen1Users) {
          try {
            const gen2Users = await User.find({ 
              'referralInfo.code': gen1User.userName 
            }).select('_id name userName email referralInfo');
            
            gen2Count += gen2Users.length;
            
            if (gen2Users.length > 0) {
              console.log(`      Found ${gen2Users.length} Generation 2 users under ${gen1User.userName}`);
              
              for (const gen2User of gen2Users) {
                try {
                  // Process Gen2 regular shares
                  const gen2UserShare = await UserShare.findOne({ user: gen2User._id });
                  
                  if (gen2UserShare && gen2UserShare.transactions) {
                    const gen2CompletedTransactions = gen2UserShare.transactions.filter(tx => 
                      tx && tx.status === 'completed' && tx.totalAmount && tx.totalAmount > 0
                    );
                    
                    for (const gen2Transaction of gen2CompletedTransactions) {
                      try {
                        const gen2CommissionAmount = (gen2Transaction.totalAmount * commissionRates.generation2) / 100;
                        
                        if (gen2CommissionAmount > 0) {
                          const gen2ReferralTxData = {
                            beneficiary: referrer._id,
                            referredUser: gen2User._id,
                            amount: gen2CommissionAmount,
                            currency: gen2Transaction.currency || 'NGN',
                            generation: 2,
                            purchaseType: 'share',
                            sourceTransactionModel: 'UserShare',
                            status: 'completed',
                            createdAt: gen2Transaction.createdAt || new Date()
                          };
                          
                          await ReferralTransaction.create(gen2ReferralTxData);
                          
                          userStats.transactions++;
                          userStats.gen2Earnings += gen2CommissionAmount;
                          userStats.totalEarnings += gen2CommissionAmount;
                          
                          stats.totalReferralTransactions++;
                          stats.totalEarningsGenerated += gen2CommissionAmount;
                          stats.shareTransactionsProcessed++;
                          
                          console.log(`        Gen2 Share: ${gen2User.userName} → $${gen2CommissionAmount.toFixed(2)} from $${gen2Transaction.totalAmount}`);
                        }
                      } catch (gen2TxError) {
                        console.error(`        Gen 2 share transaction error: ${gen2TxError.message}`);
                        stats.processingErrors++;
                      }
                    }
                  }

                  // Process Gen2 co-founder transactions
                  try {
                    const gen2CofounderTransactions = await PaymentTransaction.find({
                      userId: gen2User._id,
                      type: 'co-founder',
                      status: 'completed'
                    });

                    for (const tx of gen2CofounderTransactions) {
                      try {
                        if (tx.amount && tx.amount > 0) {
                          const commission = (tx.amount * commissionRates.generation2) / 100;
                          
                          const gen2CofounderReferralTxData = {
                            beneficiary: referrer._id,
                            referredUser: gen2User._id,
                            amount: commission,
                            currency: tx.currency || 'USD',
                            generation: 2,
                            purchaseType: 'cofounder',
                            sourceTransaction: tx._id,
                            sourceTransactionModel: 'PaymentTransaction',
                            status: 'completed',
                            metadata: {
                              shares: tx.shares,
                              originalAmount: tx.amount,
                              commissionRate: commissionRates.generation2
                            },
                            createdAt: tx.createdAt
                          };
                          
                          await ReferralTransaction.create(gen2CofounderReferralTxData);
                          
                          userStats.transactions++;
                          userStats.gen2Earnings += commission;
                          userStats.totalEarnings += commission;
                          
                          stats.totalReferralTransactions++;
                          stats.totalEarningsGenerated += commission;
                          stats.cofounderTransactionsProcessed++;
                          
                          console.log(`        Gen2 Cofounder: ${gen2User.userName} → $${commission.toFixed(2)} from $${tx.amount}`);
                        }
                      } catch (gen2CofounderTxError) {
                        console.error(`        Gen 2 co-founder transaction error: ${gen2CofounderTxError.message}`);
                        stats.processingErrors++;
                      }
                    }
                  } catch (gen2CofounderError) {
                    console.error(`      Gen 2 co-founder processing error: ${gen2CofounderError.message}`);
                    stats.processingErrors++;
                  }
                  
                } catch (gen2UserError) {
                  console.error(`      Gen 2 user processing error: ${gen2UserError.message}`);
                  stats.processingErrors++;
                }
              }
            }
          } catch (gen2Error) {
            console.error(`    Gen 2 processing error for ${gen1User.userName}: ${gen2Error.message}`);
            stats.processingErrors++;
          }
        }

        // ========================================
        // PROCESS GENERATION 3 REFERRALS
        // ========================================
        let gen3Count = 0;
        for (const gen1User of gen1Users) {
          try {
            const gen2Users = await User.find({ 'referralInfo.code': gen1User.userName });
            
            for (const gen2User of gen2Users) {
              try {
                const gen3Users = await User.find({ 
                  'referralInfo.code': gen2User.userName 
                }).select('_id name userName email referralInfo');
                
                gen3Count += gen3Users.length;
                
                if (gen3Users.length > 0) {
                  for (const gen3User of gen3Users) {
                    try {
                      // Process Gen3 regular shares
                      const gen3UserShare = await UserShare.findOne({ user: gen3User._id });
                      
                      if (gen3UserShare && gen3UserShare.transactions) {
                        const gen3CompletedTransactions = gen3UserShare.transactions.filter(tx => 
                          tx && tx.status === 'completed' && tx.totalAmount && tx.totalAmount > 0
                        );
                        
                        for (const gen3Transaction of gen3CompletedTransactions) {
                          try {
                            const gen3CommissionAmount = (gen3Transaction.totalAmount * commissionRates.generation3) / 100;
                            
                            if (gen3CommissionAmount > 0) {
                              const gen3ReferralTxData = {
                                beneficiary: referrer._id,
                                referredUser: gen3User._id,
                                amount: gen3CommissionAmount,
                                currency: gen3Transaction.currency || 'NGN',
                                generation: 3,
                                purchaseType: 'share',
                                sourceTransactionModel: 'UserShare',
                                status: 'completed',
                                createdAt: gen3Transaction.createdAt || new Date()
                              };
                              
                              await ReferralTransaction.create(gen3ReferralTxData);
                              
                              userStats.transactions++;
                              userStats.gen3Earnings += gen3CommissionAmount;
                              userStats.totalEarnings += gen3CommissionAmount;
                              
                              stats.totalReferralTransactions++;
                              stats.totalEarningsGenerated += gen3CommissionAmount;
                              stats.shareTransactionsProcessed++;
                              
                              console.log(`          Gen3 Share: ${gen3User.userName} → $${gen3CommissionAmount.toFixed(2)} from $${gen3Transaction.totalAmount}`);
                            }
                          } catch (gen3TxError) {
                            console.error(`          Gen 3 share transaction error: ${gen3TxError.message}`);
                            stats.processingErrors++;
                          }
                        }
                      }

                      // Process Gen3 co-founder transactions
                      try {
                        const gen3CofounderTransactions = await PaymentTransaction.find({
                          userId: gen3User._id,
                          type: 'co-founder',
                          status: 'completed'
                        });

                        for (const tx of gen3CofounderTransactions) {
                          try {
                            if (tx.amount && tx.amount > 0) {
                              const commission = (tx.amount * commissionRates.generation3) / 100;
                              
                              const gen3CofounderReferralTxData = {
                                beneficiary: referrer._id,
                                referredUser: gen3User._id,
                                amount: commission,
                                currency: tx.currency || 'USD',
                                generation: 3,
                                purchaseType: 'cofounder',
                                sourceTransaction: tx._id,
                                sourceTransactionModel: 'PaymentTransaction',
                                status: 'completed',
                                metadata: {
                                  shares: tx.shares,
                                  originalAmount: tx.amount,
                                  commissionRate: commissionRates.generation3
                                },
                                createdAt: tx.createdAt
                              };
                              
                              await ReferralTransaction.create(gen3CofounderReferralTxData);
                              
                              userStats.transactions++;
                              userStats.gen3Earnings += commission;
                              userStats.totalEarnings += commission;
                              
                              stats.totalReferralTransactions++;
                              stats.totalEarningsGenerated += commission;
                              stats.cofounderTransactionsProcessed++;
                              
                              console.log(`          Gen3 Cofounder: ${gen3User.userName} → $${commission.toFixed(2)} from $${tx.amount}`);
                            }
                          } catch (gen3CofounderTxError) {
                            console.error(`          Gen 3 co-founder transaction error: ${gen3CofounderTxError.message}`);
                            stats.processingErrors++;
                          }
                        }
                      } catch (gen3CofounderError) {
                        console.error(`        Gen 3 co-founder processing error: ${gen3CofounderError.message}`);
                        stats.processingErrors++;
                      }

                    } catch (gen3UserError) {
                      console.error(`        Gen 3 user processing error: ${gen3UserError.message}`);
                      stats.processingErrors++;
                    }
                  }
                }
              } catch (gen3Error) {
                console.error(`      Gen 3 processing error: ${gen3Error.message}`);
                stats.processingErrors++;
              }
            }
          } catch (gen3OuterError) {
            console.error(`    Outer Gen 3 processing error: ${gen3OuterError.message}`);
            stats.processingErrors++;
          }
        }

        // ========================================
        // UPDATE REFERRAL STATS
        // ========================================
        try {
          console.log(`  Updating referral stats for ${referrer.userName}...`);
          
          const referralStatsData = {
            user: referrer._id,
            referredUsers: gen1Users.length,
            totalEarnings: userStats.totalEarnings,
            generation1: { count: gen1Users.length, earnings: userStats.gen1Earnings },
            generation2: { count: gen2Count, earnings: userStats.gen2Earnings },
            generation3: { count: gen3Count, earnings: userStats.gen3Earnings }
          };
          
          // Use findOneAndUpdate with upsert for better reliability
          await Referral.findOneAndUpdate(
            { user: referrer._id },
            referralStatsData,
            { upsert: true, new: true }
          );

          console.log(`  ✓ ${referrer.userName}: Earnings=$${userStats.totalEarnings.toFixed(2)}, Transactions=${userStats.transactions}`);
        } catch (statsError) {
          console.error(`  Error updating referral stats for ${referrer.userName}: ${statsError.message}`);
          stats.processingErrors++;
        }

      } catch (referrerError) {
        console.error(`Error processing referrer ${referrer.userName}: ${referrerError.message}`);
        stats.processingErrors++;
      }
      
      stats.totalProcessed++;
    }
    
    lastProcessedTime = new Date();
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('======================================');
    console.log('REFERRAL SYNC SUMMARY:');
    console.log(`⏱️  Duration: ${duration} seconds`);
    console.log(`✓ Users processed: ${stats.totalProcessed}`);
    console.log(`✓ Users with referrals: ${stats.usersWithReferrals}`);
    console.log(`✓ Users skipped: ${stats.skippedUsers}`);
    console.log(`✓ Share transactions created: ${stats.shareTransactionsProcessed}`);
    console.log(`✓ Co-founder transactions created: ${stats.cofounderTransactionsProcessed}`);
    console.log(`✓ Total transactions created: ${stats.totalReferralTransactions}`);
    console.log(`✓ Total earnings generated: $${stats.totalEarningsGenerated.toFixed(2)}`);
    console.log(`⚠ Errors encountered: ${stats.processingErrors}`);
    console.log('======================================\n');
    
    return stats;
  } catch (error) {
    console.error('❌ FATAL ERROR in referral earnings sync:', error.message);
    console.error('Stack trace:', error.stack);
    throw error;
  } finally {
    isProcessing = false;
  }
}

// ========================================
// CRON SCHEDULING
// ========================================

// Main referral sync job - runs every 2 minutes
const referralSyncJob = cron.schedule('*/2 * * * *', async () => {
  try {
    console.log('🔄 Running 2-minute referral sync...');
    await fixAllUsersReferralEarnings();
  } catch (error) {
    console.error('❌ 2-minute referral sync failed:', error.message);
  }
}, {
  scheduled: false
});

// Daily comprehensive sync job (backup)
const dailyReferralSyncJob = cron.schedule('0 2 * * *', async () => {
  try {
    console.log('🔄 Running DAILY comprehensive referral sync...');
    await fixAllUsersReferralEarnings();
  } catch (error) {
    console.error('❌ Daily referral sync failed:', error.message);
  }
}, {
  scheduled: false
});

module.exports = {
  // Export the sync function for manual use
  fixAllUsersReferralEarnings,
  
  // Export cron jobs
  referralSyncJob,
  dailyReferralSyncJob,
  
  // Start all referral cron jobs
  startReferralJobs() {
    console.log('🚀 Starting referral sync cron jobs...');
    referralSyncJob.start();
    dailyReferralSyncJob.start();
    console.log('✅ Referral sync jobs started:');
    console.log('   📅 Primary sync: Every 2 minutes (with overlap prevention)');
    console.log('   📅 Backup sync: Daily at 2:00 AM UTC');
    console.log('   🎯 Features: Co-founder support, overlap prevention');
    console.log('   🛡️ Safety: Won\'t run multiple syncs simultaneously');
  },
  
  // Stop all referral cron jobs
  stopReferralJobs() {
    console.log('🛑 Stopping referral sync cron jobs...');
    referralSyncJob.stop();
    dailyReferralSyncJob.stop();
    console.log('✅ Referral sync jobs stopped');
  },

  // Get processing status
  getProcessingStatus() {
    return {
      isProcessing,
      lastProcessedTime,
      schedule: 'Every 2 minutes + Daily backup',
      features: [
        'Co-founder transaction support',
        'Overlap prevention',
        'Enhanced error handling',
        'Complete generation processing',
        'Accurate referral calculations'
      ]
    };
  }
};