/**
 * Simple in-memory cache to reduce database load
 * This helps reduce RAM usage by caching frequently accessed data
 */

class MemoryCache {
  constructor(maxSize = 100) { // Limit cache size for Railway memory constraints
    this.cache = new Map();
    this.ttl = new Map();
    this.maxSize = maxSize;
  }

  set(key, value, ttlMs = 120000) { // Default 2 minutes TTL (reduced for Railway)
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      this.ttl.delete(firstKey);
    }
    this.cache.set(key, value);
    this.ttl.set(key, Date.now() + ttlMs);
  }

  get(key) {
    const now = Date.now();
    const expiry = this.ttl.get(key);
    
    if (!expiry || now > expiry) {
      this.cache.delete(key);
      this.ttl.delete(key);
      return null;
    }
    
    return this.cache.get(key);
  }

  delete(key) {
    this.cache.delete(key);
    this.ttl.delete(key);
  }

  clear() {
    this.cache.clear();
    this.ttl.clear();
  }

  // Clean up expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, expiry] of this.ttl.entries()) {
      if (now > expiry) {
        this.cache.delete(key);
        this.ttl.delete(key);
      }
    }
  }

  // Get cache stats
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// Create a singleton instance
const cache = new MemoryCache();

// Clean up expired entries every 5 minutes
setInterval(() => {
  cache.cleanup();
}, 300000);

module.exports = cache;
