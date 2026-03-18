const express = require('express');
const router = express.Router();
const { 
  getUserTransactionHistory, 
  getAllTransactionHistory, 
  getUserBalanceSummary, 
  getAuditLog, 
  getTransactionStats,
  getAdminBalanceSheetData,
  searchTransactions
} = require('../controllers/transactionController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

// Route to get transaction history for a specific user
// Accessible by the user themselves or by an admin
router.get('/users/:userId/transactions', 
  authMiddleware, 
  getUserTransactionHistory
);

// Route to get balance summary for a specific user
// Accessible by the user themselves or by an admin
router.get('/users/:userId/balance', 
  authMiddleware, 
  getUserBalanceSummary
);

// Route to get all transactions across all users
// Admin only access
router.get('/transactions', 
  authMiddleware, 
  adminMiddleware, 
  getAllTransactionHistory
);

// Route to get transaction statistics
// Admin only access
router.get('/transactions/stats', 
  authMiddleware, 
  adminMiddleware, 
  getTransactionStats
);

// Audit Log for Admin Dashboard
router.get('/admin-balance-sheet/audit-log', 
  authMiddleware, 
  adminMiddleware, 
  getAuditLog
);

// Route to get admin balance sheet data
router.get('/admin-balance-sheet', 
  authMiddleware, 
  adminMiddleware, 
  getAdminBalanceSheetData
);

// Route to search transactions across entire database
router.get('/search', 
  authMiddleware, 
  adminMiddleware, 
  searchTransactions
);

module.exports = router;