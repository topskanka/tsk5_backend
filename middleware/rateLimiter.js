/**
 * Rate limiter middleware to prevent excessive API calls and reduce server load
 * This helps reduce RAM usage by limiting concurrent requests
 */

const rateLimit = new Map();

const rateLimiter = (options = {}) => {
  const {
    windowMs = 60000, // 1 minute window
    maxRequests = 100, // Max requests per window
    keyGenerator = (req) => req.ip || 'anonymous'
  } = options;

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();
    
    // Clean up old entries
    if (rateLimit.has(key)) {
      const userRequests = rateLimit.get(key);
      const validRequests = userRequests.filter(timestamp => now - timestamp < windowMs);
      rateLimit.set(key, validRequests);
    }

    // Get current request count
    const userRequests = rateLimit.get(key) || [];
    
    if (userRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // Add current request
    userRequests.push(now);
    rateLimit.set(key, userRequests);
    
    next();
  };
};

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, requests] of rateLimit.entries()) {
    const validRequests = requests.filter(timestamp => now - timestamp < 300000); // 5 minutes
    if (validRequests.length === 0) {
      rateLimit.delete(key);
    } else {
      rateLimit.set(key, validRequests);
    }
  }
}, 300000);

module.exports = rateLimiter;
