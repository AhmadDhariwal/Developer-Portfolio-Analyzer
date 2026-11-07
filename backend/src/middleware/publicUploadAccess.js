// Only explicitly public image directories are statically served. Stored resume
// and preview PDFs must go through routes that check publication/ownership.
function publicUploadAccess(req, res, next) {
  if (!/^\/(avatars|portfolio-images)\/[a-z0-9._-]+\.(png|jpe?g|webp)$/i.test(req.path))
    return res.sendStatus(404);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'public, max-age=3600, must-revalidate');
  next();
}
module.exports = publicUploadAccess;
