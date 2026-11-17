'use strict';
module.exports = (req, _res, buffer) => {
  if (req.originalUrl.split('?')[0] === '/api/integrations/webhooks/github')
    req.rawBody = Buffer.from(buffer);
};
