'use strict';
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const service = require('../services/courseService');
(async () => {
  const configured =
    !!process.env.YOUTUBE_API_KEY && process.env.YOUTUBE_API_KEY !== 'your_youtube_api_key';
  const started = performance.now();
  const result = await service.fetchYouTubeCourses('SQL tutorial', 3, { forceRefresh: true });
  const evidence = {
    checkedAt: new Date().toISOString(),
    configured,
    realNetwork: configured,
    status: result.status,
    reason: result.reason || '',
    milliseconds: Math.round(performance.now() - started),
    courses: result.courses.map((course) => ({
      id: course.id,
      title: course.title,
      url: course.url,
      rating: course.rating,
      engagementScore: course.engagementScore,
      provenance: course.provenance,
    })),
    limitation: result.courses.length
      ? 'Live YouTube read verified for the configured credential; course enrollment and provider uptime are not certified.'
      : 'No live successful YouTube course response was verified. Curated fallback and controlled provider-failure tests are separate evidence.',
  };
  const directory = path.resolve(__dirname, '../../verification/courses/final');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'live-provider.json'),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      configured,
      status: evidence.status,
      courses: evidence.courses.length,
      milliseconds: evidence.milliseconds,
      reason: evidence.reason,
    }),
  );
})().catch((error) => {
  console.error('Live provider verification failed:', error.code || error.name);
  process.exitCode = 1;
});
