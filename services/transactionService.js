const prisma = require("../config/db");
const cache = require("../utils/cache");

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
    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
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

const getAllTransactions = async (startDate = null, endDate = null, type = null, userId = null, page = 1, limit = 100, search = null, amountFilter = null) => {
  try {
    const whereClause = {};
    
    // Add date filters if provided
    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }
    
    // Add type filter if provided
    if (type) {
      whereClause.type = type;
    }

    // Add user ID filter if provided
    if (userId) {
      whereClause.userId = parseInt(userId, 10);
    }

    // Add search filter for user name
    if (search) {
      whereClause.user = {
        name: {
          contains: search,
          mode: 'insensitive'
        }
      };
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
const getTransactionStatistics = async (startDate = null, endDate = null, type = null, userId = null, search = null, amountFilter = null) => {
  try {
    const whereClause = {};
    
    // Add date filters if provided
    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }
    
    // Add type filter if provided
    if (type) {
      whereClause.type = type;
    }

    // Add user ID filter if provided
    if (userId) {
      whereClause.userId = parseInt(userId, 10);
    }

    // Add search filter for user name
    if (search) {
      whereClause.user = {
        name: {
          contains: search,
          mode: 'insensitive'
        }
      };
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

module.exports = {
  createTransaction,
  getUserTransactions,
  getAllTransactions,
  getTransactionStatistics
};
