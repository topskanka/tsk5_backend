const uploadService = require("../services/uploadService");

// Get all uploaded files
const getAllUploads = async (req, res) => {
  try {
    const uploads = await uploadService.getAllUploads();
    
    if (!uploads.length) {
      return res.status(404).json({ error: "No files found" });
    }

    res.status(200).json(uploads);
  } catch (error) {
    console.error("Error fetching uploads:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Get uploaded files by user ID
const getUserUploads = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const uploads = await uploadService.getUserUploads(userId);
    
    if (!uploads.length) {
      return res.status(404).json({ error: "No files found for this user" });
    }

    res.status(200).json(uploads);
  } catch (error) {
    console.error("Error fetching user uploads:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = {
  getAllUploads,
  getUserUploads,
};
