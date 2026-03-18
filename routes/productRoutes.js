// routes/productRoutes.js
const express = require('express');
const productController = require('../controllers/productController');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');

const router = express.Router();

// Public read routes (for shop/agents)
router.get('/shop', productController.getShopProducts);
router.get('/agent-products', productController.getAgentProducts);

// Authenticated read routes
router.get('/', authMiddleware, productController.getAllProducts);
router.get('/:id', authMiddleware, productController.getProductById);

// Admin-only write routes
router.post('/add', authMiddleware, adminMiddleware, productController.addProduct);
router.put('/update/:id', authMiddleware, adminMiddleware, productController.updateProduct);
router.put('/toggle-shop/:id', authMiddleware, adminMiddleware, productController.toggleShopVisibility);
router.put('/zero-stock/:id', authMiddleware, adminMiddleware, productController.setProductStockToZero);
router.patch('/reset-all-stock-to-zero', authMiddleware, adminMiddleware, productController.resetAllProductStock);
router.patch('/bulk-stock-by-carrier', authMiddleware, adminMiddleware, productController.bulkUpdateStockByCarrier);
router.patch('/bulk-shop-stock', authMiddleware, adminMiddleware, productController.bulkUpdateShopStock);
router.put('/toggle-agent/:id', authMiddleware, adminMiddleware, productController.toggleAgentVisibility);
router.patch('/bulk-agent-visibility', authMiddleware, adminMiddleware, productController.bulkUpdateAgentVisibility);
router.put('/toggle-promo/:id', authMiddleware, adminMiddleware, productController.togglePromoPrice);
router.patch('/bulk-toggle-promo', authMiddleware, adminMiddleware, productController.bulkTogglePromoPrice);
router.delete('/delete/:id', authMiddleware, adminMiddleware, productController.deleteProduct);

module.exports = router;
