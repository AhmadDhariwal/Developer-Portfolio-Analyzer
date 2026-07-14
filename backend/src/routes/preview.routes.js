const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { parsePreviewResume } = require('../controllers/resumecontoller');

const previewUploadDir = path.resolve(process.cwd(), 'uploads', 'preview');
if (!fs.existsSync(previewUploadDir)) {
  fs.mkdirSync(previewUploadDir, { recursive: true });
}

const previewStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, previewUploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `preview-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
  }
});

const previewUpload = multer({
  storage: previewStorage,
  limits: {
    files: 1,
    fileSize: 5 * 1024 * 1024 // Size limit <= 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

const previewResumePdfMiddleware = (req, res, next) => {
  previewUpload.single('file')(req, res, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Preview resume PDF must be 5 MB or smaller' });
    }
    return res.status(400).json({ message: error.message || 'Invalid preview resume upload' });
  });
};

router.post('/resume/parse-text', previewResumePdfMiddleware, parsePreviewResume);

module.exports = router;
