const express = require("express");
const { resetDatabase } = require("../controllers/resetController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

const router = express.Router();

// POST /api/reset/database - Reset database (admin only)
router.post("/database", authMiddleware, adminMiddleware, resetDatabase);

module.exports = router;
