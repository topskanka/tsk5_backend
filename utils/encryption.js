const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = crypto.scryptSync(process.env.CHAT_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-chat-key-change-me', 'salt', 32);

const encrypt = (text) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    content: encrypted + ':' + authTag,
    iv: iv.toString('hex')
  };
};

const decrypt = (encryptedContent, ivHex) => {
  try {
    const [encrypted, authTag] = encryptedContent.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error.message);
    return '[Decryption failed]';
  }
};

module.exports = { encrypt, decrypt };
