const LEVELS = ['debug', 'info', 'warn', 'error'];

const resolveLevelWeight = (level) => {
  const index = LEVELS.indexOf(String(level || '').toLowerCase());
  return index >= 0 ? index : 1;
};

const ACTIVE_LEVEL = process.env.LOG_LEVEL || 'info';
const ACTIVE_WEIGHT = resolveLevelWeight(ACTIVE_LEVEL);

const write = (level, message, meta = {}) => {
  if (resolveLevelWeight(level) < ACTIVE_WEIGHT) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(meta && typeof meta === 'object' ? meta : {})
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
};

const withRequest = (req) => ({
  requestId: req?.requestId || '',
  method: req?.method || '',
  path: req?.originalUrl || req?.url || '',
  userId: req?.user?._id ? String(req.user._id) : undefined
});

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  withRequest
};
