const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = (value, timezone = 'UTC') => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: timezone }).format(new Date(value));
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
    scoreLabel: assessed === false ? 'Not assessed' : `${report.score}/100${assessed === undefined ? ' (legacy snapshot)' : ''}`,
    readiness: assessed === false ? 'Not assessed' : `${report.predictedHiringReadiness?.score ?? 'Not recorded'}/100`,
    summary: report.progressSummary || '',
    breakdown: Object.entries(meta.scoreBreakdown || {}).map(([key, item]) => ({
      key, label: item.label || key, weight: item.weight,
      value: meta.evidence?.inputs?.[key]?.available === false ? null : item.score,
      reason: meta.evidence?.inputs?.[key]?.reason || 'Historical saved value',
    })),
    comparison: meta.comparison?.available ? `Compared with ${date(meta.comparison.baselineWeekStartDate, timezone)}: ${meta.comparisons?.scoreDelta > 0 ? '+' : ''}${meta.comparisons?.scoreDelta} points.` : meta.comparison?.reason || 'A verified adjacent-week baseline is not recorded.',
    sources: Object.entries(meta.dataSourcesUsed || {}).map(([key, source]) => ({
      key, status: source.status || 'Not recorded', freshness: source.freshness || 'Unknown',
      timestamp: date(source.lastAnalyzedAt, timezone),
    })),
    achievements: report.topAchievements || [], insights: report.insights || [],
    recommendations: report.recommendations || [], risk: report.biggestRiskArea || 'Not recorded',
  };
}
function email(report, name, reportLink) {
  const v = view(report);
  const rows = v.breakdown.map((item) => `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escape(item.label)} (${escape(item.weight)}%)</td><td style="padding:10px;border-bottom:1px solid #e2e8f0;text-align:right">${item.value === null ? 'Missing evidence' : escape(item.value) + '/100'}</td></tr>`).join('');
  const section = (title, values) => `<h2 style="font-size:18px;margin-top:28px;color:#0f172a">${escape(title)}</h2><ul style="padding-left:22px;line-height:1.7">${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul>`;
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Weekly progress</title></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#334155"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" style="max-width:640px;background:#ffffff;border-radius:12px"><tr><td style="padding:32px"><p style="color:#4338ca;font-weight:bold">${escape(v.brand)}</p><h1 style="font-size:28px;color:#0f172a">Your weekly progress</h1><p>${escape(v.period)} · ${escape(v.timezone)} · Version ${v.version}</p><p>Hello ${escape(name || 'developer')},</p><p style="font-size:28px;font-weight:bold;color:#4338ca">${escape(v.scoreLabel)}</p><p style="line-height:1.7">${escape(v.summary)}</p><p>${escape(v.comparison)}</p><table width="100%" style="border-collapse:collapse">${rows}</table>${section('Evidence highlights', v.achievements)}${section('Insights', v.insights)}${section('Next actions', v.recommendations)}<h2 style="font-size:18px">Risks and focus</h2><p>${escape(v.risk)}</p><h2 style="font-size:18px">Source freshness at assessment</h2><ul style="padding-left:22px;line-height:1.7">${v.sources.map((source) => `<li>${escape(source.key)}: ${escape(source.status)} · ${escape(source.freshness)} · ${escape(source.timestamp)}</li>`).join('')}</ul><p style="padding:24px 0"><a href="${escape(reportLink)}" style="display:inline-block;background:#4338ca;color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none">View this saved report</a></p><p style="font-size:12px;line-height:1.6">Readiness is a planning indicator, not a probability of getting hired. Learning completion is self-reported. Manage weekly email preferences in account settings.</p></td></tr></table></td></tr></table></body></html>`;
  const text = [v.brand, v.period, `Version ${v.version} / ${v.hash}`, `Score: ${v.scoreLabel}`, v.summary, v.comparison, ...v.breakdown.map((item) => `${item.label}: ${item.value === null ? 'Missing evidence' : item.value + '/100'} (${item.weight}%)`), 'Evidence highlights', ...v.achievements, 'Insights', ...v.insights, 'Next actions', ...v.recommendations, `Risks: ${v.risk}`, ...v.sources.map((source) => `${source.key}: ${source.status}; ${source.freshness}; ${source.timestamp}`), `Saved report: ${reportLink}`, 'Readiness is not a hiring probability.'].join('\n\n');
  return { html, text };
}
module.exports = { view, email, escape, date };
