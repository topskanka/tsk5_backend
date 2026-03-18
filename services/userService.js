const prisma = require("../config/db"); // Import the Prisma client instance
const bcrypt = require("bcrypt");
const xlsx = require("xlsx");
const fs = require("fs");
const path = require("path");
const { createTransaction } = require("./transactionService");
const cache = require("../utils/cache");

const getAllUsers = async () => {
  const cacheKey = 'all_users';
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
  });
  cache.set(cacheKey, users, 15000); // 15 second cache
  return users;
};

const getUserByEmail = async (email) => {
  return await prisma.user.findUnique({ where: { email } });
};

const createUser = async (data) => {
  return await prisma.user.create({ data });
};

const getUserById = async (id) => {
  return await prisma.user.findUnique({
    where: { id },
  });
};

const updateUser = async (id, data) => {
  cache.delete('all_users');
  return await prisma.user.update({
    where: { id: parseInt(id) },
    data,
  });
};


const addLoanToUser = async (userId, amount) => {
  try {
    // Update user's loan balance
    const user = await prisma.user.update({
      where: { id: userId },
      data: { loanBalance: { increment: amount } },
    });
    
    // Record the transaction
    await createTransaction(
      userId,
      amount,
      "LOAN_ADD",
      `Loan amount ${amount} added to user balance`,
      `user:${userId}`
    );
    
    return user;
  } catch (error) {
    throw new Error("Failed to add loan: " + error.message);
  }
};

const refundUser = async (userId, amount, refundReference) => {
  try {
    // Only update balance via createTransaction (atomic and logs the transaction)
    await createTransaction(
      userId,
      amount, // Positive amount for refund
      "REFUND",
      `Refund amount ${amount} added to user balance`,
      refundReference
    );
    // Fetch and return the updated user
    const user = await prisma.user.findUnique({ where: { id: userId } });
    return user;
  } catch (error) {
    throw new Error("Failed to refund: " + error.message);
  }
};

const updateLoanStatus = async (userId, hasLoan) => {
  try {
    if (!userId || isNaN(userId)) {
      throw new Error("Invalid userId: userId must be a number.");
    }

    const user = await prisma.user.update({
      where: { id: parseInt(userId, 10) }, // Convert userId to an integer
      data: { hasLoan },
    });

    return user;
  } catch (error) {
    console.error("Database error:", error);
    throw new Error("Failed to update loan status: " + error.message);
  }
};

const updateUserLoanStatus = async (userId, hasLoan, deductionAmount) => {
  try {
    if (!userId || isNaN(userId)) {
      throw new Error("Invalid userId provided");
    }
    const userIdInt = parseInt(userId, 10);
    // Fetch the user's current loan balance and adminLoanBalance
    const user = await prisma.user.findUnique({
      where: { id: userIdInt },
      select: {
        loanBalance: true,
        adminLoanBalance: true
      },
    });
    if (!user) {
      throw new Error("User not found");
    }
    let updatedLoanBalance = user.loanBalance ?? 0;
    let updatedAdminLoanBalance = user.adminLoanBalance ?? 0;

    if (hasLoan) {
      updatedAdminLoanBalance = updatedLoanBalance;
    } else {
      if (updatedLoanBalance > 0) {
        throw new Error("User still has an outstanding loan and cannot be deactivated manually until loan is fully repaid.");
      }
      updatedLoanBalance = 0;
      updatedAdminLoanBalance = 0;
    }
    // Use transaction to ensure atomicity
    return await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: userIdInt },
        data: {
          hasLoan,
          loanBalance: updatedLoanBalance,
          adminLoanBalance: updatedAdminLoanBalance,
        },
      });
      // Then create the transaction record
      await tx.transaction.create({
        data: {
          userId: userIdInt,
          amount: 0,
          balance: updatedLoanBalance,
          type: "LOAN_STATUS",
          description: hasLoan
            ? `Loan status changed to active with balance ${updatedLoanBalance}`
            : `Loan status changed to inactive and balances reset to 0`,
          reference: `user:${userIdInt}`
        }
      });
      return updatedUser;
    }, { timeout: 15000 });
  } catch (error) {
    console.error("Error updating loan status:", error.message);
    throw new Error(`Failed to update loan status: ${error.message}`);
  }
};

const updateAdminLoanBalance = async (userId, deductionAmount) => {
  try {
    if (!userId || isNaN(userId)) {
      throw new Error("Invalid userId provided");
    }
    // Fetch the current balance
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId, 10) },
      select: { adminLoanBalance: true },
    });
    if (!user) {
      throw new Error("User not found");
    }
    let updatedAdminLoanBalance = user.adminLoanBalance ?? 0;
    // Deduct the provided amount
    updatedAdminLoanBalance -= deductionAmount;
    // Ensure the balance does not go below zero
    if (updatedAdminLoanBalance < 0) {
      throw new Error("Insufficient balance for this deduction.");
    }
    // Record the loan deduction transaction
    await createTransaction(
      parseInt(userId, 10),
      -deductionAmount, // Negative amount for deduction
      "LOAN_DEDUCTION",
      `Loan deduction of ${deductionAmount} from admin loan balance`,
      `user:${userId}`
    );
    // Update adminLoanBalance and set hasLoan true if loan > 0
    const updatedUser = await prisma.user.update({
      where: { id: parseInt(userId, 10) },
      data: {
        adminLoanBalance: updatedAdminLoanBalance,
        hasLoan: updatedAdminLoanBalance > 0, // Automatically set hasLoan true if balance > 0
      },
    });
    return updatedUser;
  } catch (error) {
    console.error("Error updating adminLoanBalance:", error.message);
    throw new Error(error.message);
  }
};

const assignLoan = async (userId, amount) => {
  try {
    // Convert amount to number
    const loanAmount = Number(amount);
    
    // Update loan status and balance in a transaction
    const user = await prisma.$transaction(async (tx) => {
      // First get current balances
      const currentUser = await tx.user.findUnique({
        where: { id: userId },
        select: { loanBalance: true, adminLoanBalance: true }
      });
      
      // Save previous balances
      const prevLoanBalance = currentUser.loanBalance ?? 0;
      const prevAdminLoanBalance = currentUser.adminLoanBalance ?? 0;
      // Calculate new balances by adding loan amount
      const newLoanBalance = prevLoanBalance + loanAmount;
      const newAdminLoanBalance = prevAdminLoanBalance + loanAmount;
      
      // Update user record with both balances
      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          hasLoan: true,
          loanBalance: newLoanBalance,
          adminLoanBalance: newAdminLoanBalance
        }
      });
      
      // Create loan assignment transaction with correct prev/new balances
      await tx.transaction.create({
        data: {
          userId,
          amount: loanAmount,
          balance: newLoanBalance,
          previousBalance: prevLoanBalance,
          type: "LOAN_ASSIGNMENT",
          description: `Loan amount ${loanAmount} assigned to user. prev balance: ${prevLoanBalance}, new balance: ${newLoanBalance}`,
          reference: `user:${userId}`
        }
      });
      
      return updatedUser;
    }, { timeout: 15000 });
    
    return user;
  } catch (error) {
    throw new Error("Failed to assign loan: " + error.message);
  }
};

const repayLoan = async (userId, amount) => {
  try {
    // Fetch both loan balances
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { loanBalance: true, adminLoanBalance: true }
    });
    
    if (!user) {
      throw new Error("User not found");
    }
    
    // Save previous balances
    const prevLoanBalance = user.loanBalance;
    const prevAdminLoanBalance = user.adminLoanBalance;
    
    // Calculate new balances after repayment
    const absAmount = Math.abs(amount);
    const newLoanBalance = prevLoanBalance - absAmount;
    const newAdminLoanBalance = prevAdminLoanBalance - absAmount;
    const finalLoanBalance = Math.max(newLoanBalance, 0);
    const finalAdminLoanBalance = Math.max(newAdminLoanBalance, 0);
    // If loan fully repaid, set hasLoan to false (0)
    const hasLoanAfterRepayment = finalAdminLoanBalance > 0;
    
    // Update both loan balances and hasLoan
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        loanBalance: finalLoanBalance,
        adminLoanBalance: finalAdminLoanBalance,
        hasLoan: hasLoanAfterRepayment, // Must be boolean for Prisma/DB
      },
    });
    // Record the loan repayment transaction with correct prev/new balances
    await prisma.transaction.create({
      data: {
        userId,
        amount: -absAmount,
        balance: finalLoanBalance,
        previousBalance: prevLoanBalance,
        type: "LOAN_REPAYMENT",
        description: `Loan repayment amount of ${absAmount}, prev balance: ${prevLoanBalance}, new balance: ${finalLoanBalance}`,
        reference: `user:${userId}`
      }
    });

    return updatedUser;
  } catch (error) {
    throw new Error("Failed to repay loan: " + error.message);
  }
};

const getUserLoanBalance = async (userId) => {
  try {
      const parsedUserId = parseInt(userId, 10);

      // console.log(parsedUserId)

      if (isNaN(parsedUserId)) {
          throw new Error("Invalid user ID");
      }

      const user = await prisma.user.findUnique({
          where: { id: parsedUserId },
          select: { id: true, name: true, loanBalance: true, hasLoan: true, adminLoanBalance: true },
      });

      // console.log(user)

      if (!user) {
          throw new Error("User not found");
      }

      return user;
  } catch (error) {
      throw new Error("Failed to fetch loan balance: " + error.message);
  }
};

const deleteUser = async (id) => {
  return await prisma.$transaction(async (prisma) => {
    const userId = parseInt(id); // Ensure ID is an integer

    // Delete related order items --- just to remember - By Godfrey
    await prisma.orderItem.deleteMany({
      where: { order: { userId } },
    });

    // Delete related orders --- just to remember - By Godfrey
    await prisma.order.deleteMany({
      where: { userId },
    });

    // Delete related cart items --- just to remember - By Godfrey
    await prisma.cartItem.deleteMany({
      where: { cart: { userId } },
    });

    // Delete the cart --- just to remember - By Godfrey
    await prisma.cart.deleteMany({
      where: { userId },
    });

    // Finally, delete the user --- just to remember - By Godfrey
    return await prisma.user.delete({
      where: { id: userId },
    });
  }, { timeout: 15000 });
};

const processExcelFile = async (filePath, filename, userId, network) => {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    if (!sheetData.length) {
      throw new Error("Excel file is empty or formatted incorrectly.");
    }

    // Standardize column names and convert username to price
    const formattedData = sheetData.map(row => ({
      phone: row.phone?.toString() || row.Phone?.toString(), // Normalize case
      price: String(row.price || row.Price), // Convert to price (assuming price is a number)
      itemDescription: row.itemDescription.toString() || row["Item Description"].toString(), // Handle spaces
    }));

    // Filter out invalid rows
    const validData = formattedData.filter(row =>
      row.phone && row.price && row.itemDescription
    );

    if (!validData.length) {
      return { message: "No valid purchases found." };
    }

    // Create a new Upload record linked to the user
    const uploadedFile = await prisma.upload.create({
      data: { 
        filename, 
        filePath, 
        userId: parseInt(userId, 10) // Link the file to the user
      },
    });

    // Insert valid purchases
    const purchaseData = validData.map(row => ({
      phone: row.phone,
      price: row.price,
      itemDescription: row.itemDescription,
      network: network, // Save the selected network
      uploadedFileId: uploadedFile.id,
    }));

    await prisma.purchase.createMany({ data: purchaseData });
    return { message: "File processed successfully", uploadedFile };
  } catch (error) {
    console.error("Error processing Excel file:", error);
    throw error;
  } finally {
    // fs.unlinkSync(filePath); // Uncomment if you want to delete the file after processing
  }
};

const getLatestFileData = async () => {
  const latestFile = await prisma.upload.findFirst({
    orderBy: { uploadedAt: "desc" },
  });

  if (!latestFile) throw new Error("No uploaded files found");

  const purchases = await prisma.purchase.findMany({
    where: { uploadedFileId: latestFile.id },
  });

  if (purchases.length === 0) throw new Error("No purchases found for this file");

  return { latestFile, purchases };
};


const getFilePathById = async (fileId) => {
  try {
    const file = await prisma.upload.findUnique({
      where: { id: Number(fileId) },
    });

    if (!file) {
      throw new Error("File not found");
    }

    return {
      filePath: path.resolve(file.filePath),
      filename: file.filename,
    };
  } catch (error) {
    console.error("Error fetching file:", error);
    throw error;
  }
};

// 🛠 Generate & Download Excel File
const generateExcelFile = async (purchases) => {
  const data = purchases.map((p) => ({
    Username: p.username,
    Phone: p.phone,
    "Item Description": p.itemDescription,
  }));

  const worksheet = xlsx.utils.json_to_sheet(data);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Purchases");

  const filePath = path.join(__dirname, "../uploads", `latest_purchases.xlsx`);
  xlsx.writeFile(workbook, filePath);

  return filePath;
};


const updatePassword = async (userId, newPassword) => {
  try {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { password: newPassword },
    });
    return updatedUser;
  } catch (error) {
    throw new Error(`Failed to update password for user ${userId}: ${error.message}`);
  }
}

const updateProfile = async (userId, profileData) => {
  try {
    const { name, email } = profileData;
    
    // Check if email is already taken by another user
    if (email) {
      const existingUser = await prisma.user.findFirst({
        where: {
          email: email,
          id: { not: userId }
        }
      });
      
      if (existingUser) {
        throw new Error('Email address is already in use by another user');
      }
    }
    
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(name && { name }),
        ...(email && { email })
      },
    });
    
    return updatedUser;
  } catch (error) {
    throw new Error(`Failed to update profile for user ${userId}: ${error.message}`);
  }
}

module.exports = {
  getAllUsers,
  getUserByEmail,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  addLoanToUser,
  refundUser,
  updateLoanStatus,
  updateAdminLoanBalance,
  repayLoan,
  assignLoan,
  getUserLoanBalance,
  generateExcelFile,
  updatePassword,
  updateProfile,
  processExcelFile,
  getLatestFileData,
  getFilePathById,
  updateUserLoanStatus
};
