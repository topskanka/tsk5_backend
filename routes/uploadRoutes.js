const express = require("express");
const { getAllUploads, getUserUploads } = require("../controllers/uploadController");
const router = express.Router();

router.get("/uploads", getAllUploads); // Get all uploads
router.get("/uploads/:userId", getUserUploads); // Get user uploads

module.exports = router;
