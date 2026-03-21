const prisma = require("../config/db");
const { createTransaction } = require("./transactionService");

/**
 * Get all order batches with user info and order counts
 */
const getAllBatches = async () => {
  const batches = await prisma.orderBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true }
      },
      orders: {
        include: {
          items: {
            select: { id: true, status: true, productPrice: true, quantity: true }
          }
        }
      }
    }
  });

  return batches.map(batch => {
    let totalItems = 0;
    let totalPrice = 0;
    let statusCounts = { Pending: 0, Processing: 0, Completed: 0, Cancelled: 0 };

    for (const order of batch.orders) {
      for (const item of order.items) {
        totalItems++;
        totalPrice += (item.productPrice || 0) * item.quantity;
        const normalizedStatus = item.status === "Canceled" ? "Cancelled" : item.status;
        if (statusCounts[normalizedStatus] !== undefined) {
          statusCounts[normalizedStatus]++;
        }
      }
    }

    // Determine overall batch status from items
    let overallStatus = batch.status;
    if (totalItems > 0) {
      if (statusCounts.Completed === totalItems) overallStatus = "Completed";
      else if (statusCounts.Cancelled === totalItems) overallStatus = "Cancelled";
      else if (statusCounts.Processing > 0) overallStatus = "Processing";
      else overallStatus = "Pending";
    }

    return {
      id: batch.id,
      filename: batch.filename,
      network: batch.network,
      totalItems,
      totalPrice,
      status: overallStatus,
      statusCounts,
      createdAt: batch.createdAt,
      user: batch.user,
      orderIds: batch.orders.map(o => o.id)
    };
  });
};

/**
 * Get a specific batch with all its orders and order items
 */
const getBatchById = async (batchId) => {
  const batch = await prisma.orderBatch.findUnique({
    where: { id: parseInt(batchId) },
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true }
      },
      orders: {
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true, description: true, price: true }
              }
            }
          }
        }
      }
    }
  });

  if (!batch) {
    throw new Error("Order batch not found");
  }

  return batch;
};

/**
 * Update status of all order items in a batch
 * Handles auto-refund when status is Cancelled
 */
const updateBatchStatus = async (batchId, newStatus) => {
  const validStatuses = ["Pending", "Processing", "Completed", "Cancelled"];
  if (!validStatuses.includes(newStatus)) {
    throw new Error("Invalid status. Must be: Pending, Processing, Completed, or Cancelled");
  }

  return await prisma.$transaction(async (tx) => {
    const batch = await tx.orderBatch.findUnique({
      where: { id: parseInt(batchId) },
      include: {
        orders: {
          include: {
            items: {
              include: { product: true }
            }
          }
        }
      }
    });

    if (!batch) {
      throw new Error("Order batch not found");
    }

    let totalRefund = 0;
    let updatedCount = 0;

    for (const order of batch.orders) {
      // If cancelling, handle refunds per order
      if (newStatus === "Cancelled") {
        const refundReference = `batch_refund:${batchId}:order:${order.id}`;
        const existingRefund = await tx.transaction.findFirst({
          where: {
            userId: order.userId,
            type: "ORDER_ITEMS_REFUND",
            reference: refundReference
          }
        });

        if (!existingRefund) {
          let orderRefund = 0;
          for (const item of order.items) {
            if (item.status !== "Cancelled" && item.status !== "Canceled") {
              orderRefund += (item.productPrice || item.product.price) * item.quantity;
            }
          }

          if (orderRefund > 0) {
            await createTransaction(
              order.userId,
              orderRefund,
              "ORDER_ITEMS_REFUND",
              `Batch #${batchId} - Order #${order.id} cancelled & refunded (Amount: ${orderRefund})`,
              refundReference,
              tx
            );
            totalRefund += orderRefund;
          }
        }
      }

      // Update all items in this order
      const result = await tx.orderItem.updateMany({
        where: { orderId: order.id },
        data: { status: newStatus }
      });
      updatedCount += result.count;
    }

    // Update batch status
    await tx.orderBatch.update({
      where: { id: parseInt(batchId) },
      data: { status: newStatus }
    });

    return {
      success: true,
      batchId: parseInt(batchId),
      newStatus,
      updatedItems: updatedCount,
      totalRefund,
      message: `Batch #${batchId}: ${updatedCount} items updated to ${newStatus}${totalRefund > 0 ? `, refunded GHS ${totalRefund.toFixed(2)}` : ''}`
    };
  }, { timeout: 30000 });
};

/**
 * Update a single order item status within a batch (with refund if cancelled)
 */
const updateBatchOrderItemStatus = async (batchId, itemId, newStatus) => {
  const validStatuses = ["Pending", "Processing", "Completed", "Cancelled"];
  if (!validStatuses.includes(newStatus)) {
    throw new Error("Invalid status");
  }

  return await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: parseInt(itemId) },
      include: { order: true, product: true }
    });

    if (!item) throw new Error("Order item not found");

    // Verify the item belongs to this batch
    if (item.order.batchId !== parseInt(batchId)) {
      throw new Error("Order item does not belong to this batch");
    }

    // Handle refund for cancellation
    if (newStatus === "Cancelled" && item.status !== "Cancelled" && item.status !== "Canceled") {
      const refundReference = `batch_item_refund:${batchId}:item:${itemId}`;
      const existingRefund = await tx.transaction.findFirst({
        where: {
          userId: item.order.userId,
          type: "ORDER_ITEM_REFUND",
          reference: refundReference
        }
      });

      if (!existingRefund) {
        const refundAmount = (item.productPrice || item.product.price) * item.quantity;
        if (refundAmount > 0) {
          await createTransaction(
            item.order.userId,
            refundAmount,
            "ORDER_ITEM_REFUND",
            `Batch #${batchId} - Item #${itemId} cancelled & refunded (Amount: ${refundAmount})`,
            refundReference,
            tx
          );
        }
      }
    }

    const updatedItem = await tx.orderItem.update({
      where: { id: parseInt(itemId) },
      data: { status: newStatus }
    });

    return { success: true, item: updatedItem };
  }, { timeout: 15000 });
};

/**
 * Get batch orders formatted for Excel download
 */
const getBatchForDownload = async (batchId) => {
  const batch = await prisma.orderBatch.findUnique({
    where: { id: parseInt(batchId) },
    include: {
      user: { select: { name: true } },
      orders: {
        include: {
          items: {
            include: {
              product: {
                select: { name: true, description: true, price: true }
              }
            }
          }
        }
      }
    }
  });

  if (!batch) throw new Error("Batch not found");

  const rows = [];
  for (const order of batch.orders) {
    for (const item of order.items) {
      rows.push({
        orderId: order.id,
        itemId: item.id,
        phone: item.mobileNumber || order.mobileNumber || '',
        product: item.productName || item.product.name,
        bundle: item.productDescription || item.product.description,
        price: item.productPrice || item.product.price,
        quantity: item.quantity,
        status: item.status
      });
    }
  }

  return { batch, rows };
};

/**
 * Create order batch from file upload data (creates orders directly, bypasses cart)
 */
const createBatchFromUpload = async (userId, filename, network, productsToAdd) => {
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: parseInt(userId) } });
    if (!user) throw new Error("User not found");

    // Calculate total cost
    let totalCost = 0;
    for (const item of productsToAdd) {
      totalCost += item.price * (item.quantity || 1);
    }

    // Check wallet balance
    if (user.loanBalance < totalCost) {
      throw new Error(`Insufficient wallet balance. Required: GHS ${totalCost.toFixed(2)}, Available: GHS ${user.loanBalance.toFixed(2)}`);
    }

    // Create the batch
    const batch = await tx.orderBatch.create({
      data: {
        userId: parseInt(userId),
        filename,
        network: network || null,
        totalItems: productsToAdd.length,
        totalPrice: totalCost,
        status: "Pending"
      }
    });

    // Create a single order with all items, linked to batch
    const order = await tx.order.create({
      data: {
        userId: parseInt(userId),
        batchId: batch.id,
        status: "Pending",
        items: {
          create: productsToAdd.map(item => ({
            productId: item.product.id,
            quantity: item.quantity || 1,
            mobileNumber: item.phoneNumber || null,
            status: "Pending",
            productName: item.product.name,
            productPrice: item.price,
            productDescription: item.product.description
          }))
        }
      },
      include: {
        items: { include: { product: true } }
      }
    });

    // Deduct from wallet
    await createTransaction(
      parseInt(userId),
      -totalCost,
      "ORDER",
      `Order #${order.id} placed via file upload (Batch #${batch.id}, ${productsToAdd.length} items)`,
      `order:${order.id}`,
      tx
    );

    return { batch, order, totalCost };
  }, { timeout: 30000, maxWait: 15000 });
};

module.exports = {
  getAllBatches,
  getBatchById,
  updateBatchStatus,
  updateBatchOrderItemStatus,
  getBatchForDownload,
  createBatchFromUpload
};
