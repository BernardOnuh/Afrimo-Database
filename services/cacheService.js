// Simple fallback cache service that doesn't require Redis
class CacheService {
  static cache = new Map();
  
  static async get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  static async set(key, data, ttl = 3600) {
    this.cache.set(key, {
      data,
      expiry: Date.now() + (ttl * 1000)
    });
    return true;
  }

  static async getLeaderboard(key) {
    return await this.get(key);
  }

  static async setLeaderboard(key, data, ttl = 900) {
    return await this.set(key, data, ttl);
  }

  static async invalidateUserCache(userId) {
    const keysToDelete = [];
    for (const [key] of this.cache) {
      if (key.includes(`user:${userId}`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
    return true;
  }

  static async del(key) {
    return this.cache.delete(key);
  }
}

module.exports = CacheService;