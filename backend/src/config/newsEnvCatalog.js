const { NEWS_PROVIDER_KEYS } = require('./newsConfig');

// Operator documentation and .env organization use this catalog. Runtime parsing
// remains in newsConfig; no credential values are stored here.
const entries = [];
const add = (group, key, value, purpose) => {
  let runtimeDefault = String(value);
  if (['NEWS_DISCOVERY_ENABLED', 'NEWS_DISCOVERY_PREWARM_ENABLED'].includes(key)) runtimeDefault = 'false';
  const provider = key.match(
    /^NEWS_([A-Z]+)_(CONTENT_APPROVED|DAILY_BUDGET|MONTHLY_BUDGET|MIN_INTERVAL_MS)$/
  );
  if (provider) {
    if (provider[2] === 'MIN_INTERVAL_MS') runtimeDefault = '1200000';
    else if (!['HACKERNEWS', 'DEVTO'].includes(provider[1]))
      runtimeDefault = provider[2] === 'CONTENT_APPROVED' ? 'false' : '0';
  }
  if (/^NEWS_(HACKERNEWS|DEVTO|GITHUB)_SHARED_(DAILY|MONTHLY)_BUDGET$/.test(key))
    runtimeDefault = 'sum of the enabled family adapter budgets';
  entries.push({ group, key, value: String(value), runtimeDefault, purpose });
};
add(
  'Core',
  'NEWS_INGESTION_ENABLED',
  true,
  'Run scheduled ingestion and the discovery worker; boolean, false stops both'
);
add(
  'Core',
  'NEWS_DISCOVERY_ENABLED',
  true,
  'Allow public query discovery; boolean, platform newsEnabled also applies'
);
add(
  'Search',
  'NEWS_DISCOVERY_RESULTS_PER_PROVIDER',
  30,
  'HN/DEV search result cap; integer 1..30, metadata only; fixed RSS/GitHub caps are independent'
);
add(
  'Search',
  'NEWS_REFRESH_MIN_INTERVAL_MS',
  60000,
  'Minimum time between successful manual query checks; milliseconds 60000..3600000, never bypasses source limits'
);
add(
  'Background Workers',
  'NEWS_DISCOVERY_PREWARM_ENABLED',
  true,
  'Enable adaptive prewarm admission; boolean, consumes the shared job budget'
);
add(
  'Background Workers',
  'NEWS_DISCOVERY_PREWARM_TOPICS',
  '',
  'Deprecated comma-separated legacy topic hints, max four phrases; ignored by adaptive selection, safe to leave empty'
);
for (const [key, value, purpose] of [
  [
    'NEWS_CATALOG_RETENTION_DAYS',
    35,
    'Maximum metadata age from publication; integer days 1..35, source limits may be stricter, expiry never renews'
  ],
  [
    'NEWS_CATALOG_RANKING_LIMIT',
    2000,
    'Maximum recent matching articles ranked per personalized request; integer 100..10000, bounds memory and reported personalized pagination'
  ],
  [
    'NEWS_PREWARM_STRATEGY',
    'demand-coverage',
    'Adaptive strategy; demand-coverage or demand-only, coverage fallback is disabled by demand-only'
  ],
  [
    'NEWS_PREWARM_MIN_DEMAND',
    3,
    'Minimum distinct accounts per topic over seven days; integer 2..100, repeated account searches count once per rolling seven days'
  ],
  [
    'NEWS_PREWARM_TARGET_ARTICLES',
    6,
    'Recent coverage target per topic; integer articles 1..40, adequate fresh topics are skipped'
  ],
  [
    'NEWS_PREWARM_FRESHNESS_MS',
    21600000,
    'Maximum age of newest topic article; milliseconds 60000..86400000, older coverage is eligible'
  ],
  [
    'NEWS_PREWARM_EVALUATION_MS',
    3600000,
    'Adaptive evaluation interval; milliseconds 60000..86400000, independent from broad collection'
  ],
  [
    'NEWS_PREWARM_MAX_CANDIDATES',
    2,
    'Candidates per evaluation; integer 1..4, also constrained by daily prewarm budget'
  ],
  [
    'NEWS_PREWARM_RESERVED_USER_JOBS',
    6,
    'Daily global job slots protected from prewarm; integer 1..48, values at or above global daily jobs disable prewarm admission'
  ]
])
  add('Catalog and Adaptive Selection', key, value, purpose);
add(
  'Background Workers',
  'NEWS_DISCOVERY_PREWARM_DAILY_JOBS',
  4,
  'Prewarm admissions per UTC day; integer 0..4, zero stops prewarming'
);
add(
  'User / Global Limits',
  'NEWS_DISCOVERY_DAILY_JOBS',
  12,
  'All query jobs per UTC day across accounts and prewarm; integer 1..48'
);
add(
  'User / Global Limits',
  'NEWS_DISCOVERY_USER_MINUTE_JOBS',
  3,
  'New query jobs per account per UTC minute; integer 1..12, existing jobs are reused'
);
add(
  'User / Global Limits',
  'NEWS_DISCOVERY_USER_DAILY_JOBS',
  6,
  'New query jobs per account per UTC day; integer 1..48'
);
for (const [key, value, purpose] of [
  [
    'FRESH_TTL_MS',
    1800000,
    'Positive query freshness; milliseconds 60000..3600000, ordinary reads do not revalidate fresh results'
  ],
  [
    'STALE_TTL_MS',
    86400000,
    'Legacy query snapshot retention; milliseconds 3600000..86400000, at least fresh TTL; reads never extend it'
  ],
  [
    'NEGATIVE_TTL_MS',
    300000,
    'Successful empty-query retention; milliseconds 30000..900000, failures are not empty results'
  ],
  [
    'MEMORY_ENTRIES',
    128,
    'Maximum legacy discovery entries per in-process cache; integer 40..256; catalog query cache is independently capped at 128'
  ]
])
  add('Cache', 'NEWS_QUERY_' + key, value, purpose);
for (const family of ['HACKERNEWS', 'DEVTO', 'GITHUB']) {
  const github = family === 'GITHUB';
  add(
    'Redis Governance',
    `NEWS_${family}_SHARED_DAILY_BUDGET`,
    github ? 12 : 84,
    `${family} combined adapter requests per UTC day; integer 0..2000, zero blocks requests; broad ingestion reserves search headroom`
  );
  add(
    'Redis Governance',
    `NEWS_${family}_SHARED_MONTHLY_BUDGET`,
    github ? 300 : 2500,
    `${family} combined adapter requests per UTC month; integer 0..60000, zero blocks requests`
  );
  add(
    'Redis Governance',
    `NEWS_${family}_SHARED_MIN_INTERVAL_MS`,
    github ? 300000 : 60000,
    `${family} minimum spacing across adapters; milliseconds 0..86400000, hard floor ${github ? 300000 : 60000}`
  );
}
for (const source of NEWS_PROVIDER_KEYS.filter((key) => !['newsapi', 'gnews', 'reddit'].includes(key)).concat(
  ['newsapi', 'gnews', 'reddit']
)) {
  const broad = ['hackernews', 'devto'].includes(source);
  const search = ['hackernewssearch', 'devtosearch'].includes(source);
  const github = source.startsWith('github');
  const restricted = ['newsapi', 'gnews', 'reddit'].includes(source);
  const approved = broad || search || github || source === 'kubernetesblog';
  const group = restricted ? 'Restricted Sources' : 'Provider Settings';
  if (source === 'newsapi')
    add(
      group,
      'NEWS_API_KEY',
      '',
      'Optional NewsAPI server credential from newsapi.org; existing platform newsApiKey is also supported; requires approval and budgets'
    );
  if (source === 'gnews')
    add(
      group,
      'GNEWS_API_KEY',
      '',
      'Optional GNews server credential from gnews.io; requires commercial/content approval and budgets'
    );
  if (source === 'reddit') {
    add(
      group,
      'NEWS_REDDIT_ACCESS_TOKEN',
      '',
      'Optional Reddit OAuth access token; obtain through an approved Reddit API application; requires approval and budgets'
    );
    add(
      group,
      'NEWS_REDDIT_USER_AGENT',
      '',
      'Optional Reddit application identity; required with its token for enabled Reddit requests'
    );
  }
  const prefix = 'NEWS_' + source.toUpperCase() + '_';
  add(
    group,
    prefix + 'RETENTION_HOURS',
    restricted ? 24 : 840,
    `${source} approved metadata retention from publication; integer hours 1..840, operator must lower to contract limit before enabling; shorter than global maximum wins`
  );
  add(
    group,
    prefix + 'CONTENT_APPROVED',
    approved,
    `${source} content-use approval; boolean, credentials alone never enable a restricted source; false blocks this adapter`
  );
  add(
    group,
    prefix + 'DAILY_BUDGET',
    broad ? 72 : search ? 12 : github || source === 'lobsters' ? 6 : source === 'kubernetesblog' ? 4 : 0,
    `${source} requests per UTC day; integer 0..1000, zero blocks requests, failed transport attempts consume credit`
  );
  add(
    group,
    prefix + 'MONTHLY_BUDGET',
    broad
      ? 2200
      : search
        ? 300
        : github || source === 'lobsters'
          ? 150
          : source === 'kubernetesblog'
            ? 100
            : 0,
    `${source} requests per UTC month; integer 0..30000, zero blocks requests`
  );
  add(
    group,
    prefix + 'MIN_INTERVAL_MS',
    search ? 60000 : 1200000,
    `${source} request spacing; milliseconds 0..86400000, hard floor ${github ? 300000 : source === 'lobsters' ? 600000 : 60000}; shared cooldown may wait longer`
  );
}
for (const [key, value, purpose] of [
  ['REDIS_URL', '', 'Optional disposable integration Redis TCP URL; must differ from application Redis'],
  [
    'REDIS_DISPOSABLE',
    false,
    'Explicit acknowledgement for remote disposable Redis tests; boolean, never authorizes application Redis writes'
  ],
  ['MONGODB_URI', '', 'Optional disposable integration Mongo URI; production data is prohibited'],
  [
    'REDIS_NAMESPACE',
    '',
    'Optional isolated test namespace news-test:<UUID>:; blank generates a unique namespace'
  ],
  ['BROWSER', false, 'Opt in to focused Playwright browser verification; boolean'],
  ['LIVE_PROVIDERS', false, 'Opt in to bounded live provider verification; boolean, real quotas still apply']
])
  add('Verification only', 'NEWS_TEST_' + key, value, purpose);

function renderNewsEnv(values = {}) {
  const lines = ['# TECH NEWS CONFIGURATION — START'];
  let group;
  for (const entry of entries) {
    if (entry.group !== group) {
      group = entry.group;
      lines.push('', '# ' + group);
    }
    lines.push(
      `# ${entry.purpose}. Default: ${entry.runtimeDefault || 'empty (optional)'}. ${entry.group === 'Verification only' ? 'Applies on next test run' : 'Restart backend after changes'}.`
    );
    lines.push(`${entry.key}=${Object.hasOwn(values, entry.key) ? values[entry.key] : entry.value}`);
  }
  lines.push('# TECH NEWS CONFIGURATION — END', '');
  return lines.join('\n');
}
module.exports = { entries, renderNewsEnv };
