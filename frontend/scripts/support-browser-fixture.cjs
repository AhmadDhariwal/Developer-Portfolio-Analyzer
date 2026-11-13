// Realistic synthetic test data for Support module responsive testing.

const populatedTickets = [
  {
    _id: '672b1101a1b2c3d4e5f67890',
    userId: 'user-dev-001',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    category: 'bug',
    priority: 'urgent',
    subject: 'TypeScript build fails on AST circular dependency in skill-gap service',
    message:
      'When importing skill gap scoring foundation into the telemetry subscriber, the worker throws a cyclic reference error in ng build production pipeline.\n\nStack trace:\nError: Cyclic dependency detected between SkillGapComponent -> SkillGapService -> TelemetryCollector.',
    status: 'open',
    replyToEmail: 'alex.rivera@eng-lead.org',
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    sourcePage: 'http://localhost:4200/app/skill-gap',
    browserInfo:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    replies: [
      {
        _id: 'rep-001',
        authorId: 'admin-001',
        authorRole: 'admin',
        body: 'Investigating this issue. The cycle was introduced in commit 8d3a1f. Working on a deferred injection fix.',
        createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      },
      {
        _id: 'rep-002',
        authorId: 'user-dev-001',
        authorRole: 'user',
        body: 'Thank you! If you need my local tsconfig paths configuration, I can provide it right away.',
        createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      },
    ],
  },
  {
    _id: '672b1102b2c3d4e5f6789012',
    userId: 'user-dev-001',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    category: 'feature_request',
    priority: 'medium',
    subject: 'Export Weekly Report historical comparisons to PDF and Markdown format',
    message:
      'Our team leadership needs a one-click executive summary export for our sprint retrospectives. It would be great to have an automated markdown export in addition to the printable PDF format.',
    status: 'in_progress',
    replyToEmail: '',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 1).toISOString(),
    sourcePage: 'http://localhost:4200/app/weekly-reports',
    browserInfo:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    replies: [
      {
        _id: 'rep-003',
        authorId: 'admin-002',
        authorRole: 'admin',
        body: 'Added to our Q4 roadmap. You will receive an update once the feature enters preview stage.',
        createdAt: new Date(Date.now() - 86400000 * 1).toISOString(),
      },
    ],
  },
  {
    _id: '672b1103c3d4e5f678901234',
    userId: 'user-dev-001',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    category: 'account_issue',
    priority: 'high',
    subject: 'GitHub OAuth sync token expiry during automated repository indexing',
    message:
      'The background repository synchronization occasionally disconnects after 8 hours of continuous index polling, requiring a manual re-authentication from the Integrations tab.',
    status: 'resolved',
    replyToEmail: 'alex.rivera@example.com',
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    sourcePage: 'http://localhost:4200/app/integrations',
    browserInfo:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    replies: [
      {
        _id: 'rep-004',
        authorId: 'admin-001',
        authorRole: 'admin',
        body: 'We updated the refresh token rotation middleware. The token now auto-renews 30 minutes before expiration.',
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      },
    ],
  },
  {
    _id: '672b1104d4e5f67890123456',
    userId: 'user-dev-001',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    category: 'general_feedback',
    priority: 'low',
    subject: 'Dark theme high-contrast readability in scenario simulation charts',
    message:
      'The neon purple and indigo accents look great on OLED displays! Just wanted to note that the secondary axis ticks in the kinetic terminal theme have excellent readability.',
    status: 'closed',
    replyToEmail: '',
    createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
    updatedAt: new Date(Date.now() - 86400000 * 8).toISOString(),
    sourcePage: 'http://localhost:4200/app/scenario-simulator',
    browserInfo:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    replies: [],
  },
];

const emptyTickets = [];

const longTextTickets = [
  {
    _id: '672b9999longunbrokenidstringthatcouldcauseoverflowifnotprotectedbyoverflowwrapanywhere9999',
    userId: 'user-dev-longtext-001',
    name: 'Supercalifragilisticexpialidocious_Developer_With_Extremely_Long_Unbroken_Name_String',
    email: 'superlongdeveloperemailaddresswithoutspacesthatexceedsnormalcolumnboundaries@domainexamplecompanycorp.org',
    category: 'bug',
    priority: 'urgent',
    subject:
      'UNBROKEN_LONG_TEXT_ERROR_TRACE_REPRO_BUG_CANNOT_READ_PROPERTIES_OF_UNDEFINED_READING_CALCULATE_PORTFOLIO_SCORE_EXCEPTION_STACK_TRACE_WITHOUT_WHITESPACE_IN_CONTAINER',
    message:
      'Error:https://devinsight.internal.corp/app/telemetry/deeply/nested/route/path/with/exceptionally/long/unbroken/querystring?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c&payload_trace=UNBROKEN_STACK_DUMP_00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
    status: 'open',
    replyToEmail:
      'replyto_extremely_long_unbroken_email_handle_address_for_overflow_audit_test@corporationenterprise.technology',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourcePage:
      'http://localhost:4200/app/portfolio/settings/deep/configuration/long/path/name/overflow/test',
    browserInfo:
      'Mozilla/5.0_VeryLongBrowserUserAgentStringWithCustomEnterprisePluginsAndExtendedTelemetryIdentifiersWithoutBreaks(Windows_NT_10.0;_Win64;_x64)',
    replies: [
      {
        _id: 'rep-long-001',
        authorId: 'admin-001',
        authorRole: 'admin',
        body: 'UnbrokenInvestigationNotes_https://internal.bugtracker.corporation.com/tickets/deep-dive/inspect-telemetry-error-stack-trace-record-unbroken-slug-identifier-test-string',
        createdAt: new Date().toISOString(),
      },
    ],
  },
];

module.exports = {
  populatedTickets,
  emptyTickets,
  longTextTickets,
};

