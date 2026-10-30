const jwt = require('jsonwebtoken');
const assets = require('../services/storedAssetService');
const sessions = require('../utils/authSessionToken');
const User = require('../models/user');
const Profile = require('../models/publicProfile');
const { isPortfolioEnabled } = require('../services/publicPortfolioVisibilityService');
const COOKIE = 'devinsight_media';
const options = () => ({
  algorithms: ['HS256'],
  issuer: process.env.JWT_ISSUER || 'devinsight-api',
  audience: 'devinsight-media'
});
function mediaSession(req, res, next) {
  if ((process.env.STORAGE_DRIVER === 'b2' || process.env.B2_IMAGES_BUCKET) && req.user) {
    const token = jwt.sign(
      { id: String(req.user._id), sessionRevision: Number(req.user.sessionRevision || 0) },
      process.env.JWT_SECRET,
      {
        algorithm: 'HS256',
        issuer: options().issuer,
        audience: 'devinsight-media',
        expiresIn: '20m'
      }
    );
    // Password rotation can renew a credential already issued by route middleware.
    // Keep only the newest media cookie while preserving unrelated Set-Cookie headers.
    const existing = res.getHeader('Set-Cookie');
    const others = (Array.isArray(existing) ? existing : [existing]).filter(
      (value) => value && !String(value).startsWith(COOKIE + '=')
    );
    if (others.length) res.setHeader('Set-Cookie', others);
    else res.removeHeader('Set-Cookie');
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/uploads',
      maxAge: 1200000
    });
  }
  next();
}
function isOwner(req, owner) {
  try {
    const raw = String(req.headers.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(COOKIE + '='));
    if (!raw || raw.length > 1024) return false;
    const decoded = jwt.verify(
      decodeURIComponent(raw.slice(COOKIE.length + 1)),
      process.env.JWT_SECRET,
      options()
    );
    return decoded.id === String(owner._id) && sessions.matches(owner, decoded);
  } catch {
    return false;
  }
}
function visibleReference(profile, reference) {
  const visibility = profile.sections?.visibility || {};
  const values = [
    ...(visibility.projects !== false ? (profile.projects || []).map((item) => item.imageUrl) : []),
    ...(visibility.upcoming !== false
      ? (profile.upcomingProjects || []).map((item) => item.imageUrl)
      : []),
    ...(visibility.testimonials !== false
      ? (profile.testimonials || []).map((item) => item.avatarUrl)
      : [])
  ];
  return values.some((value) => assets.parse(value)?.reference === reference);
}
async function storedImage(req, res, next) {
  const reference = '/uploads' + req.path;
  const parsed = assets.parse(reference);
  if (!parsed || parsed.kind === 'resumes') return next();
  res.set('Cache-Control', 'private, no-store');
  res.set('Vary', 'Cookie');
  res.set('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
  try {
    const asset = await assets.resolveImage(reference);
    const owner = await User.findById(asset.ownerId)
      .select('avatar sessionRevision isActive')
      .lean();
    if (!owner || owner.isActive === false) return res.sendStatus(404);
    let allowed = isOwner(req, owner);
    if (!allowed && asset.state === 'ready' && asset.kind === 'avatars')
      allowed = assets.parse(owner.avatar)?.reference === reference;
    if (
      !allowed &&
      asset.state === 'ready' &&
      asset.kind === 'portfolio-images' &&
      (await isPortfolioEnabled())
    ) {
      const profiles = await Profile.find({ userId: asset.ownerId, isPublic: true })
        .limit(100)
        .lean();
      allowed = profiles.some((profile) => visibleReference(profile, reference));
    }
    if (!allowed) return res.sendStatus(404);
    const bytes = await assets.read(reference, asset.ownerId);
    res.type(asset.mimeType);
    res.set('Content-Length', String(bytes.length));
    return req.method === 'HEAD' ? res.end() : res.send(bytes);
  } catch (error) {
    return res.status(error.status === 404 ? 404 : 503).json({ message: 'Image unavailable.' });
  }
}
module.exports = { mediaSession, storedImage, visibleReference };
