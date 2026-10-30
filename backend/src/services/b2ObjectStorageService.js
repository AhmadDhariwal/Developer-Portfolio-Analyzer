const crypto = require('node:crypto');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const unavailable = () => Object.assign(Error('Object storage unavailable.'), { status: 503 });
function configuration(env = process.env) {
  const driver = env.STORAGE_DRIVER || 'filesystem';
  if (!['filesystem', 'b2'].includes(driver)) throw Error('Invalid STORAGE_DRIVER.');
  if (
    driver === 'filesystem' &&
    !Object.keys(env).some((key) => /^B2_(IMAGES|RESUMES)_/.test(key) && env[key])
  )
    return { driver };
  const buckets = {};
  for (const alias of ['images', 'resumes']) {
    const prefix = `B2_${alias.toUpperCase()}_`;
    const value = (name) => String(env[prefix + name] || '').trim();
    const region = value('REGION');
    const endpoint = value('ENDPOINT');
    if (
      !/^[a-z]{2}-[a-z]+-\d{3}$/.test(region) ||
      endpoint !== `https://s3.${region}.backblazeb2.com` ||
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value('BUCKET')) ||
      !value('KEY_ID') ||
      !value('APPLICATION_KEY')
    )
      throw Error(`Incomplete or invalid ${prefix} configuration.`);
    buckets[alias] = {
      region,
      endpoint,
      bucket: value('BUCKET'),
      credentials: { accessKeyId: value('KEY_ID'), secretAccessKey: value('APPLICATION_KEY') }
    };
  }
  if (
    buckets.images.bucket === buckets.resumes.bucket ||
    buckets.images.credentials.accessKeyId === buckets.resumes.credentials.accessKeyId ||
    buckets.images.credentials.secretAccessKey === buckets.resumes.credentials.secretAccessKey
  )
    throw Error('B2 requires distinct buckets and separate bucket-scoped credentials.');
  return { driver, buckets };
}
function createAdapter({
  env = process.env,
  clientFactory = (options) => new S3Client(options),
  timeoutMs = 15000
} = {}) {
  const config = configuration(env);
  const clients = new Map();
  let active = 0;
  function target(asset) {
    const bucket = config.buckets?.[asset.bucketAlias];
    const kind = asset.kind;
    const expected = new RegExp(
      `^v1/${kind}/${asset.ownerId}/[a-f0-9-]{36}\\.(png|jpg|webp|pdf)$`
    );
    if (
      !['avatars', 'portfolio-images', 'resumes'].includes(kind) ||
      !/^[a-f0-9]{24}$/.test(String(asset.ownerId)) ||
      !expected.test(asset.key) ||
      asset.bucketAlias !== (kind === 'resumes' ? 'resumes' : 'images') ||
      !Number.isInteger(asset.size) ||
      asset.size <= 0 ||
      asset.size > (kind === 'resumes' ? 10485760 : 2097152)
    )
      throw unavailable();
    if (!bucket || (asset.bucket && asset.bucket !== bucket.bucket)) throw unavailable();
    if (!clients.has(asset.bucketAlias))
      clients.set(
        asset.bucketAlias,
        clientFactory(
          {
            region: bucket.region,
            endpoint: bucket.endpoint,
            credentials: bucket.credentials,
            forcePathStyle: true,
            maxAttempts: 1,
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
            requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 }
          },
          asset.bucketAlias
        )
      );
    return { client: clients.get(asset.bucketAlias), bucket: bucket.bucket };
  }
  async function execute(asset, command, consume) {
    if (active >= 8) throw unavailable();
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let body;
    try {
      const { client } = target(asset);
      const aborted = new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(unavailable()), { once: true })
      );
      const result = await Promise.race([
        client.send(command, { abortSignal: controller.signal }),
        aborted
      ]);
      body = result.Body;
      if (!consume) return result;
      return await Promise.race([
        consume(result),
        new Promise((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(unavailable()), {
            once: true
          })
        )
      ]);
    } catch {
      throw unavailable();
    } finally {
      active--;
      clearTimeout(timer);
      body?.destroy?.();
    }
  }
  async function put(asset, buffer) {
    if (
      !Buffer.isBuffer(buffer) ||
      buffer.length !== asset.size ||
      crypto.createHash('sha256').update(buffer).digest('hex') !== asset.sha256
    )
      throw unavailable();
    const { bucket } = target(asset);
    const result = await execute(
      asset,
      new PutObjectCommand({
        Bucket: bucket,
        Key: asset.key,
        Body: buffer,
        ContentLength: buffer.length,
        ContentType: asset.mimeType,
        ContentMD5: crypto.createHash('md5').update(buffer).digest('base64'),
        ServerSideEncryption: 'AES256',
        CacheControl: 'private, no-store',
        Metadata: { sha256: asset.sha256 }
      })
    );
    if (!result.VersionId) throw unavailable();
    return { bucket, versionId: result.VersionId };
  }
  async function read(asset) {
    const { bucket } = target(asset);
    return execute(
      asset,
      new GetObjectCommand({ Bucket: bucket, Key: asset.key, VersionId: asset.versionId }),
      async (result) => {
        if (Number(result.ContentLength) !== asset.size) throw unavailable();
        const chunks = [];
        let size = 0;
        for await (const chunk of result.Body) {
          size += chunk.length;
          if (size > asset.size) throw unavailable();
          chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        if (
          size !== asset.size ||
          crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256
        )
          throw unavailable();
        return bytes;
      }
    );
  }
  async function remove(asset) {
    const { bucket } = target(asset);
    // Enumerate only this generated key. B2 is versioned; an unversioned delete
    // would leave private bytes behind. Unknown PUT outcomes are recovered here.
    let KeyMarker;
    let VersionIdMarker;
    let deleted = 0;
    for (let page = 0; page < 10; page++) {
      const result = await execute(
        asset,
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: asset.key,
          MaxKeys: 100,
          KeyMarker,
          VersionIdMarker
        })
      );
      for (const version of [...(result.Versions || []), ...(result.DeleteMarkers || [])]) {
        if (version.Key !== asset.key) continue;
        if (!version.VersionId) throw unavailable();
        deleted++;
        await execute(
          asset,
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: asset.key,
            VersionId: version.VersionId
          })
        );
      }
      if (!result.IsTruncated) return deleted;
      if (
        !result.NextKeyMarker ||
        (result.NextKeyMarker === KeyMarker && result.NextVersionIdMarker === VersionIdMarker)
      )
        throw unavailable();
      KeyMarker = result.NextKeyMarker;
      VersionIdMarker = result.NextVersionIdMarker;
    }
    throw unavailable();
  }
  return { config, put, read, remove };
}
let instance;
module.exports = {
  configuration,
  createAdapter,
  getAdapter: () => (instance ||= createAdapter()),
  unavailable
};
