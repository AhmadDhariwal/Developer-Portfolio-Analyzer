'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const service = require('../services/courseService');

for (const scenario of ['401', '403-quota', 'timeout', 'empty']) {
  test(`YouTube ${scenario} preserves usable curated alternatives and safe metadata`, async () => {
    const originalGet = axios.get,
      originalKey = process.env.YOUTUBE_API_KEY;
    process.env.YOUTUBE_API_KEY = 'controlled-test-credential';
    service.clearYouTubeCache();
    axios.get = async () => {
      if (scenario === 'empty') return { data: { items: [] } };
      const error = new Error('provider-private-response');
      if (scenario === 'timeout') error.code = 'ECONNABORTED';
      else
        error.response = {
          status: scenario === '401' ? 401 : 403,
          data: { error: { errors: [{ reason: 'quotaExceeded' }] } },
        };
      throw error;
    };
    try {
      const result = await service.buildCoursePoolWithMetadata({
        careerStack: 'Backend',
        experienceLevel: 'Intern',
        platform: 'All',
        skillGaps: ['SQL'],
      });
      assert.ok(result.courses.length >= 27);
      assert.ok(result.courses.every((course) => course.platform !== 'YouTube'));
      assert.ok(
        result.courses.every((course) => course.rating === null && course.duration === null),
      );
      assert.doesNotMatch(
        JSON.stringify(result),
        /controlled-test-credential|provider-private-response/,
      );
      if (scenario !== 'empty') assert.equal(result.sourceMetadata.fallbackUsed, true);
    } finally {
      axios.get = originalGet;
      if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
      else process.env.YOUTUBE_API_KEY = originalKey;
      service.clearYouTubeCache();
    }
  });
}

test('a cooled-down YouTube circuit recovers to a successful real-shaped response', async () => {
  const originalGet = axios.get,
    originalKey = process.env.YOUTUBE_API_KEY,
    originalNow = Date.now;
  let offset = 0,
    healthy = false;
  process.env.YOUTUBE_API_KEY = 'controlled-test-credential';
  service.clearYouTubeCache();
  Date.now = () => originalNow() + offset;
  axios.get = async (url) => {
    if (!healthy) {
      const error = new Error('outage');
      error.response = { status: 401 };
      throw error;
    }
    return {
      data: {
        items: url.endsWith('/search')
          ? [{ id: { videoId: 'abcdefghijk' } }]
          : [
              {
                id: 'abcdefghijk',
                snippet: { title: 'SQL recovery', channelTitle: 'Controlled fixture' },
                contentDetails: { duration: 'PT1H' },
                statistics: { viewCount: '0', likeCount: '0' },
              },
            ],
      },
    };
  };
  try {
    for (let i = 0; i < 3; i++) await service.fetchYouTubeCourses('failure-' + i, 3);
    assert.equal((await service.fetchYouTubeCourses('blocked', 3)).status, 'circuit-open');
    offset = 31 * 60 * 1000;
    healthy = true;
    const recovered = await service.fetchYouTubeCourses('recovery', 3);
    assert.equal(recovered.status, 'available');
    assert.equal(recovered.courses.length, 1);
    assert.equal(recovered.courses[0].rating, null);
    assert.equal(recovered.courses[0].viewCount, 0);
    assert.equal((await service.fetchYouTubeCourses('recovery', 3)).fromCache, true);
    offset += 7 * 60 * 60 * 1000;
    assert.equal((await service.fetchYouTubeCourses('recovery', 3)).fromCache, false);
  } finally {
    axios.get = originalGet;
    Date.now = originalNow;
    if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
    else process.env.YOUTUBE_API_KEY = originalKey;
    service.clearYouTubeCache();
  }
});
