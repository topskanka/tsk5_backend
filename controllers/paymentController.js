const paymentService = require('../services/paymentService');
const shopService = require('../services/shopService');
const crypto = require('crypto');
const prisma = require('../config/db');

// Atomic order creation - prevents duplicate orders from webhook + verify race condition
const createOrderIfNotExists = async (externalRef, productId, mobileNumber) => {
  // Get or create the shop user outside the transaction to avoid unnecessary locking
  const shopUser = await shopService.getOrCreateShopUser();

  return await prisma.$transaction(async (tx) => {
    // Re-check inside transaction to prevent race condition
    const transaction = await tx.paymentTransaction.findUnique({
      where: { externalRef }
    });
    
    if (!transaction) {
      return { created: false, error: 'Transaction not found' };
    }
    
    // If order already linked, return existing
    if (transaction.orderId) {
      const existingOrder = await tx.order.findUnique({
        where: { id: transaction.orderId }
      });
      return { created: false, alreadyExists: true, orderId: transaction.orderId, order: existingOrder };
    }

    // Get the product
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) {
      return { created: false, error: 'Product not found' };
    }
    
    // Create the order within the same transaction
    const order = await tx.order.create({
      data: {
        userId: shopUser.id,
        mobileNumber: mobileNumber,
        status: "Pending",
        items: {
          create: [{
            productId: productId,
            quantity: 1,
            mobileNumber: mobileNumber,
            status: "Pending",
            productName: product.name,
            productPrice: (product.usePromoPrice && product.promoPrice != null) ? product.promoPrice : product.price,
            productDescription: product.description
          }]
        }
      },
      include: { items: true }
    });
    
    // Link transaction to order atomically
    await tx.paymentTransaction.update({
      where: { externalRef },
      data: { orderId: order.id }
    });
    
    return { created: true, orderId: order.id, order };
  }, { timeout: 15000 });
};

// Initialize Paystack payment
const initializePayment = async (req, res) => {
  try {
    const { email, mobileNumber, amount, productId, productName } = req.body;

    if (!mobileNumber || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number and amount are required'
      });
    }

    // Check product availability before initializing payment
    if (productId) {
      const product = await prisma.product.findUnique({ where: { id: parseInt(productId) } });
      if (!product) {
        return res.status(400).json({ success: false, message: 'Product not found' });
      }
      if (product.stock <= 0) {
        return res.status(400).json({ success: false, message: 'Product is out of stock' });
      }
      if (product.shopStockClosed) {
        return res.status(400).json({ success: false, message: 'Product is currently unavailable for purchase' });
      }
      if (!product.showInShop) {
        return res.status(400).json({ success: false, message: 'Product is not available in shop' });
      }
    }

    // Build callback URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const callbackUrl = `${frontendUrl}/shop?payment=callback`;

    const result = await paymentService.initializePayment(
      email,
      mobileNumber,
      amount,
      productId,
      productName,
      callbackUrl
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Payment initialized',
        transactionId: result.transactionId,
        externalRef: result.externalRef,
        paymentUrl: result.paymentUrl,
        accessCode: result.accessCode,
        reference: result.reference
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to initialize payment',
        transactionId: result.transactionId,
        externalRef: result.externalRef
      });
    }
  } catch (error) {
    console.error('Payment initialization error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Handle Paystack webhook callback
const handleWebhook = async (req, res) => {
  try {
    // Verify webhook signature
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    if (hash !== req.headers['x-paystack-signature']) {
      console.error('Invalid Paystack webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    console.log('Paystack Webhook received:', req.body.event);
    
    // Check if this is a referral order - skip order creation as it's handled by storefront verify
    const metadata = req.body.data?.metadata;
    if (metadata?.type === 'referral_order') {
      console.log('Webhook: Skipping referral order - handled by storefront verification');
      return res.status(200).json({ received: true, type: 'referral_order' });
    }
    
    // Skip topup webhooks - they're handled by topup routes
    if (req.body.data?.reference?.startsWith('TOPUP-')) {
      return res.status(200).json({ received: true, type: 'topup' });
    }

    const result = await paymentService.handleWebhook(req.body);

    if (result.success && result.productId && result.mobileNumber) {
      // Payment successful - create order atomically (prevents duplicates with verify endpoint)
      try {
        const orderResult = await createOrderIfNotExists(
          result.externalRef,
          result.productId,
          result.mobileNumber
        );
        if (orderResult.created) {
          console.log('[Webhook] Order created:', orderResult.orderId);
        } else if (orderResult.alreadyExists) {
          console.log('[Webhook] Order already exists:', orderResult.orderId);
        }
      } catch (orderError) {
        console.error('[Webhook] Order creation error:', orderError.message);
      }
    }

    // Always respond 200 to webhook
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook handling error:', error);
    res.status(200).json({ received: true, error: error.message });
  }
};

// Verify payment status (called from frontend after redirect)
const verifyPaymentStatus = async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Payment reference is required'
      });
    }

    console.log('[Payment Verify] Starting verification for:', reference);

    // Retry logic - try up to 3 times with delays
    let lastError = null;
    let result = null;
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        result = await paymentService.verifyPayment(reference);
        if (result.success || result.pending === false) {
          break; // Got a definitive result
        }
        // If pending, wait and retry
        if (result.pending && attempt < 3) {
          console.log(`[Payment Verify] Attempt ${attempt} - Payment pending, retrying in 2s...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (err) {
        lastError = err;
        console.error(`[Payment Verify] Attempt ${attempt} failed:`, err.message);
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }

    if (!result && lastError) {
      throw lastError;
    }

    if (result.success) {
      // Payment confirmed - create order atomically (prevents duplicates with webhook)
      const transaction = await paymentService.checkPaymentStatus(reference);
      
      if (!transaction.orderId && transaction.productId && transaction.mobileNumber) {
        // Atomic order creation with retry
        let orderResult = null;
        let lastOrderError = null;

        for (let orderAttempt = 1; orderAttempt <= 3; orderAttempt++) {
          try {
            console.log(`[Payment Verify] Creating order atomically - attempt ${orderAttempt}`);
            orderResult = await createOrderIfNotExists(
              reference,
              transaction.productId,
              transaction.mobileNumber
            );
            if (orderResult.created || orderResult.alreadyExists) {
              console.log('[Payment Verify] Order result:', orderResult.created ? 'created' : 'already exists', orderResult.orderId);
              break;
            }
          } catch (err) {
            lastOrderError = err;
            console.error(`[Payment Verify] Order creation attempt ${orderAttempt} failed:`, err.message);
            if (orderAttempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }

        if (orderResult && (orderResult.created || orderResult.alreadyExists)) {
          res.json({
            success: true,
            message: 'Payment verified and order placed!',
            status: 'SUCCESS',
            order: {
              id: orderResult.orderId,
              mobileNumber: transaction.mobileNumber
            }
          });
        } else {
          console.error('[Payment Verify] All order creation attempts failed:', lastOrderError?.message);
          res.json({
            success: true,
            message: 'Payment verified! Order will be processed shortly.',
            status: 'SUCCESS',
            orderPending: true,
            reference: reference
          });
        }
      } else if (transaction.orderId) {
        res.json({
          success: true,
          message: 'Payment already verified',
          status: 'SUCCESS',
          order: { 
            id: transaction.orderId,
            mobileNumber: transaction.mobileNumber
          }
        });
      } else {
        // Payment verified but missing product/mobile info
        res.json({
          success: true,
          message: 'Payment verified! Order will be processed shortly.',
          status: 'SUCCESS',
          orderPending: true,
          reference: reference
        });
      }
    } else if (result.pending) {
      res.json({
        success: false,
        message: 'Payment is still pending. Please complete the payment.',
        status: 'PENDING'
      });
    } else {
      res.json({
        success: false,
        message: 'Payment failed or was abandoned',
        status: 'FAILED'
      });
    }
  } catch (error) {
    console.error('[Payment Verify] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Check payment status
const checkStatus = async (req, res) => {
  try {
    const { externalRef } = req.params;

    if (!externalRef) {
      return res.status(400).json({
        success: false,
        message: 'External reference is required'
      });
    }

    const status = await paymentService.checkPaymentStatus(externalRef);
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    console.error('Payment status check error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Get all payment transactions (admin)
const getAllTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const result = await paymentService.getAllPaymentTransactions(page, limit);
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

// Reconcile orphaned payments - process successful payments without orders
const reconcilePayments = async (req, res) => {
  try {
    console.log('[Payment Reconciliation] Starting reconciliation...');
    
    const orphanedPayments = await paymentService.getOrphanedSuccessfulPayments();
    console.log(`[Payment Reconciliation] Found ${orphanedPayments.length} orphaned payments`);

    const results = {
      processed: 0,
      ordersCreated: 0,
      failed: 0,
      details: []
    };

    for (const payment of orphanedPayments) {
      try {
        const result = await paymentService.verifyAndCreateOrder(payment.externalRef, shopService);
        results.processed++;
        
        if (result.success && result.orderId) {
          results.ordersCreated++;
          results.details.push({
            reference: payment.externalRef,
            status: 'success',
            orderId: result.orderId
          });
        } else if (result.success && result.message === 'Order already exists') {
          results.details.push({
            reference: payment.externalRef,
            status: 'already_exists',
            orderId: result.orderId
          });
        } else {
          results.failed++;
          results.details.push({
            reference: payment.externalRef,
            status: 'failed',
            error: result.error
          });
        }
      } catch (error) {
        results.failed++;
        results.details.push({
          reference: payment.externalRef,
          status: 'error',
          error: error.message
        });
      }
    }

    console.log('[Payment Reconciliation] Complete:', results);

    res.json({
      success: true,
      message: `Reconciliation complete. Created ${results.ordersCreated} orders.`,
      ...results
    });
  } catch (error) {
    console.error('[Payment Reconciliation] Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Reconciliation failed'
    });
  }
};

// Get orphaned payments (successful payments without orders)
const getOrphanedPayments = async (req, res) => {
  try {
    const orphanedPayments = await paymentService.getOrphanedSuccessfulPayments();
    res.json({
      success: true,
      count: orphanedPayments.length,
      payments: orphanedPayments
    });
  } catch (error) {
    console.error('Get orphaned payments error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error'
    });
  }
};

module.exports = {
  initializePayment,
  handleWebhook,
  verifyPaymentStatus,
  checkStatus,
  getAllTransactions,
  reconcilePayments,
  getOrphanedPayments
};
