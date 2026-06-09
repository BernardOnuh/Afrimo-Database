// controller/leaderboardController.js
// ─────────────────────────────────────────────────────────────────────────────
// UPDATED: All leaderboard data now comes from TransactionV2 + UserShareV2.
// The old UserShare / PaymentTransaction (V1) aggregations are removed.
// Route exports are 100 % backward-compatible – the router file is unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const User                 = require('../models/User');
const Referral             = require('../models/Referral');
const CoFounderShare       = require('../models/CoFounderShare');
const ReferralTransaction  = require('../models/ReferralTransaction');
const Withdrawal           = require('../models/Withdrawal');
const AdminSettings        = require('../models/AdminSettings');
const TransactionV2        = require('../models/TransactionV2');
const UserShareV2          = require('../models/UserShareV2');
const { invalidateCache }  = require('../middleware/visibilityMiddleware');

// ── Optional dependencies ─────────────────────────────────────────────────────
let AdminAuditLog, CacheService, adminValidation;

try   { AdminAuditLog  = require('../models/AdminAuditLog');            }
catch { console.log('AdminAuditLog model not found – audit logging disabled'); }

try {
  CacheService = require('../services/cacheService');
} catch {
  console.log('CacheService not found – caching disabled');
  CacheService = {
    getLeaderboard      : async () => null,
    setLeaderboard      : async () => false,
    get                 : async () => null,
    set                 : async () => false,
    invalidateUserCache : async () => false,
  };
}

try {
  adminValidation = require('../validation/adminValidation');
} catch {
  console.log('Admin validation not found – using basic validation');
  adminValidation = {
    leaderboardQuerySchema  : { validate: (d) => ({ error: null, value: d }) },
    visibilityUpdateSchema  : { validate: (d) => ({ error: null, value: d }) },
    bulkUpdateSchema        : { validate: (d) => ({ error: null, value: d }) },
  };
}

const { leaderboardQuerySchema, visibilityUpdateSchema, bulkUpdateSchema } = adminValidation;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a $gte date threshold for a named time-frame.
 * Returns null for 'all-time' / unknown values.
 */
const buildDateThreshold = (timeFrame) => {
  if (!timeFrame) return null;
  const now = new Date();
  const d   = new Date();

  switch (timeFrame) {
    case 'daily':
      d.setHours(0, 0, 0, 0);
      return d;
    case 'weekly':
      d.setDate(now.getDate() - now.getDay());
      d.setHours(0, 0, 0, 0);
      return d;
    case 'monthly':
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      return d;
    case 'yearly':
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      return d;
    default:
      return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE V2 LEADERBOARD FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getTimeFilteredLeaderboard
 *
 * Replaces the old V1 aggregation entirely.
 * Data sources:
 *   • UserShareV2  – for ownership %, earning kobo, share counts
 *   • TransactionV2 – for spending totals and share counts
 *   • Referral      – for referral counts & earnings
 *   • Withdrawal    – for withdrawal amounts
 *
 * categoryFilter values (same as before, kept for route compatibility):
 *   'registration' | 'referrals' | 'spending' | 'co-founder' |
 *   'earnings'     | 'shares'
 *
 * 'shares' category: ranks by raw share COUNT (sum of tx.shares) per your choice.
 * All other categories: ranked by the relevant V2 metric.
 */
const getTimeFilteredLeaderboard = async (
  timeFrame,
  categoryFilter = 'registration',
  limit          = Number.MAX_SAFE_INTEGER,
) => {
  const dateThreshold = buildDateThreshold(timeFrame);

  // ── Step 1: aggregate UserShareV2 snapshot per user ──────────────────────
  // This gives us totalOwnershipPct, totalEarningKobo, cofounderOwnershipPct
  const snapshotMap = {};
  const snapshots   = await UserShareV2.find({}).lean();
  for (const s of snapshots) {
    snapshotMap[s.user.toString()] = s;
  }

  // ── Step 2: aggregate TransactionV2 per user ─────────────────────────────
  // We need: totalSpent, shareCount, cofounderShareCount
  // Optionally filtered by dateThreshold
  const txMatchStage = { status: 'completed' };
  if (dateThreshold) txMatchStage.createdAt = { $gte: dateThreshold };

  const txAgg = await TransactionV2.aggregate([
    { $match: txMatchStage },
    {
      $group: {
        _id                  : '$userId',
        totalSpent           : { $sum: '$totalAmount'  },
        totalShares          : { $sum: '$shares'       },
        totalOwnershipPct    : { $sum: '$ownershipPct' },
        totalEarningKobo     : { $sum: '$earningKobo'  },
        cofounderShares      : {
          $sum: { $cond: [{ $eq: ['$type', 'co-founder'] }, '$shares', 0] },
        },
        cofounderOwnershipPct: {
          $sum: { $cond: [{ $eq: ['$type', 'co-founder'] }, '$ownershipPct', 0] },
        },
      },
    },
  ]);

  const txMap = {};
  for (const t of txAgg) txMap[t._id.toString()] = t;

  // ── Step 3: aggregate Referral per user ──────────────────────────────────
  const referralAgg = await Referral.aggregate([
    {
      $project: {
        user          : 1,
        referralCount : { $ifNull: ['$referredUsers', 0] },
        totalEarnings : { $ifNull: ['$totalEarnings',  0] },
        totalWithdrawn: { $ifNull: ['$totalWithdrawn', 0] },
        pendingW      : { $ifNull: ['$pendingWithdrawals',    0] },
        processingW   : { $ifNull: ['$processingWithdrawals', 0] },
      },
    },
  ]);
  const referralMap = {};
  for (const r of referralAgg) referralMap[r.user.toString()] = r;

  // ── Step 4: aggregate Withdrawals per user ───────────────────────────────
  const withdrawalFilter = { status: { $in: ['paid', 'approved'] } };
  if (dateThreshold) withdrawalFilter.createdAt = { $gte: dateThreshold };

  const wAgg = await Withdrawal.aggregate([
    { $match: withdrawalFilter },
    { $group: { _id: '$user', withdrawalAmount: { $sum: '$amount' } } },
  ]);
  const withdrawalMap = {};
  for (const w of wAgg) withdrawalMap[w._id.toString()] = w.withdrawalAmount;

  // ── Step 5: build combined user list ─────────────────────────────────────
  // Collect all user IDs that have any V2 data
  const userIdSet = new Set([
    ...Object.keys(snapshotMap),
    ...Object.keys(txMap),
  ]);
  if (userIdSet.size === 0) return [];

  const users = await User.find(
    { _id: { $in: [...userIdSet] } },
    { name: 1, userName: 1, createdAt: 1 },
  ).lean();

  // ── Step 6: enrich each user with computed fields ────────────────────────
  const enriched = users.map((u) => {
    const uid      = u._id.toString();
    const snap     = snapshotMap[uid] || {};
    const tx       = txMap[uid]       || {};
    const ref      = referralMap[uid] || {};
    const withdrawn = withdrawalMap[uid] || 0;

    // Use snapshot for all-time totals; use tx aggregation when date-filtered
    const useSnapshot = !dateThreshold;

    const totalOwnershipPct     = useSnapshot
      ? (snap.totalOwnershipPct     || 0)
      : (tx.totalOwnershipPct       || 0);
    const totalEarningKobo      = useSnapshot
      ? (snap.totalEarningKobo      || 0)
      : (tx.totalEarningKobo        || 0);
    const cofounderOwnershipPct = useSnapshot
      ? (snap.cofounderOwnershipPct || 0)
      : (tx.cofounderOwnershipPct   || 0);
    const regularOwnershipPct   = totalOwnershipPct - cofounderOwnershipPct;

    const totalShares      = tx.totalShares      || 0;
    const cofounderShares  = tx.cofounderShares  || 0;
    const regularShares    = totalShares - cofounderShares;
    const totalSpent       = tx.totalSpent       || 0;

    const referralCount    = ref.referralCount   || 0;
    const referralEarnings = ref.totalEarnings   || 0;
    const currentBalance   = Math.max(
      0,
      referralEarnings - (ref.totalWithdrawn || 0) - (ref.pendingW || 0) - (ref.processingW || 0),
    );

    return {
      _id                    : u._id,
      name                   : u.name,
      userName               : u.userName,
      createdAt              : u.createdAt,
      // Ownership / earnings (V2)
      totalOwnershipPct,
      totalOwnershipFormatted: `${(totalOwnershipPct * 100).toFixed(6)}%`,
      cofounderOwnershipPct,
      regularOwnershipPct,
      totalEarningKobo,
      totalEarningNaira      : totalEarningKobo / 100,
      // Share counts (for 'shares' category ranking)
      totalShares,
      cofounderShares,
      regularShares,
      // Spending
      totalSpent,
      // Referral
      referralCount,
      referralEarnings,
      currentBalance,
      withdrawalAmount       : withdrawn,
    };
  });

  // ── Step 7: filter & sort based on categoryFilter ────────────────────────
  let filtered = enriched;

  switch (categoryFilter) {
    case 'referrals':
      filtered = enriched.filter((u) => u.referralCount > 0);
      filtered.sort((a, b) => b.referralCount - a.referralCount);
      break;

    case 'spending':
      filtered = enriched.filter((u) => u.totalSpent > 0);
      filtered.sort((a, b) => b.totalSpent - a.totalSpent);
      break;

    case 'co-founder':
      filtered = enriched.filter((u) => u.cofounderOwnershipPct > 0);
      filtered.sort((a, b) => b.cofounderOwnershipPct - a.cofounderOwnershipPct);
      break;

    case 'earnings':
      filtered = enriched.filter((u) => u.referralEarnings > 0);
      filtered.sort((a, b) => b.referralEarnings - a.referralEarnings);
      break;

    case 'shares':
      // Rank by raw share COUNT per user preference
      filtered = enriched.filter((u) => u.totalShares > 0);
      filtered.sort((a, b) => b.totalShares - a.totalShares);
      break;

    case 'ownership':
      filtered = enriched.filter((u) => u.totalOwnershipPct > 0);
      filtered.sort((a, b) => b.totalOwnershipPct - a.totalOwnershipPct);
      break;

    default: // 'registration'
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
  }

  // ── Step 8: apply limit ───────────────────────────────────────────────────
  if (limit !== Number.MAX_SAFE_INTEGER) filtered = filtered.slice(0, limit);

  return filtered;
};

// Convenience wrapper (no time filter)
const getFilteredLeaderboard = (categoryFilter = 'registration', limit = Number.MAX_SAFE_INTEGER) =>
  getTimeFilteredLeaderboard(null, categoryFilter, limit);

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN LEADERBOARD (enhanced, also V2)
// ─────────────────────────────────────────────────────────────────────────────

const getAdminLeaderboard = async (filters) => {
  const {
    type         = 'earners',
    period       = 'all_time',
    limit        = 50,
    offset       = 0,
    state,
    city,
    search,
    show_earnings = true,
    show_balance  = true,
  } = filters;

  const dateThreshold = period !== 'all_time' ? buildDateThreshold(period) : null;

  // ── Pull snapshots (all-time ownership) ──────────────────────────────────
  const snapshots = await UserShareV2.find({}).lean();
  const snapMap   = {};
  for (const s of snapshots) snapMap[s.user.toString()] = s;

  // ── Pull V2 tx aggregation (potentially date-filtered) ───────────────────
  const txMatch = { status: 'completed' };
  if (dateThreshold) txMatch.createdAt = { $gte: dateThreshold };

  const txAgg = await TransactionV2.aggregate([
    { $match: txMatch },
    {
      $group: {
        _id              : '$userId',
        totalSpent       : { $sum: '$totalAmount'  },
        totalShares      : { $sum: '$shares'       },
        totalOwnershipPct: { $sum: '$ownershipPct' },
        totalEarningKobo : { $sum: '$earningKobo'  },
        cofounderShares  : {
          $sum: { $cond: [{ $eq: ['$type', 'co-founder'] }, '$shares', 0] },
        },
      },
    },
  ]);
  const txMap = {};
  for (const t of txAgg) txMap[t._id.toString()] = t;

  // ── Pull referral data ────────────────────────────────────────────────────
  const referrals    = await Referral.find({}).lean();
  const referralMap  = {};
  for (const r of referrals) referralMap[r.user.toString()] = r;

  // ── Build user match criteria ─────────────────────────────────────────────
  const matchCriteria = {
    'status.isActive': true,
    isBanned         : { $ne: true },
  };
  if (state)  matchCriteria['location.state'] = state;
  if (city)   matchCriteria['location.city']  = city;
  if (search) {
    matchCriteria.$or = [
      { name    : { $regex: search, $options: 'i' } },
      { userName: { $regex: search, $options: 'i' } },
    ];
  }

  const allUsers = await User.find(matchCriteria, {
    name: 1, userName: 1, createdAt: 1,
    'location.state': 1, 'location.city': 1,
    'earnings.visible': 1, 'availableBalance.visible': 1,
  }).lean();

  // ── Enrich ────────────────────────────────────────────────────────────────
  const enriched = allUsers.map((u) => {
    const uid = u._id.toString();
    const snap = snapMap[uid] || {};
    const tx   = txMap[uid]   || {};
    const ref  = referralMap[uid] || {};

    const totalOwnershipPct = snap.totalOwnershipPct || 0;
    const totalEarningKobo  = snap.totalEarningKobo  || 0;
    const totalShares       = tx.totalShares         || 0;
    const cofounderShares   = tx.cofounderShares     || 0;
    const referralCount     = ref.referredUsers      || 0;
    const referralEarnings  = ref.totalEarnings      || 0;
    const currentBalance    = Math.max(
      0,
      referralEarnings
        - (ref.totalWithdrawn         || 0)
        - (ref.pendingWithdrawals     || 0)
        - (ref.processingWithdrawals  || 0),
    );

    return {
      _id              : u._id,
      name             : u.name,
      userName         : u.userName,
      createdAt        : u.createdAt,
      location         : u.location,
      totalOwnershipPct,
      totalEarningKobo,
      totalShares,
      cofounderShares,
      referralCount,
      totalEarnings    : show_earnings ? referralEarnings : null,
      availableBalance : show_balance  ? currentBalance   : null,
      earningsVisible  : u.earnings?.visible,
      balanceVisible   : u.availableBalance?.visible,
    };
  });

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortFns = {
    earners   : (a, b) => b.totalEarnings    - a.totalEarnings,
    shares    : (a, b) => b.totalShares      - a.totalShares,
    ownership : (a, b) => b.totalOwnershipPct- a.totalOwnershipPct,
    referrals : (a, b) => b.referralCount    - a.referralCount,
    cofounders: (a, b) => b.cofounderShares  - a.cofounderShares,
  };
  enriched.sort(sortFns[type] || sortFns.earners);

  const total     = enriched.length;
  const paginated = enriched.slice(offset, offset + limit).map((u, i) => ({
    ...u,
    rank: offset + i + 1,
  }));

  return {
    users      : paginated,
    total,
    totalPages : Math.ceil(total / limit),
    currentPage: Math.floor(offset / limit) + 1,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// LOCATION ANALYTICS (V2)
// ─────────────────────────────────────────────────────────────────────────────

const getLocationAnalytics = async (type = 'states', parentFilter = null, limit = 10) => {
  const matchStage = { 'status.isActive': true, isBanned: { $ne: true } };
  if (type === 'cities' && parentFilter) matchStage['location.state'] = parentFilter;

  const groupBy = type === 'cities'
    ? { state: '$location.state', city: '$location.city' }
    : '$location.state';

  const referrals   = await Referral.find({}).lean();
  const referralMap = {};
  for (const r of referrals) referralMap[r.user.toString()] = r.totalEarnings || 0;

  const users = await User.find(matchStage, { 'location': 1 }).lean();

  // Group manually (MongoDB aggregation also works but this keeps it simple)
  const grouped = {};
  for (const u of users) {
    const key = type === 'cities'
      ? `${u.location?.state}||${u.location?.city}`
      : (u.location?.state || 'Unknown');

    if (!grouped[key]) grouped[key] = { totalUsers: 0, totalEarnings: 0, state: u.location?.state, city: u.location?.city };
    grouped[key].totalUsers++;
    grouped[key].totalEarnings += referralMap[u._id.toString()] || 0;
  }

  return Object.values(grouped)
    .sort((a, b) => b.totalEarnings - a.totalEarnings)
    .slice(0, limit)
    .map((g, i) => ({ ...g, rank: i + 1, averageEarnings: g.totalUsers ? g.totalEarnings / g.totalUsers : 0 }));
};

// ─────────────────────────────────────────────────────────────────────────────
// LOCATION LEADERBOARD (V2) – used by /filter/country|state|city
// ─────────────────────────────────────────────────────────────────────────────

exports.getLeaderboardByLocationFixed = async (filters) => {
  const {
    country   = null,
    state     = null,
    city      = null,
    limit     = 50,
    offset    = 0,
    sortBy    = 'totalEarnings',
    sortOrder = 'desc',
    period    = 'all_time',
  } = filters;

  const dateThreshold = buildDateThreshold(period);

  // ── Location match ────────────────────────────────────────────────────────
  const locationFilter = {};
  if (country) locationFilter.$or = [{ country }, { 'location.country': country }];
  if (state)   locationFilter.$or = [{ state   }, { 'location.state'  : state   }];
  if (city)    locationFilter.$or = [{ city    }, { 'location.city'   : city    }];

  const matchCriteria = {
    'status.isActive': true,
    isBanned         : { $ne: true },
    ...locationFilter,
    ...(dateThreshold ? { createdAt: { $gte: dateThreshold } } : {}),
  };

  const users = await User.find(matchCriteria, {
    name: 1, userName: 1, createdAt: 1,
    location: 1, country: 1, state: 1, city: 1,
    'status.isActive': 1,
  }).lean();

  const userIds = users.map((u) => u._id);

  // ── Pull V2 snapshots ─────────────────────────────────────────────────────
  const snapshots = await UserShareV2.find({ user: { $in: userIds } }).lean();
  const snapMap   = {};
  for (const s of snapshots) snapMap[s.user.toString()] = s;

  // ── Pull referrals ────────────────────────────────────────────────────────
  const referrals  = await Referral.find({ user: { $in: userIds } }).lean();
  const refMap     = {};
  for (const r of referrals) refMap[r.user.toString()] = r;

  // ── Enrich ────────────────────────────────────────────────────────────────
  const enriched = users.map((u) => {
    const uid  = u._id.toString();
    const snap = snapMap[uid] || {};
    const ref  = refMap[uid]  || {};

    const totalOwnershipPct = snap.totalOwnershipPct || 0;
    const totalEarningKobo  = snap.totalEarningKobo  || 0;
    const totalEarnings     = ref.totalEarnings      || 0;
    const availableBalance  = Math.max(
      0,
      totalEarnings
        - (ref.totalWithdrawn        || 0)
        - (ref.pendingWithdrawals    || 0)
        - (ref.processingWithdrawals || 0),
    );

    return {
      _id              : u._id,
      name             : u.name,
      userName         : u.userName,
      createdAt        : u.createdAt,
      totalOwnershipPct,
      totalOwnershipFormatted: `${(totalOwnershipPct * 100).toFixed(6)}%`,
      totalEarningKobo,
      totalEarnings,
      availableBalance,
      location: {
        country: u.country || u.location?.country,
        state  : u.state   || u.location?.state,
        city   : u.city    || u.location?.city,
      },
      status: u.status,
    };
  });

  // ── Sort ──────────────────────────────────────────────────────────────────
  const dir = sortOrder === 'asc' ? 1 : -1;
  const sortKey = {
    totalEarnings    : 'totalEarnings',
    availableBalance : 'availableBalance',
    totalOwnershipPct: 'totalOwnershipPct',
    totalEarningKobo : 'totalEarningKobo',
    createdAt        : 'createdAt',
  }[sortBy] || 'totalEarnings';

  enriched.sort((a, b) => dir * (
    sortKey === 'createdAt'
      ? new Date(b.createdAt) - new Date(a.createdAt)
      : (b[sortKey] - a[sortKey])
  ));

  const total     = enriched.length;
  const paginated = enriched.slice(offset, offset + limit).map((u, i) => ({ ...u, rank: offset + i + 1 }));

  // ── Location stats ────────────────────────────────────────────────────────
  const earnings    = enriched.map((u) => u.totalEarnings);
  const totalE      = earnings.reduce((s, v) => s + v, 0);
  const totalBal    = enriched.reduce((s, u) => s + u.availableBalance, 0);
  const locationStats = {
    totalUsers      : total,
    totalEarnings   : Math.round(totalE   * 100) / 100,
    averageEarnings : total ? Math.round((totalE / total) * 100) / 100 : 0,
    totalBalance    : Math.round(totalBal * 100) / 100,
    maxEarnings     : Math.round(Math.max(0, ...earnings) * 100) / 100,
    minEarnings     : earnings.length ? Math.round(Math.min(...earnings) * 100) / 100 : 0,
  };

  return {
    users: paginated,
    total,
    totalPages : Math.ceil(total / limit),
    currentPage: Math.floor(offset / limit) + 1,
    locationStats,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// FILTER FUNCTIONS (used by /filter/* routes)
// ─────────────────────────────────────────────────────────────────────────────

exports.getLeaderboardByEarnings = async (filters) => {
  const {
    minEarnings = 0,
    maxEarnings = null,
    limit       = 50,
    offset      = 0,
    period      = 'all_time',
    sortOrder   = 'desc',
  } = filters;

  const dateThreshold  = buildDateThreshold(period);
  const matchCriteria  = { 'status.isActive': true, isBanned: { $ne: true } };
  if (dateThreshold) matchCriteria.createdAt = { $gte: dateThreshold };

  const users      = await User.find(matchCriteria, { name: 1, userName: 1, createdAt: 1, location: 1 }).lean();
  const userIds    = users.map((u) => u._id);
  const referrals  = await Referral.find({ user: { $in: userIds } }).lean();
  const refMap     = {};
  for (const r of referrals) refMap[r.user.toString()] = r.totalEarnings || 0;

  let enriched = users
    .map((u) => ({ ...u, totalEarnings: refMap[u._id.toString()] || 0 }))
    .filter((u) => u.totalEarnings >= minEarnings && (maxEarnings === null || u.totalEarnings <= maxEarnings));

  enriched.sort((a, b) =>
    sortOrder === 'asc' ? a.totalEarnings - b.totalEarnings : b.totalEarnings - a.totalEarnings,
  );

  const total     = enriched.length;
  const paginated = enriched.slice(offset, offset + limit).map((u, i) => ({
    _id           : u._id,
    name          : u.name,
    userName      : u.userName,
    totalEarnings : u.totalEarnings,
    'location.state': u.location?.state,
    'location.city' : u.location?.city,
    createdAt     : u.createdAt,
    rank          : offset + i + 1,
  }));

  return {
    users      : paginated,
    total,
    totalPages : Math.ceil(total / limit),
    currentPage: Math.floor(offset / limit) + 1,
  };
};

exports.getLeaderboardByBalance = async (filters) => {
  const {
    minBalance = 0,
    maxBalance = null,
    limit      = 50,
    offset     = 0,
    period     = 'all_time',
    sortOrder  = 'desc',
  } = filters;

  const dateThreshold = buildDateThreshold(period);
  const matchCriteria = { 'status.isActive': true, isBanned: { $ne: true } };
  if (dateThreshold) matchCriteria.createdAt = { $gte: dateThreshold };

  const users     = await User.find(matchCriteria, { name: 1, userName: 1, createdAt: 1, location: 1 }).lean();
  const userIds   = users.map((u) => u._id);
  const referrals = await Referral.find({ user: { $in: userIds } }).lean();
  const refMap    = {};
  for (const r of referrals) refMap[r.user.toString()] = r;

  let enriched = users.map((u) => {
    const ref              = refMap[u._id.toString()] || {};
    const totalEarnings    = ref.totalEarnings      || 0;
    const availableBalance = Math.max(
      0,
      totalEarnings
        - (ref.totalWithdrawn        || 0)
        - (ref.pendingWithdrawals    || 0)
        - (ref.processingWithdrawals || 0),
    );
    return { ...u, totalEarnings, availableBalance };
  }).filter((u) => u.availableBalance >= minBalance && (maxBalance === null || u.availableBalance <= maxBalance));

  enriched.sort((a, b) =>
    sortOrder === 'asc' ? a.availableBalance - b.availableBalance : b.availableBalance - a.availableBalance,
  );

  const total     = enriched.length;
  const paginated = enriched.slice(offset, offset + limit).map((u, i) => ({
    _id              : u._id,
    name             : u.name,
    userName         : u.userName,
    totalEarnings    : u.totalEarnings,
    availableBalance : u.availableBalance,
    'location.state' : u.location?.state,
    'location.city'  : u.location?.city,
    createdAt        : u.createdAt,
    rank             : offset + i + 1,
  }));

  return {
    users      : paginated,
    total,
    totalPages : Math.ceil(total / limit),
    currentPage: Math.floor(offset / limit) + 1,
  };
};

exports.getLeaderboardByStatus = async (filters) => {
  const {
    status    = 'active',
    limit     = 50,
    offset    = 0,
    sortBy    = 'totalEarnings',
    sortOrder = 'desc',
    period    = 'all_time',
  } = filters;

  const dateThreshold = buildDateThreshold(period);

  const statusFilter = {
    active   : { 'status.isActive': true,  isBanned: { $ne: true }, isSuspended: { $ne: true } },
    inactive : { 'status.isActive': false, isBanned: { $ne: true } },
    suspended: { $or: [{ isBanned: true }, { isSuspended: true }] },
  }[status] || { 'status.isActive': true };

  const matchCriteria = {
    ...statusFilter,
    ...(dateThreshold ? { createdAt: { $gte: dateThreshold } } : {}),
  };

  const users     = await User.find(matchCriteria, {
    name: 1, userName: 1, createdAt: 1, location: 1,
    'status.isActive': 1, isBanned: 1, isSuspended: 1,
  }).lean();
  const userIds   = users.map((u) => u._id);

  const snapshots = await UserShareV2.find({ user: { $in: userIds } }).lean();
  const snapMap   = {};
  for (const s of snapshots) snapMap[s.user.toString()] = s;

  const referrals = await Referral.find({ user: { $in: userIds } }).lean();
  const refMap    = {};
  for (const r of referrals) refMap[r.user.toString()] = r;

  const enriched = users.map((u) => {
    const uid  = u._id.toString();
    const snap = snapMap[uid] || {};
    const ref  = refMap[uid]  || {};

    const totalEarnings    = ref.totalEarnings   || 0;
    const availableBalance = Math.max(
      0,
      totalEarnings
        - (ref.totalWithdrawn        || 0)
        - (ref.pendingWithdrawals    || 0)
        - (ref.processingWithdrawals || 0),
    );

    const userStatus = (u.isBanned || u.isSuspended)
      ? 'suspended'
      : (u.status?.isActive ? 'active' : 'inactive');

    return {
      ...u,
      totalOwnershipPct: snap.totalOwnershipPct || 0,
      totalEarningKobo : snap.totalEarningKobo  || 0,
      totalEarnings,
      availableBalance,
      userStatus,
    };
  });

  const dir = sortOrder === 'asc' ? 1 : -1;
  enriched.sort((a, b) => {
    const key = { totalEarnings: 'totalEarnings', availableBalance: 'availableBalance',
      totalOwnershipPct: 'totalOwnershipPct', createdAt: 'createdAt' }[sortBy] || 'totalEarnings';
    return key === 'createdAt'
      ? dir * (new Date(b.createdAt) - new Date(a.createdAt))
      : dir * (b[key] - a[key]);
  });

  const total     = enriched.length;
  const paginated = enriched.slice(offset, offset + limit).map((u, i) => ({ ...u, rank: offset + i + 1 }));
  const statusStats = ['active', 'inactive', 'suspended'].map((s) => {
    const group = enriched.filter((u) => u.userStatus === s);
    return { _id: s, count: group.length, totalEarnings: group.reduce((acc, u) => acc + u.totalEarnings, 0) };
  });

  return {
    users: paginated, total,
    totalPages : Math.ceil(total / limit),
    currentPage: Math.floor(offset / limit) + 1,
    statusStats,
  };
};

exports.getLeaderboardByShares = async (filters) => {
  const {
    minShares = 0,
    maxShares = null,
    limit     = 50,
    offset    = 0,
    period    = 'all_time',
    sortOrder = 'desc',
    shareType = 'all',
  } = filters;

  const dateThreshold = buildDateThreshold(period);
  const txMatch       = { status: 'completed' };
  if (dateThreshold) txMatch.createdAt = { $gte: dateThreshold };

  const txAgg = await TransactionV2.aggregate([
    { $match: txMatch },
    {
      $group: {
        _id             : '$userId',
        totalShares     : { $sum: '$shares' },
        cofounderShares : { $sum: { $cond: [{ $eq: ['$type', 'co-founder'] }, '$shares', 0] } },
        totalOwnershipPct: { $sum: '$ownershipPct' },
        totalEarningKobo : { $sum: '$earningKobo'  },
      },
    },
  ]);

  const txMap   = {};
  for (const t of txAgg) txMap[t._id.toString()] = t;

  const matchCriteria = { 'status.isActive': true, isBanned: { $ne: true } };
  if (dateThreshold) matchCriteria.createdAt = { $gte: dateThreshold };
  const users = await User.find(matchCriteria, { name: 1, userName: 1, createdAt: 1, location: 1 }).lean();

  // ── referrals for context ─────────────────────────────────────────────────
  const refAgg = await Referral.aggregate([
    { $group: { _id: '$user', totalEarnings: { $sum: '$totalEarnings' } } },
  ]);
  const refMap = {};
  for (const r of refAgg) refMap[r._id.toString()] = r.totalEarnings || 0;

  const enriched = users
    .map((u) => {
      const uid  = u._id.toString();
      const tx   = txMap[uid] || {};
      const regularShares  = (tx.totalShares || 0) - (tx.cofounderShares || 0);
      const filterShares   =
        shareType === 'co-founder' ? (tx.cofounderShares || 0)
        : shareType === 'share'   ? regularShares
        : (tx.totalShares || 0);

      return {
        _id              : u._id,
        name             : u.name,
        userName         : u.userName,
        createdAt        : u.createdAt,
        regularShares,
        cofounderSharesTotal: tx.cofounderShares || 0,
        combinedShares   : tx.totalShares || 0,
        totalOwnershipPct: tx.totalOwnershipPct || 0,
        totalEarningKobo : tx.totalEarningKobo  || 0,
        totalEarnings    : refMap[uid] || 0,
        filterShares,
        shareBreakdown   : {
          regular   : regularShares,
          cofounder : tx.cofounderShares || 0,
          total     : tx.totalShares || 0,
        },
        'location.state' : u.location?.state,
        'location.city'  : u.location?.city,
        'status.isActive': u.status?.isActive,
      };
    })
    .filter((u) => u.filterShares >= minShares && (maxShares === null || u.filterShares <= maxShares));

  enriched.sort((a, b) =>
    sortOrder === 'asc' ? a.filterShares - b.filterShares : b.filterShares - a.filterShares,
  );

  const total     = enriched.length;
  const paginated = enriched.slice(offset, offset + limit).map((u, i) => ({
    ...u, rank: offset + i + 1, filteredShares: u.filterShares,
  }));

  const allShares   = enriched.map((u) => u.filterShares);
  const allEarnings = enriched.map((u) => u.totalEarnings);

  return {
    users      : paginated,
    total,
    totalPages : Math.ceil(total / limit),
    currentPage: Math.floor(offset / limit) + 1,
    shareType,
    statistics : {
      totalShares    : allShares.reduce((s, v) => s + v, 0),
      averageShares  : total ? Math.round((allShares.reduce((s, v) => s + v, 0) / total) * 100) / 100 : 0,
      maxShares      : allShares.length ? Math.max(...allShares) : 0,
      minShares      : allShares.length ? Math.min(...allShares) : 0,
      totalUsers     : total,
      totalEarnings  : Math.round(allEarnings.reduce((s, v) => s + v, 0) * 100) / 100,
      averageEarnings: total ? Math.round((allEarnings.reduce((s, v) => s + v, 0) / total) * 100) / 100 : 0,
    },
  };
};

exports.getLeaderboardByLocation = exports.getLeaderboardByLocationFixed;

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN CONTROLLER METHODS  (HTTP handlers)
// ─────────────────────────────────────────────────────────────────────────────

exports.getAdminLeaderboard = async (req, res) => {
  try {
    if (!CacheService || !AdminAuditLog) {
      return res.status(503).json({ success: false, message: 'Admin features not available – missing dependencies' });
    }

    const { error, value } = leaderboardQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, message: 'Invalid query parameters',
        errors: error.details.map((d) => d.message) });
    }

    const cacheKey  = `admin_leaderboard:${JSON.stringify(value)}`;
    const cached    = await CacheService.getLeaderboard(cacheKey);
    if (cached) {
      return res.json({
        success: true, data: cached.users, fromCache: true,
        pagination: { currentPage: cached.currentPage, totalPages: cached.totalPages,
          totalItems: cached.total, hasNext: cached.currentPage < cached.totalPages,
          hasPrev: cached.currentPage > 1, limit: value.limit },
        filters: value,
      });
    }

    const result = await getAdminLeaderboard(value);
    await CacheService.setLeaderboard(cacheKey, result, 900);

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id, action: 'VIEW_ADMIN_LEADERBOARD',
        details: { filters: value }, ipAddress: req.ip, userAgent: req.get('User-Agent'),
      });
    }

    res.json({
      success: true, data: result.users,
      pagination: { currentPage: result.currentPage, totalPages: result.totalPages,
        totalItems: result.total, hasNext: result.currentPage < result.totalPages,
        hasPrev: result.currentPage > 1, limit: value.limit },
      filters: value,
    });
  } catch (error) {
    console.error('Error fetching admin leaderboard:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch admin leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

exports.getTopStates = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const cacheKey = `top_states:${limit}`;
    const cached   = await CacheService.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const states = await getLocationAnalytics('states', null, parseInt(limit));
    await CacheService.set(cacheKey, states, 1800);
    res.json({ success: true, data: states });
  } catch (error) {
    console.error('Error fetching top states:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch top states' });
  }
};

exports.getTopCities = async (req, res) => {
  try {
    const { state, limit = 10 } = req.query;
    const cacheKey = `top_cities:${state || 'all'}:${limit}`;
    const cached   = await CacheService.get(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const cities = await getLocationAnalytics('cities', state, parseInt(limit));
    await CacheService.set(cacheKey, cities, 1800);
    res.json({ success: true, data: cities });
  } catch (error) {
    console.error('Error fetching top cities:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch top cities' });
  }
};

exports.toggleUserVisibility = async (req, res) => {
  try {
    if (!AdminAuditLog) {
      return res.status(503).json({ success: false, message: 'Admin audit features not available' });
    }

    const { userId } = req.params;
    const { error, value } = visibilityUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Invalid request body',
        errors: error.details.map((d) => d.message) });
    }

    const { field, visible } = value;
    const updateField = field === 'earnings' ? 'earnings.visible' : 'availableBalance.visible';

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { [updateField]: visible } },
      { new: true, select: 'name userName earnings.visible availableBalance.visible' },
    );

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await AdminAuditLog.create({
      adminId: req.user._id, action: 'TOGGLE_USER_VISIBILITY',
      targetUserId: userId, details: { field, visible, oldValue: !visible },
      ipAddress: req.ip, userAgent: req.get('User-Agent'),
    });

    if (CacheService) await CacheService.invalidateUserCache(userId);

    res.json({ success: true, message: `User ${field} visibility updated successfully`, data: user });
  } catch (error) {
    console.error('Error toggling user visibility:', error);
    res.status(500).json({ success: false, message: 'Failed to update user visibility' });
  }
};

exports.bulkUpdateUsers = async (req, res) => {
  try {
    const { error, value } = bulkUpdateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Invalid request body',
        errors: error.details.map((d) => d.message) });
    }

    const { user_ids, updates } = value;
    const result = await User.updateMany({ _id: { $in: user_ids } }, { $set: updates });

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id, action: 'BULK_UPDATE_USERS',
        details: { userIds: user_ids, updates, result },
        ipAddress: req.ip, userAgent: req.get('User-Agent'),
      });
    }

    for (const userId of user_ids) await CacheService.invalidateUserCache(userId);

    res.json({ success: true, message: `Successfully updated ${result.modifiedCount} users`, data: result });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({ success: false, message: 'Failed to update users' });
  }
};

exports.exportLeaderboard = async (req, res) => {
  try {
    const filters = { ...req.query, limit: 10000, offset: 0 };
    const result  = await getAdminLeaderboard(filters);

    const csvData = result.users.map((u) => ({
      Rank               : u.rank,
      Name               : u.name,
      Username           : u.userName,
      'Ownership %'      : u.totalOwnershipPct ? `${(u.totalOwnershipPct * 100).toFixed(6)}%` : 'N/A',
      'Earning (kobo)'   : u.totalEarningKobo  || 0,
      'Total Earnings'   : u.totalEarnings     || 'Hidden',
      'Available Balance': u.availableBalance  || 'Hidden',
      'Total Shares'     : u.totalShares       || 0,
      'CoFounder Shares' : u.cofounderShares   || 0,
      'Total Referrals'  : u.referralCount     || 0,
      State              : u.location?.state   || '',
      City               : u.location?.city    || '',
      'Join Date'        : u.createdAt,
    }));

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id, action: 'EXPORT_LEADERBOARD',
        details: { filters, recordCount: csvData.length },
        ipAddress: req.ip, userAgent: req.get('User-Agent'),
      });
    }

    res.json({ success: true, data: csvData, total_records: csvData.length,
      exported_at: new Date().toISOString() });
  } catch (error) {
    console.error('Error exporting leaderboard:', error);
    res.status(500).json({ success: false, message: 'Failed to export leaderboard' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC TIME-BASED LEADERBOARD HANDLERS  (routes preserved)
// ─────────────────────────────────────────────────────────────────────────────

const makeTimeHandler = (timeFrame) => async (req, res) => {
  try {
    const limit      = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
    const filter     = req.query.filter || 'earnings';
    const leaderboard = await getTimeFilteredLeaderboard(timeFrame, filter, limit);
    res.status(200).json({ success: true, timeFrame, filter, leaderboard });
  } catch (error) {
    console.error(`Error fetching ${timeFrame} leaderboard:`, error);
    res.status(500).json({ success: false, message: `Failed to fetch ${timeFrame} leaderboard`,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

exports.getDailyLeaderboard   = makeTimeHandler('daily');
exports.getWeeklyLeaderboard  = makeTimeHandler('weekly');
exports.getMonthlyLeaderboard = makeTimeHandler('monthly');
exports.getYearlyLeaderboard  = makeTimeHandler('yearly');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CATEGORY LEADERBOARD HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

exports.getLeaderboard = async (req, res) => {
  try {
    const filter      = req.query.filter    || 'registration';
    const timeFrame   = req.query.timeFrame || null;
    const limit       = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
    const leaderboard = timeFrame
      ? await getTimeFilteredLeaderboard(timeFrame, filter, limit)
      : await getFilteredLeaderboard(filter, limit);

    res.status(200).json({ success: true, filter, timeFrame: timeFrame || 'all-time', leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

const makeCategoryHandler = (categoryFilter) => async (req, res) => {
  try {
    const limit       = req.query.limit ? parseInt(req.query.limit) : Number.MAX_SAFE_INTEGER;
    const leaderboard = await getFilteredLeaderboard(categoryFilter, limit);
    res.status(200).json({ success: true, filter: categoryFilter, leaderboard });
  } catch (error) {
    console.error(`Error fetching ${categoryFilter} leaderboard:`, error);
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

exports.getRegistrationLeaderboard = makeCategoryHandler('registration');
exports.getReferralLeaderboard      = makeCategoryHandler('referrals');
exports.getSpendingLeaderboard      = makeCategoryHandler('spending');
exports.getEarningsLeaderboard      = makeCategoryHandler('earnings');
exports.getSharesLeaderboard        = makeCategoryHandler('shares');

// ─────────────────────────────────────────────────────────────────────────────
// CO-FOUNDER LEADERBOARD (V2)
// ─────────────────────────────────────────────────────────────────────────────

exports.getCofounderLeaderboard = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    // Aggregate completed co-founder transactions from TransactionV2
    const txAgg = await TransactionV2.aggregate([
      { $match: { type: 'co-founder', status: 'completed' } },
      {
        $group: {
          _id                  : '$userId',
          totalCofounderShares : { $sum: '$shares'       },
          cofounderOwnershipPct: { $sum: '$ownershipPct' },
          totalEarningKobo     : { $sum: '$earningKobo'  },
          transactionCount     : { $sum: 1              },
        },
      },
      { $sort: { totalCofounderShares: -1 } },
      { $limit: limit },
    ]);

    if (!txAgg.length) {
      return res.json({ success: true, data: [], pagination: { totalItems: 0 }, filter: 'co-founder' });
    }

    const userIds = txAgg.map((t) => t._id);
    const users   = await User.find(
      { _id: { $in: userIds }, 'status.isActive': true, isBanned: { $ne: true } },
      { name: 1, userName: 1, createdAt: 1, 'location.state': 1, 'location.city': 1 },
    ).lean();
    const userMap = {};
    for (const u of users) userMap[u._id.toString()] = u;

    // Also pull regular shares for context
    const regularAgg = await TransactionV2.aggregate([
      { $match: { type: { $ne: 'co-founder' }, status: 'completed', userId: { $in: userIds } } },
      { $group: { _id: '$userId', regularShares: { $sum: '$shares' } } },
    ]);
    const regularMap = {};
    for (const r of regularAgg) regularMap[r._id.toString()] = r.regularShares || 0;

    // Referral earnings for context
    const refAgg = await Referral.aggregate([
      { $match: { user: { $in: userIds } } },
      { $project: { user: 1, totalEarnings: 1 } },
    ]);
    const refMap = {};
    for (const r of refAgg) refMap[r.user.toString()] = r.totalEarnings || 0;

    const cofounders = txAgg
      .filter((t) => userMap[t._id.toString()])
      .map((t, i) => {
        const uid  = t._id.toString();
        const user = userMap[uid];
        return {
          _id                     : t._id,
          name                    : user.name,
          userName                : user.userName,
          createdAt               : user.createdAt,
          'location.state'        : user.location?.state,
          'location.city'         : user.location?.city,
          totalCofounderShares    : t.totalCofounderShares,
          cofounderOwnershipPct   : t.cofounderOwnershipPct,
          cofounderOwnershipFormatted: `${(t.cofounderOwnershipPct * 100).toFixed(6)}%`,
          totalEarningKobo        : t.totalEarningKobo,
          regularShares           : regularMap[uid] || 0,
          totalEarnings           : refMap[uid]     || 0,
          transactionCount        : t.transactionCount,
          rank                    : i + 1,
        };
      });

    res.json({
      success: true,
      data   : cofounders,
      pagination: {
        currentPage: 1, totalPages: 1, totalItems: cofounders.length,
        hasNext: false, hasPrev: false, limit,
      },
      filter: 'co-founder',
    });
  } catch (error) {
    console.error('Error fetching cofounder leaderboard:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch cofounder leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// VISIBILITY SETTINGS  (unchanged logic, kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────

exports.getVisibilitySettings = async (req, res) => {
  try {
    let settings = await AdminSettings.findOne();
    if (!settings) {
      settings = await AdminSettings.create({ showEarnings: true, showAvailableBalance: true, updatedBy: req.user._id });
    }
    res.json({ success: true, data: { showEarnings: settings.showEarnings,
      showAvailableBalance: settings.showAvailableBalance,
      lastUpdated: settings.updatedAt, updatedBy: settings.updatedBy } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch visibility settings' });
  }
};

const makeVisibilityToggle = (field) => async (req, res) => {
  try {
    const { visible } = req.body;
    if (typeof visible !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Visible field must be a boolean' });
    }

    let settings = await AdminSettings.findOne();
    const update = { [field]: visible, updatedBy: req.user._id };
    if (!settings) {
      settings = new AdminSettings({ showEarnings: true, showAvailableBalance: true, ...update });
    } else {
      Object.assign(settings, update);
    }
    await settings.save();
    invalidateCache();

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id, action: `TOGGLE_${field.toUpperCase()}_VISIBILITY`,
        details: { visible, previousValue: !visible }, ipAddress: req.ip, userAgent: req.get('User-Agent'),
      });
    }

    const label = field === 'showEarnings' ? 'Earnings' : 'Balance';
    res.json({ success: true, message: `${label} visibility ${visible ? 'enabled' : 'disabled'}`,
      data: { showEarnings: settings.showEarnings, showAvailableBalance: settings.showAvailableBalance } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to toggle visibility' });
  }
};

exports.toggleEarningsVisibility = makeVisibilityToggle('showEarnings');
exports.toggleBalanceVisibility   = makeVisibilityToggle('showAvailableBalance');

exports.updateVisibilitySettings = async (req, res) => {
  try {
    const { showEarnings, showAvailableBalance } = req.body;
    if (typeof showEarnings !== 'boolean' || typeof showAvailableBalance !== 'boolean') {
      return res.status(400).json({ success: false,
        message: 'Both showEarnings and showAvailableBalance must be boolean values' });
    }

    let settings = await AdminSettings.findOne();
    const update = { showEarnings, showAvailableBalance, updatedBy: req.user._id };
    if (!settings) settings = new AdminSettings(update);
    else Object.assign(settings, update);
    await settings.save();
    invalidateCache();

    if (AdminAuditLog) {
      await AdminAuditLog.create({
        adminId: req.user._id, action: 'UPDATE_VISIBILITY_SETTINGS',
        details: { showEarnings, showAvailableBalance },
        ipAddress: req.ip, userAgent: req.get('User-Agent'),
      });
    }

    res.json({ success: true, message: 'Visibility settings updated successfully',
      data: { showEarnings: settings.showEarnings, showAvailableBalance: settings.showAvailableBalance } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update visibility settings' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC ROUTES  (V2-aware)
// ─────────────────────────────────────────────────────────────────────────────

exports.diagnoseCofounderData = async (req, res) => {
  try {
    const diagnostics = {};

    const completedTxs = await TransactionV2.find({ type: 'co-founder', status: 'completed' })
      .select('userId shares totalAmount currency createdAt transactionId')
      .populate('userId', 'name userName')
      .limit(20).lean();

    diagnostics.v2CofounderTransactions = {
      count : completedTxs.length,
      sample: completedTxs.map((t) => ({
        transactionId: t.transactionId,
        userId       : t.userId?._id,
        userName     : t.userId?.userName,
        shares       : t.shares,
        amount       : t.totalAmount,
      })),
    };

    const snapshots = await UserShareV2.find({ cofounderOwnershipPct: { $gt: 0 } })
      .select('user totalOwnershipPct cofounderOwnershipPct totalEarningKobo').limit(10).lean();

    diagnostics.v2Snapshots = { count: snapshots.length, sample: snapshots };

    res.json({ success: true, diagnostics });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Diagnostics failed', error: error.message });
  }
};

exports.diagnoseCofounderDataDetailed = async (req, res) => {
  try {
    const allTxs = await TransactionV2.find({ type: 'co-founder' })
      .populate('userId', 'name userName')
      .sort({ createdAt: -1 })
      .lean();

    const byStatus = allTxs.reduce((acc, t) => { acc[t.status] = (acc[t.status] || 0) + 1; return acc; }, {});

    const completedByUser = await TransactionV2.aggregate([
      { $match: { type: 'co-founder', status: 'completed' } },
      { $group: { _id: '$userId', totalShares: { $sum: '$shares' },
          totalOwnershipPct: { $sum: '$ownershipPct' }, transactionCount: { $sum: 1 } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $project: { userId: '$_id', userName: { $arrayElemAt: ['$user.userName', 0] },
          name: { $arrayElemAt: ['$user.name', 0] }, totalShares: 1, totalOwnershipPct: 1,
          transactionCount: 1 } },
    ]);

    res.json({
      success    : true,
      diagnostics: {
        allTransactions: { total: allTxs.length, byStatus,
          details: allTxs.map((t) => ({
            transactionId: t.transactionId, userId: t.userId?._id,
            userName: t.userId?.userName, shares: t.shares, status: t.status, date: t.createdAt,
          })) },
        completedByUser: { userCount: completedByUser.length,
          totalShares: completedByUser.reduce((s, u) => s + u.totalShares, 0),
          users: completedByUser },
      },
      summary: {
        totalTransactions                   : allTxs.length,
        completedTransactions               : byStatus.completed || 0,
        uniqueUsersWithCompletedTransactions: completedByUser.length,
        shouldShowInLeaderboard             : completedByUser.length,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Diagnostics failed', error: error.message });
  }
};

exports.diagnoseCofounderUserStatus = async (req, res) => {
  try {
    const uniqueUserIds = await TransactionV2.distinct('userId', { type: 'co-founder', status: 'completed' });

    const userDetails = await User.find({ _id: { $in: uniqueUserIds } })
      .select('name userName status.isActive isBanned isSuspended createdAt').lean();

    const filterResults = userDetails.map((u) => {
      const isActive  = u.status?.isActive === true;
      const notBanned = u.isBanned !== true;
      const passes    = isActive && notBanned;
      return { _id: u._id, name: u.name, userName: u.userName,
        status: { isActive: u.status?.isActive, isBanned: u.isBanned, isSuspended: u.isSuspended },
        passesFilter: passes, reason: !passes ? (!isActive ? 'Not active' : 'Is banned') : 'Passes all filters' };
    });

    res.json({ success: true, analysis: { totalUsersWithTransactions: uniqueUserIds.length,
      userFilterResults: filterResults,
      summary: { usersPassingFilter: filterResults.filter((u) => u.passesFilter).length,
        usersFailingFilter: filterResults.filter((u) => !u.passesFilter).length,
        reasonsForFailure: filterResults.filter((u) => !u.passesFilter)
          .map((u) => ({ user: u.userName, reason: u.reason })) } } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Diagnostic failed', error: error.message });
  }
};

exports.getCofounderLeaderboardDebug = async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;

    const txAgg = await TransactionV2.aggregate([
      { $match: { type: 'co-founder', status: 'completed' } },
      { $group: { _id: '$userId', totalCofounderShares: { $sum: '$shares' },
          cofounderOwnershipPct: { $sum: '$ownershipPct' }, transactionCount: { $sum: 1 },
          transactions: { $push: { shares: '$shares', amount: '$totalAmount',
            status: '$status', transactionId: '$transactionId', date: '$createdAt' } } } },
      { $sort: { totalCofounderShares: -1 } },
      { $limit: limit },
    ]);

    const userIds = txAgg.map((t) => t._id);
    const users   = await User.find({ _id: { $in: userIds } },
      { name: 1, userName: 1, 'status.isActive': 1, isBanned: 1, isSuspended: 1 }).lean();
    const userMap = {};
    for (const u of users) userMap[u._id.toString()] = u;

    const all = txAgg.map((t, i) => {
      const u = userMap[t._id.toString()] || {};
      const passes = u.status?.isActive === true && u.isBanned !== true;
      return { _id: t._id, name: u.name, userName: u.userName,
        totalCofounderShares: t.totalCofounderShares, cofounderOwnershipPct: t.cofounderOwnershipPct,
        transactionCount: t.transactionCount, transactionDetails: t.transactions,
        'status.isActive': u.status?.isActive, isBanned: u.isBanned, isSuspended: u.isSuspended,
        wouldPassNormalFilter: passes, rank: i + 1 };
    });

    const active   = all.filter((u) => u.wouldPassNormalFilter);
    const inactive = all.filter((u) => !u.wouldPassNormalFilter);

    res.json({ success: true, debug: true, data: all,
      analysis: { totalFound: all.length, activeCount: active.length,
        inactiveCount: inactive.length,
        inactiveUsers: inactive.map((u) => ({ _id: u._id, name: u.name, userName: u.userName,
          isActive: u['status.isActive'], isBanned: u.isBanned, totalShares: u.totalCofounderShares,
          reason: !u['status.isActive'] ? 'Not active' : 'Is banned' })) },
      pagination: { currentPage: 1, totalPages: 1, totalItems: all.length,
        hasNext: false, hasPrev: false, limit },
      filter: 'cofounder-debug' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch debug leaderboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
};

exports.fixInactiveCofounderUsers = async (req, res) => {
  try {
    const admin = await User.findById(req.user.id);
    if (!admin || !admin.isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized: Admin access required' });
    }

    const uniqueUserIds = await TransactionV2.distinct('userId', { type: 'co-founder', status: 'completed' });

    const inactiveUsers = await User.find({
      _id : { $in: uniqueUserIds },
      $or : [{ 'status.isActive': { $ne: true } }, { isBanned: true }],
    }).select('name userName status isBanned');

    if (!inactiveUsers.length) {
      return res.json({ success: true, message: 'All co-founder users are already active', inactiveUsers: [] });
    }

    const updateResult = await User.updateMany(
      { _id: { $in: inactiveUsers.map((u) => u._id) } },
      { $set: { 'status.isActive': true, isBanned: false } },
    );

    res.json({ success: true, message: `Fixed ${updateResult.modifiedCount} inactive co-founder users`,
      inactiveUsers: inactiveUsers.map((u) => ({
        id: u._id, name: u.name, userName: u.userName,
        wasActive: u.status?.isActive, wasBanned: u.isBanned,
      })), updateResult });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fix inactive users', error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// LOCATION ANALYTICS FIXED  (exported for any direct usage)
// ─────────────────────────────────────────────────────────────────────────────
exports.getLocationAnalyticsFixed = getLocationAnalytics;