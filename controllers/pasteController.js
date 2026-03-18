const prisma = require('../config/db');
const userService = require('../services/userService');
const cartService = require('../services/cartService');

exports.pasteAndProcessOrders = async (req, res) => {
  console.log('--- [PASTE AND PROCESS ORDERS] Endpoint hit ---');

  try {
    const { agentId, network, textData } = req.body;
    if (!agentId || !network || !textData) {
      return res.status(400).json({ success: false, message: 'Missing agentId, network, or textData.' });
    }

    const lines = textData.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) {
      return res.status(400).json({ success: false, message: 'No data submitted.' });
    }

    const agent = await userService.getUserById(parseInt(agentId));
    if (!agent) {
      return res.status(400).json({ success: false, message: 'Agent not found.' });
    }
    const userRole = agent.role;

    let errorReport = [];
    let productsToAdd = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const parts = line.split(/\s+/);
      let rowErrors = [];

      if (parts.length !== 2) {
        rowErrors.push('Invalid format. Each line must be: phone_number space bundle_amount.');
        errorReport.push({ row: i + 1, errors: rowErrors });
        continue;
      }

      const [phoneNumber, bundleAmount] = parts;

      if (!phoneNumber) rowErrors.push('Missing phone number.');
      if (!bundleAmount || isNaN(parseFloat(bundleAmount))) rowErrors.push('Invalid or missing bundle amount.');

      if (rowErrors.length > 0) {
        errorReport.push({ row: i + 1, errors: rowErrors });
        continue;
      }

      const productDescription = `${bundleAmount}GB`;
      let productName;
      if (userRole.toUpperCase() === 'USER') {
        productName = network.toUpperCase();
      } else {
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
      } else if (product.stock <= 0) {
        rowErrors.push(`Product with bundle ${productDescription} and network ${network} is out of stock.`);
      } else {
        productsToAdd.push({ product, quantity: 1, phoneNumber });
      }

      if (rowErrors.length > 0) {
        errorReport.push({ row: i + 1, errors: rowErrors });
      }
    }

    if (errorReport.length > 0) {
      return res.status(400).json({ success: false, errorReport });
    }

    for (const item of productsToAdd) {
      await cartService.addItemToCart(agent.id, item.product.id, item.quantity, item.phoneNumber);
    }

    return res.json({ success: true, message: `${productsToAdd.length} products added to cart.` });

  } catch (err) {
    console.log('ERROR in pasteAndProcessOrders:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};
