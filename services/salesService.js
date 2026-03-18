const prisma = require("../config/db");

/**
 * Get total sales for a user on a specific date
 * 
 * @param {number} userId - The ID of the user
 * @param {Date} date - The date to get sales for (defaults to today)
 * @return {Promise<object>} - Sales data
 */
const getDailySales = async (userId, date = new Date()) => {
  try {
    // Convert the date to start and end of the day
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);
    
    // Get all completed orders for the user on the specified date
    const orders = await prisma.order.findMany({
      where: {
        userId: parseInt(userId),
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: "Completed", // Assuming "Completed" is the status for successful orders
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });
    
    // Calculate total sales
    let totalSales = 0;
    let totalItems = 0;
    const soldProducts = [];
    
    for (const order of orders) {
      for (const item of order.items) {
        const itemTotal = item.quantity * item.product.price;
        totalSales += itemTotal;
        totalItems += item.quantity;
        
        const existingProductIndex = soldProducts.findIndex(p => p.id === item.product.id);
        if (existingProductIndex !== -1) {
          soldProducts[existingProductIndex].quantity += item.quantity;
          soldProducts[existingProductIndex].total += itemTotal;
        } else {
          soldProducts.push({
            id: item.product.id,
            name: item.product.name,
            quantity: item.quantity,
            total: itemTotal
          });
        }
      }
    }
    
    // Get transactions for the day (if you want to include them in the report)
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: parseInt(userId),
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        type: "SALE" // Assuming "SALE" is the transaction type for sales
      }
    });
    
    return {
      date: startDate.toISOString().split('T')[0],
      totalSales,
      totalItems,
      totalOrders: orders.length,
      soldProducts,
      transactions
    };
  } catch (error) {
    console.error("Error getting daily sales:", error);
    throw error;
  }
};

/**
 * Get sales summary for user over a time period
 * 
 * @param {number} userId - The ID of the user
 * @param {Date} startDate - Start of period
 * @param {Date} endDate - End of period
 * @return {Promise<Array>} - Daily sales data for the period
 */
const getSalesSummary = async (userId, startDate, endDate) => {
  try {
    // Normalize date range
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    // Get all orders for the period
    const orders = await prisma.order.findMany({
      where: {
        userId: parseInt(userId),
        createdAt: {
          gte: start,
          lte: end,
        },
        status: "Completed"
      },
      include: {
        items: {
          include: {
            product: true,
          },
        },
      },
    });
    
    // Group orders by date
    const salesByDate = {};
    
    for (const order of orders) {
      const orderDate = order.createdAt.toISOString().split('T')[0];
      
      if (!salesByDate[orderDate]) {
        salesByDate[orderDate] = {
          date: orderDate,
          totalSales: 0,
          totalItems: 0,
          totalOrders: 0
        };
      }
      
      salesByDate[orderDate].totalOrders += 1;
      
      for (const item of order.items) {
        const itemTotal = item.quantity * item.product.price;
        salesByDate[orderDate].totalSales += itemTotal;
        salesByDate[orderDate].totalItems += item.quantity;
      }
    }
    
    // Convert to array and sort by date
    const summaryArray = Object.values(salesByDate).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );
    
    return summaryArray;
  } catch (error) {
    console.error("Error getting sales summary:", error);
    throw error;
  }
};

/**
 * Get current user balance
 * 
 * @param {number} userId - The ID of the user
 * @return {Promise<number>} - User balance
 */
const getUserBalance = async (userId) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      select: { loanBalance: true }
    });
    
    return user ? user.loanBalance : 0;
  } catch (error) {
    console.error("Error getting user balance:", error);
    throw error;
  }
};

module.exports = {
  getDailySales,
  getSalesSummary,
  getUserBalance
};