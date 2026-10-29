const BaseIntegrationAdapter = require('./baseAdapter');
const axios = require('axios');
const governance = require('../integrationGovernanceService');

// Current production endpoint in Hashnode's official gql-skill endpoint reference.
const ENDPOINT = 'https://gql-beta.hashnode.com';

function publicationHost() {
  const value = String(process.env.HASHNODE_PUBLICATION_HOST || '').trim();
  let host = value;
  if (value.includes('://')) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        url.pathname !== '/'
      )
        return '';
      host = url.hostname;
    } catch {
      return '';
    }
  }
  return /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(host)
    ? host.toLowerCase()
    : '';
}

function providerFailure(errors = [], status = 400) {
  const list = Array.isArray(errors) ? errors : [];
  if (
    list.some((error) =>
      /(?:active pro plan|pro plan on your publication|publication.*requires.*pro|publication.*not.*pro)/i.test(
        String(error?.message || '')
      )
    )
  ) {
    return Object.assign(
      Error(
        'Hashnode publication requires an active Pro plan. Free publication API access is unavailable.'
      ),
      { status: 403, code: 'HASHNODE_PRO_REQUIRED' }
    );
  }
  if (status === 401 || list.some((error) => error?.extensions?.code === 'UNAUTHENTICATED')) {
    return Object.assign(Error('Hashnode PAT authentication failed.'), {
      status: 401,
      code: 'HASHNODE_AUTH_FAILED'
    });
  }
  return Object.assign(
    Error('Hashnode read failed. Verify the PAT, Pro publication and API permissions.'),
    { status, code: 'HASHNODE_READ_FAILED' }
  );
}

// Share the existing devblogs quota, request deadline and synchronization boundary.
class HashnodePublication extends BaseIntegrationAdapter {
  constructor() {
    super('devblogs');
  }

  validateConfig() {
    const missing = ['HASHNODE_PAT', 'HASHNODE_PUBLICATION_HOST'].filter(
      (key) => !String(process.env[key] || '').trim()
    );
    const validHost = Boolean(publicationHost());
    const validToken = !/[\r\n]/.test(process.env.HASHNODE_PAT || '');
    return {
      ok: missing.length === 0 && validHost && validToken,
      missing,
      invalid: [
        ...(!validHost && !missing.includes('HASHNODE_PUBLICATION_HOST')
          ? ['HASHNODE_PUBLICATION_HOST']
          : []),
        ...(!validToken ? ['HASHNODE_PAT'] : [])
      ]
    };
  }

  async post(url, data, config) {
    // Keep GraphQL permission errors available for safe classification, while retaining
    // the shared admission, timeout, response bounds, no-redirect and no-retry controls.
    const response = await governance.request(this.provider, (controls) =>
      axios.post(url, data, { ...config, ...controls })
    );
    return response.data;
  }

  async fetch(username) {
    if (!this.validateConfig().ok) {
      throw Object.assign(
        Error(
          'Hashnode requires HASHNODE_PAT and HASHNODE_PUBLICATION_HOST as a hostname or HTTPS root URL.'
        ),
        { status: 400 }
      );
    }
    let response;
    try {
      response = await this.post(
        ENDPOINT,
        {
          query: `query IntegrationPublication($host: String!) {
            me { id username }
            publication(host: $host) {
              id
              author { id username }
              postsCount(first: 1) { totalDocuments }
              posts(first: 30) {
                edges { node { id title reactionCount publishedAt author { username } tags { slug } } }
                pageInfo { hasNextPage }
              }
            }
          }`,
          variables: { host: publicationHost() }
        },
        { headers: { Authorization: `Bearer ${process.env.HASHNODE_PAT.trim()}` } }
      );
    } catch (error) {
      // Do not echo provider errors or request headers into logs or API responses.
      const failure = providerFailure(
        error.response?.data?.errors,
        error.status || error.response?.status || 400
      );
      if (error.retryAfter) failure.retryAfter = error.retryAfter;
      throw failure;
    }
    if (response?.errors?.length) throw providerFailure(response.errors);
    const identity = response?.data?.me;
    const publication = response?.data?.publication;
    const posts = publication?.posts;
    if (
      typeof identity?.id !== 'string' ||
      !identity.id ||
      typeof identity?.username !== 'string' ||
      !identity.username ||
      (username !== undefined &&
        identity.username.toLowerCase() !== String(username).toLowerCase()) ||
      !publication?.id ||
      !Array.isArray(posts?.edges) ||
      posts.edges.length > 30 ||
      typeof posts.pageInfo?.hasNextPage !== 'boolean'
    ) {
      throw Object.assign(Error('Hashnode publication or authenticated author is unavailable.'), {
        status: 400
      });
    }
    if (
      publication.author?.id !== identity.id ||
      typeof publication.author?.username !== 'string' ||
      publication.author.username.toLowerCase() !== identity.username.toLowerCase()
    ) {
      throw Object.assign(Error('Hashnode PAT identity does not own the configured publication.'), {
        status: 403,
        code: 'HASHNODE_OWNER_MISMATCH'
      });
    }
    const publicationPostCount = publication.postsCount?.totalDocuments ?? null;
    if (
      publicationPostCount !== null &&
      (!Number.isInteger(publicationPostCount) || publicationPostCount < posts.edges.length)
    ) {
      throw Object.assign(Error('Hashnode returned an invalid publication post count.'), {
        status: 400
      });
    }
    const articles = [];
    const seen = new Set();
    for (const edge of posts.edges) {
      const node = edge?.node;
      if (
        !node?.id ||
        typeof node.author?.username !== 'string' ||
        !node.author.username ||
        typeof node.title !== 'string' ||
        !Number.isInteger(node.reactionCount) ||
        node.reactionCount < 0 ||
        typeof node.publishedAt !== 'string' ||
        !Number.isFinite(Date.parse(node.publishedAt)) ||
        (node.tags != null && !Array.isArray(node.tags)) ||
        (node.tags || []).some((tag) => typeof tag?.slug !== 'string') ||
        seen.has(node.id)
      ) {
        throw Object.assign(Error('Hashnode returned invalid article observations.'), {
          status: 400
        });
      }
      seen.add(node.id);
      if (node.author.username.toLowerCase() !== identity.username.toLowerCase()) continue;
      articles.push({
        title: node.title,
        reactions: node.reactionCount,
        views: null,
        publishedAt: node.publishedAt,
        tags: (node.tags || []).map((tag) => tag.slug),
        platform: 'Hashnode'
      });
    }
    return {
      articles,
      username: identity.username,
      publicationId: publication.id,
      publicationPostCount,
      observedPublicationPosts: posts.edges.length,
      hasMorePublicationPosts: posts.pageInfo.hasNextPage,
      sampleLimit: 30
    };
  }
}

module.exports = new HashnodePublication();
