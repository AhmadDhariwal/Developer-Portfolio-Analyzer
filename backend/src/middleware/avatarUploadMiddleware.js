const multer = require('multer');
const { imageType } = require('../utils/imageType');
const images = require('../services/publicImageStorageService');
const parse = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 }
}).single('avatar');
module.exports = {
  single: () => (req, res, next) =>
    parse(req, res, async (error) => {
      if (error)
        return res
          .status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
          .json({ message: 'One avatar up to 2 MiB is required.' });
      const type = req.file && imageType(req.file.buffer);
      if (!type || req.file.mimetype !== type[1])
        return res.status(400).json({ message: 'A valid PNG, JPG or WebP avatar is required.' });
      try {
        const processed = await require('../services/imageOptimizationService').optimize(
          req.file.buffer,
          'avatars'
        );
        req.file.buffer = processed.buffer;
        req.file.size = processed.size;
        req.file.mimetype = processed.mimeType;
        req.file.publicPath = await images.put(
          'avatars',
          req.user._id,
          req.file.buffer,
          processed.extension
        );
        next();
      } catch (error) {
        res
          .status(error.status || 503)
          .json({ message: error.status ? error.message : 'Avatar storage unavailable.' });
      }
    })
};
