const shopService = require("../services/shopService");
const productService = require("../services/productService");

// Get products available in shop
const getShopProducts = async (req, res) => {
  try {
    const products = await productService.getShopProducts();
    res.json(products);
  } catch (error) {
    console.error("Error fetching shop products:", error);
    res.status(500).json({ error: error.message });
  }
};

// Create a shop order (for guest users)
const createShopOrder = async (req, res) => {
  try {
    const { productId, mobileNumber, customerName } = req.body;
    
    if (!productId || !mobileNumber) {
      return res.status(400).json({ 
        success: false, 
        message: "Product ID and mobile number are required" 
      });
    }
    
    const order = await shopService.createShopOrder(
      parseInt(productId),
      mobileNumber,
      customerName || "Shop Customer"
    );
    
    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: {
        id: order.id,
        mobileNumber: order.mobileNumber,
        status: order.status,
        createdAt: order.createdAt,
        items: order.items.map(item => ({
          id: item.id,
          productName: item.product.name,
          productDescription: item.product.description,
          price: item.product.price,
          status: item.status
        }))
      }
    });
  } catch (error) {
    console.error("Error creating shop order:", error);
    res.status(400).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Track orders by mobile number
const trackOrders = async (req, res) => {
  try {
    const { mobileNumber } = req.query;
    
    if (!mobileNumber) {
      return res.status(400).json({ 
        success: false, 
        message: "Mobile number is required" 
      });
    }
    
    const orders = await shopService.trackOrdersByMobile(mobileNumber);
    
    // Transform orders for frontend
    const transformedOrders = orders.map(order => ({
      orderId: order.id,
      mobileNumber: order.mobileNumber,
      createdAt: order.createdAt,
      items: order.items.map(item => ({
        id: item.id,
        productName: item.product.name,
        productDescription: item.product.description,
        price: item.product.price,
        status: item.status,
        mobileNumber: item.mobileNumber
      }))
    }));
    
    res.json({
      success: true,
      orders: transformedOrders
    });
  } catch (error) {
    console.error("Error tracking orders:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

// Get all shop orders (for admin)
// Supports optional startDate/endDate query params. Order amount is derived
// from the order-item snapshot (`orderItem.productPrice`) so it always
// matches what the customer actually paid, even if the product price has
// been updated since. Falls back to the product's current (promo-aware)
// price for older rows that were created before snapshots were stored.
const getAllShopOrders = async (req, res) => {
  try {
    const prisma = require("../config/db");
    const { startDate, endDate } = req.query;

    const where = {
      user: { email: "shop@tsk5.com" }
    };
    // Same-day filter: expand calendar strings to cover the full day so a
    // `startDate === endDate` selection (Today / Yesterday) does not collapse
    // the window to a single instant and return zero rows.
    if (startDate && endDate) {
      const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
      const gte = new Date(startDate);
      const lte = new Date(endDate);
      if (typeof startDate === 'string' && dateOnly.test(startDate)) gte.setUTCHours(0, 0, 0, 0);
      if (typeof endDate === 'string' && dateOnly.test(endDate)) lte.setUTCHours(23, 59, 59, 999);
      if (!Number.isNaN(gte.getTime()) && !Number.isNaN(lte.getTime())) {
        where.createdAt = { gte, lte };
      }
    }

    const orders = await prisma.order.findMany({
      where,
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                description: true,
                price: true,
                promoPrice: true,
                usePromoPrice: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    const resolvePrice = (item) => {
      if (typeof item?.productPrice === 'number') return item.productPrice;
      const p = item?.product;
      if (!p) return 0;
      return p.usePromoPrice && typeof p.promoPrice === 'number'
        ? p.promoPrice
        : (p.price || 0);
    };

    // Transform orders for frontend
    const transformedOrders = orders.map(order => {
      const first = order.items[0];
      const unitPrice = resolvePrice(first);
      const qty = first?.quantity || 1;
      return {
        id: order.id,
        customerName: first?.customerName || 'Shop Customer',
        phone: order.mobileNumber || first?.mobileNumber || 'N/A',
        product: first?.productName || first?.product?.name || 'N/A',
        description: first?.productDescription || first?.product?.description || 'N/A',
        amount: unitPrice * qty,
        unitPrice,
        quantity: qty,
        status: first?.status || order.status,
        reference: first?.externalRef || 'N/A',
        date: order.createdAt
      };
    });

    // Aggregate server-side stats so the admin modal does not have to
    // reduce the full list on the client.
    const gbRegex = /(\d+(?:\.\d+)?)\s*GB/i;
    let totalOrders = 0;
    let totalAmount = 0;
    let totalGB = 0;
    for (const o of transformedOrders) {
      totalOrders += 1;
      totalAmount += o.amount || 0;
      if ((o.status || '').toLowerCase() === 'completed') {
        const m = (o.description || '').match(gbRegex);
        if (m) totalGB += parseFloat(m[1]) * (o.quantity || 1);
      }
    }

    res.json({
      success: true,
      orders: transformedOrders,
      stats: { totalOrders, totalAmount, totalGB }
    });
  } catch (error) {
    console.error("Error fetching shop orders:", error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};

module.exports = {
  getShopProducts,
  createShopOrder,
  trackOrders,
  getAllShopOrders
};
