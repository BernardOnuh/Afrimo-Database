const express = require('express');
const router = express.Router();
const leaderboardController = require('../controller/leaderboardController');
const { protect } = require('../middleware/auth');

// ========== PUBLIC LEADERBOARD ROUTES WITH FILTERS ==========

/**
 * @swagger
 * /api/leaderboard/registration:
 *   get:
 *     summary: Get registration leaderboard
 *     description: Retrieve leaderboard based on user registration dates and activity
 *     tags: [Public - Leaderboards]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of users to return
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, today, week, month, quarter, year]
 *           default: all
 *         description: Time period for registration data
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include inactive users in results
 *     responses:
 *       200:
 *         description: Registration leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                         example: 1
 *                       username:
 *                         type: string
 *                         example: "john_doe"
 *                       displayName:
 *                         type: string
 *                         example: "John Doe"
 *                       registrationDate:
 *                         type: string
 *                         format: date-time
 *                       isActive:
 *                         type: boolean
 *                       profileImage:
 *                         type: string
 *                         description: URL to user's profile image
 *                       badge:
 *                         type: string
 *                         enum: [early_adopter, pioneer, founder, veteran]
 *                         description: Registration-based achievement badge
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalUsers:
 *                       type: integer
 *                     periodStart:
 *                       type: string
 *                       format: date-time
 *                     periodEnd:
 *                       type: string
 *                       format: date-time
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/registration', leaderboardController.getRegistrationLeaderboard);

/**
 * @swagger
 * /api/leaderboard/referrals:
 *   get:
 *     summary: Get referral leaderboard
 *     description: Retrieve leaderboard based on referral performance and earnings
 *     tags: [Public - Leaderboards]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [total_referrals, active_referrals, earnings, conversion_rate]
 *           default: total_referrals
 *         description: Metric to rank by
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, today, week, month, quarter, year]
 *           default: all
 *       - in: query
 *         name: minReferrals
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Minimum referrals required to appear on leaderboard
 *     responses:
 *       200:
 *         description: Referral leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       totalReferrals:
 *                         type: integer
 *                         description: Total number of referrals
 *                       activeReferrals:
 *                         type: integer
 *                         description: Number of active referrals
 *                       totalEarnings:
 *                         type: number
 *                         description: Total referral earnings
 *                       conversionRate:
 *                         type: number
 *                         description: Referral conversion rate percentage
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [referral_rookie, influencer, ambassador, legend]
 *                       tier:
 *                         type: string
 *                         enum: [bronze, silver, gold, platinum, diamond]
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     metric:
 *                       type: string
 *                     averageReferrals:
 *                       type: number
 *                     totalReferralEarnings:
 *                       type: number
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Invalid query parameters
 */
router.get('/referrals', leaderboardController.getReferralLeaderboard);

/**
 * @swagger
 * /api/leaderboard/spending:
 *   get:
 *     summary: Get spending leaderboard
 *     description: Retrieve leaderboard based on user spending and investment amounts
 *     tags: [Public - Leaderboards]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [all, shares, cofounder, installments, subscriptions]
 *           default: all
 *         description: Spending category to filter by
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, today, week, month, quarter, year]
 *           default: all
 *       - in: query
 *         name: minSpending
 *         schema:
 *           type: number
 *           minimum: 0
 *           default: 100
 *         description: Minimum spending amount to appear on leaderboard
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           enum: [USD, NGN, EUR, GBP]
 *           default: USD
 *         description: Currency for spending amounts
 *     responses:
 *       200:
 *         description: Spending leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       totalSpending:
 *                         type: number
 *                         description: Total amount spent
 *                       sharesPurchases:
 *                         type: number
 *                         description: Amount spent on regular shares
 *                       cofounderPurchases:
 *                         type: number
 *                         description: Amount spent on co-founder shares
 *                       installmentPayments:
 *                         type: number
 *                         description: Total installment payments
 *                       transactionCount:
 *                         type: integer
 *                         description: Number of transactions
 *                       averageTransaction:
 *                         type: number
 *                         description: Average transaction amount
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [spender, investor, whale, titan]
 *                       vipStatus:
 *                         type: string
 *                         enum: [standard, premium, platinum, diamond]
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalVolume:
 *                       type: number
 *                     averageSpending:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     category:
 *                       type: string
 *       400:
 *         description: Invalid parameters
 */
router.get('/spending', leaderboardController.getSpendingLeaderboard);

/**
 * @swagger
 * /api/leaderboard/cofounder:
 *   get:
 *     summary: Get co-founder leaderboard
 *     description: Retrieve leaderboard of co-founder share holders and investments
 *     tags: [Public - Leaderboards]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [shares_owned, investment_amount, ownership_percentage, early_investment]
 *           default: shares_owned
 *         description: Metric to rank co-founders by
 *       - in: query
 *         name: includeVesting
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include vesting information
 *       - in: query
 *         name: minShares
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Minimum co-founder shares to appear on leaderboard
 *     responses:
 *       200:
 *         description: Co-founder leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       cofounderShares:
 *                         type: integer
 *                         description: Number of co-founder shares owned
 *                       investmentAmount:
 *                         type: number
 *                         description: Total investment in co-founder shares
 *                       ownershipPercentage:
 *                         type: number
 *                         description: Percentage ownership of company
 *                       vestingStatus:
 *                         type: object
 *                         properties:
 *                           totalVested:
 *                             type: number
 *                           availableToExercise:
 *                             type: number
 *                           nextVestingDate:
 *                             type: string
 *                             format: date
 *                       investmentDate:
 *                         type: string
 *                         format: date-time
 *                         description: First co-founder investment date
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [founder, early_investor, major_stakeholder, board_member]
 *                       privileges:
 *                         type: array
 *                         items:
 *                           type: string
 *                         description: Special privileges (voting rights, board seat, etc.)
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalCofounderShares:
 *                       type: integer
 *                     totalInvestment:
 *                       type: number
 *                     averageInvestment:
 *                       type: number
 *                     metric:
 *                       type: string
 *       400:
 *         description: Invalid parameters
 */
router.get('/cofounder', leaderboardController.getCofounderLeaderboard);

/**
 * @swagger
 * /api/leaderboard/earnings:
 *   get:
 *     summary: Get earnings leaderboard
 *     description: Retrieve leaderboard based on total earnings from referrals and other sources
 *     tags: [Public - Leaderboards]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: source
 *         schema:
 *           type: string
 *           enum: [all, referrals, bonuses, rewards, dividends]
 *           default: all
 *         description: Earnings source to filter by
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, today, week, month, quarter, year]
 *           default: all
 *       - in: query
 *         name: minEarnings
 *         schema:
 *           type: number
 *           minimum: 0
 *           default: 10
 *         description: Minimum earnings to appear on leaderboard
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [all, paid, pending]
 *           default: all
 *         description: Filter by earnings status
 *     responses:
 *       200:
 *         description: Earnings leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       totalEarnings:
 *                         type: number
 *                         description: Total earnings amount
 *                       referralEarnings:
 *                         type: number
 *                         description: Earnings from referrals
 *                       bonusEarnings:
 *                         type: number
 *                         description: Bonus and reward earnings
 *                       dividendEarnings:
 *                         type: number
 *                         description: Dividend earnings from shares
 *                       paidEarnings:
 *                         type: number
 *                         description: Earnings already paid out
 *                       pendingEarnings:
 *                         type: number
 *                         description: Earnings pending payout
 *                       earningsGrowth:
 *                         type: number
 *                         description: Percentage growth in earnings
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [earner, achiever, top_performer, earnings_legend]
 *                       streak:
 *                         type: integer
 *                         description: Consecutive months with earnings
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalEarningsPool:
 *                       type: number
 *                     averageEarnings:
 *                       type: number
 *                     topEarnerPercentage:
 *                       type: number
 *                     source:
 *                       type: string
 *       400:
 *         description: Invalid parameters
 */
router.get('/earnings', leaderboardController.getEarningsLeaderboard);

/**
 * @swagger
 * /api/leaderboard/shares:
 *   get:
 *     summary: Get shares leaderboard
 *     description: Retrieve leaderboard based on share ownership and portfolio value
 *     tags: [Public - Leaderboards]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: shareType
 *         schema:
 *           type: string
 *           enum: [all, regular, cofounder, preferred]
 *           default: all
 *         description: Type of shares to include
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [total_shares, portfolio_value, share_growth, diversity_score]
 *           default: total_shares
 *         description: Metric to rank by
 *       - in: query
 *         name: minShares
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Minimum shares to appear on leaderboard
 *       - in: query
 *         name: includeGrowth
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Include portfolio growth metrics
 *     responses:
 *       200:
 *         description: Shares leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       totalShares:
 *                         type: integer
 *                         description: Total number of shares owned
 *                       regularShares:
 *                         type: integer
 *                         description: Regular shares owned
 *                       cofounderShares:
 *                         type: integer
 *                         description: Co-founder shares owned
 *                       portfolioValue:
 *                         type: number
 *                         description: Current portfolio value
 *                       portfolioGrowth:
 *                         type: number
 *                         description: Portfolio growth percentage
 *                       diversityScore:
 *                         type: number
 *                         description: Portfolio diversity score
 *                       firstPurchaseDate:
 *                         type: string
 *                         format: date-time
 *                       lastPurchaseDate:
 *                         type: string
 *                         format: date-time
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [shareholder, investor, portfolio_builder, share_master]
 *                       investorLevel:
 *                         type: string
 *                         enum: [beginner, intermediate, advanced, expert, master]
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     totalSharesIssued:
 *                       type: integer
 *                     averagePortfolioValue:
 *                       type: number
 *                     shareType:
 *                       type: string
 *                     metric:
 *                       type: string
 *       400:
 *         description: Invalid parameters
 */
router.get('/shares', leaderboardController.getSharesLeaderboard);

// ========== TIME-BASED LEADERBOARD ROUTES ==========

/**
 * @swagger
 * /api/leaderboard/daily:
 *   get:
 *     summary: Get daily leaderboard
 *     description: Retrieve leaderboard for daily activity and performance
 *     tags: [Public - Time-Based Leaderboards]
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Specific date (defaults to today)
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [activity_score, transactions, spending, referrals, logins]
 *           default: activity_score
 *         description: Daily metric to rank by
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 25
 *       - in: query
 *         name: timezone
 *         schema:
 *           type: string
 *           default: UTC
 *         description: Timezone for daily calculations
 *     responses:
 *       200:
 *         description: Daily leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       dailyScore:
 *                         type: number
 *                         description: Daily activity score
 *                       transactionsToday:
 *                         type: integer
 *                       spendingToday:
 *                         type: number
 *                       referralsToday:
 *                         type: integer
 *                       loginsToday:
 *                         type: integer
 *                       streak:
 *                         type: integer
 *                         description: Consecutive active days
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [daily_active, streak_master, daily_champion]
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     date:
 *                       type: string
 *                       format: date
 *                     metric:
 *                       type: string
 *                     totalActiveUsers:
 *                       type: integer
 *                     averageScore:
 *                       type: number
 *       400:
 *         description: Invalid date or parameters
 */
router.get('/daily', leaderboardController.getDailyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/weekly:
 *   get:
 *     summary: Get weekly leaderboard
 *     description: Retrieve leaderboard for weekly activity and performance
 *     tags: [Public - Time-Based Leaderboards]
 *     parameters:
 *       - in: query
 *         name: week
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-W\d{2}$'
 *         description: Specific week in YYYY-WXX format (defaults to current week)
 *         example: "2024-W15"
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [weekly_score, total_spending, new_referrals, transactions, growth]
 *           default: weekly_score
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *     responses:
 *       200:
 *         description: Weekly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       weeklyScore:
 *                         type: number
 *                       weeklySpending:
 *                         type: number
 *                       weeklyReferrals:
 *                         type: integer
 *                       weeklyTransactions:
 *                         type: integer
 *                       weeklyGrowth:
 *                         type: number
 *                         description: Week-over-week growth percentage
 *                       activeDays:
 *                         type: integer
 *                         description: Number of active days this week
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [weekly_warrior, consistent_performer, week_champion]
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     week:
 *                       type: string
 *                     weekStart:
 *                       type: string
 *                       format: date
 *                     weekEnd:
 *                       type: string
 *                       format: date
 *                     metric:
 *                       type: string
 *       400:
 *         description: Invalid week format or parameters
 */
router.get('/weekly', leaderboardController.getWeeklyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/monthly:
 *   get:
 *     summary: Get monthly leaderboard
 *     description: Retrieve leaderboard for monthly activity and performance
 *     tags: [Public - Time-Based Leaderboards]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema:
 *           type: string
 *           pattern: '^\d{4}-\d{2}$'
 *         description: Specific month in YYYY-MM format (defaults to current month)
 *         example: "2024-04"
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [monthly_score, total_investment, referral_earnings, portfolio_growth, activity_level]
 *           default: monthly_score
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [all, investors, referrers, active_users, new_users]
 *           default: all
 *         description: User category to focus on
 *     responses:
 *       200:
 *         description: Monthly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       monthlyScore:
 *                         type: number
 *                       monthlyInvestment:
 *                         type: number
 *                       monthlyReferralEarnings:
 *                         type: number
 *                       portfolioGrowthPercent:
 *                         type: number
 *                       activeDaysInMonth:
 *                         type: integer
 *                       transactionsCount:
 *                         type: integer
 *                       newReferrals:
 *                         type: integer
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [monthly_mvp, top_investor, referral_king, growth_champion]
 *                       achievements:
 *                         type: array
 *                         items:
 *                           type: string
 *                         description: Monthly achievements earned
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     month:
 *                       type: string
 *                     monthStart:
 *                       type: string
 *                       format: date
 *                     monthEnd:
 *                       type: string
 *                       format: date
 *                     metric:
 *                       type: string
 *                     category:
 *                       type: string
 *       400:
 *         description: Invalid month format or parameters
 */
router.get('/monthly', leaderboardController.getMonthlyLeaderboard);

/**
 * @swagger
 * /api/leaderboard/yearly:
 *   get:
 *     summary: Get yearly leaderboard
 *     description: Retrieve leaderboard for yearly activity and performance
 *     tags: [Public - Time-Based Leaderboards]
 *     parameters:
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *           minimum: 2020
 *           maximum: 2030
 *         description: Specific year (defaults to current year)
 *         example: 2024
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [yearly_score, total_investment, portfolio_value, referral_network, lifetime_earnings]
 *           default: yearly_score
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [all, investors, referrers, top_performers, veterans]
 *           default: all
 *         description: User category to focus on
 *     responses:
 *       200:
 *         description: Yearly leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       yearlyScore:
 *                         type: number
 *                       totalInvestment:
 *                         type: number
 *                         description: Total investment for the year
 *                       portfolioValue:
 *                         type: number
 *                         description: Current portfolio value
 *                       referralNetworkSize:
 *                         type: integer
 *                         description: Size of referral network built this year
 *                       lifetimeEarnings:
 *                         type: number
 *                         description: Lifetime earnings accumulated
 *                       yearlyGrowth:
 *                         type: number
 *                         description: Year-over-year growth percentage
 *                       milestonesAchieved:
 *                         type: array
 *                         items:
 *                           type: string
 *                         description: Major milestones achieved this year
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                         enum: [yearly_champion, legend, hall_of_fame, pioneer]
 *                       achievements:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             name:
 *                               type: string
 *                             dateEarned:
 *                               type: string
 *                               format: date
 *                             category:
 *                               type: string
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     year:
 *                       type: integer
 *                     metric:
 *                       type: string
 *                     category:
 *                       type: string
 *                     totalParticipants:
 *                       type: integer
 *                     averageScore:
 *                       type: number
 *       400:
 *         description: Invalid year or parameters
 */
router.get('/yearly', leaderboardController.getYearlyLeaderboard);

// ========== COMPREHENSIVE LEADERBOARD ==========

/**
 * @swagger
 * /api/leaderboard:
 *   get:
 *     summary: Get comprehensive leaderboard with all filters
 *     description: Retrieve a comprehensive leaderboard with advanced filtering and sorting options
 *     tags: [Public - Leaderboards]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [registration, referrals, spending, cofounder, earnings, shares, activity]
 *           default: activity
 *         description: Primary leaderboard type
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, today, week, month, quarter, year]
 *           default: all
 *         description: Time period for data
 *       - in: query
 *         name: metric
 *         schema:
 *           type: string
 *           enum: [score, investment, earnings, referrals, shares, activity, growth]
 *           default: score
 *         description: Primary ranking metric
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 200
 *           default: 100
 *         description: Number of users to return
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [all, investors, referrers, active_users, new_users, veterans]
 *           default: all
 *         description: User category filter
 *       - in: query
 *         name: minThreshold
 *         schema:
 *           type: number
 *           minimum: 0
 *         description: Minimum threshold for the selected metric
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *           default: false
 *         description: Include inactive users
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [rank, username, score, joinDate, lastActivity]
 *           default: rank
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Sort order
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *           maxLength: 50
 *         description: Search by username or display name
 *       - in: query
 *         name: badges
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *         description: Filter by specific badges
 *         style: form
 *         explode: false
 *       - in: query
 *         name: tiers
 *         schema:
 *           type: array
 *           items:
 *             type: string
 *             enum: [bronze, silver, gold, platinum, diamond]
 *         description: Filter by user tiers
 *         style: form
 *         explode: false
 *     responses:
 *       200:
 *         description: Comprehensive leaderboard retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:
 *                         type: integer
 *                       username:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                       overallScore:
 *                         type: number
 *                         description: Calculated overall performance score
 *                       metrics:
 *                         type: object
 *                         properties:
 *                           totalInvestment:
 *                             type: number
 *                           totalEarnings:
 *                             type: number
 *                           totalReferrals:
 *                             type: integer
 *                           totalShares:
 *                             type: integer
 *                           activityScore:
 *                             type: number
 *                           growthRate:
 *                             type: number
 *                       portfolio:
 *                         type: object
 *                         properties:
 *                           regularShares:
 *                             type: integer
 *                           cofounderShares:
 *                             type: integer
 *                           portfolioValue:
 *                             type: number
 *                           diversityScore:
 *                             type: number
 *                       referralStats:
 *                         type: object
 *                         properties:
 *                           totalReferrals:
 *                             type: integer
 *                           activeReferrals:
 *                             type: integer
 *                           referralEarnings:
 *                             type: number
 *                           conversionRate:
 *                             type: number
 *                       activity:
 *                         type: object
 *                         properties:
 *                           lastLogin:
 *                             type: string
 *                             format: date-time
 *                           activeDays:
 *                             type: integer
 *                           streak:
 *                             type: integer
 *                           transactionCount:
 *                             type: integer
 *                       achievements:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             name:
 *                               type: string
 *                             category:
 *                               type: string
 *                             dateEarned:
 *                               type: string
 *                               format: date
 *                             rarity:
 *                               type: string
 *                               enum: [common, rare, epic, legendary]
 *                       profileImage:
 *                         type: string
 *                       badge:
 *                         type: string
 *                       tier:
 *                         type: string
 *                         enum: [bronze, silver, gold, platinum, diamond]
 *                       isVerified:
 *                         type: boolean
 *                       joinDate:
 *                         type: string
 *                         format: date-time
 *                       percentileRank:
 *                         type: number
 *                         description: Percentile ranking (0-100)
 *                 filters:
 *                   type: object
 *                   properties:
 *                     applied:
 *                       type: object
 *                       description: Currently applied filters
 *                     available:
 *                       type: object
 *                       description: Available filter options
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                     period:
 *                       type: string
 *                     metric:
 *                       type: string
 *                     totalUsers:
 *                       type: integer
 *                     activeUsers:
 *                       type: integer
 *                     averageScore:
 *                       type: number
 *                     topPercentileThreshold:
 *                       type: number
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *                     updateFrequency:
 *                       type: string
 *                       enum: [realtime, hourly, daily]
 *                 pagination:
 *                   $ref: '#/components/schemas/Pagination'
 *       400:
 *         description: Invalid query parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded
 */
router.get('/', leaderboardController.getLeaderboard);

module.exports = router;