// routes/salesRoutes.js
const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const authMiddleware = require('../middleware/authMiddleware');

// Troubleshooting: Check if controller functions exist
// console.log('Controller functions:', {
//   getDailySales: typeof salesController.getDailySales,
//   getSalesSummary: typeof salesController.getSalesSummary
// });

// Get daily sales for authenticated user
router.get('/daily', authMiddleware, (req, res) => {
  console.log('Daily route hit');
  salesController.getDailySales(req, res);
});

// Get sales summary for a date range
router.get('/summary', authMiddleware, (req, res) => {
  console.log('Summary route hit');
  salesController.getSalesSummary(req, res);
});

module.exports = router;