/**
 * Query optimization utilities to reduce memory usage and improve performance
 */

const cache = require('./cache');

class QueryOptimizer {
  /**
   * Optimize Prisma queries by adding selective field loading and pagination
   */
  static optimizeSelect(baseSelect, excludeFields = []) {
    const optimized = { ...baseSelect };
    
    // Remove heavy fields that are not always needed
    excludeFields.forEach(field => {
      delete optimized[field];
    });
    
    return optimized;
  }

  /**
   * Add pagination limits to prevent excessive memory usage
   */
  static addPaginationLimits(query, maxLimit = 1000) {
    if (query.take && query.take > maxLimit) {
      query.take = maxLimit;
    }
    
    if (!query.take) {
      query.take = maxLimit;
    }
    
    return query;
  }

  /**
   * Create efficient cache keys for complex queries
   */
  static createCacheKey(prefix, params) {
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}:${params[key]}`)
      .join('_');
    
    return `${prefix}_${sortedParams}`;
  }

  /**
   * Batch database operations to reduce connection overhead
   */
  static async batchOperations(operations, batchSize = 100) {
    const results = [];
    
    for (let i = 0; i < operations.length; i += batchSize) {
      const batch = operations.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Optimize WHERE clauses for better index usage
   */
  static optimizeWhereClause(where) {
    // Move indexed fields to the front for better query performance
    const indexedFields = ['id', 'userId', 'createdAt', 'status', 'type'];
    const optimized = {};
    
    // Add indexed fields first
    indexedFields.forEach(field => {
      if (where[field] !== undefined) {
        optimized[field] = where[field];
      }
    });
    
    // Add remaining fields
    Object.keys(where).forEach(field => {
      if (!indexedFields.includes(field)) {
        optimized[field] = where[field];
      }
    });
    
    return optimized;
  }

  /**
   * Stream large result sets to reduce memory usage
   */
  static async streamResults(query, processor, batchSize = 500) {
    let skip = 0;
    let hasMore = true;
    
    while (hasMore) {
      const batch = await query({
        ...query,
        skip,
        take: batchSize
      });
      
      if (batch.length === 0) {
        hasMore = false;
      } else {
        await processor(batch);
        skip += batchSize;
        hasMore = batch.length === batchSize;
      }
    }
  }
}

module.exports = QueryOptimizer;
