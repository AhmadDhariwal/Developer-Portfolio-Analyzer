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
      const processed = await require('../services/imageOptimizationService').optimize(
        req.file.buffer,
        'portfolio-images'
      );
      const imageUrl = await require('../services/publicImageStorageService').put(
        'portfolio-images',
        req.user._id,
        processed.buffer,
        processed.extension
      );
      res.status(201).json({
        imageUrl: imageUrl,
        mimeType: processed.mimeType,
        size: processed.size
      });
    } catch (error) {
      res
        .status(error.status || 503)
        .json({ message: error.status ? error.message : 'Image storage unavailable.' });
    }
  });
}
module.exports = { uploadPortfolioImage, imageType };
