// Read-only audit. Never prints credentials, bucket identities, tokens or raw errors.
const fs = require('node:fs/promises');
const path = require('node:path');
const { configuration } = require('../services/b2ObjectStorageService');
async function audit({ live = false } = {}) {
  const env = require('dotenv').parse(await fs.readFile(path.resolve(__dirname, '../../.env')));
  const config = configuration(env);
  configuration({ ...env, STORAGE_DRIVER: 'b2' });
  const result = {
    configuredDriver: config.driver,
    b2ActivationConfigurationValid: true,
    configurationChanged: false,
    runtimeCapabilities: ['readFiles', 'writeFiles', 'listFiles', 'deleteFiles'],
    buckets: {}
  };
  if (live)
    for (const alias of ['images', 'resumes']) {
      const cfg = config.buckets[alias];
      try {
        const authorized = await fetch(
          'https://api.backblazeb2.com/b2api/v4/b2_authorize_account',
          {
            headers: {
              Authorization:
                'Basic ' +
                Buffer.from(
                  cfg.credentials.accessKeyId + ':' + cfg.credentials.secretAccessKey
                ).toString('base64')
            },
            signal: AbortSignal.timeout(15000)
          }
        );
        if (!authorized.ok) throw Error('Authorization failed.');
        const auth = await authorized.json();
        const api = auth.apiInfo.storageApi;
        const allowed = api.allowed;
        const scoped = allowed.buckets?.length === 1 && allowed.buckets[0].name === cfg.bucket;
        const entry = (result.buckets[alias] = {
          authenticated: true,
          intendedBucketOnly: scoped,
          endpointMatches: api.s3ApiUrl === cfg.endpoint,
          fileCapabilitiesPresent: result.runtimeCapabilities.every((cap) =>
            allowed.capabilities.includes(cap)
          ),
          excessRuntimeCapabilities: allowed.capabilities.filter(
            (cap) => !result.runtimeCapabilities.includes(cap)
          )
        });
        if (!scoped || !/^https:\/\/api\d+\.backblazeb2\.com$/.test(api.apiUrl))
          throw Error('Unexpected authorization scope.');
        const response = await fetch(api.apiUrl + '/b2api/v4/b2_list_buckets', {
          method: 'POST',
          headers: { Authorization: auth.authorizationToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: auth.accountId, bucketId: allowed.buckets[0].id }),
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) {
          entry.bucketMetadata = 'operator audit required';
          continue;
        }
        const bucket = (await response.json()).buckets[0];
        Object.assign(entry, {
          private: bucket.bucketType === 'allPrivate',
          defaultSSEB2: bucket.defaultServerSideEncryption?.value?.mode === 'SSE-B2',
          lifecycleRuleCount: bucket.lifecycleRules?.length,
          retentionMetadataVisible: !!bucket.fileLockConfiguration?.isClientAuthorizedToRead
        });
        if (entry.retentionMetadataVisible)
          entry.retention = {
            enabled: bucket.fileLockConfiguration.value?.isFileLockEnabled,
            defaultMode: bucket.fileLockConfiguration.value?.defaultRetention?.mode || null
          };
      } catch {
        result.buckets[alias] = {
          ...result.buckets[alias],
          incomplete: true,
          failure: 'Read-only audit unavailable (sanitized).'
        };
      }
    }
  return result;
}
if (require.main === module)
  audit({ live: process.argv.includes('--live') })
    .then(async (result) => {
      if (process.env.B2_SECURITY_OUTPUT)
        await fs.writeFile(process.env.B2_SECURITY_OUTPUT, JSON.stringify(result, null, 2) + '\n');
      console.log(JSON.stringify(result));
    })
    .catch(() => {
      console.error('B2 security configuration invalid (sanitized).');
      process.exitCode = 1;
    });
module.exports = { audit };
