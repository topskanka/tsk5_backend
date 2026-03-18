const prisma = require('../config/db');
const crypto = require('crypto');

// Generate a secure API key
const generateApiKey = () => {
  return 'klh_' + crypto.randomBytes(32).toString('hex');
};

// Create a new API key for a partner
const createApiKey = async (partnerName) => {
  const apiKey = generateApiKey();

  const record = await prisma.externalApiKey.create({
    data: {
      partnerName,
      apiKey
    }
  });

  return { id: record.id, partnerName: record.partnerName, apiKey: record.apiKey, createdAt: record.createdAt };
};

// List all API keys (mask the actual key for security)
const listApiKeys = async () => {
  const keys = await prisma.externalApiKey.findMany({
    orderBy: { createdAt: 'desc' }
  });

  return keys.map(k => ({
    id: k.id,
    partnerName: k.partnerName,
    apiKeyPreview: k.apiKey.substring(0, 12) + '...',
    isActive: k.isActive,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    totalOrders: k.totalOrders
  }));
};

// Revoke an API key
const revokeApiKey = async (id) => {
  return await prisma.externalApiKey.update({
    where: { id: parseInt(id) },
    data: { isActive: false }
  });
};

// Reactivate an API key
const activateApiKey = async (id) => {
  return await prisma.externalApiKey.update({
    where: { id: parseInt(id) },
    data: { isActive: true }
  });
};

// Delete an API key permanently
const deleteApiKey = async (id) => {
  return await prisma.externalApiKey.delete({
    where: { id: parseInt(id) }
  });
};

// Get available products for external partners
const getAvailableProducts = async () => {
  const products = await prisma.product.findMany({
    where: { showForAgents: true },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      promoPrice: true,
      usePromoPrice: true,
      stock: true
    },
    orderBy: { name: 'asc' }
  });

  return products.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    price: (p.usePromoPrice && p.promoPrice != null) ? p.promoPrice : p.price,
    stock: p.stock
  }));
};

// Create an external order
const createExternalOrder = async (partnerId, items) => {
  return await prisma.$transaction(async (tx) => {
    // Validate all products exist and calculate total
    const productIds = items.map(i => parseInt(i.productId));
    const products = await tx.product.findMany({
      where: { id: { in: productIds } }
    });

    const productMap = {};
    for (const p of products) {
      productMap[p.id] = p;
    }

    // Validate each item
    const orderItems = [];
    let totalPrice = 0;

    for (const item of items) {
      const product = productMap[parseInt(item.productId)];
      if (!product) {
        throw new Error(`Product with ID ${item.productId} not found`);
      }

      const effectivePrice = (product.usePromoPrice && product.promoPrice != null) ? product.promoPrice : product.price;
      const quantity = parseInt(item.quantity) || 1;
      const itemTotal = effectivePrice * quantity;
      totalPrice += itemTotal;

      orderItems.push({
        productId: product.id,
        quantity,
        mobileNumber: item.mobileNumber || null,
        status: 'Pending',
        productName: product.name,
        productPrice: effectivePrice,
        productDescription: product.description
      });
    }

    // Get or create partner user account (used to link orders in the system)
    let partnerUser = await tx.user.findFirst({
      where: { email: `partner_${partnerId}@external.api` }
    });

    if (!partnerUser) {
      const partner = await tx.externalApiKey.findUnique({ where: { id: partnerId } });
      partnerUser = await tx.user.create({
        data: {
          name: `[Partner] ${partner?.partnerName || 'External'}`,
          email: `partner_${partnerId}@external.api`,
          password: crypto.randomBytes(32).toString('hex'),
          role: 'external_partner'
        }
      });
    }

    // Create the order
    const order = await tx.order.create({
      data: {
        userId: partnerUser.id,
        mobileNumber: items[0]?.mobileNumber || null,
        status: 'Pending',
        items: {
          create: orderItems
        }
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, description: true, price: true }
            }
          }
        }
      }
    });

    // Increment partner's total orders count
    await tx.externalApiKey.update({
      where: { id: partnerId },
      data: { totalOrders: { increment: 1 } }
    });

    return {
      orderId: order.id,
      status: order.status,
      totalPrice,
      items: order.items.map(item => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        price: item.productPrice,
        mobileNumber: item.mobileNumber,
        status: item.status
      })),
      createdAt: order.createdAt
    };
  }, { timeout: 15000 });
};

// Check order status by order ID
const getExternalOrderStatus = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: parseInt(orderId) },
    include: {
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          quantity: true,
          productPrice: true,
          mobileNumber: true,
          status: true,
          updatedAt: true
        }
      }
    }
  });

  if (!order) {
    throw new Error('Order not found');
  }

  return {
    orderId: order.id,
    status: order.status,
    items: order.items,
    createdAt: order.createdAt
  };
};

// Check multiple order statuses
const getExternalOrderStatuses = async (orderIds) => {
  const ids = orderIds.map(id => parseInt(id));
  const orders = await prisma.order.findMany({
    where: { id: { in: ids } },
    include: {
      items: {
        select: {
          id: true,
          productId: true,
          productName: true,
          quantity: true,
          productPrice: true,
          mobileNumber: true,
          status: true,
          updatedAt: true
        }
      }
    }
  });

  return orders.map(order => ({
    orderId: order.id,
    status: order.status,
    items: order.items,
    createdAt: order.createdAt
  }));
};

module.exports = {
  generateApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
  activateApiKey,
  deleteApiKey,
  getAvailableProducts,
  createExternalOrder,
  getExternalOrderStatus,
  getExternalOrderStatuses
};
