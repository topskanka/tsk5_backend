const prisma = require("../config/db");
const { createTransaction } = require("./transactionService");

/**
 * Get counts of pending order items grouped by network (for export UI)
 */
const getPendingCountsByNetwork = async () => {
  // Find all pending OrderItems whose parent Order has NO batchId
  // Include product relation as fallback for items without productName snapshot
  const items = await prisma.orderItem.findMany({
    where: {
      status: "Pending",
      order: { batchId: null }
    },
    select: { productName: true, productPrice: true, quantity: true, product: { select: { name: true, price: true } } }
  });

  const networks = { MTN: { count: 0, total: 0 }, TELECEL: { count: 0, total: 0 }, "AIRTEL TIGO": { count: 0, total: 0 } };

  for (const item of items) {
    const name = (item.productName || item.product?.name || "").toUpperCase();
    for (const net of Object.keys(networks)) {
      if (name.startsWith(net)) {
        networks[net].count++;
        networks[net].total += (item.productPrice || item.product?.price || 0) * item.quantity;
        break;
      }
    }
  }

  return networks;
};

/**
 * Export pending orders by network: creates a batch, links orders, returns rows for Excel
 */
const exportPendingByNetwork = async (adminUserId, network) => {
  return await prisma.$transaction(async (tx) => {
    // Find pending items matching the network whose order has no batchId
    // Use OR to match both productName snapshot and product.name (fallback for old orders)
    const pendingItems = await tx.orderItem.findMany({
      where: {
        status: "Pending",
        order: { batchId: null },
        OR: [
          { productName: { startsWith: network.toUpperCase() } },
          { productName: null, product: { name: { startsWith: network.toUpperCase() } } },
          { productName: "", product: { name: { startsWith: network.toUpperCase() } } }
        ]
      },
      include: {
        order: { include: { user: { select: { id: true, name: true, phone: true } } } },
        product: { select: { id: true, name: true, description: true, price: true } }
      }
    });

    if (pendingItems.length === 0) {
      throw new Error(`No pending orders found for ${network}`);
    }

    // Get distinct order IDs
    const orderIdSet = new Set(pendingItems.map(item => item.orderId));
    const orderIds = [...orderIdSet];

    // Calculate totals
    let totalPrice = 0;
    for (const item of pendingItems) {
      totalPrice += (item.productPrice || item.product.price) * item.quantity;
    }

    // Create the batch
    const filename = `${network.toUpperCase()}_export_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.xlsx`;
    const batch = await tx.orderBatch.create({
      data: {
        userId: parseInt(adminUserId),
        filename,
        network: network.toUpperCase(),
        totalItems: pendingItems.length,
        totalPrice,
        status: "Pending"
      }
    });

    // Link orders to the batch
    await tx.order.updateMany({
      where: { id: { in: orderIds } },
      data: { batchId: batch.id }
    });

    // Auto-update exported items from Pending to Processing
    const itemIds = pendingItems.map(item => item.id);
    await tx.orderItem.updateMany({
      where: { id: { in: itemIds } },
      data: { status: "Processing" }
    });

    // Update the batch status to Processing as well
    await tx.orderBatch.update({
      where: { id: batch.id },
      data: { status: "Processing" }
    });

    // Build Excel rows
    const rows = pendingItems.map(item => ({
      orderId: item.orderId,
      itemId: item.id,
      agent: item.order.user?.name || "N/A",
      phone: item.mobileNumber || item.order.mobileNumber || "",
      product: item.productName || item.product.name,
      bundle: item.productDescription || item.product.description,
      price: item.productPrice || item.product.price,
      quantity: item.quantity,
      status: "Processing"
    }));

    return { batch, rows, totalItems: pendingItems.length, totalPrice };
  }, { timeout: 30000 });
};

/**
 * Get all order batches with computed stats
 */
const getAllBatches = async () => {
  const batches = await prisma.orderBatch.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { id: true, name: true } },
      orders: {
        include: {
          user: { select: { id: true, name: true } },
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
        const s = item.status === "Canceled" ? "Cancelled" : item.status;
        if (statusCounts[s] !== undefined) statusCounts[s]++;
      }
    }

    let overallStatus = batch.status;
    if (totalItems > 0) {
      if (statusCounts.Completed === totalItems) overallStatus = "Completed";
      else if (statusCounts.Cancelled === totalItems) overallStatus = "Cancelled";
      else if (statusCounts.Processing > 0) overallStatus = "Processing";
      else overallStatus = "Pending";
    }

    // Collect unique agents from the orders in the batch
    const agents = [];
    const seenAgents = new Set();
    for (const order of batch.orders) {
      if (order.user && !seenAgents.has(order.user.id)) {
        seenAgents.add(order.user.id);
        agents.push(order.user);
      }
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
      exportedBy: batch.user,
      agents,
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
      user: { select: { id: true, name: true } },
      orders: {
        include: {
          user: { select: { id: true, name: true, phone: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, description: true, price: true } }
            }
          }
        }
      }
    }
  });

  if (!batch) throw new Error("Order batch not found");
  return batch;
};

/**
 * Update status of all order items in a batch (auto-refund on cancel)
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
          include: { items: { include: { product: true } } }
        }
      }
    });

    if (!batch) throw new Error("Order batch not found");

    let totalRefund = 0;
    let updatedCount = 0;

    for (const order of batch.orders) {
      if (newStatus === "Cancelled") {
        const refundReference = `batch_refund:${batchId}:order:${order.id}`;
        const existingRefund = await tx.transaction.findFirst({
          where: { userId: order.userId, type: "ORDER_ITEMS_REFUND", reference: refundReference }
        });

        if (!existingRefund) {
          let orderRefund = 0;
          for (const item of order.items) {
            if (item.status !== "Cancelled" && item.status !== "Canceled") {
              orderRefund += (item.productPrice || item.product.price) * item.quantity;
            }
          }
          if (orderRefund > 0) {
            await createTransaction(order.userId, orderRefund, "ORDER_ITEMS_REFUND",
              `Batch #${batchId} - Order #${order.id} cancelled & refunded (Amount: ${orderRefund})`,
              refundReference, tx);
            totalRefund += orderRefund;
          }
        }
      }

      const result = await tx.orderItem.updateMany({
        where: { orderId: order.id },
        data: { status: newStatus }
      });
      updatedCount += result.count;
    }

    await tx.orderBatch.update({
      where: { id: parseInt(batchId) },
      data: { status: newStatus }
    });

    return {
      success: true, batchId: parseInt(batchId), newStatus, updatedItems: updatedCount, totalRefund,
      message: `Batch #${batchId}: ${updatedCount} items updated to ${newStatus}${totalRefund > 0 ? `, refunded GHS ${totalRefund.toFixed(2)}` : ''}`
    };
  }, { timeout: 30000 });
};

/**
 * Update a single order item status within a batch (with refund if cancelled)
 */
const updateBatchOrderItemStatus = async (batchId, itemId, newStatus) => {
  const validStatuses = ["Pending", "Processing", "Completed", "Cancelled"];
  if (!validStatuses.includes(newStatus)) throw new Error("Invalid status");

  return await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.findUnique({
      where: { id: parseInt(itemId) },
      include: { order: true, product: true }
    });

    if (!item) throw new Error("Order item not found");
    if (item.order.batchId !== parseInt(batchId)) throw new Error("Order item does not belong to this batch");

    if (newStatus === "Cancelled" && item.status !== "Cancelled" && item.status !== "Canceled") {
      const refundReference = `batch_item_refund:${batchId}:item:${itemId}`;
      const existingRefund = await tx.transaction.findFirst({
        where: { userId: item.order.userId, type: "ORDER_ITEM_REFUND", reference: refundReference }
      });

      if (!existingRefund) {
        const refundAmount = (item.productPrice || item.product.price) * item.quantity;
        if (refundAmount > 0) {
          await createTransaction(item.order.userId, refundAmount, "ORDER_ITEM_REFUND",
            `Batch #${batchId} - Item #${itemId} cancelled & refunded (Amount: ${refundAmount})`,
            refundReference, tx);
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
 * Re-download a batch as Excel (for re-export)
 */
const getBatchForDownload = async (batchId) => {
  const batch = await prisma.orderBatch.findUnique({
    where: { id: parseInt(batchId) },
    include: {
      orders: {
        include: {
          user: { select: { name: true } },
          items: {
            include: { product: { select: { name: true, description: true, price: true } } }
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
        agent: order.user?.name || "N/A",
        phone: item.mobileNumber || order.mobileNumber || "",
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

module.exports = {
  getPendingCountsByNetwork,
  exportPendingByNetwork,
  getAllBatches,
  getBatchById,
  updateBatchStatus,
  updateBatchOrderItemStatus,
  getBatchForDownload
};
