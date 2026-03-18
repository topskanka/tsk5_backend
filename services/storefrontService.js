const axios = require('axios');
const prisma = require('../config/db');

// Paystack API URLs
const PAYSTACK_INITIALIZE_URL = 'https://api.paystack.co/transaction/initialize';
const PAYSTACK_VERIFY_URL = 'https://api.paystack.co/transaction/verify';

// Generate unique reference for referral orders
const generateReferralRef = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `REF-${timestamp}-${random}`;
};

// Generate unique storefront slug from agent name
const generateStorefrontSlug = (name) => {
  const base = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const random = Math.random().toString(36).substring(2, 6);
  return `${base}-${random}`;
};

// ==================== AGENT STOREFRONT MANAGEMENT ====================

// Get or create storefront slug for an agent
const getOrCreateStorefrontSlug = async (agentId) => {
  const agent = await prisma.user.findUnique({
    where: { id: parseInt(agentId) },
    select: { id: true, name: true, storefrontSlug: true }
  });

  if (!agent) throw new Error('Agent not found');

  if (agent.storefrontSlug) {
    return agent.storefrontSlug;
  }

  // Generate and save new slug
  const slug = generateStorefrontSlug(agent.name);
  await prisma.user.update({
    where: { id: parseInt(agentId) },
    data: { storefrontSlug: slug }
  });

  return slug;
};

// Get all products available for storefront (filtered by agent role)
const getAvailableProducts = async (agentId) => {
  // Get agent's role
  const agent = await prisma.user.findUnique({
    where: { id: parseInt(agentId) },
    select: { role: true }
  });

  if (!agent) throw new Error('Agent not found');

  const role = agent.role;

  // Build product name filter based on role
  // Products are named like "MTN - SUPER", "VODAFONE - PREMIUM", etc.
  // For USER role, products don't have role suffix (just "MTN", "VODAFONE")
  let nameFilter;
  if (role === 'USER') {
    // For USER role, get products without role suffix
    nameFilter = {
      AND: [
        { name: { not: { contains: ' - SUPER' } } },
        { name: { not: { contains: ' - PREMIUM' } } },
        { name: { not: { contains: ' - NORMAL' } } },
        { name: { not: { contains: ' - OTHER' } } }
      ]
    };
  } else {
    // For other roles, get products with their role suffix
    nameFilter = { name: { contains: ` - ${role}` } };
  }

  return await prisma.product.findMany({
    where: {
      stock: { gt: 0 },
      ...nameFilter
    },
    orderBy: [{ name: 'asc' }, { price: 'asc' }]
  });
};

// Get agent's storefront products
const getAgentStorefrontProducts = async (agentId) => {
  return await prisma.storefrontProduct.findMany({
    where: { agentId: parseInt(agentId) },
    include: {
      product: {
        select: { id: true, name: true, description: true, price: true, stock: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
};

// Add product to agent's storefront
const addProductToStorefront = async (agentId, productId, customPrice) => {
  const product = await prisma.product.findUnique({
    where: { id: parseInt(productId) }
  });

  if (!product) throw new Error('Product not found');
  
  if (parseFloat(customPrice) < product.price) {
    throw new Error(`Custom price cannot be less than base price (GHS ${product.price})`);
  }

  // Check if already exists
  const existing = await prisma.storefrontProduct.findUnique({
    where: {
      agentId_productId: {
        agentId: parseInt(agentId),
        productId: parseInt(productId)
      }
    }
  });

  if (existing) {
    // Update existing
    return await prisma.storefrontProduct.update({
      where: { id: existing.id },
      data: { customPrice: parseFloat(customPrice), isActive: true },
      include: { product: true }
    });
  }

  // Create new
  return await prisma.storefrontProduct.create({
    data: {
      agentId: parseInt(agentId),
      productId: parseInt(productId),
      customPrice: parseFloat(customPrice)
    },
    include: { product: true }
  });
};

// Update product price in storefront
const updateStorefrontProductPrice = async (agentId, storefrontProductId, customPrice) => {
  const storefrontProduct = await prisma.storefrontProduct.findFirst({
    where: {
      id: parseInt(storefrontProductId),
      agentId: parseInt(agentId)
    },
    include: { product: true }
  });

  if (!storefrontProduct) throw new Error('Storefront product not found');

  if (parseFloat(customPrice) < storefrontProduct.product.price) {
    throw new Error(`Custom price cannot be less than base price (GHS ${storefrontProduct.product.price})`);
  }

  return await prisma.storefrontProduct.update({
    where: { id: parseInt(storefrontProductId) },
    data: { customPrice: parseFloat(customPrice) },
    include: { product: true }
  });
};

// Remove product from storefront
const removeProductFromStorefront = async (agentId, storefrontProductId) => {
  const storefrontProduct = await prisma.storefrontProduct.findFirst({
    where: {
      id: parseInt(storefrontProductId),
      agentId: parseInt(agentId)
    }
  });

  if (!storefrontProduct) throw new Error('Storefront product not found');

  await prisma.storefrontProduct.delete({
    where: { id: parseInt(storefrontProductId) }
  });

  return { success: true, message: 'Product removed from storefront' };
};

// Toggle product active status
const toggleStorefrontProduct = async (agentId, storefrontProductId) => {
  const storefrontProduct = await prisma.storefrontProduct.findFirst({
    where: {
      id: parseInt(storefrontProductId),
      agentId: parseInt(agentId)
    }
  });

  if (!storefrontProduct) throw new Error('Storefront product not found');

  return await prisma.storefrontProduct.update({
    where: { id: parseInt(storefrontProductId) },
    data: { isActive: !storefrontProduct.isActive },
    include: { product: true }
  });
};

// ==================== PUBLIC STOREFRONT ====================

// Get public storefront by slug
const getPublicStorefront = async (slug) => {
  const agent = await prisma.user.findFirst({
    where: { storefrontSlug: slug },
    select: { id: true, name: true, storefrontSlug: true }
  });

  if (!agent) throw new Error('Storefront not found');

  const products = await prisma.storefrontProduct.findMany({
    where: {
      agentId: agent.id,
      isActive: true,
      product: { stock: { gt: 0 } }
    },
    include: {
      product: {
        select: { id: true, name: true, description: true, stock: true }
      }
    },
    orderBy: { customPrice: 'asc' }
  });

  return {
    agent: { name: agent.name, slug: agent.storefrontSlug },
    products: products.map(sp => ({
      id: sp.id,
      productId: sp.product.id,
      name: sp.product.name,
      description: sp.product.description,
      price: sp.customPrice,
      inStock: sp.product.stock > 0
    }))
  };
};

// ==================== REFERRAL ORDER PROCESSING ====================

// Initialize payment for referral order
const initializeReferralPayment = async (slug, storefrontProductId, customerName, customerPhone, callbackUrl) => {
  // Get agent and storefront product
  const agent = await prisma.user.findFirst({
    where: { storefrontSlug: slug },
    select: { id: true, name: true, email: true }
  });

  if (!agent) throw new Error('Storefront not found');

  const storefrontProduct = await prisma.storefrontProduct.findFirst({
    where: {
      id: parseInt(storefrontProductId),
      agentId: agent.id,
      isActive: true
    },
    include: { product: true }
  });

  if (!storefrontProduct) throw new Error('Product not available');
  if (storefrontProduct.product.stock <= 0) throw new Error('Product out of stock');

  const paymentRef = generateReferralRef();
  const basePrice = storefrontProduct.product.price;
  const agentPrice = storefrontProduct.customPrice;
  const commission = agentPrice - basePrice;

  // Format phone number
  let formattedPhone = customerPhone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '233' + formattedPhone.substring(1);
  } else if (!formattedPhone.startsWith('233')) {
    formattedPhone = '233' + formattedPhone;
  }

  // Create referral order record
  const referralOrder = await prisma.referralOrder.create({
    data: {
      agentId: agent.id,
      productId: storefrontProduct.product.id,
      customerName,
      customerPhone: formattedPhone,
      basePrice,
      agentPrice,
      commission,
      paymentRef,
      paymentStatus: 'Pending',
      orderStatus: 'Pending'
    }
  });

  // Initialize Paystack payment
  try {
    const amountInPesewas = Math.round(agentPrice * 100);

    const response = await axios({
      method: 'POST',
      url: PAYSTACK_INITIALIZE_URL,
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        email: `${formattedPhone}@tsk5.com`,
        amount: amountInPesewas,
        currency: 'GHS',
        reference: paymentRef,
        callback_url: callbackUrl,
        metadata: {
          type: 'referral_order',
          referralOrderId: referralOrder.id,
          agentId: agent.id,
          agentName: agent.name,
          productId: storefrontProduct.product.id,
          productName: storefrontProduct.product.name,
          customerName,
          customerPhone: formattedPhone,
          custom_fields: [
            { display_name: "Customer Name", variable_name: "customer_name", value: customerName },
            { display_name: "Mobile Number", variable_name: "mobile_number", value: formattedPhone },
            { display_name: "Agent", variable_name: "agent_name", value: agent.name },
            { display_name: "Product", variable_name: "product_name", value: storefrontProduct.product.name }
          ]
        },
        channels: ['mobile_money', 'card']
      },
      timeout: 30000
    });

    if (response.data.status === true) {
      return {
        success: true,
        paymentUrl: response.data.data.authorization_url,
        reference: paymentRef,
        referralOrderId: referralOrder.id
      };
    } else {
      throw new Error('Failed to initialize payment');
    }
  } catch (error) {
    // Update referral order status
    await prisma.referralOrder.update({
      where: { id: referralOrder.id },
      data: { paymentStatus: 'Failed' }
    });
    throw error;
  }
};

// Verify referral payment and create order
const verifyReferralPayment = async (reference) => {
  // Find referral order
  const referralOrder = await prisma.referralOrder.findUnique({
    where: { paymentRef: reference },
    include: {
      agent: { select: { id: true, name: true } },
      product: true
    }
  });

  if (!referralOrder) throw new Error('Referral order not found');

  // If already paid and order exists, return early to prevent duplicate
  if (referralOrder.paymentStatus === 'Paid' && referralOrder.orderId) {
    const existingOrder = await prisma.order.findUnique({
      where: { id: referralOrder.orderId },
      include: {
        items: { include: { product: true } },
        user: { select: { id: true, name: true } }
      }
    });
    return {
      success: true,
      alreadyProcessed: true,
      order: existingOrder,
      referralOrder
    };
  }

  // Verify with Paystack
  try {
    const response = await axios({
      method: 'GET',
      url: `${PAYSTACK_VERIFY_URL}/${reference}`,
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      },
      timeout: 30000
    });

    if (response.data.status === true && response.data.data.status === 'success') {
      // Double-check to prevent race condition - use transaction
      const result = await prisma.$transaction(async (tx) => {
        // Re-fetch the referral order inside transaction to check current state
        const currentOrder = await tx.referralOrder.findUnique({
          where: { paymentRef: reference }
        });

        // If already processed, skip order creation
        if (currentOrder.paymentStatus === 'Paid' && currentOrder.orderId) {
          const existingOrder = await tx.order.findUnique({
            where: { id: currentOrder.orderId },
            include: {
              items: { include: { product: true } },
              user: { select: { id: true, name: true } }
            }
          });
          return { alreadyProcessed: true, order: existingOrder };
        }

        // Payment successful - create order in agent's name
        const order = await tx.order.create({
          data: {
            userId: referralOrder.agentId, // Order goes to agent
            mobileNumber: referralOrder.customerPhone,
            status: 'Pending',
            items: {
              create: [{
                productId: referralOrder.productId,
                quantity: 1,
                mobileNumber: referralOrder.customerPhone,
                status: 'Pending'
              }]
            }
          },
          include: {
            items: { include: { product: true } },
            user: { select: { id: true, name: true } }
          }
        });

        // Update referral order
        await tx.referralOrder.update({
          where: { id: referralOrder.id },
          data: {
            paymentStatus: 'Paid',
            orderStatus: 'Processing',
            orderId: order.id
          }
        });

        return { alreadyProcessed: false, order };
      }, { timeout: 15000 });

      return {
        success: true,
        alreadyProcessed: result.alreadyProcessed,
        message: result.alreadyProcessed ? 'Order already processed' : 'Payment verified and order created',
        order: result.order,
        referralOrder: {
          ...referralOrder,
          paymentStatus: 'Paid',
          orderId: result.order.id
        }
      };
    } else {
      await prisma.referralOrder.update({
        where: { id: referralOrder.id },
        data: { paymentStatus: 'Failed' }
      });

      return {
        success: false,
        message: 'Payment verification failed'
      };
    }
  } catch (error) {
    console.error('Payment verification error:', error);
    return {
      success: false,
      pending: true,
      message: error.message
    };
  }
};

// ==================== AGENT COMMISSION TRACKING ====================

// Get agent's referral orders and commission summary
const getAgentReferralSummary = async (agentId) => {
  const referralOrders = await prisma.referralOrder.findMany({
    where: { agentId: parseInt(agentId) },
    include: {
      product: { select: { id: true, name: true, description: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Calculate totals
  const totalOrders = referralOrders.length;
  const paidOrders = referralOrders.filter(o => o.paymentStatus === 'Paid');
  const totalCommission = paidOrders.reduce((sum, o) => sum + o.commission, 0);
  const unpaidCommission = paidOrders.filter(o => !o.commissionPaid).reduce((sum, o) => sum + o.commission, 0);
  const paidCommission = paidOrders.filter(o => o.commissionPaid).reduce((sum, o) => sum + o.commission, 0);

  return {
    orders: referralOrders,
    stats: {
      totalOrders,
      completedOrders: paidOrders.length,
      totalCommission,
      unpaidCommission,
      paidCommission
    }
  };
};

// ==================== ADMIN FUNCTIONS ====================

// Get all referral orders (for admin)
const getAllReferralOrders = async (filters = {}) => {
  const where = {};
  
  if (filters.agentId) where.agentId = parseInt(filters.agentId);
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.commissionPaid !== undefined) where.commissionPaid = filters.commissionPaid === 'true';
  
  if (filters.startDate && filters.endDate) {
    where.createdAt = {
      gte: new Date(filters.startDate),
      lte: new Date(filters.endDate + 'T23:59:59.999Z')
    };
  }

  const orders = await prisma.referralOrder.findMany({
    where,
    include: {
      agent: { select: { id: true, name: true, phone: true, role: true } },
      product: { select: { id: true, name: true, description: true, price: true } }
    },
    orderBy: { createdAt: 'desc' }
  });

  // Calculate summary
  const paidOrders = orders.filter(o => o.paymentStatus === 'Paid');
  const totalCommission = paidOrders.reduce((sum, o) => sum + o.commission, 0);
  const unpaidCommission = paidOrders.filter(o => !o.commissionPaid).reduce((sum, o) => sum + o.commission, 0);

  // Group by agent
  const agentSummary = {};
  paidOrders.forEach(order => {
    const agentId = order.agentId;
    if (!agentSummary[agentId]) {
      agentSummary[agentId] = {
        agent: order.agent,
        totalOrders: 0,
        totalCommission: 0,
        unpaidCommission: 0
      };
    }
    agentSummary[agentId].totalOrders++;
    agentSummary[agentId].totalCommission += order.commission;
    if (!order.commissionPaid) {
      agentSummary[agentId].unpaidCommission += order.commission;
    }
  });

  return {
    orders,
    stats: {
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      totalCommission,
      unpaidCommission
    },
    agentSummary: Object.values(agentSummary)
  };
};

// Mark commissions as paid and optionally add to agent's wallet
// paymentMethod: 'wallet' (adds to agent wallet) or 'momo' (paid via momo, no wallet credit)
const markCommissionsPaid = async (agentId, orderIds, paymentMethod = 'wallet') => {
  // Get the unpaid orders to calculate total commission
  const unpaidOrders = await prisma.referralOrder.findMany({
    where: {
      id: { in: orderIds.map(id => parseInt(id)) },
      agentId: parseInt(agentId),
      paymentStatus: 'Paid',
      commissionPaid: false
    }
  });

  if (unpaidOrders.length === 0) {
    return {
      success: false,
      message: 'No unpaid commissions found',
      updatedCount: 0
    };
  }

  // Calculate total commission
  const totalCommission = unpaidOrders.reduce((sum, order) => sum + order.commission, 0);

  // Use transaction to ensure atomicity
  const result = await prisma.$transaction(async (tx) => {
    // Mark orders as paid with payment method info
    const updateResult = await tx.referralOrder.updateMany({
      where: {
        id: { in: orderIds.map(id => parseInt(id)) },
        agentId: parseInt(agentId),
        paymentStatus: 'Paid',
        commissionPaid: false
      },
      data: {
        commissionPaid: true,
        paidAt: new Date(),
        commissionPaymentMethod: paymentMethod // 'wallet' or 'momo'
      }
    });

    // Only add to wallet if payment method is 'wallet'
    if (paymentMethod === 'wallet') {
      await tx.user.update({
        where: { id: parseInt(agentId) },
        data: {
          loanBalance: { increment: totalCommission }
        }
      });
    }

    return updateResult;
  }, { timeout: 15000 });

  const paymentMethodLabel = paymentMethod === 'momo' ? 'via MoMo' : "to agent's wallet";
  return {
    success: true,
    updatedCount: result.count,
    totalCommission,
    paymentMethod,
    message: `GHS ${totalCommission.toFixed(2)} paid ${paymentMethodLabel}`
  };
};

// Get weekly commission summary
const getWeeklyCommissionSummary = async () => {
  // Get start of current week (Monday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - diff);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const orders = await prisma.referralOrder.findMany({
    where: {
      paymentStatus: 'Paid',
      createdAt: {
        gte: weekStart,
        lte: weekEnd
      }
    },
    include: {
      agent: { select: { id: true, name: true, phone: true } }
    }
  });

  // Group by agent
  const agentCommissions = {};
  orders.forEach(order => {
    const agentId = order.agentId;
    if (!agentCommissions[agentId]) {
      agentCommissions[agentId] = {
        agent: order.agent,
        orders: 0,
        totalCommission: 0,
        unpaidCommission: 0
      };
    }
    agentCommissions[agentId].orders++;
    agentCommissions[agentId].totalCommission += order.commission;
    if (!order.commissionPaid) {
      agentCommissions[agentId].unpaidCommission += order.commission;
    }
  });

  return {
    weekStart,
    weekEnd,
    agents: Object.values(agentCommissions),
    totalCommission: orders.reduce((sum, o) => sum + o.commission, 0),
    totalUnpaid: orders.filter(o => !o.commissionPaid).reduce((sum, o) => sum + o.commission, 0)
  };
};

module.exports = {
  // Agent storefront management
  getOrCreateStorefrontSlug,
  getAvailableProducts,
  getAgentStorefrontProducts,
  addProductToStorefront,
  updateStorefrontProductPrice,
  removeProductFromStorefront,
  toggleStorefrontProduct,
  
  // Public storefront
  getPublicStorefront,
  
  // Referral order processing
  initializeReferralPayment,
  verifyReferralPayment,
  
  // Agent commission tracking
  getAgentReferralSummary,
  
  // Admin functions
  getAllReferralOrders,
  markCommissionsPaid,
  getWeeklyCommissionSummary
};
