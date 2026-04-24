const prisma = require("../config/db");
const cache = require("../utils/cache");

const { createTransaction } = require("./transactionService");
const userService = require("./userService");

const submitCart = async (userId, mobileNumber = null, retries = 3) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await submitCartInner(userId, mobileNumber);
    } catch (error) {
      const isDeadlock = error.message?.includes('deadlock') || error.code === 'P2034';
      if (isDeadlock && attempt < retries) {
        await new Promise(r => setTimeout(r, 200 * attempt));
        continue;
      }
      throw error;
    }
  }
};

const submitCartInner = async (userId, mobileNumber = null) => {
  // Use a transaction to ensure atomicity
  return await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.findUnique({
      where: { userId },
      include: {
        items: { include: { product: true } },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new Error("Cart is empty");
    }

    // Calculate total order price
    const totalPrice = cart.items.reduce((sum, item) => {
      const effectivePrice = (item.product.usePromoPrice && item.product.promoPrice != null) ? item.product.promoPrice : item.product.price;
      return sum + effectivePrice * item.quantity;
    }, 0);

    // Get user current balance
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error("User not found");
    }

    if (user.isSuspended) {
      throw new Error("Your account is suspended. Please contact admin.");
    }

    if (user.loanBalance < totalPrice) {
      throw new Error("Insufficient balance to place order");
    }

    // Set mobile number if provided
    if (mobileNumber && !cart.mobileNumber) {
      await tx.cart.update({
        where: { id: cart.id },
        data: { mobileNumber },
      });
    }

    // Create order with product snapshots to prevent data mismatch
    const order = await tx.order.create({
      data: {
        userId,
        mobileNumber: cart.mobileNumber || mobileNumber,
        items: {
          create: cart.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            mobileNumber: item.mobileNumber,
            status: "Pending",
            productName: item.product.name,
            productPrice: (item.product.usePromoPrice && item.product.promoPrice != null) ? item.product.promoPrice : item.product.price,
            productDescription: item.product.description,
          })),
        },
      },
      include: { items: { include: { product: true } } },
    });

    // Record transaction for the order
    // createTransaction must use the transaction-bound prisma
    await createTransaction(
      userId,
      -totalPrice, // Negative amount for deduction
      "ORDER",
      `Order #${order.id} placed with ${order.items.length} items`,
      `order:${order.id}`,
      tx // pass the transaction-bound prisma
    );

    // Clear cart (we already have the items in the order)
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

    return order;
  }, {
    timeout: 15000,
    maxWait: 10000,
  });
};

async function getAllOrders(limit = 100, offset = 0) {
  const cappedLimit = Math.min(limit, 500);

  // Run count and findMany in parallel
  const [orders, totalCount] = await Promise.all([
    prisma.order.findMany({
      take: cappedLimit,
      skip: offset,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        status: true,
        mobileNumber: true,
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            mobileNumber: true,
            status: true,
            product: {
              select: { id: true, name: true, description: true, price: true },
            },
          },
        },
      },
    }),
    prisma.order.count()
  ]);

  return {
    orders,
    totalCount,
    hasMore: (offset + limit) < totalCount
  };
}

// Admin: Process and complete an order
const processOrder = async (orderId, status) => {
  const validStatuses = ["Pending", "Processing", "Completed"];
  if (!validStatuses.includes(status)) {
    throw new Error("Invalid order status");
  }

  const order = await prisma.order.update({
    where: { id: orderId },
    data: { status },
    include: {
      user: true,
      items: { include: { product: true } }
    }
  });

  // Record transaction for status change
  await createTransaction(
    order.userId,
    0, // Zero amount for status change
    "ORDER_STATUS",
    `Order #${orderId} status changed to ${status}`,
    `order:${orderId}`
  );

  return order;
};

const processOrderItem = async (orderItemId, status) => {
  const validStatuses = ["Pending", "Processing", "Completed", "Cancelled", "Canceled"];
  if (!validStatuses.includes(status)) {
    throw new Error("Invalid order status");
  }
  return await prisma.$transaction(async (tx) => {
    const orderItem = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { status },
      include: { order: true, product: true }
    });

    // Auto-refund logic for cancelled/canceled
    if (["Cancelled", "Canceled"].includes(status)) {
      const refundAmount = (orderItem.productPrice != null ? orderItem.productPrice : orderItem.product.price) * orderItem.quantity;
      const existingRefund = await tx.transaction.findFirst({
        where: {
          userId: orderItem.order.userId,
          type: "ORDER_ITEM_REFUND",
          reference: `orderItem:${orderItemId}`
        }
      });
      if (!existingRefund) {
        // Refund user wallet and log transaction
        await createTransaction(
          orderItem.order.userId,
          refundAmount,
          "ORDER_ITEM_REFUND",
          `Order item #${orderItemId} (${orderItem.product.name}) refunded`,
          `orderItem:${orderItemId}`,
          tx
        );
      }
    }

    await createTransaction(
      orderItem.order.userId,
      0,
      "ORDER_ITEM_STATUS",
      `Order item #${orderItemId} (${orderItem.product.name}) status changed to ${status}`,
      `orderItem:${orderItemId}`,
      tx
    );
    return orderItem;
  }, { timeout: 15000 });
};

// ... (rest of the code remains the same)

const getOrderStatus = async (options = {}) => {
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
  } = options;

  // Build where clause for filtering
  const where = {};
  const itemsWhere = {};

  // Date filtering
  if (selectedDate) {
    const startDate = new Date(selectedDate);
    const endDate = new Date(selectedDate);
    endDate.setDate(endDate.getDate() + 1);
    
    if (startTime && endTime) {
      const startDateTime = new Date(`${selectedDate}T${startTime}`);
      const endDateTime = new Date(`${selectedDate}T${endTime}`);
      where.createdAt = {
        gte: startDateTime,
        lte: endDateTime
      };
    } else {
      where.createdAt = {
        gte: startDate,
        lt: endDate
      };
    }
  }

  // New requests filter (last 5 minutes)
  if (showNewRequestsOnly) {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    where.createdAt = {
      gte: fiveMinutesAgo
    };
  }

  // Phone number filter - search both order-level and item-level mobile numbers
  // Handle various phone number formats (with/without 0 prefix, with 233 prefix)
  if (phoneNumberFilter) {
    const cleanedNumber = phoneNumberFilter.replace(/\D/g, '');
    const phoneVariants = [cleanedNumber];
    
    // Generate phone number variants for comprehensive search
    if (cleanedNumber.startsWith('0') && cleanedNumber.length === 10) {
      // 0XXXXXXXXX -> add XXXXXXXXX and 233XXXXXXXXX
      phoneVariants.push(cleanedNumber.substring(1));
      phoneVariants.push('233' + cleanedNumber.substring(1));
    } else if (cleanedNumber.startsWith('233') && cleanedNumber.length === 12) {
      // 233XXXXXXXXX -> add 0XXXXXXXXX and XXXXXXXXX
      phoneVariants.push('0' + cleanedNumber.substring(3));
      phoneVariants.push(cleanedNumber.substring(3));
    } else if (cleanedNumber.length === 9) {
      // XXXXXXXXX -> add 0XXXXXXXXX and 233XXXXXXXXX
      phoneVariants.push('0' + cleanedNumber);
      phoneVariants.push('233' + cleanedNumber);
    }
    
    // Build OR conditions for all phone variants
    const phoneConditions = [];
    phoneVariants.forEach(variant => {
      phoneConditions.push({
        mobileNumber: { contains: variant }
      });
      phoneConditions.push({
        items: {
          some: {
            mobileNumber: { contains: variant }
          }
        }
      });
    });
    
    where.OR = phoneConditions;
  }

  // Order ID filter
  if (orderIdFilter) {
    where.id = parseInt(orderIdFilter) || undefined;
  }

  // Product filter
  if (selectedProduct) {
    itemsWhere.product = {
      name: selectedProduct
    };
  }

  // Status filter
  if (selectedStatusMain) {
    itemsWhere.status = selectedStatusMain;
  }

  // Add items filter to where clause if needed
  if (Object.keys(itemsWhere).length > 0) {
    where.items = {
      some: itemsWhere
    };
  }

  // Calculate pagination
  const skip = (page - 1) * limit;

  const totalCount = await prisma.order.count({ where });
  
  // Get status counts - cached for 30 seconds to reduce DB load
  const statusCacheKey = 'order_status_counts';
  let statusCounts = cache.get(statusCacheKey);
  if (!statusCounts) {
    const allOrderItems = await prisma.orderItem.groupBy({
      by: ['status'],
      _count: { status: true }
    });
    
    statusCounts = {
      pending: 0,
      processing: 0,
      completed: 0,
      cancelled: 0
    };
    
    allOrderItems.forEach(item => {
      const status = item.status?.toLowerCase();
      if (status === 'pending') statusCounts.pending = item._count.status;
      else if (status === 'processing') statusCounts.processing = item._count.status;
      else if (status === 'completed') statusCounts.completed = item._count.status;
      else if (status === 'cancelled' || status === 'canceled') statusCounts.cancelled = item._count.status;
    });
    
    cache.set(statusCacheKey, statusCounts, 30000); // 30 second cache
  }
  
  // Determine sort order
  const orderBy = sortOrder === 'newest' 
    ? { createdAt: 'desc' }
    : { createdAt: 'asc' };

  // Fetch orders with optimized query
  const orders = await prisma.order.findMany({
    where,
    skip,
    take: limit,
    orderBy,
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true
            }
          }
        }
      },
      user: {
        select: { id: true, name: true, email: true, phone: true }
      }
    }
  });

  // Transform data to match frontend expectations - include nested order structure
  const transformedData = [];
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  
  // Build phone number variants for item-level filtering
  let phoneVariantsForItemFilter = null;
  if (phoneNumberFilter) {
    const cleanedNumber = phoneNumberFilter.replace(/\D/g, '');
    phoneVariantsForItemFilter = [cleanedNumber];
    if (cleanedNumber.startsWith('0') && cleanedNumber.length === 10) {
      phoneVariantsForItemFilter.push(cleanedNumber.substring(1));
      phoneVariantsForItemFilter.push('233' + cleanedNumber.substring(1));
    } else if (cleanedNumber.startsWith('233') && cleanedNumber.length === 12) {
      phoneVariantsForItemFilter.push('0' + cleanedNumber.substring(3));
      phoneVariantsForItemFilter.push(cleanedNumber.substring(3));
    } else if (cleanedNumber.length === 9) {
      phoneVariantsForItemFilter.push('0' + cleanedNumber);
      phoneVariantsForItemFilter.push('233' + cleanedNumber);
    }
  }

  for (const order of orders) {
    const orderCreatedAt = new Date(order.createdAt).getTime();
    const isNew = orderCreatedAt > fiveMinutesAgo;
    
    for (const item of order.items) {
      // If status filter is applied, only include items with that exact status
      if (selectedStatusMain && item.status !== selectedStatusMain) {
        continue; // Skip items that don't match the status filter
      }
      
      // If product filter is applied, only include items with that product
      if (selectedProduct && item.product.name !== selectedProduct) {
        continue; // Skip items that don't match the product filter
      }

      // If phone number filter is applied, only include items whose mobileNumber matches
      if (phoneVariantsForItemFilter) {
        const itemPhone = (item.mobileNumber || order.mobileNumber || '').replace(/\D/g, '');
        const matchesPhone = phoneVariantsForItemFilter.some(variant => itemPhone.includes(variant));
        if (!matchesPhone) {
          continue; // Skip items that don't match the phone number filter
        }
      }
      
      transformedData.push({
        id: item.id,
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        mobileNumber: item.mobileNumber || order.mobileNumber,
        user: {
          id: order.user.id,
          name: order.user.name,
          email: order.user.email,
          phone: order.user.phone
        },
        product: {
          id: item.product.id,
          name: item.productName || item.product.name,
          description: item.productDescription || item.product.description,
          price: item.productPrice != null ? item.productPrice : item.product.price
        },
        order: {
          id: order.id,
          createdAt: order.createdAt,
          items: [{
            status: item.status
          }]
        },
        isNew
      });
    }
  }

  return {
    data: transformedData,
    pagination: {
      total: totalCount,
      totalItems: transformedData.length,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(totalCount / limit),
      hasMore: (page * limit) < totalCount
    },
    statusCounts
  };
};

const getOrderHistory = async (userId) => {
  return await prisma.order.findMany({
    where: { userId },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      status: true,
      mobileNumber: true,
      items: {
        select: {
          id: true,
          mobileNumber: true,
          status: true,
          quantity: true,
          updatedAt: true,
          productPrice: true,
          productName: true,
          productDescription: true,
          product: {
            select: { id: true, name: true, description: true, price: true, promoPrice: true, usePromoPrice: true }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
};

const getUserCompletedOrders = async (userId) => {
  return await prisma.order.findMany({
    where: { userId, status: "Completed" },
    include: {
      items: {
        include: {
          product: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });
};

const updateSingleOrderItemStatus = async (itemId, newStatus) => {
  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUnique({
        where: { id: parseInt(itemId) },
        include: { order: true, product: true }
      });
      
      if (!item) {
        throw new Error("Order item not found");
      }
      
      // If status is cancelled/canceled, handle refund logic for this single item
      if (["Cancelled", "Canceled"].includes(newStatus)) {
        const refundReference = `order_item_refund:${itemId}`;
        
        const existingRefund = await tx.transaction.findFirst({
          where: {
            userId: item.order.userId,
            type: "ORDER_ITEM_REFUND",
            reference: refundReference
          }
        });
        
        if (!existingRefund) {
          const refundAmount = (item.productPrice != null ? item.productPrice : item.product.price) * item.quantity;
          
          if (refundAmount > 0) {
            await createTransaction(
              item.order.userId,
              refundAmount,
              "ORDER_ITEM_REFUND",
              `Item #${itemId} in order #${item.orderId} refunded (Amount: ${refundAmount})`,
              refundReference,
              tx
            );
          }
        }
      }
      
      // Update single order item status
      const updatedItem = await tx.orderItem.update({
        where: { id: parseInt(itemId) },
        data: { status: newStatus }
      });
      
      return { 
        success: true, 
        item: updatedItem,
        message: `Successfully updated item #${itemId} to ${newStatus}` 
      };
    }, { timeout: 15000 });
  } catch (error) {
    console.error("Error updating single order item status:", error);
    throw new Error("Failed to update order item status");
  }
};

const updateOrderItemsStatus = async (orderId, newStatus) => {
  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ 
        where: { id: parseInt(orderId) }, 
        select: { userId: true } 
      });
      
      if (!order) {
        throw new Error("Order not found");
      }
      
      // If status is cancelled/canceled, handle refund logic
      if (["Cancelled", "Canceled"].includes(newStatus)) {
        const refundReference = `order_items_refund:${orderId}`;
        
        const existingRefund = await tx.transaction.findFirst({
          where: {
            userId: order.userId,
            type: "ORDER_ITEMS_REFUND",
            reference: refundReference
          }
        });
        
        if (!existingRefund) {
          // Calculate total order amount
          const items = await tx.orderItem.findMany({
            where: { orderId: parseInt(orderId) },
            include: { product: true }
          });
          
          let totalOrderAmount = 0;
          for (const item of items) {
            totalOrderAmount += (item.productPrice != null ? item.productPrice : item.product.price) * item.quantity;
          }
          
          // Find the original order transaction to get the amount that was deducted
          const originalOrderTransaction = await tx.transaction.findFirst({
            where: {
              userId: order.userId,
              type: "ORDER",
              reference: `order:${orderId}`,
              amount: { lt: 0 } // Negative amount (deduction)
            }
          });
          
          let refundAmount = totalOrderAmount;
          
          if (originalOrderTransaction) {
            refundAmount = Math.abs(originalOrderTransaction.amount);
          }
          
          if (refundAmount > 0) {
            // Process the refund
            await createTransaction(
              order.userId,
              refundAmount,
              "ORDER_ITEMS_REFUND",
              `All items in order #${orderId} refunded (Amount: ${refundAmount})`,
              refundReference,
              tx
            );
          }
        } else {
          console.log(`Refund already processed for order ${orderId}. Skipping duplicate refund.`);
        }
      }
      
      // Update order items status
      const updatedItems = await tx.orderItem.updateMany({ 
        where: { orderId: parseInt(orderId) }, 
        data: { status: newStatus } 
      });
      
      // Create status change transaction (only if not a duplicate)
      const statusChangeReference = `order_status:${orderId}:${newStatus}`;
      const existingStatusChange = await tx.transaction.findFirst({
        where: {
          userId: order.userId,
          type: "ORDER_ITEMS_STATUS",
          reference: statusChangeReference
        }
      });
      
      if (!existingStatusChange) {
        await createTransaction(
          order.userId, 
          0, 
          "ORDER_ITEMS_STATUS", 
          `All items in order #${orderId} status changed to ${newStatus}`, 
          statusChangeReference,
          tx
        );
      }
      
      return { 
        success: true, 
        updatedCount: updatedItems.count, 
        message: `Successfully updated ${updatedItems.count} order items to ${newStatus}` 
      };
    }, { timeout: 15000 });
  } catch (error) {
    console.error("Error updating order items status:", error);
    throw new Error("Failed to update order items status");
  }
};

const orderService = {
  async getOrdersPaginated({ page = 1, limit = 20, filters = {} }) {
    const { startDate, endDate, status, product, mobileNumber } = filters;
    
    // Build where clause
    const where = {};
    
    if (startDate && endDate) {
      where.createdAt = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }
    
    if (status) {
      where.items = {
        some: {
          status,
        },
      };
    }
    
    if (product) {
      where.items = {
        ...(where.items || {}),
        some: {
          ...(where.items?.some || {}),
          product: {
            name: product,
          },
        },
      };
    }
    
    if (mobileNumber) {
      where.mobileNumber = {
        contains: mobileNumber,
      };
    }
    
    // Calculate pagination parameters
    const skip = (page - 1) * parseInt(limit);
    
    // Get count for pagination info
    const totalOrders = await prisma.order.count({ where });
    
    // Get paginated orders
    const orders = await prisma.order.findMany({
      where,
      skip,
      take: parseInt(limit),
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                price: true,
                description: true,
              },
            },
          },
        },
        user: {
          select: { 
            id: true, 
            name: true, 
            email: true, 
            phone: true 
          },
        },
      },
    });
    
    // Transform data more efficiently - avoid flatMap and deep copying
    const transformedItems = [];
    for (const order of orders) {
      for (const item of order.items) {
        transformedItems.push({
          id: item.id,
          orderId: order.id,
          mobileNumber: order.mobileNumber,
          user: order.user,
          createdAt: order.createdAt,
          product: item.product,
          status: item.status,
          order: {
            id: order.id,
            createdAt: order.createdAt,
            items: [{ status: item.status }]
          }
        });
      }
    }
    
    return {
      items: transformedItems,
      pagination: {
        total: totalOrders,
        pages: Math.ceil(totalOrders / parseInt(limit)),
        currentPage: parseInt(page),
        limit: parseInt(limit)
      }
    };
  },
  
  async getOrderStats() {
    // Cache order stats for 5 minutes since they don't change frequently
    const cacheKey = 'order_stats';
    const cached = cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Use more efficient aggregation query
    const stats = await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM OrderItem oi WHERE oi.orderId = o.id AND oi.status = 'Pending') THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM OrderItem oi WHERE oi.orderId = o.id AND oi.status = 'Completed') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM OrderItem oi WHERE oi.orderId = o.id AND oi.status = 'Processing') THEN 1 ELSE 0 END) as processing
      FROM \`Order\` o
    `;

    const result = {
      total: Number(stats[0]?.total || 0),
      pending: Number(stats[0]?.pending || 0),
      completed: Number(stats[0]?.completed || 0),
      processing: Number(stats[0]?.processing || 0)
    };

    // Cache for 5 minutes
    cache.set(cacheKey, result, 300000);
    return result;
  },
  
  async updateOrderStatus(orderId, status) {
    const id = parseInt(orderId);
    if (isNaN(id)) {
      throw new Error('Invalid order ID');
    }
    return await prisma.order.update({
      where: { id },
      data: {
        items: {
          updateMany: {
            where: {},
            data: { status }
          }
        }
      }
    });
  },

  async batchCompleteProcessingOrders(filters = {}) {
    const { selectedProduct, selectedDate, sourceFilter, phoneNumberFilter, orderIdFilter, startTime, endTime } = filters;
    const hasFilters = selectedProduct || selectedDate || sourceFilter || phoneNumberFilter || orderIdFilter || startTime || endTime;

    if (!hasFilters) {
      const result = await prisma.orderItem.updateMany({
        where: { status: 'Processing' },
        data: { status: 'Completed' }
      });
      cache.delete('order_status_counts');
      cache.delete('order_stats');
      return { count: result.count };
    }

    const where = {};
    const itemsWhere = { status: 'Processing' };

    if (selectedDate) {
      const startOfDay = new Date(selectedDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(selectedDate);
      endOfDay.setHours(23, 59, 59, 999);
      if (startTime) {
        const [h, m] = startTime.split(':');
        startOfDay.setHours(parseInt(h), parseInt(m), 0, 0);
      }
      if (endTime) {
        const [h, m] = endTime.split(':');
        endOfDay.setHours(parseInt(h), parseInt(m), 59, 999);
      }
      where.createdAt = { gte: startOfDay, lte: endOfDay };
    }

    if (phoneNumberFilter) {
      const cleanedNumber = phoneNumberFilter.replace(/\D/g, '');
      const phoneVariants = [cleanedNumber];
      if (cleanedNumber.startsWith('0') && cleanedNumber.length === 10) {
        phoneVariants.push(cleanedNumber.substring(1));
        phoneVariants.push('233' + cleanedNumber.substring(1));
      } else if (cleanedNumber.startsWith('233') && cleanedNumber.length === 12) {
        phoneVariants.push('0' + cleanedNumber.substring(3));
        phoneVariants.push(cleanedNumber.substring(3));
      } else if (cleanedNumber.length === 9) {
        phoneVariants.push('0' + cleanedNumber);
        phoneVariants.push('233' + cleanedNumber);
      }
      const phoneConditions = [];
      phoneVariants.forEach(variant => {
        phoneConditions.push({ mobileNumber: { contains: variant } });
        phoneConditions.push({ items: { some: { mobileNumber: { contains: variant } } } });
      });
      where.OR = phoneConditions;
    }

    if (orderIdFilter) {
      const parsedId = parseInt(orderIdFilter);
      if (!isNaN(parsedId)) where.id = parsedId;
    }

    if (selectedProduct) {
      itemsWhere.product = { name: selectedProduct };
    }

    if (sourceFilter === 'shop') {
      where.user = { OR: [{ name: 'shop' }, { email: { contains: 'shop@' } }] };
    } else if (sourceFilter === 'dashboard') {
      where.user = { AND: [{ NOT: { name: 'shop' } }, { NOT: { email: { contains: 'shop@' } } }] };
    }

    where.items = { some: itemsWhere };

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: {
          where: itemsWhere,
          select: { id: true }
        }
      }
    });

    const itemIds = [];
    for (const order of orders) {
      for (const item of order.items) {
        itemIds.push(item.id);
      }
    }

    if (itemIds.length === 0) {
      return { count: 0 };
    }

    const result = await prisma.orderItem.updateMany({
      where: { id: { in: itemIds } },
      data: { status: 'Completed' }
    });
    cache.delete('order_status_counts');
    cache.delete('order_stats');
    return { count: result.count };
  },

  // Create direct order from ext_agent system
  async createDirectOrder(userId, items, totalAmount) {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: parseInt(userId) } });
      if (!user) throw new Error("User not found");

      if (user.loanBalance < totalAmount) {
        throw new Error("Insufficient balance to place order");
      }

      const order = await tx.order.create({
        data: {
          userId: parseInt(userId),
          mobileNumber: items[0]?.mobileNumber || null,
          items: {
            create: items.map((item) => ({
              productId: parseInt(item.productId),
              quantity: parseInt(item.quantity),
              price: parseFloat(item.price),
              mobileNumber: item.mobileNumber || null,
              status: "Pending",
              productName: item.productName || null,
              productPrice: parseFloat(item.price) || null,
              productDescription: item.productDescription || null
            }))
          }
        },
        include: {
          items: { include: { product: true } },
          user: true
        }
      });

      await tx.user.update({
        where: { id: parseInt(userId) },
        data: { loanBalance: { decrement: totalAmount } }
      });

      await createTransaction(
        parseInt(userId),
        -totalAmount,
        "ORDER",
        `Order #${order.id} placed via ext_agent system`,
        `order:${order.id}`,
        tx
      );

      return order;
    }, { timeout: 15000 });
  },

  // Get multiple orders by IDs
  async getOrdersByIds(orderIds) {
    const orders = await prisma.order.findMany({
      where: {
        id: {
          in: orderIds.map(id => parseInt(id))
        }
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                description: true,
                price: true
              }
            }
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true
          }
        }
      }
    });
    return orders;
  },
};

const downloadOrdersForExcel = async ({ statusFilter, selectedProduct, selectedDate, sortOrder, sourceFilter, phoneNumberFilter, orderIdFilter, startTime, endTime } = {}) => {
  const where = {};
  const itemsWhere = {};

  const targetStatus = statusFilter || 'Pending';
  itemsWhere.status = targetStatus;

  if (selectedDate) {
    const startOfDay = new Date(selectedDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);
    if (startTime) {
      const [h, m] = startTime.split(':');
      startOfDay.setHours(parseInt(h), parseInt(m), 0, 0);
    }
    if (endTime) {
      const [h, m] = endTime.split(':');
      endOfDay.setHours(parseInt(h), parseInt(m), 59, 999);
    }
    where.createdAt = { gte: startOfDay, lte: endOfDay };
  }

  if (phoneNumberFilter) {
    const cleanedNumber = phoneNumberFilter.replace(/\D/g, '');
    const phoneVariants = [cleanedNumber];
    if (cleanedNumber.startsWith('0') && cleanedNumber.length === 10) {
      phoneVariants.push(cleanedNumber.substring(1));
      phoneVariants.push('233' + cleanedNumber.substring(1));
    } else if (cleanedNumber.startsWith('233') && cleanedNumber.length === 12) {
      phoneVariants.push('0' + cleanedNumber.substring(3));
      phoneVariants.push(cleanedNumber.substring(3));
    } else if (cleanedNumber.length === 9) {
      phoneVariants.push('0' + cleanedNumber);
      phoneVariants.push('233' + cleanedNumber);
    }
    const phoneConditions = [];
    phoneVariants.forEach(variant => {
      phoneConditions.push({ mobileNumber: { contains: variant } });
      phoneConditions.push({ items: { some: { mobileNumber: { contains: variant } } } });
    });
    where.OR = phoneConditions;
  }

  if (orderIdFilter) {
    const parsedId = parseInt(orderIdFilter);
    if (!isNaN(parsedId)) where.id = parsedId;
  }

  if (selectedProduct) {
    itemsWhere.product = { name: selectedProduct };
  }

  if (sourceFilter === 'shop') {
    where.user = { OR: [{ name: 'shop' }, { email: { contains: 'shop@' } }] };
  } else if (sourceFilter === 'dashboard') {
    where.user = { AND: [{ NOT: { name: 'shop' } }, { NOT: { email: { contains: 'shop@' } } }] };
  }

  where.items = { some: itemsWhere };

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: sortOrder === 'oldest' ? 'asc' : 'desc' },
    include: {
      items: {
        where: itemsWhere,
        include: {
          product: { select: { id: true, name: true, description: true, price: true } }
        }
      },
      user: { select: { id: true, name: true, email: true, phone: true } }
    }
  });

  const items = [];
  const pendingItemIds = [];
  for (const order of orders) {
    for (const item of order.items) {
      items.push({
        id: item.id,
        orderId: order.id,
        mobileNumber: item.mobileNumber || order.mobileNumber,
        product: {
          name: item.productName || item.product?.name,
          description: item.productDescription || item.product?.description,
          price: item.productPrice != null ? item.productPrice : item.product?.price
        },
        status: item.status,
        createdAt: order.createdAt,
        user: order.user
      });
      if (item.status === 'Pending') {
        pendingItemIds.push(item.id);
      }
    }
  }

  let updatedCount = 0;
  if (pendingItemIds.length > 0) {
    const result = await prisma.orderItem.updateMany({
      where: { id: { in: pendingItemIds } },
      data: { status: 'Processing' }
    });
    updatedCount = result.count;
    cache.delete('order_status_counts');
    cache.delete('order_stats');
  }

  return { items, updatedCount, totalItems: items.length };
};

const getOrderTrackerData = async (filters = {}) => {
  const { agentId, productId, startDate, endDate, startTime, endTime } = filters;
  const where = {};

  // Only show agent dashboard orders (exclude shop-origin orders)
  where.user = {
    NOT: {
      OR: [
        { role: 'SHOP' },
        { email: { contains: 'shop@' } },
        { name: { in: ['Shop', 'shop'] } }
      ]
    }
  };

  if (agentId) {
    where.userId = parseInt(agentId);
  }

  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = endDate ? new Date(endDate) : new Date(startDate);
    end.setHours(23, 59, 59, 999);
    if (startTime) {
      const [h, m] = startTime.split(':');
      start.setHours(parseInt(h), parseInt(m), 0, 0);
    }
    if (endTime) {
      const [h, m] = endTime.split(':');
      end.setHours(parseInt(h), parseInt(m), 59, 999);
    }
    where.createdAt = { gte: start, lte: end };
  }

  const itemsWhere = {};
  if (productId) {
    itemsWhere.productId = parseInt(productId);
  }

  if (Object.keys(itemsWhere).length > 0) {
    where.items = { some: itemsWhere };
  }

  const orders = await prisma.order.findMany({
    where,
    include: {
      items: {
        ...(Object.keys(itemsWhere).length > 0 ? { where: itemsWhere } : {}),
        include: {
          product: { select: { id: true, name: true, description: true, price: true } }
        }
      },
      user: { select: { id: true, name: true, email: true, phone: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 5000
  });

  const orderIds = orders.map(o => o.id);
  const references = orderIds.map(id => `order:${id}`);

  const transactions = references.length > 0 ? await prisma.transaction.findMany({
    where: {
      reference: { in: references },
      type: 'ORDER'
    },
    select: {
      reference: true,
      previousBalance: true,
      balance: true,
      amount: true
    }
  }) : [];

  const txMap = {};
  for (const tx of transactions) {
    txMap[tx.reference] = tx;
  }

  // Fetch referral orders (storefront/Paystack-paid) linked to these orders
  const referralOrders = orderIds.length > 0 ? await prisma.referralOrder.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, paymentStatus: true, paymentRef: true }
  }) : [];

  const referralMap = {};
  for (const ro of referralOrders) {
    referralMap[ro.orderId] = ro;
  }

  const tableData = [];
  const fraudAlerts = [];
  const networkSummary = {
    mtn: { count: 0, total: 0 },
    telecel: { count: 0, total: 0 },
    airteltigo: { count: 0, total: 0 }
  };

  for (const order of orders) {
    const tx = txMap[`order:${order.id}`];
    const referral = referralMap[order.id];
    const isStorefrontOrder = !!referral;

    for (const item of order.items) {
      const productName = (item.productName || item.product?.name || '').toUpperCase();
      const price = item.productPrice != null ? item.productPrice : (item.product?.price || 0);
      const description = item.productDescription || item.product?.description || '';

      let network = 'other';
      if (productName.includes('MTN')) {
        network = 'mtn';
        networkSummary.mtn.count++;
        networkSummary.mtn.total += price;
      } else if (productName.includes('TELECEL') || productName.includes('VODAFONE')) {
        network = 'telecel';
        networkSummary.telecel.count++;
        networkSummary.telecel.total += price;
      } else if (productName.includes('AIRTELTIGO') || productName.includes('AIRTEL')) {
        network = 'airteltigo';
        networkSummary.airteltigo.count++;
        networkSummary.airteltigo.total += price;
      }

      const row = {
        agentName: order.user?.name || 'N/A',
        agentId: order.user?.id,
        orderId: order.id,
        itemId: item.id,
        product: item.productName || item.product?.name || 'N/A',
        data: description,
        balanceBefore: tx ? tx.previousBalance : null,
        orderPrice: price,
        balanceAfter: tx ? tx.balance : null,
        dateTime: order.createdAt,
        network,
        mobileNumber: item.mobileNumber || order.mobileNumber,
        isStorefront: isStorefrontOrder,
        paymentMethod: isStorefrontOrder ? 'Paystack' : 'Wallet'
      };

      tableData.push(row);

      // Fraud detection logic
      if (isStorefrontOrder) {
        // Storefront order paid via Paystack — only flag if payment was NOT verified
        if (referral.paymentStatus !== 'Paid') {
          fraudAlerts.push({ ...row, reason: `Storefront order - payment not verified (${referral.paymentStatus})` });
        }
      } else {
        // Wallet-based agent order — flag if balance unchanged or no transaction
        if (tx && Math.abs(tx.previousBalance - tx.balance) < 0.01) {
          fraudAlerts.push({ ...row, reason: 'Balance unchanged after order' });
        }
        if (!tx) {
          fraudAlerts.push({ ...row, reason: 'No transaction record found for order' });
        }
      }
    }
  }

  return { tableData, networkSummary, fraudAlerts };
};

const cancelOrderItem = async (userId, orderItemId) => {
  return await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: true, product: true }
    });

    if (!item) throw new Error("Order item not found");
    if (item.order.userId !== userId) throw new Error("Unauthorized: This order does not belong to you");
    if (item.status !== "Pending") throw new Error("Only pending orders can be cancelled");

    // Update item status to Cancelled
    await tx.orderItem.update({
      where: { id: orderItemId },
      data: { status: "Cancelled" }
    });

    // Refund the agent's wallet
    const refundAmount = item.productPrice || item.product.price;
    await createTransaction(
      userId,
      refundAmount,
      "REFUND",
      `Refund for cancelled order item #${orderItemId} (Order #${item.orderId})`,
      `cancel:${item.orderId}:${orderItemId}`,
      tx
    );

    return { message: "Order cancelled and refund processed", refundAmount };
  }, { timeout: 15000 });
};

module.exports = {
  submitCart,
  getAllOrders,
  processOrder,
  getUserCompletedOrders,
  processOrderItem,
  getOrderStatus,
  getOrderHistory,
  updateOrderItemsStatus,
  updateSingleOrderItemStatus,
  downloadOrdersForExcel,
  getOrderTrackerData,
  cancelOrderItem,
  createDirectOrder: orderService.createDirectOrder,
  getOrdersByIds: orderService.getOrdersByIds,
  batchCompleteProcessingOrders: orderService.batchCompleteProcessingOrders,

  orderService
};