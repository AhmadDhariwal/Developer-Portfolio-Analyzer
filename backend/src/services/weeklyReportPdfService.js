const PDFDocument = require('pdfkit');
const path = require('node:path');
const { view } = require('./weeklyReportPresentation');

// Only the supplied persisted snapshot is read. No source queries or AI calls.
async function render(report) {
  const v = view(report);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 54, left: 48, right: 48 },
    bufferPages: true,
    info: {
      Title: `Weekly progress – ${v.period}`,
      Author: v.brand,
      Subject: `Saved report ${report._id}; ${v.hash}`,
    },
  });
  doc.font(path.join(__dirname, '../assets/fonts/Manrope.ttf'));
  const chunks = [];
  const ready = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - 96;
  const ensure = (height) => {
    if (doc.y + height > doc.page.height - 66) doc.addPage();
  };

  const paragraph = (text, size = 9.5) => {
    doc
      .fillColor('#334155')
      .fontSize(size)
      .text(String(text ?? ''), { width, lineGap: 3.5 });
    doc.moveDown(0.6);
  };

  const heading = (text) => {
    ensure(60);
    doc.fillColor('#0f172a').fontSize(14).text(text);
    doc.moveDown(0.4);
  };

  const bullets = (title, values) => {
    if (!values || !values.length) return;
    heading(title);
    for (const value of values) {
      ensure(32);
      doc.fillColor('#4f46e5').fontSize(9.5).text('•', 48, doc.y, { continued: true });
      doc
        .fillColor('#334155')
        .fontSize(9.5)
        .text(`  ${value}`, { width: width - 8, lineGap: 3 });
      doc.moveDown(0.35);
    }
  };

  // Header Banner
  doc.rect(48, 48, width, 4).fill('#4f46e5');
  doc.y = 60;
  doc
    .fillColor('#4f46e5')
    .fontSize(9)
    .text('DEVINSIGHT AI · EXECUTIVE WEEKLY REPORT', { characterSpacing: 0.5 });
  doc.moveDown(0.3);
  doc.fillColor('#0f172a').fontSize(22).text('Your weekly progress');
  doc.moveDown(0.3);
  paragraph(`${v.period} · ${v.timezone} · Version ${v.version}`, 9);
  doc.moveDown(0.2);

  // Score Hero Block
  doc.fillColor('#4338ca').fontSize(28).text(v.scoreLabel);
  doc.moveDown(0.35);
  paragraph(v.summary);
  paragraph(v.comparison);

  // Readiness Indicator
  heading('Readiness indicator');
  paragraph(`${v.readiness} · ${v.readinessReason}`);

  // Score Breakdown
  heading('Score breakdown');
  paragraph(
    'Fixed weights: GitHub 30%, resume 25%, Sprint 20%, interview 15%, skill coverage 10%. Missing evidence is never a measured zero.',
    8.5,
  );
  for (const item of v.breakdown) {
    ensure(42);
    const y = doc.y;
    doc.fillColor('#0f172a').fontSize(9).text(`${item.label} · ${item.weight}% weight`, 48, y);
    const valText = item.value === null ? item.reason : `${item.value}/100`;
    doc.fillColor('#334155').fontSize(9).text(valText, 48, y, { align: 'right', width });
    const barY = y + 13;
    doc.roundedRect(48, barY, width, 6, 3).fill('#e2e8f0');
    if (item.value !== null && item.value > 0) {
      doc
        .roundedRect(48, barY, (width * Math.min(100, Math.max(0, item.value))) / 100, 6, 3)
        .fill('#4f46e5');
    }
    doc.y = barY + 12;
  }

  // Reporting Activity
  heading('Reporting activity');
  paragraph(
    `Sprint: ${report.meta?.sprint?.tasksTotal ? report.meta.sprint.tasksCompleted + '/' + report.meta.sprint.tasksTotal + ' tasks complete' : 'No tasks to assess'}. Interview: ${report.meta?.interview?.sessions ?? 'Not recorded'} active sessions.`,
  );
  paragraph(
    `Repository commits: ${report.meta?.activity?.commits ?? 'Not recorded'} lifetime snapshot count. Weekly commits are ${report.meta?.activity?.weeklyCommitSignal == null ? 'not measured' : report.meta.activity.weeklyCommitSignal}. Active repositories: ${report.meta?.activity?.activeRepositories ?? 'Not recorded'} (repository update timestamps).`,
  );

  // Narrative Blocks
  bullets('Evidence highlights', v.achievements);
  bullets('Insights', v.insights);
  bullets('Next actions', v.recommendations);

  // Risks and Focus
  heading('Risks and focus');
  ensure(36);
  const riskY = doc.y;
  doc.rect(48, riskY, 3, 20).fill('#f59e0b');
  doc
    .fillColor('#334155')
    .fontSize(9.5)
    .text(String(v.risk ?? ''), 56, riskY + 2, { width: width - 8, lineGap: 3 });
  doc.y = Math.max(doc.y, riskY + 26);
  doc.moveDown(0.4);

  // Source Freshness
  ensure(360);
  heading('Source freshness at assessment');
  for (const source of v.sources) {
    ensure(36);
    doc.fillColor('#0f172a').fontSize(9).text(`${source.label}`, { continued: true });
    doc.fillColor('#64748b').fontSize(8.5).text(` — ${source.status} · ${source.freshness}`);
    doc
      .fillColor('#64748b')
      .fontSize(8)
      .text(`Latest evidence: ${source.timestamp}`, { width, lineGap: 2 });
    doc.moveDown(0.3);
  }

  // Provenance
  heading('Snapshot provenance');
  paragraph(`Report ID: ${report._id}\nContent hash: ${v.hash}`, 8);
  paragraph(
    'This PDF uses the saved report snapshot. It does not regenerate scores or refresh sources. Readiness is a planning indicator, not a hiring probability. Learning completion is self-reported.',
    8.5,
  );

  // Header & Footer on every page
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    doc.rect(48, doc.page.height - 44, width, 0.5).fill('#e2e8f0');
    doc
      .fontSize(8)
      .fillColor('#64748b')
      .text(`${v.brand} · Private weekly report`, 48, doc.page.height - 34, {
        lineBreak: false,
      });
    doc.text(`${index + 1} / ${range.count}`, doc.page.width - 85, doc.page.height - 34, {
      lineBreak: false,
    });
    doc.restore();
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return ready;
}

module.exports = { render };
