const express = require("express");
const multer = require("multer");
const {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  repayLoan,
  getLoanBalance,
  downloadExcel,
  uploadExcel,
  downloadLatestExcel,
  updateUserPassword,
  updateUserProfile,
  getUserProfile,
  updateLoanStatus,
  updateAdminLoanBalance,
  updateAdminLoanBalanceController,
  refundUser,
  assignLoan,
  toggleSuspendUser
} = require("../controllers/userController");

const upload = require("../middleware/uploadMiddleware");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

const createUserRouter = (io, userSockets) => {
  const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, file.originalname),
});

// Admin-only routes
router.get("/", authMiddleware, adminMiddleware, getAllUsers);
router.post("/", authMiddleware, adminMiddleware, createUser);
router.put("/:id", authMiddleware, adminMiddleware, (req, res) => updateUser(req, res, io, userSockets));
router.delete("/:id", authMiddleware, adminMiddleware, deleteUser);
router.post("/loan/assign", authMiddleware, adminMiddleware, assignLoan);
router.post("/refund", authMiddleware, adminMiddleware, refundUser);
router.post("/repay-loan", authMiddleware, adminMiddleware, repayLoan);
router.post("/loan/repay", authMiddleware, adminMiddleware, refundUser);
router.put("/loan/status", authMiddleware, adminMiddleware, updateLoanStatus);
router.put("/updateLoan/loanAmount", authMiddleware, adminMiddleware, updateAdminLoanBalance);
router.post("/upload-excel", authMiddleware, adminMiddleware, upload.single("file"), uploadExcel);
router.post("/download/:filename", authMiddleware, adminMiddleware, downloadExcel);
router.put('/:id/suspend', authMiddleware, adminMiddleware, (req, res) => toggleSuspendUser(req, res, io, userSockets));

// Authenticated user routes
router.get("/loan/:userId", authMiddleware, getLoanBalance);
router.put('/:userId/updatePassword', authMiddleware, updateUserPassword);
router.put('/:userId/password', authMiddleware, updateUserPassword);
router.get('/:userId', authMiddleware, getUserProfile);
router.put('/:userId/profile', authMiddleware, updateUserProfile);

  return router;
};

module.exports = createUserRouter;