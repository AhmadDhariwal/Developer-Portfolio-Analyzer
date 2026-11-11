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
  const paragraph = (text, size = 10) => {
    doc
      .fillColor('#334155')
      .fontSize(size)
      .text(String(text ?? ''), { width, lineGap: 4 });
    doc.moveDown(0.7);
  };
  const heading = (text) => {
    ensure(70);
    doc.fillColor('#0f172a').fontSize(16).text(text);
    doc.moveDown(0.45);
  };
  const bullets = (title, values) => {
    if (!values.length) return;
    heading(title);
    for (const value of values) {
      ensure(45);
      paragraph(`• ${value}`);
    }
  };
  doc.fillColor('#4338ca').fontSize(13).text(v.brand.toUpperCase());
  doc.moveDown();
  doc.fillColor('#0f172a').fontSize(28).text('Your weekly progress');
  doc.moveDown(0.4);
  paragraph(`${v.period} · ${v.timezone} · Version ${v.version}`);
  doc.fillColor('#4338ca').fontSize(30).text(v.scoreLabel);
  doc.moveDown(0.4);
  paragraph(v.summary);
  paragraph(v.comparison);
  heading('Readiness indicator');
  paragraph(`${v.readiness} · ${v.readinessReason}`);
  heading('Score breakdown');
  paragraph(
    'Fixed weights: GitHub 30%, resume 25%, Sprint 20%, interview 15%, skill coverage 10%. Missing evidence is never a measured zero.',
    9,
  );
  for (const item of v.breakdown) {
    ensure(66);
    paragraph(
      `${item.label} · ${item.weight}% weight · ${item.value === null ? item.reason : item.value + '/100'}`,
      10,
    );
    const y = doc.y;
    doc.roundedRect(48, y, width, 7, 3).fill('#e2e8f0');
    if (item.value !== null && item.value > 0)
      doc
        .roundedRect(48, y, (width * Math.min(100, Math.max(0, item.value))) / 100, 7, 3)
        .fill('#6366f1');
    doc.y = y + 18;
  }
  heading('Reporting activity');
  paragraph(
    `Sprint: ${report.meta?.sprint?.tasksTotal ? report.meta.sprint.tasksCompleted + '/' + report.meta.sprint.tasksTotal + ' tasks complete' : 'No tasks to assess'}. Interview: ${report.meta?.interview?.sessions ?? 'Not recorded'} active sessions.`,
  );
  paragraph(
    `Repository commits: ${report.meta?.activity?.commits ?? 'Not recorded'} lifetime snapshot count. Weekly commits are ${report.meta?.activity?.weeklyCommitSignal == null ? 'not measured' : report.meta.activity.weeklyCommitSignal}. Active repositories: ${report.meta?.activity?.activeRepositories ?? 'Not recorded'} (repository update timestamps).`,
  );
  bullets('Evidence highlights', v.achievements);
  bullets('Insights', v.insights);
  bullets('Next actions', v.recommendations);
  heading('Risks and focus');
  paragraph(v.risk);
  ensure(460);
  heading('Source freshness at assessment');
  for (const source of v.sources) {
    ensure(44);
    paragraph(
      `${source.label} — ${source.status} · ${source.freshness}\nLatest evidence: ${source.timestamp}`,
      9,
    );
  }
  heading('Snapshot provenance');
  paragraph(`Report ID: ${report._id}\nContent hash: ${v.hash}`, 8);
  paragraph(
    'This PDF uses the saved report snapshot. It does not regenerate scores or refresh sources. Readiness is a planning indicator, not a hiring probability. Learning completion is self-reported.',
    9,
  );
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.save();
    doc
      .fontSize(8)
      .fillColor('#64748b')
      .text(`${v.brand} · Private weekly report`, 48, doc.page.height - 39, {
        lineBreak: false,
      });
    doc.text(`${index + 1} / ${range.count}`, doc.page.width - 85, doc.page.height - 39, {
      lineBreak: false,
    });
    doc.restore();
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return ready;
}
module.exports = { render };
