const isObjectId = (value) => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);

const validateObjectIdParam = (req, res, next, value, name) =>
  isObjectId(value) ? next() : res.status(400).json({ message: `${name} is invalid.` });

module.exports = { isObjectId, validateObjectIdParam };
