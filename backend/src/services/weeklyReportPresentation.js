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
    .map((item) => {
      const isNum = item.value !== null && Number.isFinite(item.value);
      const pct = isNum ? Math.min(100, Math.max(0, item.value)) : 0;
      const bar =
        isNum && pct > 0
          ? `<div style="background:#4f46e5;height:5px;width:${pct}%;border-radius:9999px;"></div>`
          : '';
      const displayVal = item.value === null ? escape(item.reason) : `${escape(item.value)}/100`;
      return `<tr>
        <td style="padding:10px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle;">
          <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:3px;">${escape(item.label)} <span style="font-size:11px;font-weight:500;color:#64748b;">(${escape(item.weight)}%)</span></div>
          <div style="background:#e2e8f0;border-radius:9999px;height:5px;width:100%;max-width:180px;overflow:hidden;">${bar}</div>
        </td>
        <td align="right" style="padding:10px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle;font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;">
          ${displayVal}
        </td>
      </tr>`;
    })
    .join('');

  const listSection = (title, values) => {
    const items = values.length
      ? values
          .map(
            (value) =>
              `<li style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #4f46e5;border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:8px;font-size:13px;color:#334155;line-height:1.6;">${escape(value)}</li>`,
          )
          .join('')
      : '<li style="background:#f8fafc;border:1px solid #e2e8f0;border-left:3px solid #cbd5e1;border-radius:0 8px 8px 0;padding:12px 14px;margin-bottom:8px;font-size:13px;color:#64748b;font-style:italic;">No saved items for this week.</li>';
    return `<h2 style="font-size:16px;font-weight:800;color:#0f172a;margin:28px 0 12px 0;letter-spacing:-0.02em;">${escape(title)}</h2><ul style="list-style:none;padding:0;margin:0 0 16px 0;">${items}</ul>`;
  };

  const sourceRows = v.sources
    .map(
      (source) =>
        `<li style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:12px;color:#475569;line-height:1.5;"><strong style="color:#0f172a;">${escape(source.label)}</strong>: ${escape(source.status)} · ${escape(source.freshness)} · ${escape(source.timestamp)}</li>`,
    )
    .join('');

  // Clean score presentation: avoids 36px wrapping of "(legacy snapshot)"
  const isLegacy = v.scoreLabel.includes('(legacy snapshot)');
  const scoreDisplayHtml =
    v.score === null
      ? `<span style="font-size:26px;font-weight:800;color:#4338ca;">Not assessed</span>`
      : `<span style="font-size:36px;font-weight:800;color:#4338ca;letter-spacing:-0.03em;">${escape(v.score)}</span><span style="font-size:18px;font-weight:600;color:#64748b;">/100</span>` +
        (isLegacy
          ? ` <span style="display:inline-block;margin-left:6px;font-size:11px;font-weight:600;background:#f1f5f9;color:#64748b;padding:2px 7px;border-radius:4px;vertical-align:middle;text-transform:uppercase;letter-spacing:0.04em;">legacy snapshot</span>`
          : '');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Weekly progress</title>
  </head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155;-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" style="border-collapse:collapse;margin:0;padding:0;background:#f8fafc;">
      <tr>
        <td align="center" style="padding:28px 12px;">
          <table role="presentation" width="100%" style="max-width:640px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;border-collapse:separate;overflow:hidden;box-shadow:0 4px 12px -2px rgba(15,23,42,0.06);">
            <tr>
              <td style="background:#4f46e5;height:4px;padding:0;line-height:1px;font-size:1px;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:28px 24px;">
                <div style="margin-bottom:12px;">
                  <span style="display:inline-block;padding:3px 10px;background:#eef2ff;color:#4f46e5;border:1px solid #e0e7ff;border-radius:9999px;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#4f46e5;margin-right:6px;vertical-align:middle;"></span>
                    ${escape(v.brand)} · Weekly Progress
                  </span>
                </div>
                <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:800;color:#0f172a;letter-spacing:-0.03em;line-height:1.25;">Your weekly progress</h1>
                <p style="margin:0 0 18px 0;font-size:13px;color:#64748b;line-height:1.5;">${escape(v.period)} · ${escape(v.timezone)} · <span style="display:inline-block;background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:4px;font-weight:600;font-size:12px;">Version ${v.version}</span></p>
                <p style="margin:0 0 16px 0;font-size:14px;color:#334155;line-height:1.6;">Hello ${escape(name || 'developer')},</p>

                <div style="background:linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);border:1px solid #e0e7ff;border-radius:12px;padding:20px;margin-bottom:24px;">
                  <table role="presentation" width="100%" style="border-collapse:collapse;">
                    <tr>
                      <td valign="top" style="padding-bottom:12px;">
                        <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;margin-bottom:4px;">Career Momentum Score</div>
                        <div style="line-height:1.1;">${scoreDisplayHtml}</div>
                      </td>
                      <td valign="top" align="right" style="padding-bottom:12px;">
                        <div style="display:inline-block;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;text-align:right;">
                          <div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;letter-spacing:0.05em;">Readiness</div>
                          <div style="font-size:15px;font-weight:800;color:#0f172a;">${escape(v.readiness)}</div>
                        </div>
                      </td>
                    </tr>
                  </table>
                  <div style="border-top:1px solid #e0e7ff;padding-top:12px;margin-top:4px;">
                    <p style="margin:0 0 8px 0;font-size:14px;color:#334155;line-height:1.65;">${escape(v.summary)}</p>
                    <p style="margin:0 0 8px 0;font-size:13px;color:#475569;font-weight:500;line-height:1.5;">${escape(v.comparison)}</p>
                    <p style="margin:0;font-size:12px;color:#64748b;line-height:1.5;"><strong>Readiness indicator:</strong> ${escape(v.readiness)} · ${escape(v.readinessReason)}</p>
                  </div>
                </div>

                <h2 style="font-size:16px;font-weight:800;color:#0f172a;margin:28px 0 12px 0;letter-spacing:-0.02em;">Score breakdown</h2>
                <table aria-label="Deterministic score breakdown" width="100%" style="border-collapse:collapse;margin-bottom:16px;">
                  <thead>
                    <tr>
                      <th scope="col" align="left" style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:2px solid #e2e8f0;">Evidence input</th>
                      <th scope="col" align="right" style="padding:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:2px solid #e2e8f0;">Measured value</th>
                    </tr>
                  </thead>
                  <tbody>${rows}</tbody>
                </table>

                ${listSection('Evidence highlights', v.achievements)}
                ${listSection('Insights', v.insights)}
                ${listSection('Next actions', v.recommendations)}

                <h2 style="font-size:16px;font-weight:800;color:#0f172a;margin:28px 0 12px 0;letter-spacing:-0.02em;">Risks and focus</h2>
                <div style="background:#fffbeb;border:1px solid #fef3c7;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#92400e;line-height:1.6;margin-bottom:20px;">
                  ${escape(v.risk)}
                </div>

                <h2 style="font-size:16px;font-weight:800;color:#0f172a;margin:28px 0 12px 0;letter-spacing:-0.02em;">Source freshness at assessment</h2>
                <ul style="list-style:none;padding:0;margin:0 0 24px 0;">${sourceRows}</ul>

                <div style="padding:16px 0;text-align:center;">
                  <a href="${escape(reportLink)}" style="display:inline-block;background:#4f46e5;color:#ffffff;font-size:14px;font-weight:700;padding:12px 24px;border-radius:8px;text-decoration:none;box-shadow:0 2px 8px rgba(79,70,229,0.3);">View this saved report &rarr;</a>
                </div>

                <!-- Provenance & Snapshot Verification Card (Clean footer location) -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:20px;font-size:11px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;word-break:break-all;">
                  <div style="font-weight:700;color:#475569;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;font-size:10px;">Snapshot Verification</div>
                  <div>Content hash: <span style="color:#1e293b;">${escape(v.hash)}</span></div>
                  <div style="margin-top:2px;color:#64748b;">Snapshot version: Version ${v.version} · ${escape(v.timezone)}</div>
                </div>

                <p style="margin:16px 0 0 0;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.6;color:#94a3b8;text-align:center;">Readiness is a planning indicator, not a probability of getting hired. Learning completion is self-reported. Manage weekly email preferences in account settings.</p>
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
