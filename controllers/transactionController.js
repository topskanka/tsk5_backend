const { getUserTransactions, getAllTransactions, getTransactionStatistics } = require('../services/transactionService');
const prisma = require('../config/db');

// Get transactions for a specific user (accessible by user and admin)
const getUserTransactionHistory = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const { startDate, endDate, type } = req.query;
    
    const transactions = await getUserTransactions(userId, startDate, endDate, type);
    
    res.status(200).json({
      success: true,
      data: transactions
    });
  } catch (error) {
    console.error("Error in getUserTransactionHistory:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to retrieve transaction history" 
    });
  }
};

// Get all transactions (admin only)
const getAllTransactionHistory = async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      type, 
      page = 1, 
      limit = 100, 
      search, 
      amountFilter 
    } = req.query;
    
    const result = await getAllTransactions(
      startDate, 
      endDate, 
      type, 
      null, // userId
      parseInt(page), 
      parseInt(limit), 
      search, 
      amountFilter
    );
    
    res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (error) {
    console.error("Error in getAllTransactionHistory:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to retrieve all transactions" 
    });
  }
};

// Helper function to calculate total amount by transaction type
const calculateTotalByType = async (userId, type) => {
  try {
    const transactions = await getUserTransactions(userId, null, null, type);
    return transactions.reduce((total, transaction) => total + transaction.amount, 0);
  } catch (error) {
    console.error(`Error calculating total for ${type}:`, error);
    return 0;
  }
};

// Get user balance summary
const getUserBalanceSummary = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    
    // Get current balance from user record directly (more efficient)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { loanBalance: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Use database aggregations instead of multiple service calls
    const transactionStats = await prisma.transaction.groupBy({
      by: ['type'],
      where: { userId },
      _sum: { amount: true },
      _count: true
    });

    // Process stats efficiently
    const stats = {
      totalTopups: 0,
      totalOrders: 0,
      totalLoanRepayments: 0,
      totalLoanDeductions: 0,
      transactionCount: 0
    };

    transactionStats.forEach(stat => {
      const amount = stat._sum.amount || 0;
      const count = stat._count || 0;
      stats.transactionCount += count;

      switch (stat.type) {
        case 'TOPUP_APPROVED':
          stats.totalTopups = amount;
          break;
        case 'ORDER':
          stats.totalOrders = Math.abs(amount);
          break;
        case 'LOAN_REPAYMENT':
          stats.totalLoanRepayments = amount;
          break;
        case 'LOAN_DEDUCTION':
          stats.totalLoanDeductions = Math.abs(amount);
          break;
      }
    });
    
    res.status(200).json({
      success: true,
      data: {
        currentBalance: user.loanBalance,
        statistics: {
          ...stats,
          totalLoanBalance: stats.totalLoanDeductions - stats.totalLoanRepayments
        },
        transactionCount: stats.transactionCount
      }
    });
  } catch (error) {
    console.error("Error in getUserBalanceSummary:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to retrieve balance summary" 
    });
  }
};

// Get audit log (filtered transactions for admin audit)
const getAuditLog = async (req, res) => {
  try {
    const { userId, start, end, type } = req.query;
    // getAllTransactions returns an object with data and pagination
    const result = await getAllTransactions(start, end, type, userId);
    // Return only the data array for frontend compatibility
    res.status(200).json(result.data);
  } catch (error) {
    console.error("Error in getAuditLog:", error);
    res.status(500).json({ message: error.message || "Failed to retrieve audit log" });
  }
};

// Get transaction statistics (admin only)
const getTransactionStats = async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      type, 
      search, 
      amountFilter 
    } = req.query;
    
    const stats = await getTransactionStatistics(
      startDate, 
      endDate, 
      type, 
      null, // userId
      search, 
      amountFilter
    );
    
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error("Error in getTransactionStats:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to retrieve transaction statistics" 
    });
  }
};

// Get admin balance sheet data
const getAdminBalanceSheetData = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter for transactions and topups
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    // Use database aggregations instead of loading all data into memory
    // 1. Total Revenue (Sales) - Use aggregate query
    const revenueAggregation = await prisma.orderItem.aggregate({
      where: {
        status: 'Completed',
        ...(startDate && endDate ? {
          order: {
            createdAt: {
              gte: new Date(startDate),
              lte: new Date(endDate)
            }
          }
        } : {})
      },
      _sum: {
        quantity: true
      }
    });

    // Get revenue by joining with products - more efficient query
    const revenueQuery = await prisma.$queryRaw`
      SELECT COALESCE(SUM(oi.quantity * p.price), 0) as totalRevenue, COUNT(*) as orderCount
      FROM OrderItem oi
      JOIN Product p ON oi.productId = p.id
      JOIN \`Order\` o ON oi.orderId = o.id
      WHERE oi.status = 'Completed'
      ${startDate && endDate ? 
        `AND o.createdAt >= ${new Date(startDate)} AND o.createdAt <= ${new Date(endDate)}` : 
        ''
      }
    `;

    const totalRevenue = Number(revenueQuery[0]?.totalRevenue || 0);
    const orderCount = Number(revenueQuery[0]?.orderCount || 0);

    // 2. Total Top-ups - Use aggregate query
    const topupAggregation = await prisma.topUp.aggregate({
      where: {
        status: 'Approved',
        ...dateFilter
      },
      _sum: {
        amount: true
      },
      _count: true
    });

    const totalTopups = topupAggregation._sum.amount || 0;
    const topupCount = topupAggregation._count || 0;

    // 3. Total Refunds - Use aggregate query
    const refundAggregation = await prisma.transaction.aggregate({
      where: {
        type: 'REFUND',
        ...dateFilter
      },
      _sum: {
        amount: true
      },
      _count: true
    });

    const totalRefunds = refundAggregation._sum.amount || 0;
    const refundCount = refundAggregation._count || 0;

    // 4. Previous Balance - Use more efficient query
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999);

    // Get previous balance using a single aggregated query
    const previousBalanceQuery = await prisma.$queryRaw`
      SELECT COALESCE(SUM(t.balance), 0) as previousBalance
      FROM Transaction t
      INNER JOIN (
        SELECT userId, MAX(createdAt) as maxCreatedAt
        FROM Transaction
        WHERE createdAt <= ${yesterday}
        GROUP BY userId
      ) latest ON t.userId = latest.userId AND t.createdAt = latest.maxCreatedAt
    `;

    const previousBalance = Number(previousBalanceQuery[0]?.previousBalance || 0);

    // Get active users count efficiently
    const activeUsersCount = await prisma.user.count();

    const totalTopupsAndRefunds = totalTopups + totalRefunds;

    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalTopups,
        totalRefunds,
        totalTopupsAndRefunds,
        previousBalance,
        orderCount,
        topupCount,
        refundCount,
        // Additional metrics
        activeUsers: activeUsersCount,
        netCashFlow: totalTopups + totalRefunds - totalRevenue
      }
    });

  } catch (error) {
    console.error("Error in getAdminBalanceSheetData:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to retrieve admin balance sheet data" 
    });
  }
};

// Search transactions across entire database
const searchTransactions = async (req, res) => {
  try {
    const { 
      search, 
      typeFilter, 
      amountFilter, 
      startDate, 
      endDate,
      page = 1, 
      limit = 100 
    } = req.query;
    
    // Build where clause for search
    const whereClause = {};
    
    // Date filter
    if (startDate && endDate) {
      whereClause.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }
    
    // Type filter
    if (typeFilter) {
      whereClause.type = typeFilter;
    }
    
    // Amount filter
    if (amountFilter === 'positive') {
      whereClause.amount = { gt: 0 };
    } else if (amountFilter === 'negative') {
      whereClause.amount = { lt: 0 };
    }
    
    // Search filter - search in user name and transaction description
    if (search) {
      whereClause.OR = [
        {
          description: {
            contains: search,
            mode: 'insensitive'
          }
        },
        {
          user: {
            name: {
              contains: search,
              mode: 'insensitive'
            }
          }
        }
      ];
    }
    
    // Get total count for pagination
    const totalCount = await prisma.transaction.count({
      where: whereClause
    });
    
    // Get transactions with pagination
    const transactions = await prisma.transaction.findMany({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit)
    });
    
    res.status(200).json({
      success: true,
      data: transactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalCount / parseInt(limit)),
        totalCount,
        hasNextPage: parseInt(page) * parseInt(limit) < totalCount,
        hasPreviousPage: parseInt(page) > 1
      }
    });
    
  } catch (error) {
    console.error("Error in searchTransactions:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message || "Failed to search transactions" 
    });
  }
};

module.exports = {
  getUserTransactionHistory,
  getAllTransactionHistory,
  getUserBalanceSummary,
  getAuditLog,
  getTransactionStats,
  getAdminBalanceSheetData,
  searchTransactions
};