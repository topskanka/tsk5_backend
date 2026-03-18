const prisma = require('../config/db');

const externalApiAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'Missing API key. Include x-api-key header.'
      });
    }

    const keyRecord = await prisma.externalApiKey.findUnique({
      where: { apiKey }
    });

    if (!keyRecord) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key.'
      });
    }

    if (!keyRecord.isActive) {
      return res.status(403).json({
        success: false,
        message: 'API key has been revoked.'
      });
    }

    // Update last used timestamp (fire-and-forget)
    prisma.externalApiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {});

    // Attach partner info to request
    req.partner = {
      id: keyRecord.id,
      name: keyRecord.partnerName
    };

    next();
  } catch (error) {
    console.error('External API auth error:', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed.'
    });
  }
};

module.exports = externalApiAuth;
