const multer = require('multer');

const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 }
}).single('image');
const { imageType } = require('../utils/imageType');
function uploadPortfolioImage(req, res) {
  parse(req, res, async (error) => {
    if (error)
      return res
        .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
        .json({ message: 'One image up to 2 MiB is required.' });
    const type = req.file && imageType(req.file.buffer);
    if (!type || req.file.mimetype !== type[1])
      return res.status(400).json({ message: 'A valid PNG, JPG or WebP image is required.' });
    try {
      const imageUrl = await require('../services/publicImageStorageService').put(
        'portfolio-images',
        req.user._id,
        req.file.buffer,
        type[0]
      );
      res.status(201).json({
        imageUrl: imageUrl,
        mimeType: type[1],
        size: req.file.size
      });
    } catch {
      res.status(503).json({ message: 'Image storage unavailable.' });
    }
  });
}
module.exports = { uploadPortfolioImage, imageType };
