// Simple validation without Joi dependency
const validateLeaderboardQuery = (data) => {
  const allowedTypes = ['earners', 'shares', 'referrals', 'cofounders'];
  const allowedPeriods = ['all_time', 'monthly', 'weekly', 'daily'];
  
  const validated = {
    type: allowedTypes.includes(data.type) ? data.type : 'earners',
    period: allowedPeriods.includes(data.period) ? data.period : 'all_time',
    limit: Math.min(Math.max(parseInt(data.limit) || 50, 1), 1000),
    offset: Math.max(parseInt(data.offset) || 0, 0),
    state: data.state || undefined,
    city: data.city || undefined,
    search: data.search || undefined,
    show_earnings: data.show_earnings !== 'false',
    show_balance: data.show_balance !== 'false'
  };
  
  return { error: null, value: validated };
};

const validateVisibilityUpdate = (data) => {
  if (!data.field || !['earnings', 'balance'].includes(data.field)) {
    return { error: { details: [{ message: 'Field must be earnings or balance' }] } };
  }
  
  if (typeof data.visible !== 'boolean') {
    return { error: { details: [{ message: 'Visible must be a boolean' }] } };
  }
  
  return { error: null, value: data };
};

const validateBulkUpdate = (data) => {
  if (!Array.isArray(data.user_ids) || data.user_ids.length === 0) {
    return { error: { details: [{ message: 'user_ids must be a non-empty array' }] } };
  }
  
  if (!data.updates || typeof data.updates !== 'object') {
    return { error: { details: [{ message: 'updates must be an object' }] } };
  }
  
  return { error: null, value: data };
};

module.exports = {
  leaderboardQuerySchema: { validate: validateLeaderboardQuery },
  visibilityUpdateSchema: { validate: validateVisibilityUpdate },
  bulkUpdateSchema: { validate: validateBulkUpdate }
};