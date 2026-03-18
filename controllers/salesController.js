// controllers/salesController.js
const salesService = require('../services/salesService');

// Define both functions using exports directly
exports.getDailySales = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 1; // Assuming you have authentication middleware that sets req.user
    const date = req.query.date ? new Date(req.query.date) : new Date();
    
    const salesData = await salesService.getDailySales(userId, date);
    const balance = await salesService.getUserBalance(userId);
    
    res.status(200).json({
      success: true,
      data: {
        ...salesData,
        currentBalance: balance
      }
    });
  } catch (error) {
    console.error("Error in getDailySales controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve daily sales",
      error: error.message
    });
  }
};

exports.getSalesSummary = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : 1;
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Both startDate and endDate are required"
      });
    }
    
    const summaryData = await salesService.getSalesSummary(
      userId,
      new Date(startDate),
      new Date(endDate)
    );
    
    const balance = await salesService.getUserBalance(userId);
    
    res.status(200).json({
      success: true,
      data: {
        summary: summaryData,
        currentBalance: balance
      }
    });
  } catch (error) {
    console.error("Error in getSalesSummary controller:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve sales summary",
      error: error.message
    });
  }
};

// No need for module.exports at the end, we're using exports.functionName directly