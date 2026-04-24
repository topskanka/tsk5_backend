const prisma = require("../config/db");
const cache = require("../utils/cache");

/**
 * Normalise a startDate/endDate pair into Prisma `{ gte, lte }` bounds.
 *
 * The admin UI sends plain calendar strings (YYYY-MM-DD) from <input type="date">
 * and from the Today/Yesterday quick filters. `new Date("2026-04-21")` parses
 * those as 2026-04-21T00:00:00.000Z — so when the user picks the *same* day
 * for start and end the window collapses to a single instant and no rows
 * match. Here we expand a date-only string to cover the entire day.
 * Full ISO datetimes are left untouched so callers that pass a precise
 * instant keep their exact bounds.
 *
 * @param {string|Date|null} startDate
 * @param {string|Date|null} endDate
 * @returns {{ gte: Date, lte: Date } | null}
 */
const parseDateBounds = (startDate, endDate) => {
  if (!startDate || !endDate) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  const gte = new Date(startDate);
  const lte = new Date(endDate);
  if (typeof startDate === 'string' && dateOnly.test(startDate)) {
    gte.setUTCHours(0, 0, 0, 0);
  }
  if (typeof endDate === 'string' && dateOnly.test(endDate)) {
    lte.setUTCHours(23, 59, 59, 999);
  }
  if (Number.isNaN(gte.getTime()) || Number.isNaN(lte.getTime())) return null;
  return { gte, lte };
};

/**
 * Map a friendly network name to the set of substrings we look for in
 * transaction descriptions / product names. Used by the admin dashboard
 * Network filter so the stat cards (credits, debits, revenue, total GB…)
 * reflect only the selected network.
 *
 * @param {string|null} network
 * @returns {string[]} list of case-insensitive substrings (MySQL default
 *   collation is case-insensitive so no `mode` flag is needed).
 */
const parseNetworkTerms = (network) => {
  if (!network) return [];
  const n = String(network).toUpperCase();
  if (n === 'MTN') return ['MTN'];
  if (n === 'AIRTELTIGO' || n === 'AIRTEL' || n === 'TIGO') return ['AIRTEL', 'TIGO'];
  if (n === 'TELECEL' || n === 'VODAFONE') return ['TELECEL', 'VODAFONE'];
  return [];
};

/**
 * Creates a transaction record
 * @param {Number} userId - User ID
 * @param {Number} amount - Transaction amount (positive for credits, negative for debits)
 * @param {String} type - Transaction type (TOPUP, ORDER, CART_ADD, LOAN_REPAYMENT, LOAN_DEDUCTION)
 * @param {String} description - Transaction description
 * @param {String} reference - Reference ID (optional)
 * @returns {Promise<Object>} Created transaction
 */

const createTransaction = async (userId, amount, type, description, reference = null, prismaOverride = null) => {
  try {
    const prismaTx = prismaOverride || prisma;
    // If using a transaction, don't nest another $transaction
    if (prismaOverride) {
      // Atomically increment the balance and get the updated value
      const updatedUser = await prismaTx.user.update({
        where: { id: userId },
        data: { loanBalance: { increment: amount } },
        select: { loanBalance: true }
      });

      // Calculate previous balance by subtracting the amount from the new balance
      const newBalance = updatedUser.loanBalance;
      const previousBalance = newBalance - amount;

      // Create transaction record with previousBalance
      const transaction = await prismaTx.transaction.create({
        data: {
          userId,
          amount,
          balance: newBalance,
          previousBalance,
          type,
          description,
          reference
        }
      });

      return transaction;
    } else {
      // Use a transaction for atomicity (15s timeout to avoid P2028 under load)
      return await prisma.$transaction(async (prismaTxInner) => {
        // Atomically increment the balance and get the updated value
        const updatedUser = await prismaTxInner.user.update({
          where: { id: userId },
          data: { loanBalance: { increment: amount } },
          select: { loanBalance: true }
        });

        // Calculate previous balance by subtracting the amount from the new balance
        const newBalance = updatedUser.loanBalance;
        const previousBalance = newBalance - amount;

        // Create transaction record with previousBalance
        const transaction = await prismaTxInner.transaction.create({
          data: {
            userId,
            amount,
            balance: newBalance,
            previousBalance,
            type,
            description,
            reference
          }
        });

        return transaction;
      }, { timeout: 15000 });
    }
  } catch (error) {
    console.error("Error creating transaction:", error);
    throw new Error(`Failed to record transaction: ${error.message}`);
  }
};

/**
 * Get user transaction history
 * @param {Number} userId - User ID
 * @param {Date} startDate - Start date filter (optional)
 * @param {Date} endDate - End date filter (optional)
 * @param {String} type - Transaction type filter (optional)
 * @returns {Promise<Array>} Transaction history
 */

const getUserTransactions = async (userId, startDate = null, endDate = null, type = null, limit = 1000) => {
  try {
    // Create cache key for this query
    const cacheKey = `user_transactions_${userId}_${startDate}_${endDate}_${type}_${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const whereClause = { userId };

    // Add date filters if provided
    const userTxBounds = parseDateBounds(startDate, endDate);
    if (userTxBounds) {
      whereClause.createdAt = userTxBounds;
    }

    // Add type filter if provided
    if (type) {
      whereClause.type = type;
    }

    const result = await prisma.transaction.findMany({
      where: whereClause,
      select: {
        id: true,
        amount: true,
        balance: true,
        previousBalance: true,
        type: true,
        description: true,
        reference: true,
        createdAt: true,
        user: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: "desc" },
      take: limit // Add limit to prevent excessive memory usage
    });

    // Cache for 2 minutes for frequently accessed user data
    cache.set(cacheKey, result, 120000);
    return result;
  } catch (error) {
    console.error("Error fetching user transactions:", error);
    throw new Error(`Failed to retrieve transaction history: ${error.message}`);
  }
};


/**
 * Get all transactions
 * @param {Date} startDate - Start date filter (optional)
 * @param {Date} endDate - End date filter (optional)
 * @param {String} type - Transaction type filter (optional)
 * @param {Number} userId - User ID filter (optional)
 * @returns {Promise<Array>} All transactions
 */

const getAllTransactions = async (startDate = null, endDate = null, type = null, userId = null, page = 1, limit = 100, search = null, amountFilter = null, network = null) => {
  try {
    const whereClause = {};

    // Add date filters if provided
    const allTxBounds = parseDateBounds(startDate, endDate);
    if (allTxBounds) {
      whereClause.createdAt = allTxBounds;
    }

    // Add type filter if provided
    if (type) {
      whereClause.type = type;
    }

    // Add user ID filter if provided
    if (userId) {
      whereClause.userId = parseInt(userId, 10);
    }

    // Search + network filters are combined with AND so they can coexist with
    // each other and with any other filter on the same where clause.
    const andConditions = [];
    if (search) {
      const term = String(search).trim();
      if (term) {
        andConditions.push({
          OR: [
            { description: { contains: term } },
            { user: { is: { name: { contains: term } } } },
            { user: { is: { email: { contains: term } } } },
            { user: { is: { phone: { contains: term } } } }
          ]
        });
      }
    }
    const networkTerms = parseNetworkTerms(network);
    if (networkTerms.length) {
      andConditions.push({
        OR: networkTerms.map(t => ({ description: { contains: t } }))
      });
    }
    if (andConditions.length) {
      whereClause.AND = andConditions;
    }

    // Add amount filter
    if (amountFilter === 'positive') {
      whereClause.amount = { gte: 0 };
    } else if (amountFilter === 'negative') {
      whereClause.amount = { lt: 0 };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;
    
    // Get total count for pagination info
    const totalCount = await prisma.transaction.count({
      where: whereClause
    });

    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      select: {
        id: true,
        amount: true,
        balance: true,
        previousBalance: true,
        type: true,
        description: true,
        reference: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true }
        }
      },
      orderBy: { createdAt: "desc" },
      skip: skip,
      take: limit
    });

    return {
      data: transactions,
      pagination: {
        page: page,
        limit: limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNext: page < Math.ceil(totalCount / limit),
        hasPrev: page > 1
      }
    };
  } catch (error) {
    console.error("Error fetching all transactions:", error);
    throw new Error(`Failed to retrieve transactions: ${error.message}`);
  }
};

/**
 * Get transaction statistics (totals) without pagination
 * @param {Date} startDate - Start date filter (optional)
 * @param {Date} endDate - End date filter (optional)
 * @param {String} type - Transaction type filter (optional)
 * @param {Number} userId - User ID filter (optional)
 * @param {String} search - Search filter for user name (optional)
 * @param {String} amountFilter - Amount filter (positive/negative/all) (optional)
 * @returns {Promise<Object>} Transaction statistics
 */
const getTransactionStatistics = async (startDate = null, endDate = null, type = null, userId = null, search = null, amountFilter = null, network = null) => {
  try {
    const whereClause = {};

    // Add date filters if provided
    const statsBounds = parseDateBounds(startDate, endDate);
    if (statsBounds) {
      whereClause.createdAt = statsBounds;
    }

    // Add type filter if provided
    if (type) {
      whereClause.type = type;
    }

    // Add user ID filter if provided
    if (userId) {
      whereClause.userId = parseInt(userId, 10);
    }

    // Combine search + network into an AND of OR clauses so the returned
    // totals (credits / debits / net) reflect exactly what the user sees
    // in the transactions table.
    const andConditions = [];
    if (search) {
      const term = String(search).trim();
      if (term) {
        andConditions.push({
          OR: [
            { description: { contains: term } },
            { user: { is: { name: { contains: term } } } },
            { user: { is: { email: { contains: term } } } },
            { user: { is: { phone: { contains: term } } } }
          ]
        });
      }
    }
    const networkTerms = parseNetworkTerms(network);
    if (networkTerms.length) {
      andConditions.push({
        OR: networkTerms.map(t => ({ description: { contains: t } }))
      });
    }
    if (andConditions.length) {
      whereClause.AND = andConditions;
    }

    // Add amount filter
    if (amountFilter === 'positive') {
      whereClause.amount = { gte: 0 };
    } else if (amountFilter === 'negative') {
      whereClause.amount = { lt: 0 };
    }

    // Single query: count + credits sum + debits sum in one pass
    const [countResult, aggResult] = await Promise.all([
      prisma.transaction.count({ where: whereClause }),
      prisma.transaction.aggregate({
        where: whereClause,
        _sum: { amount: true },
        _count: { id: true }
      })
    ]);

    // Credits and debits in parallel (2 queries instead of 3)
    const [creditsResult, debitsResult] = await Promise.all([
      prisma.transaction.aggregate({
        where: { ...whereClause, amount: { gte: 0 } },
        _sum: { amount: true }
      }),
      prisma.transaction.aggregate({
        where: { ...whereClause, amount: { lt: 0 } },
        _sum: { amount: true }
      })
    ]);

    const totalCredits = creditsResult._sum.amount || 0;
    const totalDebits = debitsResult._sum.amount || 0;
    const netBalance = totalCredits + totalDebits;

    return {
      totalTransactions: countResult,
      totalCredits,
      totalDebits,
      netBalance
    };
  } catch (error) {
    console.error("Error fetching transaction statistics:", error);
    throw new Error(`Failed to retrieve transaction statistics: ${error.message}`);
  }
};

/**
 * Get admin overview stats for a date range — aggregates directly from DB
 * so the admin dashboard Financial/Balance/Sales/Shop tabs always show the
 * correct totals regardless of how many orders exist (no 200-row sampling).
 *
 * Uses the order-item snapshot price (`orderItem.productPrice`) when present
 * so changes to the current `Product.price`/`promoPrice` do NOT retroactively
 * mutate historical revenue or expenses figures. Falls back to the current
 * promo-aware product price when a snapshot is missing (older rows).
 *
 * @param {Date|string|null} startDate
 * @param {Date|string|null} endDate
 * @returns {Promise<Object>} { revenue, revenueCount, expenses, expenseCount,
 *   totalGB, shop: { total, totalAmount, totalGB }, salesByAgent: [...] }
 */
const getAdminOverviewStats = async (startDate = null, endDate = null, search = null, network = null) => {
  try {
    const where = {};
    const overviewBounds = parseDateBounds(startDate, endDate);
    if (overviewBounds) {
      where.order = { createdAt: overviewBounds };
    }

    // Search + network filters are applied against the order item snapshot
    // fields and the underlying product, so the Revenue / Expenses / Total
    // GB / Sales-by-agent cards all reflect the same subset the user filtered.
    const andConditions = [];
    const term = search ? String(search).trim() : '';
    if (term) {
      andConditions.push({
        OR: [
          { productName: { contains: term } },
          { productDescription: { contains: term } },
          { mobileNumber: { contains: term } },
          { product: { is: { name: { contains: term } } } },
          { product: { is: { description: { contains: term } } } },
          { order: { is: { user: { is: { name: { contains: term } } } } } },
          { order: { is: { mobileNumber: { contains: term } } } }
        ]
      });
    }
    const networkTerms = parseNetworkTerms(network);
    if (networkTerms.length) {
      andConditions.push({
        OR: networkTerms.flatMap(t => [
          { productName: { contains: t } },
          { productDescription: { contains: t } },
          { product: { is: { name: { contains: t } } } },
          { product: { is: { description: { contains: t } } } }
        ])
      });
    }
    if (andConditions.length) {
      where.AND = andConditions;
    }

    // Pull the minimal columns needed for aggregation
    const items = await prisma.orderItem.findMany({
      where,
      select: {
        quantity: true,
        status: true,
        productPrice: true,
        productName: true,
        productDescription: true,
        product: {
          select: {
            price: true,
            promoPrice: true,
            usePromoPrice: true,
            name: true,
            description: true
          }
        },
        order: {
          select: {
            userId: true,
            createdAt: true,
            user: { select: { id: true, name: true, email: true, role: true } }
          }
        }
      }
    });

    let revenue = 0;
    let revenueCount = 0;
    let expenses = 0;
    let expenseCount = 0;
    let totalGB = 0;

    let shopTotal = 0;
    let shopOrdersCount = 0;
    let shopGB = 0;

    const salesByAgentMap = new Map();
    const gbRegex = /(\d+(?:\.\d+)?)\s*GB/i;

    for (const it of items) {
      // Resolve the effective price using the snapshot first
      const productPrice = typeof it.productPrice === 'number' ? it.productPrice : null;
      let fallbackPrice = 0;
      if (it.product) {
        fallbackPrice = it.product.usePromoPrice && typeof it.product.promoPrice === 'number'
          ? it.product.promoPrice
          : (it.product.price || 0);
      }
      const effectivePrice = productPrice !== null ? productPrice : fallbackPrice;
      const qty = it.quantity || 1;
      const value = qty * effectivePrice;

      const status = (it.status || '').toLowerCase();
      const desc = it.productDescription || it.product?.description || '';
      const gbMatch = desc.match(gbRegex);
      const gbPerUnit = gbMatch ? parseFloat(gbMatch[1]) : 0;
      const gbTotal = gbPerUnit * qty;

      const userEmail = (it.order?.user?.email || '').toLowerCase();
      const userName = (it.order?.user?.name || '').toLowerCase();
      const isShopOrder = userEmail.startsWith('shop@') || userName === 'shop';

      if (status === 'completed') {
        revenue += value;
        revenueCount += 1;

        if (isShopOrder) {
          shopTotal += value;
          shopGB += gbTotal;
          shopOrdersCount += 1;
        } else {
          totalGB += gbTotal;

          const uid = it.order?.userId;
          const nm = it.order?.user?.name || 'Unknown';
          if (uid != null) {
            const prev = salesByAgentMap.get(uid) || {
              userId: uid,
              name: nm,
              role: it.order?.user?.role || '',
              orders: 0,
              total: 0
            };
            prev.orders += 1;
            prev.total += value;
            salesByAgentMap.set(uid, prev);
          }
        }
      } else if (status === 'cancelled' || status === 'canceled' || status === 'refunded') {
        expenses += value;
        expenseCount += 1;
      }
    }

    const salesByAgent = Array.from(salesByAgentMap.values()).sort((a, b) => b.total - a.total);

    return {
      revenue,
      revenueCount,
      expenses,
      expenseCount,
      totalGB,
      shop: {
        total: shopOrdersCount,
        totalAmount: shopTotal,
        totalGB: shopGB
      },
      salesByAgent
    };
  } catch (error) {
    console.error("Error fetching admin overview stats:", error);
    throw new Error(`Failed to retrieve admin overview stats: ${error.message}`);
  }
};

module.exports = {
  createTransaction,
  getUserTransactions,
  getAllTransactions,
  getTransactionStatistics,
  getAdminOverviewStats
};
