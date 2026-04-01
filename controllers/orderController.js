const {
  submitCart,
  getOrderStatus,
  processOrderItem,
  getAllOrders,
  processOrder,
  getUserCompletedOrders,
  getOrderHistory,
  updateOrderItemsStatus,
  updateSingleOrderItemStatus,
  downloadOrdersForExcel,
  getOrderTrackerData,
  cancelOrderItem,
} = require("../services/orderService");

const orderService = require('../services/orderService');
const path = require('path');

exports.submitCart = async (req, res) => {
  try {
    const { userId, mobileNumber } = req.body;

    const order = await submitCart(userId, mobileNumber);

    // Emit real-time notification to admin
    try {
      const { io } = require('../index');
      io.emit('new-order', { orderId: order.id, userId, itemCount: order.items?.length || 0 });
    } catch (e) { /* socket emit is best-effort */ }

    res.status(201).json({
      success: true,
      message: "Order submitted successfully",
      order,
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.getAllOrders = async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await getAllOrders(parseInt(limit), parseInt(offset));
    
    // Transform data to match frontend expectations
    const transformedData = result.orders.flatMap(order => 
      order.items.map(item => ({
        ...item,
        orderId: order.id,
        createdAt: order.createdAt,
        user: order.user,
        order: {
          ...order,
          items: [item] // Only include current item to avoid status mix-ups
        }
      }))
    );
    
    res.json(transformedData);
  } catch (error) {
    console.error('Error in getAllOrders:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.getOrderStatus = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      orderIdFilter,
      phoneNumberFilter,
      selectedProduct,
      selectedStatusMain,
      selectedDate,
      startTime,
      endTime,
      sortOrder = 'newest',
      showNewRequestsOnly = false
    } = req.query;

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      orderIdFilter,
      phoneNumberFilter,
      selectedProduct,
      selectedStatusMain,
      selectedDate,
      startTime,
      endTime,
      sortOrder,
      showNewRequestsOnly: showNewRequestsOnly === 'true'
    };

    const result = await getOrderStatus(options);
    res.json(result);
  } catch (error) {
    console.error('Error in getOrderStatus:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.processOrderItem = async (req, res) => {
  const { orderItemId, status } = req.body;
  try {
    const updatedItem = await processOrderItem(orderItemId, status);
    res.json({ message: "Order item status updated", updatedItem });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.processOrderController = async (req, res) => {
  const { status } = req.body;
  try {
    const updatedOrder = await processOrder(
      parseInt(req.params.orderId),
      status
    );
    res.json(updatedOrder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUserCompletedOrdersController = async (req, res) => {
  try {
    const orders = await getUserCompletedOrders(parseInt(req.params.userId));
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getOrderHistory = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId); // Get userId from request params

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Users can only view their own order history; admins can view any
    if (req.user.role?.toUpperCase() !== 'ADMIN' && req.user.id !== userId) {
      return res.status(403).json({ error: "You can only view your own order history" });
    }

    const orders = await getOrderHistory(userId);

    if (!orders.length) {
      return res.status(404).json({ message: "No order history found" });
    }

    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};





exports.updateOrderItemsStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    // Validate inputs
    if (!orderId) {
      return res.status(400).json({ success: false, message: "Order ID is required" });
    }
    
    if (!status) {
      return res.status(400).json({ success: false, message: "New status is required" });
    }
    
    // Validate status is one of the allowed values
    const allowedStatuses = ["Pending", "Processing", "Completed", "Cancelled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Status must be one of: ${allowedStatuses.join(", ")}` 
      });
    }
    
    const result = await updateOrderItemsStatus(orderId, status);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Controller error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update order items status" 
    });
  }
}

exports.updateSingleOrderItemStatus = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { status } = req.body;
    
    if (!itemId) {
      return res.status(400).json({ success: false, message: "Item ID is required" });
    }
    
    if (!status) {
      return res.status(400).json({ success: false, message: "New status is required" });
    }
    
    const allowedStatuses = ["Pending", "Processing", "Completed", "Cancelled"];
    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Status must be one of: ${allowedStatuses.join(", ")}` 
      });
    }
    
    const result = await updateSingleOrderItemStatus(itemId, status);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Controller error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to update order item status" 
    });
  }
}

exports.getOrders = async (req, res) => {
  try {
    const { 
      page, 
      limit,
      startDate,
      endDate,
      status,
      product,
      mobileNumber
    } = req.query;
    
    const filters = {
      startDate,
      endDate,
      status,
      product,
      mobileNumber
    };
    
    const result = await orderService.getOrdersPaginated({
      page,
      limit,
      filters
    });
    
    res.json(result);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: error.message });
  }
},

// Excel Upload Controller for Agent Orders
exports.uploadExcelOrders = async (req, res) => {
  const prisma = require('../config/db');
  const userService = require('../services/userService');
  const productService = require('../services/productService');
  const cartService = require('../services/cartService');
  const xlsx = require('xlsx');
  const fs = require('fs');

  try {
    const { agentId, network } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    if (!agentId || !network) {
      return res.status(400).json({ success: false, message: 'Missing agentId or network.' });
    }

    // Parse Excel file
    const filePath = req.file.path;
    let data = [];
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } catch (parseErr) {
      return res.status(400).json({ success: false, message: 'Failed to parse Excel file.' });
    }

    let total = data.length;
    let errorReport = [];

    // Fetch agent/user and role
    const agent = await userService.getUserById(parseInt(agentId));
    if (!agent) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: 'Agent not found.' });
    }
    const userRole = agent.role;
    const username = agent.name;

    // Validate all rows before adding to cart
    let productsToAdd = [];
    let totalCost = 0;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const phoneNumber = row['phone'] ? String(row['phone']).trim() : '';
      const item = row['item'] ? String(row['item']).trim() : '';
      const bundleAmount = row['bundle amount'] ? String(row['bundle amount']).trim() : '';
      const quantity = 1;
      let rowErrors = [];
      if (!phoneNumber) rowErrors.push('Missing phone');
      if (!item) rowErrors.push('Missing item (e.g: MTN - SUPERAGENT)');
      if (!bundleAmount) rowErrors.push('Missing bundle amount (e.g: 50GB)');
      // Lookup product by item and bundle amount
      let product = await prisma.product.findFirst({
        where: {
          name: item,
          description: bundleAmount
        },
      });
      if (!product) {
        rowErrors.push('Product not found for item: ' + item + ' and bundle amount: ' + bundleAmount);
      }
      // Get price for user role
      let finalPrice = null;
      if (product) {
        finalPrice = productService.getPriceForUserRole(userRole, product);
        if (finalPrice == null) {
          rowErrors.push('Price could not be determined for user role and product.');
        }
      }
      // Check stock
      if (product && product.stock < quantity) {
        rowErrors.push('Not enough stock for product: ' + item + ' (' + bundleAmount + ')');
      }
      // Accumulate total cost
      if (finalPrice && rowErrors.length === 0) {
        totalCost += finalPrice * quantity;
        productsToAdd.push({ product, quantity, phoneNumber, price: finalPrice });
      } else if (rowErrors.length > 0) {
        errorReport.push({ row: i + 2, errors: rowErrors });
      }
    }

    // Check wallet balance
    if (productsToAdd.length > 0 && agent.walletBalance !== undefined) {
      if (agent.walletBalance < totalCost) {
        errorReport.push({ row: 'ALL', errors: ['Insufficient wallet balance for total order. Required: ' + totalCost + ', Available: ' + agent.walletBalance] });
      }
    }

    // If any errors, do not add to cart
    if (errorReport.length > 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, errorReport });
    }

    // All validations passed, add to cart
    let added = 0;
    for (const item of productsToAdd) {
      await cartService.addItemToCart(agent.id, item.product.id, item.quantity, item.phoneNumber);
      added++;
    }
    fs.unlinkSync(filePath);
    return res.json({ success: true, message: `${added} products added to cart.`, summary: { total, added } });
  } catch (err) {
    if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.getOrderStats = async (req, res) => {
  try {
    const stats = await orderService.getOrderStats();
    res.json(stats);
  } catch (error) {
    console.error("Error fetching order stats:", error);
    res.status(500).json({ error: error.message });
  }
},

exports.downloadSimplifiedTemplate = (req, res) => {
  const filePath = path.join(__dirname, '..', 'public', 'order_template.xlsx');
  res.download(filePath, 'order_template.xlsx', (err) => {
    if (err) {
      console.error("Error downloading template:", err);
      res.status(500).send("Could not download the file.");
    }
  });
};

// New Excel Upload Controller for Simplified (2-column) Agent Orders
exports.uploadSimplifiedExcelOrders = async (req, res) => {
  const prisma = require('../config/db');
  const userService = require('../services/userService');
  const cartService = require('../services/cartService');
  const xlsx = require('xlsx');
  const fs = require('fs');

  try {
    const { agentId, network } = req.body;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.' });
    }
    if (!agentId || !network) {
      return res.status(400).json({ success: false, message: 'Missing agentId or network.' });
    }

    const filePath = req.file.path;
    let data = [];
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } catch (parseErr) {
      return res.status(400).json({ success: false, message: 'Failed to parse Excel file.' });
    }

    let total = data.length;
    let errorReport = [];

    const agent = await userService.getUserById(parseInt(agentId));
    if (!agent) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ success: false, message: 'Agent not found.' });
    }
    const userRole = agent.role; 

    let productsToAdd = [];
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      // Support multiple column name variations (case-insensitive)
      const getColumnValue = (row, possibleNames) => {
        for (const name of possibleNames) {
          // Check exact match first
          if (row[name] !== undefined) return String(row[name]).trim();
          // Check case-insensitive match
          const key = Object.keys(row).find(k => k.toLowerCase() === name.toLowerCase());
          if (key && row[key] !== undefined) return String(row[key]).trim();
        }
        return '';
      };
      
      const phoneNumber = getColumnValue(row, ['phone', 'Phone', 'PHONE', 'phone_number', 'Phone Number', 'phoneNumber']);
      const bundleAmount = getColumnValue(row, ['bundle_amount', 'bundle amount', 'Bundle_Amount', 'Bundle Amount', 'BUNDLE_AMOUNT', 'BUNDLE AMOUNT', 'bundle', 'Bundle', 'amount', 'Amount', 'data', 'Data', 'gb', 'GB']);
      
      let rowErrors = [];

      if (!phoneNumber) rowErrors.push('Missing phone number.');
      if (!bundleAmount || isNaN(parseFloat(bundleAmount))) rowErrors.push(`Invalid or missing bundle amount. It must be a number. Got: "${bundleAmount}"`);

      if(rowErrors.length > 0) {
        errorReport.push({ row: i + 2, errors: rowErrors });
        continue; // Skip to next row
      }

      const productDescription = `${bundleAmount}GB`;
      let productName;
      if (userRole.toUpperCase() === 'USER') {
        // For 'USER' role, product name is just the network
        productName = network.toUpperCase();
      } else {
        // For all other roles, it's 'NETWORK - ROLE'
        productName = `${network.toUpperCase()} - ${userRole.toUpperCase()}`;
      }

      const product = await prisma.product.findFirst({
        where: {
          name: productName,
          description: productDescription,
        },
      });

      if (!product) {
        rowErrors.push(`Product not found for your user type (${userRole}) with bundle ${productDescription} and network ${network}.`);
      } else {
          productsToAdd.push({ 
              product, 
              quantity: 1, // Quantity is always 1 in the new flow
              phoneNumber 
            });
      }

      if (rowErrors.length > 0) {
        errorReport.push({ row: i + 2, errors: rowErrors });
      }
    }

    if (errorReport.length > 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({ 
        success: false, 
        message: 'Validation errors occurred.',
        summary: { total, successful: total - errorReport.length, failed: errorReport.length },
        errors: errorReport 
      });
    }

    // All validations passed — add to cart
    const productService = require('../services/productService');
    const cartService = require('../services/cartService');

    let added = 0;
    for (const item of productsToAdd) {
      await cartService.addItemToCart(agent.id, item.product.id, item.quantity || 1, item.phoneNumber);
      added++;
    }

    fs.unlinkSync(filePath);
    return res.json({ 
        success: true, 
        message: `${added} products added to cart.`,
        summary: { total, successful: added, failed: 0 }
    });

  } catch (err) {
    if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch (e) {}
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    const updatedOrder = await orderService.updateOrderStatus(orderId, status);
    res.json(updatedOrder);
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ error: error.message });
  }
}

// Direct order creation from ext_agent system
exports.createDirectOrder = async (req, res) => {
  try {
    const { userId, items, totalAmount } = req.body;
    
    // Validate required fields
    if (!userId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: userId, items array' 
      });
    }

    const order = await orderService.createDirectOrder(userId, items, totalAmount);
    
    // Emit real-time notification to admin
    try {
      const { io } = require('../index');
      io.emit('new-order', { orderId: order.id, userId, itemCount: items?.length || 0 });
    } catch (e) { /* socket emit is best-effort */ }

    res.status(201).json({
      success: true,
      message: "Direct order created successfully",
      orderId: order.id,
      order
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Get specific order by ID for status sync
exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }

    const prisma = require('../config/db');
    
    const order = await prisma.order.findUnique({
      where: { id: parseInt(orderId) },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, description: true, price: true }
            }
          }
        },
        user: {
          select: { id: true, name: true, email: true, phone: true }
        }
      }
    });
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order ${orderId} not found`
      });
    }

    // Transform to match expected format
    const matchingOrders = order.items.map(item => ({
      id: item.id,
      orderId: order.id,
      productId: item.productId,
      quantity: item.quantity,
      mobileNumber: item.mobileNumber || order.mobileNumber,
      user: order.user,
      product: item.product,
      order: {
        id: order.id,
        createdAt: order.createdAt,
        items: [{ status: item.status }]
      }
    }));
    
    res.json({
      success: true,
      data: matchingOrders,
      orderId: parseInt(orderId),
      itemCount: matchingOrders.length
    });
  } catch (error) {
    console.error(`[GET ORDER] Error fetching order ${req.params.orderId}:`, error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

// Get multiple orders by IDs for GB calculation
exports.getOrdersByIds = async (req, res) => {
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Order IDs array is required'
      });
    }

    const orders = await orderService.getOrdersByIds(orderIds);
    
    res.json({
      success: true,
      orders
    });
  } catch (error) {
    console.error(`❌ [GET ORDERS BY IDS] Error:`, error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

// Batch complete all processing orders (respects filters)
exports.batchCompleteProcessing = async (req, res) => {
  try {
    const { selectedProduct, selectedDate, sourceFilter, phoneNumberFilter, orderIdFilter, startTime, endTime } = req.body;
    const result = await orderService.batchCompleteProcessingOrders({
      selectedProduct, selectedDate, sourceFilter, phoneNumberFilter, orderIdFilter, startTime, endTime
    });
    res.json({
      success: true,
      message: `Successfully completed ${result.count} processing orders`,
      count: result.count
    });
  } catch (error) {
    console.error(`❌ [BATCH COMPLETE] Error:`, error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

// Order tracker data with balance tracking and fraud detection
exports.getOrderTracker = async (req, res) => {
  try {
    const { agentId, productId, startDate, endDate, startTime, endTime } = req.query;
    const result = await getOrderTrackerData({ agentId, productId, startDate, endDate, startTime, endTime });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in getOrderTracker:', error);
    res.status(500).json({ success: false, message: error.message });
  }
}

// Download orders for Excel and update pending to processing
exports.downloadOrdersForExcel = async (req, res) => {
  try {
    const { statusFilter, selectedProduct, selectedDate, sortOrder, sourceFilter, phoneNumberFilter, orderIdFilter, startTime, endTime } = req.query;
    const result = await downloadOrdersForExcel({
      statusFilter, selectedProduct, selectedDate, sortOrder,
      sourceFilter, phoneNumberFilter, orderIdFilter, startTime, endTime
    });
    res.json(result);
  } catch (error) {
    console.error('Error in downloadOrdersForExcel:', error);
    res.status(500).json({ error: error.message });
  }
}

exports.cancelOrderItem = async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const orderItemId = parseInt(req.params.itemId);
    const result = await cancelOrderItem(userId, orderItemId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// ==================== ORDER BATCH (Order Files) ====================
const orderBatchService = require('../services/orderBatchService');
const xlsx = require('xlsx');

exports.getPendingCounts = async (req, res) => {
  try {
    const counts = await orderBatchService.getPendingCountsByNetwork();
    res.json({ success: true, counts });
  } catch (error) {
    console.error('Error fetching pending counts:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.exportPendingOrders = async (req, res) => {
  try {
    const { network } = req.body;
    if (!network) return res.status(400).json({ success: false, message: 'Network is required' });

    const adminUserId = req.user.id;
    const { batch, rows, totalItems, totalPrice } = await orderBatchService.exportPendingByNetwork(adminUserId, network);

    const worksheetData = rows.map(row => {
      let phone = row.phone || '';
      if (phone.startsWith('233')) phone = '0' + phone.substring(3);
      const dataSize = (row.bundle || '').replace(/[^0-9.]/g, '');
      return { 'Phone Number': phone, 'Data Size': dataSize };
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(worksheetData);
    xlsx.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=${batch.filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Error exporting pending orders:', error);
    res.status(error.message.includes('No pending') ? 404 : 500).json({ success: false, message: error.message });
  }
};

exports.getAllBatches = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await orderBatchService.getAllBatches(parseInt(page), parseInt(limit));
    res.json({ success: true, batches: result.batches, pagination: result.pagination });
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getBatchById = async (req, res) => {
  try {
    const batch = await orderBatchService.getBatchById(req.params.batchId);
    res.json({ success: true, batch });
  } catch (error) {
    console.error('Error fetching batch:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBatchStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const result = await orderBatchService.updateBatchStatus(req.params.batchId, status);
    res.json(result);
  } catch (error) {
    console.error('Error updating batch status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateBatchOrderItemStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const result = await orderBatchService.updateBatchOrderItemStatus(req.params.batchId, req.params.itemId, status);
    res.json(result);
  } catch (error) {
    console.error('Error updating batch item status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.downloadBatch = async (req, res) => {
  try {
    const { batch, rows } = await orderBatchService.getBatchForDownload(req.params.batchId);

    const worksheetData = rows.map(row => {
      let phone = row.phone || '';
      if (phone.startsWith('233')) phone = '0' + phone.substring(3);
      const dataSize = (row.bundle || '').replace(/[^0-9.]/g, '');
      return { 'Phone Number': phone, 'Data Size': dataSize };
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(worksheetData);
    xlsx.utils.book_append_sheet(wb, ws, 'Orders');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=${batch.filename}`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Error downloading batch:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
