const BaseIntegrationAdapter = require('./baseAdapter');

const BASE = 'https://api.kaggle.com/v1';
const PAGE_SIZE = 20;
const fail = (message, status = 502) => Object.assign(Error(message), { status });

// Direct JSON transport of Kaggle's official SDK contracts; no Python runtime.
class KaggleResources extends BaseIntegrationAdapter {
  constructor() {
    super('kaggle');
  }

  validateConfig() {
    const token = String(process.env.KAGGLE_API_TOKEN || '');
    return {
      ok: Boolean(token.trim()) && !/[\r\n]/.test(token),
      missing: token.trim() ? [] : ['KAGGLE_API_TOKEN']
    };
  }

  async list(kind, username, pageToken = '', page = 1) {
    if (!this.validateConfig().ok) throw fail('Kaggle requires a valid KAGGLE_API_TOKEN.', 400);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(username || ''))
      throw fail('Invalid Kaggle username.', 400);
    if (typeof pageToken !== 'string' || pageToken.length > 2048)
      throw fail('Invalid Kaggle page token.', 400);
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw fail('Invalid Kaggle page.', 400);
    if (!['notebooks', 'datasets'].includes(kind)) throw fail('Unsupported Kaggle resource.', 400);
    const notebooks = kind === 'notebooks';
    const route = notebooks
      ? 'kernels.KernelsApiService/ListKernels'
      : 'datasets.DatasetApiService/ListDatasets';
    const body = {
      user: username,
      pageSize: PAGE_SIZE,
      ...(pageToken ? { pageToken } : { page }),
      ...(notebooks
        ? { group: 'EVERYONE', kernelType: 'notebook', language: 'all' }
        : { group: 'DATASET_SELECTION_GROUP_USER' })
    };
    let payload;
    try {
      payload = await this.post(`${BASE}/${route}`, body, {
        headers: {
          Authorization: `Bearer ${process.env.KAGGLE_API_TOKEN.trim()}`,
          Accept: 'application/json'
        }
      });
    } catch (error) {
      throw fail(
        'Kaggle resource API request failed; check credentials, permissions and quota.',
        error.status || error.response?.status || 502
      );
    }
    if (
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload) ||
      payload.error ||
      payload.errorMessage ||
      Number(payload.code) >= 400
    ) {
      throw fail('Kaggle did not return a valid resource listing.');
    }
    const key = notebooks ? 'kernels' : 'datasets';
    const rows = payload[key];
    // Omitted repeated fields are protobuf JSON defaults; do not accept arbitrary HTML/arrays.
    if (
      (rows !== undefined && !Array.isArray(rows)) ||
      (rows?.length || 0) > PAGE_SIZE ||
      (payload.nextPageToken !== undefined && typeof payload.nextPageToken !== 'string')
    )
      throw fail('Invalid Kaggle listing contract.');
    const seen = new Set();
    const resources = (rows || []).map((row) => {
      if (
        !row ||
        typeof row.ref !== 'string' ||
        row.ref.split('/')[0].toLowerCase() !== username.toLowerCase() ||
        (!notebooks &&
          row.ownerRef != null &&
          (typeof row.ownerRef !== 'string' ||
            row.ownerRef.toLowerCase() !== username.toLowerCase())) ||
        !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(row.ref) ||
        seen.has(row.ref) ||
        row.isPrivate === true
      )
        throw fail('Kaggle resource attribution is unavailable.');
      seen.add(row.ref);
      const fields = notebooks
        ? [
            'id',
            'ref',
            'title',
            'author',
            'language',
            'kernelType',
            'lastRunTime',
            'totalVotes',
            'currentVersionNumber',
            'isPrivate'
          ]
        : [
            'id',
            'ref',
            'title',
            'subtitle',
            'ownerRef',
            'ownerName',
            'creatorName',
            'creatorUrl',
            'licenseName',
            'lastUpdated',
            'downloadCount',
            'viewCount',
            'voteCount',
            'totalBytes',
            'currentVersionNumber',
            'isPrivate'
          ];
      const observation = Object.fromEntries(
        fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]])
      );
      if (!notebooks && row.tags !== undefined) {
        if (row.tags === null) observation.tags = null;
        else {
          if (!Array.isArray(row.tags) || row.tags.length > 100)
            throw fail('Invalid Kaggle resource tags.');
          observation.tags = row.tags.map((tag) => {
            if (!tag || typeof tag !== 'object') throw fail('Invalid Kaggle resource tags.');
            const item = {};
            for (const key of ['ref', 'name']) {
              if (tag[key] !== undefined) {
                if (typeof tag[key] !== 'string' || tag[key].length > 2000)
                  throw fail('Invalid Kaggle resource tags.');
                item[key] = tag[key];
              }
            }
            return item;
          });
        }
      }
      for (const [field, value] of Object.entries(observation)) {
        if (value === null) continue;
        if (
          [
            'title',
            'subtitle',
            'author',
            'language',
            'kernelType',
            'ownerRef',
            'ownerName',
            'creatorName',
            'creatorUrl',
            'licenseName'
          ].includes(field) &&
          (typeof value !== 'string' || value.length > 2000)
        )
          throw fail('Invalid Kaggle resource metadata.');
        if (
          ['lastRunTime', 'lastUpdated'].includes(field) &&
          (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
        )
          throw fail('Invalid Kaggle resource timestamp.');
        if (
          [
            'totalVotes',
            'downloadCount',
            'viewCount',
            'voteCount',
            'currentVersionNumber',
            'totalBytes',
            'id'
          ].includes(field) &&
          (!Number.isSafeInteger(value) || value < 0)
        )
          throw fail('Invalid Kaggle resource count.');
      }
      return observation;
    });
    return {
      resources,
      nextPageToken: payload.nextPageToken || null,
      pageSize: PAGE_SIZE,
      page: pageToken ? null : page,
      completeness: 'bounded sample; missing next-page token does not prove a complete catalog',
      scope: 'public resource sample',
      ownershipVerified: false
    };
  }
}

module.exports = new KaggleResources();
