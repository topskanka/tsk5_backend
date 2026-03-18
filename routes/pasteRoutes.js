const express = require('express');
const router = express.Router();
const { pasteAndProcessOrders } = require('../controllers/pasteController');
const authMiddleware = require('../middleware/authMiddleware');

// Route for pasting orders from text area (requires authentication)
router.post('/paste-orders', authMiddleware, pasteAndProcessOrders);

module.exports = router;
