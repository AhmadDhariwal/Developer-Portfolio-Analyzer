const { isIP } = require('node:net');

function safeNewsUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      host.endsWith('.') ||
      host.endsWith('.local') ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      isIP(host) ||
      host.includes(':') ||
      host.startsWith('[')
    )
      return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.toString();
  } catch {
    return '';
  }
}

module.exports = { safeNewsUrl };
