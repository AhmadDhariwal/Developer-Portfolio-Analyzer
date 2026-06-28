const multer = require('multer');
const path = require('path');
const fs = require('fs');

const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;
const uploadDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${req.user._id}-${Date.now()}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: {
        files: 1,
        fileSize: MAX_RESUME_SIZE_BYTES
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    }
});

module.exports = upload;
module.exports.resumePdf = (req, res, next) => {
    upload.single('file')(req, res, (error) => {
        if (!error) return next();
        if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ message: 'Resume PDF must be 10 MB or smaller' });
        }
        return res.status(400).json({ message: error.message || 'Invalid resume upload' });
    });
};
