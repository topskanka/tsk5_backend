const axios = require('axios');
const prisma = require('../config/db');
const { createTransaction } = require('./transactionService');
const smsService = require('./smsService');

// Paystack API URLs
const PAYSTACK_INITIALIZE_URL = 'https://api.paystack.co/transaction/initialize';
const PAYSTACK_VERIFY_URL = 'https://api.paystack.co/transaction/verify';

// Generate unique external reference for topup
const generateTopupRef = () => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TOPUP-${timestamp}-${random}`;
};

// Initialize Paystack payment for wallet top-up
const initializeTopupPayment = async (userId, amount, callbackUrl) => {
  const externalRef = generateTopupRef();
  
  // Get user details
  const user = await prisma.user.findUnique({
    where: { id: parseInt(userId) },
    select: { id: true, name: true, email: true, phone: true, loanBalance: true }
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Format phone number for email fallback
  let formattedPhone = user.phone?.replace(/\D/g, '') || '';
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '233' + formattedPhone.substring(1);
  } else if (formattedPhone && !formattedPhone.startsWith('233')) {
    formattedPhone = '233' + formattedPhone;
  }

  // Create topup record with PENDING status
  const topUp = await prisma.topUp.create({
    data: {
      userId: parseInt(userId),
      referenceId: externalRef,
      amount: parseFloat(amount),
      status: 'Pending',
      submittedBy: 'PAYSTACK_PAYMENT'
    }
  });

  try {
    console.log('Initializing Paystack Top-up Payment...');
    
    // Paystack amount is in pesewas, multiply by 100
    const amountInPesewas = Math.round(parseFloat(amount) * 100);

    const response = await axios({
      method: 'POST',
      url: PAYSTACK_INITIALIZE_URL,
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        email: user.email || `${formattedPhone}@tsk5.com`,
        amount: amountInPesewas,
        currency: 'GHS',
        reference: externalRef,
        callback_url: callbackUrl || `${process.env.FRONTEND_URL}/dashboard?topup=callback`,
        metadata: {
          topupId: topUp.id,
          userId: user.id,
          userName: user.name,
          type: 'WALLET_TOPUP',
          custom_fields: [
            {
              display_name: "Top-up Amount",
              variable_name: "topup_amount",
              value: `GHS ${amount}`
            },
            {
              display_name: "Agent Name",
              variable_name: "agent_name",
              value: user.name
            }
          ]
        },
        channels: ['mobile_money', 'card']
      },
      timeout: 30000
    });

    console.log('Paystack Top-up Initialize Response:', response.data);

    if (response.data.status === true) {
      const paymentUrl = response.data.data.authorization_url;
      const accessCode = response.data.data.access_code;

      return {
        success: true,
        topupId: topUp.id,
        externalRef,
        paymentUrl,
        accessCode,
        amount: parseFloat(amount),
        message: 'Payment initialized successfully'
      };
    } else {
      // Update topup status to failed
      await prisma.topUp.update({
        where: { id: topUp.id },
        data: { status: 'Failed' }
      });

      return {
        success: false,
        topupId: topUp.id,
        externalRef,
        error: response.data.message || 'Failed to initialize payment'
      };
    }

  } catch (error) {
    console.error('Paystack Top-up Initialize Error:', error.response?.data || error.message);
    
    // Update topup status to failed
    await prisma.topUp.update({
      where: { id: topUp.id },
      data: { status: 'Failed' }
    });

    return {
      success: false,
      topupId: topUp.id,
      externalRef,
      error: error.response?.data?.message || error.message
    };
  }
};

// Verify topup payment and credit wallet
const verifyTopupPayment = async (reference) => {
  // Find the topup by reference
  const topUp = await prisma.topUp.findUnique({
    where: { referenceId: reference },
    include: { user: { select: { id: true, name: true, loanBalance: true } } }
  });

  if (!topUp) {
    throw new Error('Top-up transaction not found');
  }

  // If already approved, return success
  if (topUp.status === 'Approved') {
    return {
      success: true,
      alreadyProcessed: true,
      topupId: topUp.id,
      amount: topUp.amount,
      message: 'Top-up already processed'
    };
  }

  try {
    console.log('Verifying Paystack Top-up Payment:', reference);
    
    const response = await axios({
      method: 'GET',
      url: `${PAYSTACK_VERIFY_URL}/${reference}`,
      headers: {
        'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log('Paystack Top-up Verify Response:', response.data);

    const paymentData = response.data.data;
    const paymentStatus = paymentData?.status;
    
    const isSuccess = paymentStatus === 'success';
    const isPending = paymentStatus === 'pending' || paymentStatus === 'ongoing';
    const isFailed = paymentStatus === 'failed' || paymentStatus === 'abandoned';

    if (isSuccess) {
      // Credit user wallet using transaction
      const result = await prisma.$transaction(async (prismaTx) => {
        // Update topup status to Approved
        await prismaTx.topUp.update({
          where: { id: topUp.id },
          data: { status: 'Approved' }
        });

        // Create transaction and update balance
        const transaction = await createTransaction(
          topUp.userId,
          topUp.amount,
          'TOPUP_APPROVED',
          `Wallet top-up of GHS ${topUp.amount} via Paystack - Ref: ${reference}`,
          `topup:${topUp.id}`,
          prismaTx
        );

        return {
          success: true,
          topupId: topUp.id,
          amount: topUp.amount,
          newBalance: transaction.balance,
          reference,
          message: 'Top-up successful! Wallet credited.'
        };
      }, { timeout: 15000 });

      return result;
    } else if (isPending) {
      return {
        success: false,
        pending: true,
        topupId: topUp.id,
        amount: topUp.amount,
        reference,
        message: 'Payment is still being processed. Please try again.'
      };
    } else {
      // Payment failed
      await prisma.topUp.update({
        where: { id: topUp.id },
        data: { status: 'Failed' }
      });

      return {
        success: false,
        topupId: topUp.id,
        amount: topUp.amount,
        reference,
        message: 'Payment failed or was cancelled.'
      };
    }

  } catch (error) {
    console.error('Paystack Top-up Verify Error:', error.response?.data || error.message);
    return {
      success: false,
      pending: true,
      topupId: topUp.id,
      reference,
      error: error.response?.data?.message || error.message
    };
  }
};

// Handle Paystack webhook for topup
const handleTopupWebhook = async (webhookData) => {
  console.log('Paystack Top-up Webhook Received:', webhookData);
  
  const event = webhookData.event;
  const data = webhookData.data;
  
  if (!data || !data.reference) {
    console.error('Webhook missing reference');
    return { success: false, error: 'Missing reference' };
  }

  const reference = data.reference;

  // Check if this is a topup transaction
  if (!reference.startsWith('TOPUP-')) {
    return { success: false, error: 'Not a topup transaction' };
  }

  // Find the topup
  const topUp = await prisma.topUp.findUnique({
    where: { referenceId: reference }
  });

  if (!topUp) {
    console.error('Top-up not found for webhook:', reference);
    return { success: false, error: 'Top-up not found' };
  }

  // If already processed, skip
  if (topUp.status === 'Approved') {
    return { success: true, message: 'Already processed' };
  }

  const isSuccess = event === 'charge.success' && data.status === 'success';

  if (isSuccess) {
    // Verify and credit wallet
    return await verifyTopupPayment(reference);
  }

  return { success: false, error: 'Payment not successful' };
};

// Get all topups with filtering (for admin)
const getAllTopups = async (startDate, endDate, status) => {
  const whereCondition = {};

  if (startDate && endDate) {
    whereCondition.createdAt = {
      gte: new Date(startDate),
      lte: new Date(endDate)
    };
  }

  if (status) {
    whereCondition.status = status;
  }

  return await prisma.topUp.findMany({
    where: whereCondition,
    include: {
      user: {
        select: { id: true, name: true, email: true, phone: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
};

// Get user's topup history
const getUserTopups = async (userId) => {
  return await prisma.topUp.findMany({
    where: { userId: parseInt(userId) },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
};

// Delete a topup record
const deleteTopup = async (topupId) => {
  const id = parseInt(topupId);
  
  // Check if topup exists
  const topup = await prisma.topUp.findUnique({
    where: { id }
  });

  if (!topup) {
    throw new Error('Top-up not found');
  }

  // Delete the topup record
  await prisma.topUp.delete({
    where: { id }
  });

  return { success: true, message: 'Top-up deleted successfully' };
};

// Verify top-up using Transaction ID (SMS verification)
const verifyTransactionIdTopup = async (userId, referenceId, retries = 3) => {
  try {
    // Normalize: trim whitespace and remove non-alphanumeric chars
    const cleanRef = String(referenceId).trim().replace(/[^a-zA-Z0-9]/g, '');

    // Step 1: Find SMS message regardless of processed status
    const smsMessage = await smsService.findSmsByReferenceAny
      ? await smsService.findSmsByReferenceAny(cleanRef)
      : await smsService.findSmsByReference(cleanRef);

    // Step 2: If not found at all → invalid ID
    if (!smsMessage) {
      throw new Error("Invalid transaction ID. Please check the transaction ID and try again.");
    }

    // Step 3: If found but already processed → already used
    if (smsMessage.isProcessed) {
      const processedDate = smsMessage.updatedAt || smsMessage.createdAt;
      const formattedDate = processedDate ? new Date(processedDate).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown date';
      const amt = smsMessage.amount ? `GHS ${smsMessage.amount}` : '';
      throw new Error(`This transaction ID has already been used. It was credited${amt ? ` (${amt})` : ''} on ${formattedDate}.`);
    }

    if (!smsMessage.amount) {
      throw new Error("Amount not found in SMS. Please contact support.");
    }

    // Step 4: Check if reference already exists in TopUp table
    const existingTopUp = await prisma.topUp.findFirst({
      where: {
        OR: [
          { referenceId: cleanRef },
          ...(smsMessage.reference && smsMessage.reference !== cleanRef ? [{ referenceId: smsMessage.reference }] : [])
        ]
      }
    });

    if (existingTopUp) {
      const creditDate = existingTopUp.createdAt ? new Date(existingTopUp.createdAt).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' }) : 'unknown date';
      const amt = existingTopUp.amount ? `GHS ${existingTopUp.amount}` : '';
      throw new Error(`This transaction ID has already been used. It was credited${amt ? ` (${amt})` : ''} on ${creditDate}.`);
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      select: { id: true, name: true, loanBalance: true }
    });

    if (!user) {
      throw new Error("User not found");
    }

    // --- Start Atomic Transaction ---
    const result = await prisma.$transaction(async (prismaTx) => {
      // 1. Create TopUp record with Approved status
      const topUp = await prismaTx.topUp.create({
        data: {
          userId: parseInt(userId),
          referenceId: referenceId,
          amount: smsMessage.amount,
          status: "Approved",
          submittedBy: "TRANSACTION_ID_VERIFICATION"
        }
      });

      // 2. Update user balance and create a transaction record
      const transaction = await createTransaction(
        parseInt(userId),
        smsMessage.amount,
        "TOPUP_APPROVED",
        `Top-up via Transaction ID verification - Ref: ${referenceId} for GHS ${smsMessage.amount}`,
        `topup:${topUp.id}`,
        prismaTx
      );

      // 3. Mark the SMS as processed
      await smsService.markSmsAsProcessed(smsMessage.id, prismaTx);

      return {
        success: true,
        amount: smsMessage.amount,
        newBalance: transaction.balance,
        reference: referenceId,
        topUpId: topUp.id,
        message: "Top-up successful!"
      };
    }, { timeout: 15000 });
    // --- End Atomic Transaction ---

    return result;

  } catch (error) {
    console.error(`Error in transaction ID top-up (attempt ${4 - retries}):`, error);
    if (retries > 0 && !error.message.includes("Invalid") && !error.message.includes("already")) {
      // Exponential backoff: wait for 100ms, 200ms, 400ms
      await new Promise((res) => setTimeout(res, (4 - retries) * 100));
      return verifyTransactionIdTopup(userId, referenceId, retries - 1);
    }
    throw new Error(error.message);
  }
};

module.exports = {
  initializeTopupPayment,
  verifyTopupPayment,
  handleTopupWebhook,
  getAllTopups,
  getUserTopups,
  deleteTopup,
  verifyTransactionIdTopup
};
