const axios = require('axios');
const governance = require('./newsGovernanceService');
const { normalizeItem, fromHackerNews, fromDevTo } = require('../utils/newsFormatter');
const { TOPICS, topicFor, matchesTopic } = require('../utils/newsTopics');
const { getIntegrationSecretsSync } = require('./platformSettingsService');

// Fixed public upstreams only. Never use account credentials or request-supplied URLs.
const SOURCE_NAMES = [
  'Hacker News',
  'GitHub Releases',
  'GitHub Security Advisories',
  'Lobsters',
  'Dev.to',
  'Kubernetes Blog'
];
const KEYS = ['hackernewssearch', 'githubreleases', 'githubadvisories', 'lobsters', 'devtosearch', 'kubernetesblog'];
function enabled() {
  return process.env.NEWS_DISCOVERY_ENABLED === 'true' && getIntegrationSecretsSync()?.newsEnabled !== false;
}
function available(topic) {
  const config = TOPICS[topic];
  if (!config || !enabled()) return [];
  return KEYS.filter((key) => {
    const limits = governance.policy(key);
    return (
      limits.daily > 0 &&
      limits.monthly > 0 &&
      (key !== 'githubreleases' || config.repo) &&
      (key !== 'githubadvisories' || config.ecosystem || ['security', 'devsecops'].includes(topic)) &&
      (key !== 'kubernetesblog' ||
        ['devops', 'kubernetes', 'cloud', 'gitops', 'security', 'observability'].includes(topic))
    );
  }).sort(
    (a, b) =>
      (a === 'kubernetesblog' ? 0 : a === 'devtosearch' ? 1 : 2) -
      (b === 'kubernetesblog' ? 0 : b === 'devtosearch' ? 1 : 2)
  );
}

const decode = (value) =>
  value.replace(
    /&(?:amp|lt|gt|quot|apos);/g,
    (match) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[match]
  );
function fromRss(xml, source = 'Lobsters') {
  // Intentionally narrow RSS 2.0 metadata reader: no DTD/entity processing, HTML bodies or recursive XML.
  if (
    typeof xml !== 'string' ||
    xml.length > 1048576 ||
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<rss\b/i.test(xml) ||
    !/<\/rss>\s*$/i.test(xml)
  )
    throw new Error('Invalid RSS');
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)];
  if (items.length !== (xml.match(/<item(?:\s|>)/gi) || []).length) throw new Error('Invalid RSS');
  const field = (item, name) => {
    const raw = new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i').exec(item)?.[1] || '';
    const text = raw.startsWith('<![CDATA[') && raw.endsWith(']]>') ? raw.slice(9, -3) : raw;
    return decode(text.trim());
  };
  return items
    .slice(0, 40)
    .map(([, item]) =>
      normalizeItem({
        title: field(item, 'title'),
        url: field(item, 'link'),
        attributionUrl: field(item, 'comments'),
        publishedAt: field(item, 'pubDate'),
        source,
        publisher: source === 'Kubernetes Blog' ? 'Kubernetes Authors (CC BY 4.0)' : 'Lobsters',
        ...(source === 'Kubernetes Blog'
          ? { license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' }
          : {}),
        description: ''
      })
    )
    .filter(Boolean);
}
function requestFor(key, topic) {
  const config = TOPICS[topic];
  if (!config) throw new Error('Unsupported topic');
  const since = Math.floor((Date.now() - 30 * 86400000) / 1000);
  if (key === 'hackernewssearch')
    return {
      url: `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent({ cicd: 'CI/CD', githubactions: 'GitHub Actions', dotnet: '.NET', gcp: 'Google Cloud' }[topic] || topic)}&tags=story&hitsPerPage=30&numericFilters=created_at_i%3E${since}`
    };
  if (key === 'githubreleases' && config.repo)
    return { url: `https://api.github.com/repos/${config.repo}/releases?per_page=20`, github: true };
  if (key === 'githubadvisories')
    return {
      url: `https://api.github.com/advisories?type=reviewed&per_page=30&sort=published&direction=desc${config.ecosystem ? `&ecosystem=${config.ecosystem}` : ''}`,
      github: true
    };
  if (key === 'lobsters') return { url: `https://lobste.rs/t/${config.tag}.rss`, rss: true };
  if (key === 'devtosearch')
    return {
      url: `https://dev.to/api/articles?tag=${encodeURIComponent({ cicd: 'devops', golang: 'go', postgres: 'postgresql', ml: 'machinelearning' }[topic] || topic)}&per_page=30`
    };
  if (key === 'kubernetesblog') return { url: 'https://kubernetes.io/feed.xml', rss: true };
  throw new Error('Unsupported provider');
}
function format(key, payload, topic) {
  if (key === 'hackernewssearch') {
    if (!Array.isArray(payload?.hits)) throw new Error('Invalid provider response');
    return fromHackerNews(payload);
  }
  if (key === 'lobsters') return fromRss(payload);
  if (key === 'kubernetesblog') return fromRss(payload, 'Kubernetes Blog');
  if (key === 'devtosearch') {
    if (!Array.isArray(payload)) throw new Error('Invalid provider response');
    return fromDevTo(payload);
  }
  if (!Array.isArray(payload)) throw new Error('Invalid provider response');
  return payload
    .slice(0, 30)
    .filter(
      (item) =>
        item &&
        (key === 'githubreleases'
          ? !item.draft &&
            !item.prerelease &&
            ((typeof item.name === 'string' && item.name.trim()) ||
              (typeof item.tag_name === 'string' && item.tag_name.trim()))
          : !item.withdrawn_at)
    )
    .map((item) =>
      normalizeItem({
        title: key === 'githubreleases' ? `${TOPICS[topic].repo}: ${item.name || item.tag_name || ''}` : item.summary,
        source: key === 'githubreleases' ? 'GitHub Releases' : 'GitHub Security Advisories',
        publisher: 'GitHub',
        url: item.html_url,
        attributionUrl: item.html_url,
        publishedAt: item.published_at,
        description: '',
        // Repository is a known topic; advisories must independently match their headline. No full bodies retained.
        tags: key === 'githubreleases' ? [topic] : [],
        ...(key === 'githubadvisories'
          ? {
              category: 'Cybersecurity',
              license: 'CC-BY-4.0',
              licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
            }
          : {})
      })
    )
    .filter(Boolean);
}
async function search(key, topic) {
  if (!available(topic).includes(key)) return { status: 'disabled', items: [] };
  const reservation = await governance.reserve(key);
  if (!reservation.allowed)
    return {
      status: reservation.reason === 'quota_store_unavailable' ? 'unavailable' : 'quota_limited',
      reason: reservation.reason,
      items: []
    };
  try {
    const request = requestFor(key, topic);
    const response = await axios.get(request.url, {
      timeout: 7000,
      signal: AbortSignal.timeout(7000),
      maxRedirects: 0,
      maxContentLength: 1048576,
      responseType: request.rss ? 'text' : 'json',
      headers: {
        Accept: request.rss
          ? 'application/rss+xml'
          : request.github
            ? 'application/vnd.github+json'
            : 'application/json',
        'User-Agent': 'DevInsight-News/1.0',
        ...(request.github ? { 'X-GitHub-Api-Version': '2026-03-10' } : {})
      }
    });
    const seen = new Set();
    const items = format(key, response.data, topic)
      .filter((item) => {
        if (!matchesTopic(item, topic) || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
      })
      .map((item) => ({
        ...item,
        category: item.category === 'Backend' && TOPICS[topic].category === 'DevOps' ? 'DevOps' : item.category
      }));
    await governance.finish(reservation, { status: response.status, headers: response.headers });
    return { status: 'success', items };
  } catch (error) {
    await governance.finish(reservation, {
      failed: true,
      status: error.response?.status || 0,
      headers: error.response?.headers || {}
    });
    return { status: [429, 403].includes(error.response?.status) ? 'quota_limited' : 'unavailable', items: [] };
  }
}

module.exports = {
  TOPICS,
  KEYS,
  SOURCE_NAMES,
  topicFor,
  matchesTopic,
  enabled,
  available,
  search,
  requestFor,
  fromRss
};
