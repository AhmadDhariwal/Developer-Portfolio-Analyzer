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

  const paragraph = (text, size = 9) => {
    doc
      .fillColor('#334155')
      .fontSize(size)
      .text(String(text ?? ''), { width, lineGap: 3 });
    doc.moveDown(0.5);
  };

  const heading = (text) => {
    ensure(50);
    doc.fillColor('#0f172a').fontSize(13).text(text);
    doc.moveDown(0.35);
  };

  const bullets = (title, values) => {
    if (!values || !values.length) return;
    heading(title);
    for (const value of values) {
      const valStr = String(value ?? '');
      const textH = doc.heightOfString(valStr, { width: width - 34, lineGap: 2.5 });
      const itemH = Math.max(24, textH + 10);
      ensure(itemH + 4);
      const bY = doc.y;
      doc.roundedRect(48, bY, width, itemH, 4).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.rect(48, bY, 3, itemH).fill('#4f46e5');
      doc
        .fillColor('#334155')
        .fontSize(8.5)
        .text(valStr, 58, bY + 5, { width: width - 34, lineGap: 2.5 });
      doc.y = bY + itemH + 5;
    }
    doc.moveDown(0.2);
  };

  // Header Banner
  doc.rect(48, 48, width, 4).fill('#4f46e5');
  doc.y = 58;
  doc
    .fillColor('#4f46e5')
    .fontSize(8.5)
    .text('DEVINSIGHT AI · EXECUTIVE PROGRESS REPORT', { characterSpacing: 0.5 });
  doc.moveDown(0.25);
  doc.fillColor('#0f172a').fontSize(22).text('Your weekly progress');
  doc.moveDown(0.25);
  paragraph(`${v.period} · ${v.timezone} · Version ${v.version}`, 9);
  doc.moveDown(0.2);

  // Score Hero Card
  const summaryStr = String(v.summary ?? '');
  const summaryH = doc.heightOfString(summaryStr, { width: width - 28, lineGap: 2.5 });
  const heroH = Math.max(76, 52 + summaryH + 10);
  ensure(heroH + 10);
  const heroY = doc.y;
  doc.roundedRect(48, heroY, width, heroH, 8).fillAndStroke('#f8fafc', '#e2e8f0');
  doc
    .fillColor('#64748b')
    .fontSize(8)
    .text('CAREER MOMENTUM SCORE', 62, heroY + 10);
  doc
    .fillColor('#4338ca')
    .fontSize(24)
    .text(v.scoreLabel, 62, heroY + 22);
  doc
    .fillColor('#334155')
    .fontSize(8.5)
    .text(summaryStr, 62, heroY + 50, { width: width - 28, lineGap: 2.5 });
  doc.y = heroY + heroH + 8;
  paragraph(v.comparison, 8.5);

  // Readiness Indicator
  heading('Readiness indicator');
  ensure(28);
  const rY = doc.y;
  doc.roundedRect(48, rY, width, 24, 6).fillAndStroke('#f8fafc', '#e2e8f0');
  doc
    .fillColor('#0f172a')
    .fontSize(8.5)
    .text('Readiness indicator:', 58, rY + 6, { continued: true });
  doc.fillColor('#4338ca').fontSize(8.5).text(`  ${v.readiness}`, { continued: true });
  doc.fillColor('#64748b').fontSize(8).text(` · ${v.readinessReason}`);
  doc.y = rY + 30;

  // Score Breakdown
  heading('Score breakdown');
  paragraph(
    'Fixed weights: GitHub 30%, resume 25%, Sprint 20%, interview 15%, skill coverage 10%. Missing evidence is never a measured zero.',
    8,
  );
  for (const item of v.breakdown) {
    ensure(30);
    const y = doc.y;
    doc.roundedRect(48, y, width, 26, 5).fill('#f8fafc');
    doc
      .fillColor('#0f172a')
      .fontSize(8.5)
      .text(`${item.label} · ${item.weight}% weight`, 58, y + 5);
    const valText = item.value === null ? item.reason : `${item.value}/100`;
    doc
      .fillColor('#334155')
      .fontSize(8.5)
      .text(valText, 48, y + 5, { align: 'right', width: width - 10 });
    const barY = y + 17;
    doc.roundedRect(58, barY, width - 20, 3.5, 1.75).fill('#e2e8f0');
    if (item.value !== null && item.value > 0) {
      doc
        .roundedRect(
          58,
          barY,
          ((width - 20) * Math.min(100, Math.max(0, item.value))) / 100,
          3.5,
          1.75,
        )
        .fill('#4f46e5');
    }
    doc.y = y + 29;
  }
  doc.moveDown(0.2);

  // Reporting Activity
  heading('Reporting activity');
  const sprintActivity = `Sprint: ${report.meta?.sprint?.tasksTotal ? report.meta.sprint.tasksCompleted + '/' + report.meta.sprint.tasksTotal + ' tasks complete' : 'No tasks to assess'}. Interview: ${report.meta?.interview?.sessions ?? 'Not recorded'} active sessions.`;
  const repositoryActivity = `Repository commits: ${report.meta?.activity?.commits ?? 'Not recorded'} lifetime snapshot count. Weekly commits are ${report.meta?.activity?.weeklyCommitSignal == null ? 'not measured' : report.meta.activity.weeklyCommitSignal}. Active repositories: ${report.meta?.activity?.activeRepositories ?? 'Not recorded'} (repository update timestamps).`;
  const activityTextStyle = { width: width - 20, lineGap: 2 };
  const activityPadding = 6;
  const activityGap = 4;
  doc.fontSize(8);
  const sprintActivityHeight = doc.heightOfString(sprintActivity, activityTextStyle);
  const repositoryActivityHeight = doc.heightOfString(repositoryActivity, activityTextStyle);
  const activityCardHeight = Math.max(
    44,
    activityPadding * 2 + sprintActivityHeight + activityGap + repositoryActivityHeight,
  );
  ensure(activityCardHeight + 4);
  const actY = doc.y;
  doc.roundedRect(48, actY, width, activityCardHeight, 6).fillAndStroke('#f8fafc', '#e2e8f0');
  doc
    .fillColor('#334155')
    .fontSize(8)
    .text(sprintActivity, 58, actY + activityPadding, activityTextStyle);
  doc
    .fillColor('#334155')
    .fontSize(8)
    .text(
      repositoryActivity,
      58,
      actY + activityPadding + sprintActivityHeight + activityGap,
      activityTextStyle,
    );
  doc.y = actY + activityCardHeight + 4;

  // Narrative Blocks
  bullets('Evidence highlights', v.achievements);
  bullets('Insights', v.insights);
  bullets('Next actions', v.recommendations);

  // Risks and Focus
  heading('Risks and focus');
  const riskStr = String(v.risk ?? '');
  const rH = Math.max(26, doc.heightOfString(riskStr, { width: width - 36, lineGap: 2.5 }) + 12);
  ensure(rH + 4);
  const riskY = doc.y;
  doc.roundedRect(48, riskY, width, rH, 6).fillAndStroke('#fffbeb', '#fef3c7');
  doc.rect(48, riskY, 3, rH).fill('#f59e0b');
  doc
    .fillColor('#92400e')
    .fontSize(8.5)
    .text(riskStr, 58, riskY + 6, { width: width - 36, lineGap: 2.5 });
  doc.y = riskY + rH + 8;

  // Source Freshness at Assessment (Page 2 Card Grid)
  ensure(320);
  heading('Source freshness at assessment');
  for (const source of v.sources) {
    ensure(30);
    const sY = doc.y;
    doc.roundedRect(48, sY, width, 25, 5).fillAndStroke('#f8fafc', '#e2e8f0');
    doc
      .fillColor('#0f172a')
      .fontSize(8.5)
      .text(source.label, 58, sY + 6);
    doc
      .fillColor('#475569')
      .fontSize(8)
      .text(`${source.status} · ${source.freshness}`, 175, sY + 6);
    doc
      .fillColor('#64748b')
      .fontSize(7.5)
      .text(`Latest evidence: ${source.timestamp}`, 48, sY + 6.5, {
        align: 'right',
        width: width - 10,
      });
    doc.y = sY + 28;
  }
  doc.moveDown(0.2);

  // Snapshot Provenance
  ensure(65);
  heading('Snapshot provenance');
  const provY = doc.y;
  const provH = 50;
  doc.roundedRect(48, provY, width, provH, 6).fillAndStroke('#f8fafc', '#e2e8f0');
  doc
    .fillColor('#475569')
    .fontSize(7.5)
    .text('SNAPSHOT VERIFICATION & PROVENANCE', 58, provY + 6);
  doc
    .fillColor('#0f172a')
    .fontSize(7.5)
    .text(`Report ID: ${report._id}  |  Content hash: ${v.hash}`, 58, provY + 17, {
      width: width - 20,
    });
  doc
    .fillColor('#64748b')
    .fontSize(7)
    .text(
      'This PDF uses the saved report snapshot. It does not regenerate scores or refresh sources. Readiness is a planning indicator, not a hiring probability. Learning completion is self-reported.',
      58,
      provY + 29,
      { width: width - 20, lineGap: 2 },
    );
  doc.y = provY + provH + 10;

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
