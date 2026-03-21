const express = require('express');
const orderController = require('../controllers/orderController'); // Import controller
const path = require('path');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// Download Excel template for order upload
const templatePath = path.join(__dirname, '../uploads/order_upload_template.xlsx');

// Route to download the Excel template
const router = express.Router();
router.get('/download-template', (req, res) => {
  res.download(templatePath, 'order_upload_template.xlsx');
});

// Excel upload for agent orders (requires auth)
router.post('/upload-excel', authMiddleware, upload.single('file'), orderController.uploadExcelOrders);

// User: Submit cart as an order
router.post('/submit', authMiddleware, orderController.submitCart);

router.get('/download-simplified-template', authMiddleware, orderController.downloadSimplifiedTemplate);
router.post('/upload-simplified', authMiddleware, upload.single('file'), orderController.uploadSimplifiedExcelOrders);

// Admin: Process an order (update status) - REQUIRES ADMIN AUTH
router.put('/admin/process/:orderId', authMiddleware, adminMiddleware, orderController.processOrderController);

router.post('/admin/process/order', authMiddleware, adminMiddleware, orderController.processOrderItem);

router.get('/admin/allorder', authMiddleware, adminMiddleware, orderController.getOrderStatus);

// Order tracker with balance tracking and fraud detection (requires admin)
router.get('/admin/order-tracker', authMiddleware, adminMiddleware, orderController.getOrderTracker);

// Download orders for Excel export and update pending to processing (requires admin)
router.get('/admin/download-excel', authMiddleware, adminMiddleware, orderController.downloadOrdersForExcel);

// ==================== ORDER BATCH (Order Files) ====================
// These MUST be above /admin/:userId to avoid being caught by the param route
router.get('/admin/batches/pending-counts', authMiddleware, adminMiddleware, orderController.getPendingCounts);
router.post('/admin/batches/export', authMiddleware, adminMiddleware, orderController.exportPendingOrders);
router.get('/admin/batches', authMiddleware, adminMiddleware, orderController.getAllBatches);
router.get('/admin/batches/:batchId', authMiddleware, adminMiddleware, orderController.getBatchById);
router.put('/admin/batches/:batchId/status', authMiddleware, adminMiddleware, orderController.updateBatchStatus);
router.put('/admin/batches/:batchId/items/:itemId/status', authMiddleware, adminMiddleware, orderController.updateBatchOrderItemStatus);
router.get('/admin/batches/:batchId/download', authMiddleware, adminMiddleware, orderController.downloadBatch);

router.get("/admin/:userId", authMiddleware, orderController.getOrderHistory);

// Get specific order by ID for status sync (requires auth)
router.get("/status/:orderId", authMiddleware, orderController.getOrderById);

// User: View completed orders (requires auth)
router.get('/user/completed/:userId', authMiddleware, orderController.getUserCompletedOrdersController);

// Order status updates (requires admin)
router.put('/orders/:orderId/status', authMiddleware, adminMiddleware, orderController.updateOrderItemsStatus);
router.put('/items/:itemId/status', authMiddleware, adminMiddleware, orderController.updateSingleOrderItemStatus);

// Agent: Cancel a pending order item (refunds wallet)
router.post('/cancel/:userId/:itemId', authMiddleware, orderController.cancelOrderItem);

// Direct order creation from ext_agent system (requires auth)
router.post('/create-direct', authMiddleware, orderController.createDirectOrder);

// Get multiple orders by IDs for GB calculation (requires admin)
router.post('/admin/orders-by-ids', authMiddleware, adminMiddleware, orderController.getOrdersByIds);

// Batch complete all processing orders (requires admin)
router.post('/admin/batch-complete', authMiddleware, adminMiddleware, orderController.batchCompleteProcessing);

module.exports = router;