'use strict';
// Real preview cache in a credential-free child process, with Redis deliberately absent.
const cache = require('../../services/previewResumeCacheService');
process.on('message', async (message) => {
  try {
    const value =
      message.kind === 'create'
        ? await cache.createPreviewResume(
            'Synthetic TypeScript and SQL claims',
            'account:synthetic-owner'
          )
        : await cache.resolvePreviewResume({
            ...message.value,
            claimPolicy: 'skill-gap-v2',
            ownerScope: message.scope
          });
    process.send({ id: message.id, value });
  } catch {
    process.send({ id: message.id, error: 'cache probe failed' });
  }
});
process.send({ ready: true });
