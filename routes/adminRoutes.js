const express = require("express");
const { addPackage } = require("../controllers/adminController");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

const router = express.Router();
router.post("/add-package", authMiddleware, adminMiddleware, addPackage);

module.exports = router;
