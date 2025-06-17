// validation/adminValidation.js - COMPLETE IMPLEMENTATION
const Joi = require('joi');

// ====================
// CORE VALIDATION SCHEMAS
// ====================

// Schema for leaderboard query parameters
const leaderboardQuerySchema = Joi.object({
  type: Joi.string().valid('earners', 'shares', 'referrals', 'cofounders').default('earners'),
  period: Joi.string().valid('all_time', 'daily', 'weekly', 'monthly').default('all_time'),
  limit: Joi.number().integer().min(1).max(1000).default(50),
  offset: Joi.number().integer().min(0).default(0),
  state: Joi.string().trim().allow('').optional(),
  city: Joi.string().trim().allow('').optional(),
  search: Joi.string().trim().allow('').optional(),
  status: Joi.string().valid('active', 'inactive', 'banned', 'all').default('active'),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
  minEarnings: Joi.number().min(0).optional(),
  maxEarnings: Joi.number().min(Joi.ref('minEarnings')).optional(),
  minBalance: Joi.number().min(0).optional(),
  maxBalance: Joi.number().min(Joi.ref('minBalance')).optional(),
  sortBy: Joi.string().valid('name', 'earnings', 'balance', 'shares', 'referrals', 'joinDate', 'state', 'city').default('earnings'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  show_earnings: Joi.boolean().default(true),
  show_balance: Joi.boolean().default(true)
}).options({ allowUnknown: true, stripUnknown: true });

// Schema for visibility update requests
const visibilityUpdateSchema = Joi.object({
  field: Joi.string().valid('earnings', 'balance').required(),
  visible: Joi.boolean().required()
}).required();

// Schema for bulk visibility updates
const bulkVisibilityUpdateSchema = Joi.object({
  userIds: Joi.array().items(Joi.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(100).required(),
  field: Joi.string().valid('earnings', 'balance').required(),
  visible: Joi.boolean().required()
}).required();

// Schema for bulk user updates (legacy support)
const bulkUpdateSchema = Joi.object({
  user_ids: Joi.array().items(Joi.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(100).required(),
  updates: Joi.object({
    'earnings.visible': Joi.boolean().optional(),
    'availableBalance.visible': Joi.boolean().optional(),
    'status.isActive': Joi.boolean().optional(),
    isBanned: Joi.boolean().optional()
  }).min(1).required()
}).required();

// Schema for location analytics
const locationAnalyticsSchema = Joi.object({
  type: Joi.string().valid('states', 'cities').default('states'),
  state: Joi.string().trim().when('type', {
    is: 'cities',
    then: Joi.optional(),
    otherwise: Joi.forbidden()
  }),
  limit: Joi.number().integer().min(1).max(50).default(10),
  status: Joi.string().valid('active', 'inactive', 'banned', 'all').default('active'),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional()
}).options({ allowUnknown: true, stripUnknown: true });

// Schema for export parameters
const exportSchema = Joi.object({
  type: Joi.string().valid('earners', 'shares', 'referrals', 'cofounders').default('earners'),
  period: Joi.string().valid('all_time', 'daily', 'weekly', 'monthly').default('all_time'),
  state: Joi.string().trim().allow('').optional(),
  city: Joi.string().trim().allow('').optional(),
  status: Joi.string().valid('active', 'inactive', 'banned', 'all').default('active'),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
  minEarnings: Joi.number().min(0).optional(),
  maxEarnings: Joi.number().min(Joi.ref('minEarnings')).optional(),
  minBalance: Joi.number().min(0).optional(),
  maxBalance: Joi.number().min(Joi.ref('minBalance')).optional(),
  sortBy: Joi.string().valid('name', 'earnings', 'balance', 'shares', 'referrals', 'joinDate', 'state', 'city').default('earnings'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc')
}).options({ allowUnknown: true, stripUnknown: true });

// Schema for statistics query parameters
const statsQuerySchema = Joi.object({
  status: Joi.string().valid('active', 'inactive', 'banned', 'all').default('active'),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
  state: Joi.string().trim().allow('').optional(),
  city: Joi.string().trim().allow('').optional()
}).options({ allowUnknown: true, stripUnknown: true });

// Schema for public leaderboard queries
const publicLeaderboardSchema = Joi.object({
  type: Joi.string().valid('earners', 'shares', 'referrals', 'cofounders').default('earners'),
  period: Joi.string().valid('all_time', 'daily', 'weekly', 'monthly').default('all_time'),
  limit: Joi.number().integer().min(1).max(100).default(50),
  offset: Joi.number().integer().min(0).default(0),
  state: Joi.string().trim().allow('').optional(),
  city: Joi.string().trim().allow('').optional(),
  search: Joi.string().trim().allow('').optional(),
  sortBy: Joi.string().valid('name', 'earnings', 'balance', 'shares', 'referrals', 'joinDate', 'state', 'city').default('earnings'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc')
}).options({ allowUnknown: true, stripUnknown: true });

// Rate limiting validation
const rateLimitSchema = Joi.object({
  windowMs: Joi.number().integer().min(1000).max(3600000).default(900000), // 15 minutes default
  maxRequests: Joi.number().integer().min(1).max(1000).default(100)
}).options({ allowUnknown: false });

// Export format validation
const exportFormatSchema = Joi.object({
  format: Joi.string().valid('json', 'csv', 'xlsx').default('json'),
  includeHeaders: Joi.boolean().default(true),
  dateFormat: Joi.string().valid('iso', 'us', 'eu').default('iso'),
  fields: Joi.array().items(
    Joi.string().valid(
      'rank', 'name', 'userName', 'email', 'totalEarnings', 'availableBalance',
      'totalShares', 'totalReferrals', 'state', 'city', 'status', 'joinDate'
    )
  ).optional()
}).options({ allowUnknown: false });

// Activity logging schema
const activityLogSchema = Joi.object({
  action: Joi.string().required(),
  targetUserId: Joi.string().regex(/^[0-9a-fA-F]{24}$/).optional(),
  details: Joi.object().optional(),
  ipAddress: Joi.string().ip().optional(),
  userAgent: Joi.string().max(500).optional()
});

// ====================
// ADVANCED VALIDATION SCHEMAS
// ====================

// Schema for batch operations
const batchOperationSchema = Joi.object({
  operation: Joi.string().valid(
    'activate', 'deactivate', 'ban', 'unban', 
    'hide_earnings', 'show_earnings', 'hide_balance', 'show_balance',
    'reset_password', 'send_notification', 'update_tier'
  ).required(),
  userIds: Joi.array().items(Joi.string().regex(/^[0-9a-fA-F]{24}$/)).min(1).max(500).required(),
  reason: Joi.string().min(3).max(500).when('operation', {
    is: Joi.string().valid('ban', 'unban'),
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  options: Joi.object({
    sendNotification: Joi.boolean().default(false),
    notificationMessage: Joi.string().max(1000).optional(),
    scheduledDate: Joi.date().iso().min('now').optional(),
    priority: Joi.string().valid('low', 'medium', 'high').default('medium')
  }).optional()
}).required();

// Schema for report generation
const reportGenerationSchema = Joi.object({
  reportType: Joi.string().valid(
    'summary', 'detailed', 'trend', 'comparison', 
    'visibility_audit', 'performance_analysis', 'user_activity'
  ).required(),
  dateFrom: Joi.date().iso().optional(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')).optional(),
  filters: Joi.object({
    states: Joi.array().items(Joi.string()).optional(),
    cities: Joi.array().items(Joi.string()).optional(),
    userTiers: Joi.array().items(Joi.string().valid('bronze', 'silver', 'gold', 'platinum')).optional(),
    minEarnings: Joi.number().min(0).optional(),
    maxEarnings: Joi.number().min(Joi.ref('minEarnings')).optional(),
    includeInactive: Joi.boolean().default(false),
    includeBanned: Joi.boolean().default(false)
  }).optional(),
  format: Joi.string().valid('json', 'csv', 'pdf', 'excel').default('json'),
  groupBy: Joi.string().valid('state', 'city', 'tier', 'month', 'quarter').optional(),
  includeCharts: Joi.boolean().default(false)
}).required();

// Schema for API key creation
const apiKeySchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  description: Joi.string().max(500).optional(),
  permissions: Joi.array().items(
    Joi.string().valid(
      'read_public', 'read_admin', 'write_visibility', 
      'export_data', 'manage_users', 'view_analytics',
      'generate_reports', 'manage_cache'
    )
  ).min(1).required(),
  expiresAt: Joi.date().iso().min('now').optional(),
  ipWhitelist: Joi.array().items(Joi.string().ip()).optional(),
  rateLimit: Joi.object({
    requestsPerHour: Joi.number().integer().min(1).max(10000).default(1000),
    requestsPerDay: Joi.number().integer().min(1).max(100000).default(10000)
  }).optional(),
  environment: Joi.string().valid('development', 'staging', 'production').default('development')
}).required();

// Schema for webhook configuration
const webhookConfigSchema = Joi.object({
  url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
  events: Joi.array().items(
    Joi.string().valid(
      'position_change', 'new_leader', 'visibility_change', 
      'user_banned', 'milestone_reached', 'earnings_threshold',
      'suspicious_activity', 'data_export'
    )
  ).min(1).required(),
  secret: Joi.string().min(16).max(256).optional(),
  headers: Joi.object().pattern(
    Joi.string().regex(/^[a-zA-Z0-9\-_]+$/),
    Joi.string().max(1000)
  ).optional(),
  retryPolicy: Joi.object({
    maxRetries: Joi.number().integer().min(0).max(10).default(3),
    retryDelay: Joi.number().integer().min(1000).max(300000).default(5000), // 5 seconds
    backoffMultiplier: Joi.number().min(1).max(5).default(2)
  }).optional(),
  isActive: Joi.boolean().default(true),
  timeout: Joi.number().integer().min(1000).max(30000).default(15000) // 15 seconds
}).required();

// Schema for alert configuration
const alertConfigSchema = Joi.object({
  name: Joi.string().min(3).max(100).required(),
  description: Joi.string().max(500).optional(),
  type: Joi.string().valid(
    'position_change', 'anomaly_detection', 'threshold_breach',
    'suspicious_activity', 'system_performance', 'data_integrity'
  ).required(),
  conditions: Joi.object({
    metric: Joi.string().valid('earnings', 'referrals', 'shares', 'position', 'activity').required(),
    operator: Joi.string().valid('gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'change_gt', 'change_lt').required(),
    value: Joi.number().required(),
    timeWindow: Joi.string().valid('5m', '15m', '1h', '6h', '24h', '7d').default('1h')
  }).required(),
  severity: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
  notifications: Joi.object({
    email: Joi.boolean().default(false),
    webhook: Joi.boolean().default(false),
    dashboard: Joi.boolean().default(true)
  }).optional(),
  isActive: Joi.boolean().default(true)
}).required();

// Schema for maintenance tasks
const maintenanceTaskSchema = Joi.object({
  task: Joi.string().valid(
    'recalculate_rankings', 'fix_inconsistencies', 'update_statistics',
    'cleanup_old_data', 'rebuild_cache', 'verify_data_integrity',
    'optimize_database', 'archive_old_snapshots'
  ).required(),
  options: Joi.object({
    dryRun: Joi.boolean().default(true),
    batchSize: Joi.number().integer().min(100).max(10000).default(1000),
    maxRuntime: Joi.number().integer().min(60).max(3600).default(1800), // 30 minutes
    priority: Joi.string().valid('low', 'medium', 'high').default('medium'),
    notifyOnCompletion: Joi.boolean().default(true),
    backupBeforeRun: Joi.boolean().default(true)
  }).optional(),
  scheduledAt: Joi.date().iso().min('now').optional()
}).required();

// Schema for advanced search
const advancedSearchSchema = Joi.object({
  query: Joi.string().min(1).max(200).optional(),
  filters: Joi.object({
    userTiers: Joi.array().items(Joi.string()).optional(),
    registrationDate: Joi.object({
      from: Joi.date().iso().optional(),
      to: Joi.date().iso().min(Joi.ref('from')).optional()
    }).optional(),
    lastActivity: Joi.object({
      from: Joi.date().iso().optional(),
      to: Joi.date().iso().min(Joi.ref('from')).optional()
    }).optional(),
    earningsRange: Joi.object({
      min: Joi.number().min(0).optional(),
      max: Joi.number().min(Joi.ref('min')).optional()
    }).optional(),
    balanceRange: Joi.object({
      min: Joi.number().min(0).optional(),
      max: Joi.number().min(Joi.ref('min')).optional()
    }).optional(),
    location: Joi.object({
      states: Joi.array().items(Joi.string()).optional(),
      cities: Joi.array().items(Joi.string()).optional(),
      radius: Joi.object({
        lat: Joi.number().min(-90).max(90).required(),
        lng: Joi.number().min(-180).max(180).required(),
        distance: Joi.number().min(1).max(1000).required() // km
      }).optional()
    }).optional(),
    flags: Joi.object({
      hasHiddenEarnings: Joi.boolean().optional(),
      hasHiddenBalance: Joi.boolean().optional(),
      isVerified: Joi.boolean().optional(),
      hasSuspiciousActivity: Joi.boolean().optional()
    }).optional()
  }).optional(),
  sortBy: Joi.string().valid(
    'relevance', 'earnings', 'balance', 'shares', 'referrals',
    'joinDate', 'lastActivity', 'name', 'location'
  ).default('relevance'),
  sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  limit: Joi.number().integer().min(1).max(1000).default(50),
  offset: Joi.number().integer().min(0).default(0),
  includeInactive: Joi.boolean().default(false),
  includeBanned: Joi.boolean().default(false),
  highlightTerms: Joi.boolean().default(true)
}).options({ allowUnknown: false });

// ====================
// UTILITY FUNCTIONS
// ====================

// Build date range filter
const buildDateFilter = (dateFrom, dateTo, field = 'createdAt') => {
  const filter = {};
  if (dateFrom || dateTo) {
    filter[field] = {};
    if (dateFrom) {
      filter[field].$gte = new Date(dateFrom);
    }
    if (dateTo) {
      const endDate = new Date(dateTo);
      endDate.setHours(23, 59, 59, 999);
      filter[field].$lte = endDate;
    }
  }
  return filter;
};

// Build earnings filter
const buildEarningsFilter = (minEarnings, maxEarnings) => {
  const filter = {};
  if (minEarnings !== undefined || maxEarnings !== undefined) {
    filter['earnings.total'] = {};
    if (minEarnings !== undefined) {
      filter['earnings.total'].$gte = parseFloat(minEarnings);
    }
    if (maxEarnings !== undefined) {
      filter['earnings.total'].$lte = parseFloat(maxEarnings);
    }
  }
  return filter;
};

// Build balance filter
const buildBalanceFilter = (minBalance, maxBalance) => {
  const filter = {};
  if (minBalance !== undefined || maxBalance !== undefined) {
    filter['availableBalance.amount'] = {};
    if (minBalance !== undefined) {
      filter['availableBalance.amount'].$gte = parseFloat(minBalance);
    }
    if (maxBalance !== undefined) {
      filter['availableBalance.amount'].$lte = parseFloat(maxBalance);
    }
  }
  return filter;
};

// Build search filter for name
const buildSearchFilter = (search) => {
  if (!search) return {};
  
  return {
    $or: [
      { name: { $regex: search.trim(), $options: 'i' } },
      { userName: { $regex: search.trim(), $options: 'i' } }
    ]
  };
};

// Build location filter
const buildLocationFilter = (state, city) => {
  const filter = {};
  if (state) {
    filter['location.state'] = { $regex: state.trim(), $options: 'i' };
  }
  if (city) {
    filter['location.city'] = { $regex: city.trim(), $options: 'i' };
  }
  return filter;
};

// Build status filter
const buildStatusFilter = (status) => {
  const filter = {};
  switch (status) {
    case 'active':
      filter['status.isActive'] = true;
      filter.isBanned = { $ne: true };
      break;
    case 'inactive':
      filter['status.isActive'] = false;
      break;
    case 'banned':
      filter.isBanned = true;
      break;
    case 'all':
    default:
      break;
  }
  return filter;
};

// Pagination validation helper
const validatePagination = (limit, offset, maxLimit = 1000) => {
  const errors = [];
  
  if (limit !== undefined) {
    const parsedLimit = parseInt(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > maxLimit) {
      errors.push(`Limit must be between 1 and ${maxLimit}`);
    }
  }
  
  if (offset !== undefined) {
    const parsedOffset = parseInt(offset);
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      errors.push('Offset must be a non-negative integer');
    }
  }
  
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
};

// Search query sanitization
const sanitizeSearchQuery = (search) => {
  if (!search || typeof search !== 'string') return '';
  
  return search
    .trim()
    .replace(/[<>'"&]/g, '') // Remove HTML/script injection chars
    .replace(/[{}[\]\\]/g, '') // Remove regex special chars
    .substring(0, 100); // Limit to 100 characters
};

// Location validation helper
const validateLocation = (state, city) => {
  const errors = [];
  
  if (state && typeof state === 'string') {
    if (state.length > 50) {
      errors.push('State name cannot exceed 50 characters');
    }
    if (!/^[a-zA-Z\s\-']+$/.test(state)) {
      errors.push('State name contains invalid characters');
    }
  }
  
  if (city && typeof city === 'string') {
    if (city.length > 50) {
      errors.push('City name cannot exceed 50 characters');
    }
    if (!/^[a-zA-Z\s\-']+$/.test(city)) {
      errors.push('City name contains invalid characters');
    }
  }
  
  return errors.length > 0 ? { valid: false, errors } : { valid: true };
};

// Enhanced user ID validation with batch support
const validateUserIds = (userIds) => {
  if (!Array.isArray(userIds)) {
    return { valid: false, error: 'User IDs must be provided as an array' };
  }
  
  if (userIds.length === 0) {
    return { valid: false, error: 'At least one user ID must be provided' };
  }
  
  if (userIds.length > 500) {
    return { valid: false, error: 'Cannot process more than 500 user IDs at once' };
  }
  
  const invalidIds = [];
  const duplicateIds = new Set();
  const seenIds = new Set();
  
  for (const id of userIds) {
    if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
      invalidIds.push(id);
    } else if (seenIds.has(id)) {
      duplicateIds.add(id);
    } else {
      seenIds.add(id);
    }
  }
  
  if (invalidIds.length > 0) {
    return { 
      valid: false, 
      error: `Invalid user ID format: ${invalidIds.slice(0, 5).join(', ')}${invalidIds.length > 5 ? '...' : ''}` 
    };
  }
  
  if (duplicateIds.size > 0) {
    return { 
      valid: false, 
      error: `Duplicate user IDs found: ${Array.from(duplicateIds).slice(0, 5).join(', ')}` 
    };
  }
  
  return { valid: true };
};

// Custom date range validation
const validateDateRange = (dateFrom, dateTo) => {
  if (!dateFrom && !dateTo) return { valid: true };
  
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(dateTo) : null;
  
  if (from && isNaN(from.getTime())) {
    return { valid: false, error: 'Invalid dateFrom format' };
  }
  
  if (to && isNaN(to.getTime())) {
    return { valid: false, error: 'Invalid dateTo format' };
  }
  
  if (from && to && from > to) {
    return { valid: false, error: 'dateFrom cannot be after dateTo' };
  }
  
  const now = new Date();
  const maxFutureDate = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
  
  if (from && from > maxFutureDate) {
    return { valid: false, error: 'dateFrom cannot be more than 1 year in the future' };
  }
  
  if (to && to > maxFutureDate) {
    return { valid: false, error: 'dateTo cannot be more than 1 year in the future' };
  }
  
  return { valid: true };
};

// Custom earnings/balance range validation
const validateNumberRange = (min, max, fieldName) => {
  if (min === undefined && max === undefined) return { valid: true };
  
  if (min !== undefined && (isNaN(min) || min < 0)) {
    return { valid: false, error: `${fieldName} minimum must be a non-negative number` };
  }
  
  if (max !== undefined && (isNaN(max) || max < 0)) {
    return { valid: false, error: `${fieldName} maximum must be a non-negative number` };
  }
  
  if (min !== undefined && max !== undefined && min > max) {
    return { valid: false, error: `${fieldName} minimum cannot be greater than maximum` };
  }
  
  const maxReasonableValue = 1000000000;
  if (min !== undefined && min > maxReasonableValue) {
    return { valid: false, error: `${fieldName} minimum exceeds reasonable limit` };
  }
  
  if (max !== undefined && max > maxReasonableValue) {
    return { valid: false, error: `${fieldName} maximum exceeds reasonable limit` };
  }
  
  return { valid: true };
};

// ====================
// BASIC VALIDATION MIDDLEWARE
// ====================

// Validation middleware functions
const validateLeaderboardQuery = (req, res, next) => {
  const { error, value } = leaderboardQuerySchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  req.validatedQuery = value;
  next();
};

const validateVisibilityUpdate = (req, res, next) => {
  const { error, value } = visibilityUpdateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request body',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  req.validatedBody = value;
  next();
};

const validateBulkVisibilityUpdate = (req, res, next) => {
  const { error, value } = bulkVisibilityUpdateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request body',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  req.validatedBody = value;
  next();
};

const validateLocationAnalytics = (req, res, next) => {
  const { error, value } = locationAnalyticsSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  req.validatedQuery = value;
  next();
};

const validateExportQuery = (req, res, next) => {
  const { error, value } = exportSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  req.validatedQuery = value;
  next();
};

const validateStatsQuery = (req, res, next) => {
  const { error, value } = statsQuerySchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  req.validatedQuery = value;
  next();
};

const validatePublicLeaderboard = (req, res, next) => {
  const { error, value } = publicLeaderboardSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid query parameters',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  req.validatedQuery = value;
  next();
};

// Additional validation helpers
const validateUserId = (req, res, next) => {
  const { userId } = req.params;
  const userIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/).required();
  
  const { error } = userIdSchema.validate(userId);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid user ID format',
      error: 'User ID must be a valid 24-character hexadecimal string'
    });
  }
  next();
};

// Advanced validation middleware that combines multiple checks
const validateAdvancedFilters = (req, res, next) => {
  const { dateFrom, dateTo, minEarnings, maxEarnings, minBalance, maxBalance } = req.query;
  
  // Validate date range
  const dateValidation = validateDateRange(dateFrom, dateTo);
  if (!dateValidation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid date range',
      error: dateValidation.error
    });
  }
  
  // Validate earnings range
  const earningsValidation = validateNumberRange(
    minEarnings ? parseFloat(minEarnings) : undefined,
    maxEarnings ? parseFloat(maxEarnings) : undefined,
    'Earnings'
  );
  if (!earningsValidation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid earnings range',
      error: earningsValidation.error
    });
  }
  
  // Validate balance range
  const balanceValidation = validateNumberRange(
    minBalance ? parseFloat(minBalance) : undefined,
    maxBalance ? parseFloat(maxBalance) : undefined,
    'Balance'
  );
  if (!balanceValidation.valid) {
    return res.status(400).json({
      success: false,
      message: 'Invalid balance range',
      error: balanceValidation.error
    });
  }
  
  next();
};

// Comprehensive filter validation middleware
const validateComprehensiveFilters = (req, res, next) => {
  const errors = [];
  
  // Validate pagination
  const paginationValidation = validatePagination(req.query.limit, req.query.offset);
  if (!paginationValidation.valid) {
    errors.push(...paginationValidation.errors);
  }
  
  // Validate and sanitize search
  if (req.query.search) {
    req.query.search = sanitizeSearchQuery(req.query.search);
  }
  
  // Validate location
  const locationValidation = validateLocation(req.query.state, req.query.city);
  if (!locationValidation.valid) {
    errors.push(...locationValidation.errors);
  }
  
  // Validate date range
  const dateValidation = validateDateRange(req.query.dateFrom, req.query.dateTo);
  if (!dateValidation.valid) {
    errors.push(dateValidation.error);
  }
  
  // Validate earnings range
  const earningsValidation = validateNumberRange(
    req.query.minEarnings ? parseFloat(req.query.minEarnings) : undefined,
    req.query.maxEarnings ? parseFloat(req.query.maxEarnings) : undefined,
    'Earnings'
  );
  if (!earningsValidation.valid) {
    errors.push(earningsValidation.error);
  }
  
  // Validate balance range
  const balanceValidation = validateNumberRange(
    req.query.minBalance ? parseFloat(req.query.minBalance) : undefined,
    req.query.maxBalance ? parseFloat(req.query.maxBalance) : undefined,
    'Balance'
  );
  if (!balanceValidation.valid) {
    errors.push(balanceValidation.error);
  }
  
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors
    });
  }
  
  next();
};

// Admin permission validation middleware
const validateAdminPermissions = (requiredPermissions = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!req.user.isAdmin && !req.user.role?.includes('admin')) {
      return res.status(403).json({
        success: false,
        message: 'Admin permissions required'
      });
    }
    
    // Check specific permissions if provided
    if (requiredPermissions.length > 0 && req.user.permissions) {
      const hasPermission = requiredPermissions.some(permission => 
        req.user.permissions.includes(permission)
      );
      
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: `Required permissions: ${requiredPermissions.join(', ')}`
        });
      }
    }
    
    next();
  };
};

// Enhanced bulk operation validation
const validateBulkOperation = (maxBatchSize = 100) => {
  return (req, res, next) => {
    const { userIds } = req.body;
    
    const validation = validateUserIds(userIds);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: validation.error
      });
    }
    
    if (userIds.length > maxBatchSize) {
      return res.status(400).json({
        success: false,
        message: `Batch size cannot exceed ${maxBatchSize} items`
      });
    }
    
    next();
  };
};

// Export format validation
const validateExportFormat = (req, res, next) => {
  const { error, value } = exportFormatSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid export format parameters',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }
  
  req.exportOptions = value;
  next();
};

// Request throttling validation
const validateRequestThrottling = (windowMs = 900000, maxRequests = 100) => {
  const requests = new Map();
  
  return (req, res, next) => {
    const clientId = req.user?._id || req.ip;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Clean up old requests
    if (requests.has(clientId)) {
      const userRequests = requests.get(clientId).filter(time => time > windowStart);
      requests.set(clientId, userRequests);
    } else {
      requests.set(clientId, []);
    }
    
    const userRequests = requests.get(clientId);
    
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests',
        retryAfter: Math.ceil((userRequests[0] + windowMs - now) / 1000)
      });
    }
    
    userRequests.push(now);
    next();
  };
};

// Data consistency validation
const validateDataConsistency = async (req, res, next) => {
  try {
    // Validate that referenced users exist if userIds are provided
    if (req.body.userIds && Array.isArray(req.body.userIds)) {
      // For now, just validate format - implement actual user existence check if needed
      const validation = validateUserIds(req.body.userIds);
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          message: validation.error
        });
      }
    }
    
    next();
  } catch (error) {
    console.error('Data consistency validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Data validation failed'
    });
  }
};

// ====================
// ADVANCED VALIDATION MIDDLEWARE
// ====================

// Validate batch operations
const validateBatchOperation = (req, res, next) => {
  const { error, value } = batchOperationSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid batch operation request',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        value: detail.context?.value
      }))
    });
  }
  
  // Additional validation for specific operations
  if (['ban', 'unban'].includes(value.operation) && !value.reason) {
    return res.status(400).json({
      success: false,
      message: 'Reason is required for ban/unban operations'
    });
  }
  
  req.validatedBody = value;
  next();
};

// Validate report generation
const validateReportGeneration = (req, res, next) => {
  const { error, value } = reportGenerationSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid report generation request',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }
  
  // Validate date range
  if (value.dateFrom && value.dateTo) {
    const diffDays = (new Date(value.dateTo) - new Date(value.dateFrom)) / (1000 * 60 * 60 * 24);
    if (diffDays > 365) {
      return res.status(400).json({
        success: false,
        message: 'Date range cannot exceed 365 days'
      });
    }
  }
  
  req.validatedBody = value;
  next();
};

// Validate API key creation
const validateApiKeyCreation = (req, res, next) => {
  const { error, value } = apiKeySchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid API key creation request',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }
  
  // Validate permission combinations
  const writePermissions = ['write_visibility', 'manage_users', 'manage_cache'];
  const hasWritePermissions = value.permissions.some(p => writePermissions.includes(p));
  
  if (hasWritePermissions && value.environment === 'production' && !value.ipWhitelist) {
    return res.status(400).json({
      success: false,
      message: 'IP whitelist is required for write permissions in production'
    });
  }
  
  req.validatedBody = value;
  next();
};

// Validate webhook configuration
const validateWebhookConfig = (req, res, next) => {
  const { error, value } = webhookConfigSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid webhook configuration',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }
  
  req.validatedBody = value;
  next();
};

// Validate alert configuration
const validateAlertConfig = (req, res, next) => {
  const { error, value } = alertConfigSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid alert configuration',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }
  
  req.validatedBody = value;
  next();
};

// Validate maintenance tasks
const validateMaintenanceTask = (req, res, next) => {
  const { error, value } = maintenanceTaskSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid maintenance task request',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }
  
  // Additional validation for destructive operations
  const destructiveOperations = ['cleanup_old_data', 'archive_old_snapshots'];
  if (destructiveOperations.includes(value.task) && !value.options?.dryRun) {
    return res.status(400).json({
      success: false,
      message: 'Destructive operations must be run with dryRun: true first'
    });
  }
  
  req.validatedBody = value;
  next();
};

// Validate advanced search
const validateAdvancedSearch = (req, res, next) => {
  const { error, value } = advancedSearchSchema.validate(req.query);
  if (error) {
    return res.status(400).json({
      success: false,
      message: 'Invalid search parameters',
      errors: error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    });
  }
  
  req.validatedQuery = value;
  next();
};

// ====================
// SECURITY VALIDATION HELPERS
// ====================

// Validate IP address access
const validateIpAccess = (allowedIps = []) => {
  return (req, res, next) => {
    if (allowedIps.length === 0) return next();
    
    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress;
    const isAllowed = allowedIps.some(ip => {
      if (ip.includes('/')) {
        // CIDR notation
        return isIpInCidr(clientIp, ip);
      }
      return ip === clientIp;
    });
    
    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        message: 'Access denied from this IP address'
      });
    }
    
    next();
  };
};

// Helper function to check if IP is in CIDR range
const isIpInCidr = (ip, cidr) => {
  // Simple CIDR check - in production, use a proper IP library
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - bits) - 1);
  return (ip2long(ip) & mask) === (ip2long(range) & mask);
};

const ip2long = (ip) => {
  return ip.split('.').reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet, 10), 0) >>> 0;
};

// Validate time-based access windows
const validateTimeWindow = (allowedWindows = []) => {
  return (req, res, next) => {
    if (allowedWindows.length === 0) return next();
    
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
    
    const isInWindow = allowedWindows.some(window => {
      const dayMatch = !window.days || window.days.includes(currentDay);
      const timeMatch = currentTime >= window.startTime && currentTime <= window.endTime;
      return dayMatch && timeMatch;
    });
    
    if (!isInWindow) {
      return res.status(403).json({
        success: false,
        message: 'Access denied outside allowed time window'
      });
    }
    
    next();
  };
};

// Validate request signature (for webhooks)
const validateRequestSignature = (secret) => {
  return (req, res, next) => {
    if (!secret) return next();
    
    const crypto = require('crypto');
    const signature = req.headers['x-signature'] || req.headers['x-hub-signature-256'];
    
    if (!signature) {
      return res.status(401).json({
        success: false,
        message: 'Missing request signature'
      });
    }
    
    const payload = JSON.stringify(req.body);
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid request signature'
      });
    }
    
    next();
  };
};

// ====================
// PERFORMANCE VALIDATION
// ====================

// Validate query complexity
const validateQueryComplexity = (maxComplexity = 100) => {
  return (req, res, next) => {
    let complexity = 0;
    
    // Calculate complexity based on query parameters
    if (req.query.search) complexity += 10;
    if (req.query.dateFrom || req.query.dateTo) complexity += 5;
    if (req.query.minEarnings || req.query.maxEarnings) complexity += 5;
    if (req.query.state) complexity += 3;
    if (req.query.city) complexity += 3;
    if (req.query.status && req.query.status !== 'active') complexity += 5;
    
    const limit = parseInt(req.query.limit) || 50;
    complexity += Math.floor(limit / 10);
    
    if (complexity > maxComplexity) {
      return res.status(400).json({
        success: false,
        message: 'Query too complex, please simplify your filters',
        complexity: {
          current: complexity,
          maximum: maxComplexity
        }
      });
    }
    
    req.queryComplexity = complexity;
    next();
  };
};

// Validate concurrent request limits
const validateConcurrentRequests = (maxConcurrent = 10) => {
  const activeRequests = new Map();
  
  return (req, res, next) => {
    const userId = req.user?._id?.toString() || req.ip;
    const currentCount = activeRequests.get(userId) || 0;
    
    if (currentCount >= maxConcurrent) {
      return res.status(429).json({
        success: false,
        message: 'Too many concurrent requests',
        maxConcurrent,
        current: currentCount
      });
    }
    
    activeRequests.set(userId, currentCount + 1);
    
    const cleanup = () => {
      const newCount = activeRequests.get(userId) - 1;
      if (newCount <= 0) {
        activeRequests.delete(userId);
      } else {
        activeRequests.set(userId, newCount);
      }
    };
    
    res.on('finish', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
    
    next();
  };
};

// ====================
// COMPLETE MODULE EXPORTS
// ====================

module.exports = {
  // Basic schemas
  leaderboardQuerySchema,
  visibilityUpdateSchema,
  bulkVisibilityUpdateSchema,
  bulkUpdateSchema,
  locationAnalyticsSchema,
  exportSchema,
  statsQuerySchema,
  publicLeaderboardSchema,
  rateLimitSchema,
  exportFormatSchema,
  activityLogSchema,
  
  // Advanced schemas
  batchOperationSchema,
  reportGenerationSchema,
  apiKeySchema,
  webhookConfigSchema,
  alertConfigSchema,
  maintenanceTaskSchema,
  advancedSearchSchema,
  
  // Basic middleware functions
  validateLeaderboardQuery,
  validateVisibilityUpdate,
  validateBulkVisibilityUpdate,
  validateLocationAnalytics,
  validateExportQuery,
  validateStatsQuery,
  validatePublicLeaderboard,
  validateUserId,
  validateAdvancedFilters,
  validateComprehensiveFilters,
  validateAdminPermissions,
  validateBulkOperation,
  validateExportFormat,
  validateRequestThrottling,
  validateDataConsistency,
  
  // Advanced middleware functions
  validateBatchOperation,
  validateReportGeneration,
  validateApiKeyCreation,
  validateWebhookConfig,
  validateAlertConfig,
  validateMaintenanceTask,
  validateAdvancedSearch,
  
  // Security validation
  validateIpAccess,
  validateTimeWindow,
  validateRequestSignature,
  
  // Performance validation
  validateQueryComplexity,
  validateConcurrentRequests,
  
  // Helper functions
  validateDateRange,
  validateNumberRange,
  validatePagination,
  validateLocation,
  validateUserIds,
  sanitizeSearchQuery,
  buildDateFilter,
  buildEarningsFilter,
  buildBalanceFilter,
  buildSearchFilter,
  buildLocationFilter,
  buildStatusFilter,
  
  // Validation chains for common use cases
  adminLeaderboardValidation: [
    validateComprehensiveFilters,
    validateAdminPermissions(['view_leaderboard', 'manage_users']),
    validateQueryComplexity(150),
    validateRequestThrottling(900000, 200), // 200 requests per 15 minutes for admins
    validateConcurrentRequests(5)
  ],
  
  publicLeaderboardValidation: [
    validatePublicLeaderboard,
    validateQueryComplexity(50),
    validateRequestThrottling(300000, 50), // 50 requests per 5 minutes for public
    validateConcurrentRequests(3)
  ],
  
  bulkVisibilityValidation: [
    validateBulkVisibilityUpdate,
    validateBulkOperation(500),
    validateAdminPermissions(['manage_user_visibility']),
    validateDataConsistency
  ],
  
  exportValidation: [
    validateExportQuery,
    validateExportFormat,
    validateAdminPermissions(['export_data']),
    validateRequestThrottling(3600000, 10), // 10 exports per hour
    validateConcurrentRequests(2)
  ],
  
  batchOperationValidation: [
    validateBatchOperation,
    validateAdminPermissions(['bulk_operations']),
    validateDataConsistency,
    validateRequestThrottling(3600000, 5), // 5 batch operations per hour
    validateConcurrentRequests(1)
  ],
  
  reportGenerationValidation: [
    validateReportGeneration,
    validateAdminPermissions(['generate_reports']),
    validateRequestThrottling(3600000, 20), // 20 reports per hour
    validateConcurrentRequests(2)
  ],
  
  webhookValidation: [
    validateWebhookConfig,
    validateAdminPermissions(['manage_webhooks']),
    validateRequestThrottling(3600000, 10) // 10 webhook operations per hour
  ],
  
  maintenanceValidation: [
    validateMaintenanceTask,
    validateAdminPermissions(['system_maintenance']),
    validateRequestThrottling(86400000, 5), // 5 maintenance tasks per day
    validateConcurrentRequests(1)
  ],
  
  // Utility functions for custom validation
  createCustomValidator: (schema) => {
    return (req, res, next) => {
      const { error, value } = schema.validate(req.query || req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: error.details.map(detail => ({
            field: detail.path.join('.'),
            message: detail.message,
            value: detail.context?.value
          }))
        });
      }
      req.validated = value;
      next();
    };
  },
  
  // Security helpers
  createSecureValidator: (schema, options = {}) => {
    return [
      ...(options.ipWhitelist ? [validateIpAccess(options.ipWhitelist)] : []),
      ...(options.timeWindows ? [validateTimeWindow(options.timeWindows)] : []),
      ...(options.signature ? [validateRequestSignature(options.signature)] : []),
      ...(options.complexity ? [validateQueryComplexity(options.complexity)] : []),
      ...(options.concurrent ? [validateConcurrentRequests(options.concurrent)] : []),
      ...(options.rateLimit ? [validateRequestThrottling(options.rateLimit.window, options.rateLimit.max)] : [])
    ];
  }
};