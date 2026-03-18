const topupPaymentService = require("../services/topupPaymentService");

// Initialize Paystack payment for wallet top-up
const initializeTopup = async (req, res) => {
  try {
    const { userId, amount } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({
        success: false,
        message: "User ID and amount are required",
      });
    }

    if (parseFloat(amount) < 1) {
      return res.status(400).json({
        success: false,
        message: "Minimum top-up amount is GHS 1",
      });
    }

    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard?topup=callback`;
    const result = await topupPaymentService.initializeTopupPayment(userId, amount, callbackUrl);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error initializing top-up payment:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to initialize payment",
    });
  }
};

// Verify Paystack payment and credit wallet
const verifyTopup = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required",
      });
    }

    const result = await topupPaymentService.verifyTopupPayment(reference);

    if (result.success) {
      res.status(200).json(result);
    } else if (result.pending) {
      res.status(202).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error("Error verifying top-up payment:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to verify payment",
    });
  }
};

// Handle Paystack webhook for top-ups
const handleWebhook = async (req, res) => {
  try {
    const result = await topupPaymentService.handleTopupWebhook(req.body);
    res.status(200).json(result);
  } catch (error) {
    console.error("Error handling top-up webhook:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get all top-ups (for admin)
const getTopUps = async (req, res) => {
  try {
    const { startDate, endDate, status } = req.query;
    const topUps = await topupPaymentService.getAllTopups(startDate, endDate, status);
    res.status(200).json(topUps);
  } catch (error) {
    console.error("Error fetching top-ups:", error);
    res.status(500).json({ success: false, message: "Failed to fetch top-ups" });
  }
};

// Get user's top-up history
const getUserTopups = async (req, res) => {
  try {
    const { userId } = req.params;
    const topUps = await topupPaymentService.getUserTopups(userId);
    res.status(200).json({ success: true, data: topUps });
  } catch (error) {
    console.error("Error fetching user top-ups:", error);
    res.status(500).json({ success: false, message: "Failed to fetch top-ups" });
  }
};

// Delete a top-up record
const deleteTopup = async (req, res) => {
  try {
    const { id } = req.params;
    await topupPaymentService.deleteTopup(id);
    res.status(200).json({ success: true, message: "Top-up deleted successfully" });
  } catch (error) {
    console.error("Error deleting top-up:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to delete top-up" });
  }
};

// Verify top-up using Transaction ID (SMS verification)
const verifyTransactionId = async (req, res) => {
  try {
    const { userId, referenceId } = req.body;

    if (!userId || !referenceId) {
      return res.status(400).json({
        success: false,
        message: "User ID and Transaction ID are required",
      });
    }

    const result = await topupPaymentService.verifyTransactionIdTopup(userId, referenceId);

    res.status(200).json(result);
  } catch (error) {
    console.error("Error in transaction ID top-up:", error);

    const statusCode =
      error.message.includes("Invalid") ||
      error.message.includes("not found") ||
      error.message.includes("already")
        ? 400
        : 500;

    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  initializeTopup,
  verifyTopup,
  handleWebhook,
  getTopUps,
  getUserTopups,
  deleteTopup,
  verifyTransactionId,
};
