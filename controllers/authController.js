// const userService = require('../services/userService');
// const jwt = require('jsonwebtoken');
// require('dotenv').config();

// const loginUser = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     ////////////////////////////////1️⃣ Check if user exists  --- GODFREY ///////////////////////////////
//     const user = await userService.getUserByEmail(email);
//     if (!user) {
//       return res.status(400).json({ message: "Invalid email or password" });
//     }

//     /////////////////////////////// 2️⃣ Compare passwords (WITHOUT HASHING) --- GODFREY ////////////////////////////////
//     if (user.password !== password) {
//       return res.status(400).json({ message: "Invalid email or password" });
//     }

//     /////////////////////////////// 3️⃣ Generate JWT token --- GODFREY ///////////////////////////////////// 
//     const token = jwt.sign(
//       { id: user.id, email: user.email, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "1h" }
//     );

   
//     res.status(200).json({ message: "Login successful", token, user });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// module.exports = { loginUser };


// const userService = require('../services/userService');
// const jwt = require('jsonwebtoken');
// require('dotenv').config();

// // Store active sessions - key: user ID, value: session data
// const activeSessions = new Map();

// const loginUser = async (req, res) => {
//   try {
//     const { email, password } = req.body;
    
//     ////////////////////////////////1️⃣ Check if user exists  --- GODFREY ///////////////////////////////
//     const user = await userService.getUserByEmail(email);
//     if (!user) {
//       return res.status(400).json({ message: "Invalid email or password" });
//     }
    
//     /////////////////////////////// 2️⃣ Compare passwords (WITHOUT HASHING) --- GODFREY ////////////////////////////////
//     if (user.password !== password) {
//       return res.status(400).json({ message: "Invalid email or password" });
//     }

//     /////////////////////////////// Check for existing session --- ADDED FUNCTIONALITY ///////////////////////////////
//     if (activeSessions.has(user.id)) {
//       return res.status(403).json({ message: "This account is currently in use. Please log out from other devices first." });
//     }
    
//     /////////////////////////////// 3️⃣ Generate JWT token --- GODFREY /////////////////////////////////////
    
//     const token = jwt.sign(
//       { id: user.id, email: user.email, role: user.role },
//       process.env.JWT_SECRET,
//       { expiresIn: "1h" }
//     );
    
//     // Store session information
//     activeSessions.set(user.id, {
//       token,
//       loginTime: new Date().toISOString()
//     });
    
//     res.status(200).json({ message: "Login successful", token, user });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// // Add logout function to clear sessions
// const logoutUser = async (req, res) => {
//   try {
//     // Extract user ID from token
//     const token = req.headers.authorization?.split(' ')[1];
//     if (!token) {
//       return res.status(401).json({ message: "No authentication token provided" });
//     }
    
//     const decoded = jwt.verify(token, process.env.JWT_SECRET);
//     const userId = decoded.id;
    
//     // Remove from active sessions
//     if (activeSessions.has(userId)) {
//       activeSessions.delete(userId);
//     }
    
//     res.status(200).json({ message: "Logged out successfully" });
//   } catch (error) {
//     res.status(500).json({ message: error.message });
//   }
// };

// module.exports = { loginUser, logoutUser };


const { PrismaClient } = require('@prisma/client');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const prisma = new PrismaClient();

const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
        
    ////////////////////////////////1️⃣ Check if user exists  --- GODFREY ///////////////////////////////
    const user = await prisma.user.findUnique({
      where: { email: email }
    });
    
    if (!user) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
        
    /////////////////////////////// 2️⃣ Compare passwords (WITHOUT HASHING) --- GODFREY ////////////////////////////////
    if (user.password !== password) {
      return res.status(400).json({ message: "Invalid email or password" });
    }
    
    /////////////////////////////// 3️⃣ Check if user is already logged in using database flag ///////////////////////////////
    // if (user.isLoggedIn === true) {
    //   return res.status(403).json({ message: "This account is currently in use. Please log out from other devices first." });
    // }
        
    /////////////////////////////// 4️⃣ Generate JWT token --- GODFREY /////////////////////////////////////
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    
    /////////////////////////////// 5️⃣ Update user login status in database ///////////////////////////////
    await prisma.user.update({
      where: { id: user.id },
      data: { isLoggedIn: true }
    });
        
    res.status(200).json({ message: "Login successful", token, user: { ...user, isLoggedIn: true } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Logout using User ID - sets flag to false
const logoutUser = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
    // Check if user exists and update login status
    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) }
    });
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Update login status to false in database
    await prisma.user.update({
      where: { id: parseInt(userId) },
      data: { isLoggedIn: false }
    });
        
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Alternative: Logout using Email
const logoutUserByEmail = async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    
    // Check if user exists and update login status
    const user = await prisma.user.findUnique({
      where: { email: email }
    });
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Update login status to false in database
    await prisma.user.update({
      where: { email: email },
      data: { isLoggedIn: false }
    });
        
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error('Logout by email error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Admin function: Logout all users
const logoutAllUsers = async (req, res) => {
  try {
    const result = await prisma.user.updateMany({
      data: { isLoggedIn: false }
    });
    
    res.status(200).json({ 
      message: `Successfully logged out all users`,
      usersLoggedOut: result.count
    });
  } catch (error) {
    console.error('Logout all users error:', error);
    res.status(500).json({ message: error.message });
  }
};

// Helper function: Get all currently logged in users (for admin)
const getLoggedInUsers = async (req, res) => {
  try {
    const loggedInUsers = await prisma.user.findMany({
      where: { isLoggedIn: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true
      }
    });
    
    res.status(200).json({ 
      message: "Currently logged in users",
      count: loggedInUsers.length,
      users: loggedInUsers
    });
  } catch (error) {
    console.error('Get logged in users error:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { 
  loginUser,
  logoutUser,           // Logout by User ID
  logoutUserByEmail,    // Logout by Email  
  logoutAllUsers,       // Admin: Logout all users
  getLoggedInUsers      // Admin: See who's logged in
};