const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const date = (value, timezone = 'UTC') => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone: timezone,
  }).format(new Date(value));
};
const sourceLabels = {
  github: 'GitHub',
  resume: 'Resume',
  skillGap: 'Skill Gap',
  recommendations: 'Recommendations',
  careerSprint: 'Career Sprint',
  interviewPrep: 'Interview Prep',
  learning: 'Learning Hub',
  portfolio: 'Portfolio',
  integrations: 'Integrations',
};
function view(report) {
  const meta = report.meta || {};
  const timezone = meta.provenance?.timezone || 'UTC';
  const assessed = meta.evidence?.scoreAvailable;
  return {
    brand: meta.provenance?.brand || 'DevInsight AI',
    period: `${date(report.weekStartDate, timezone)} – ${date(report.weekEndDate, timezone)}`,
    timezone,
    version: meta.version || 1,
    hash: meta.reportHash || 'Legacy snapshot',
    score: assessed === false ? null : report.score,
    scoreLabel:
      assessed === false
        ? 'Not assessed'
        : `${report.score}/100${assessed === undefined ? ' (legacy snapshot)' : ''}`,
    readiness:
      assessed === false
        ? 'Not assessed'
        : `${report.predictedHiringReadiness?.score ?? 'Not recorded'}/100`,
    readinessReason: report.predictedHiringReadiness?.reason || 'Not recorded',
    summary: report.progressSummary || 'No narrative was recorded for this snapshot.',
    breakdown: Object.entries(meta.scoreBreakdown || {}).map(([key, item]) => ({
      key,
      label: item.label || key,
      weight: item.weight,
      value: meta.evidence?.inputs?.[key]?.available === false ? null : item.score,
      reason: meta.evidence?.inputs?.[key]?.reason || 'Historical saved value',
    })),
    comparison: meta.comparison?.available
      ? `Compared with ${date(meta.comparison.baselineWeekStartDate, timezone)}: ${meta.comparisons?.scoreDelta > 0 ? '+' : ''}${meta.comparisons?.scoreDelta} points.`
      : meta.comparison?.reason || 'A verified adjacent-week baseline is not recorded.',
    sources: Object.entries(meta.dataSourcesUsed || {}).map(([key, source]) => ({
      key,
      label: sourceLabels[key] || key,
      status: source.status || 'Not recorded',
      freshness: source.freshness || 'Unknown',
      timestamp: date(source.lastAnalyzedAt, timezone),
    })),
    achievements: report.topAchievements || [],
    insights: report.insights || [],
    recommendations: report.recommendations || [],
    risk: report.biggestRiskArea || 'Not recorded',
  };
}
function email(report, name, reportLink) {
  const v = view(report);
  const rows = v.breakdown
    .map(
      (item) =>
        `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escape(item.label)} (${escape(item.weight)}%)</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right">${item.value === null ? escape(item.reason) : escape(item.value) + '/100'}</td></tr>`,
    )
    .join('');
  const listSection = (title, values) => {
    const items = values.length
      ? values.map((value) => `<li>${escape(value)}</li>`).join('')
      : '<li>No saved items for this week.</li>';
    return `<h2 style="font-size:18px;margin-top:28px;color:#0f172a">${escape(title)}</h2><ul style="padding-left:22px;line-height:1.7">${items}</ul>`;
  };
  const sourceRows = v.sources
    .map(
      (source) =>
        `<li>${escape(source.label)}: ${escape(source.status)} · ${escape(source.freshness)} · ${escape(source.timestamp)}</li>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Weekly progress</title>
  </head>
  <body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#334155">
    <table role="presentation" width="100%" style="border-collapse:collapse">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="100%" style="max-width:640px;background:#ffffff;border-radius:12px;border-collapse:collapse">
            <tr>
              <td style="padding:32px">
                <p style="color:#4338ca;font-weight:bold">${escape(v.brand)}</p>
                <h1 style="font-size:28px;color:#0f172a">Your weekly progress</h1>
                <p>${escape(v.period)} · ${escape(v.timezone)} · Version ${v.version}</p>
                <p style="font-size:12px;word-break:break-all">Snapshot hash: ${escape(v.hash)}</p>
                <p>Hello ${escape(name || 'developer')},</p>
                <p style="font-size:28px;font-weight:bold;color:#4338ca">${escape(v.scoreLabel)}</p>
                <p style="line-height:1.7">${escape(v.summary)}</p>
                <p>${escape(v.comparison)}</p>
                <h2 style="font-size:18px;margin-top:28px;color:#0f172a">Score breakdown</h2>
                <table aria-label="Deterministic score breakdown" width="100%" style="border-collapse:collapse">
                  <thead>
                    <tr>
                      <th scope="col" align="left" style="padding:10px;border-bottom:2px solid #cbd5e1">Evidence input</th>
                      <th scope="col" align="right" style="padding:10px;border-bottom:2px solid #cbd5e1">Measured value</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>
                <p><strong>Readiness indicator:</strong> ${escape(v.readiness)} · ${escape(v.readinessReason)}</p>
                ${listSection('Evidence highlights', v.achievements)}
                ${listSection('Insights', v.insights)}
                ${listSection('Next actions', v.recommendations)}
                <h2 style="font-size:18px;margin-top:28px;color:#0f172a">Risks and focus</h2>
                <p>${escape(v.risk)}</p>
                <h2 style="font-size:18px;margin-top:28px;color:#0f172a">Source freshness at assessment</h2>
                <ul style="padding-left:22px;line-height:1.7">${sourceRows}</ul>
                <p style="padding:24px 0">
                  <a href="${escape(reportLink)}" style="display:inline-block;background:#4338ca;color:#ffffff;padding:14px 20px;border-radius:8px;text-decoration:none">View this saved report</a>
                </p>
                <p style="font-size:12px;line-height:1.6">Readiness is a planning indicator, not a probability of getting hired. Learning completion is self-reported. Manage weekly email preferences in account settings.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = [
    v.brand,
    v.period,
    `Version ${v.version} / ${v.hash}`,
    `Score: ${v.scoreLabel}`,
    v.summary,
    v.comparison,
    ...v.breakdown.map(
      (item) =>
        `${item.label}: ${item.value === null ? item.reason : item.value + '/100'} (${item.weight}%)`,
    ),
    'Evidence highlights',
    ...v.achievements,
    'Insights',
    ...v.insights,
    'Next actions',
    ...v.recommendations,
    `Risks: ${v.risk}`,
    ...v.sources.map(
      (source) => `${source.label}: ${source.status}; ${source.freshness}; ${source.timestamp}`,
    ),
    `Saved report: ${reportLink}`,
    'Readiness is not a hiring probability.',
  ].join('\n\n');
  return { html, text };
}
module.exports = { view, email, escape, date };
