const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');

const AVATAR_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'avatars');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(AVATAR_UPLOAD_DIR)) {
      fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
    }
    cb(null, AVATAR_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${req.user._id}-${Date.now()}${ext}`);
  }
});

const avatarUpload = multer({
  storage,
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (allowed.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('Only JPG, PNG, and WEBP files are allowed.'), false);
  }
});

module.exports = avatarUpload;
