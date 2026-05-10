const BaseIntegrationAdapter = require('./baseAdapter');
const axios = require('axios');

class PortfolioScannerAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('portfolio');
  }

  getAuthMode() {
    return 'manual';
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText: 'Enter your portfolio website URL (e.g. https://yourname.dev) to scan technologies, responsiveness, and SEO signals.'
    };
  }

  async ingestData(connection = {}) {
    const rawUrl = String(connection.externalUsername || '').trim();
    if (!rawUrl) {
      throw new Error('Portfolio URL is required.');
    }

    const url = this.normalizeUrl(rawUrl);

    const scanResult = await this.scanPortfolio(url);

    const technologies = scanResult.technologies || [];
    const inferredSkills = [...new Set(technologies)].slice(0, 12);

    return {
      provider: this.provider,
      profile: {
        username: url,
        url,
        isReachable: scanResult.isReachable,
        statusCode: scanResult.statusCode,
        responseTimeMs: scanResult.responseTimeMs
      },
      activity: {
        technologies,
        hasSSL: scanResult.hasSSL,
        hasMeta: scanResult.hasMeta,
        hasViewport: scanResult.hasViewport,
        hasOgTags: scanResult.hasOgTags,
        wordCount: scanResult.wordCount,
        seoScore: scanResult.seoScore,
        performanceScore: scanResult.performanceScore
      },
      inferredSkills,
      raw: scanResult
    };
  }

  normalizeUrl(raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://${raw}`;
  }

  async scanPortfolio(url) {
    const start = Date.now();
    let html = '';
    let statusCode = 0;
    let isReachable = false;
    let hasSSL = url.startsWith('https://');

    try {
      const response = await axios.get(url, {
        timeout: 12000,
        maxRedirects: 5,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DevInsightBot/1.0; +https://devinsight.ai)',
          Accept: 'text/html,application/xhtml+xml'
        },
        validateStatus: (status) => status < 600
      });
      statusCode = response.status;
      isReachable = statusCode >= 200 && statusCode < 400;
      html = String(response.data || '');
    } catch {
      return {
        isReachable: false,
        statusCode: 0,
        responseTimeMs: Date.now() - start,
        technologies: [],
        hasSSL,
        hasMeta: false,
        hasViewport: false,
        hasOgTags: false,
        wordCount: 0,
        seoScore: 0,
        performanceScore: 0
      };
    }

    const responseTimeMs = Date.now() - start;
    const technologies = this.detectTechnologies(html, url);
    const hasMeta = /<meta\s+name=["']description["']/i.test(html);
    const hasViewport = /<meta\s+name=["']viewport["']/i.test(html);
    const hasOgTags = /<meta\s+property=["']og:/i.test(html);
    const hasTitle = /<title>/i.test(html);
    const hasH1 = /<h1[\s>]/i.test(html);
    const wordCount = this.estimateWordCount(html);

    // Simple SEO score (0-100)
    const seoChecks = [hasMeta, hasViewport, hasOgTags, hasTitle, hasH1, hasSSL, wordCount > 100];
    const seoScore = Math.round((seoChecks.filter(Boolean).length / seoChecks.length) * 100);

    // Performance proxy: penalize slow response times
    const performanceScore = Math.max(0, Math.min(100, Math.round(100 - (responseTimeMs / 100))));

    return {
      isReachable,
      statusCode,
      responseTimeMs,
      technologies,
      hasSSL,
      hasMeta,
      hasViewport,
      hasOgTags,
      wordCount,
      seoScore,
      performanceScore
    };
  }

  detectTechnologies(html, url) {
    const techs = new Set();
    const lower = html.toLowerCase();

    const patterns = [
      [/react|reactdom|__react/i, 'React'],
      [/angular|ng-version|ng-app/i, 'Angular'],
      [/vue\.js|vuejs|__vue/i, 'Vue.js'],
      [/next\.js|__next|_next\//i, 'Next.js'],
      [/nuxt\.js|__nuxt/i, 'Nuxt.js'],
      [/svelte/i, 'Svelte'],
      [/gatsby/i, 'Gatsby'],
      [/tailwind/i, 'Tailwind CSS'],
      [/bootstrap/i, 'Bootstrap'],
      [/jquery/i, 'jQuery'],
      [/three\.js|threejs/i, 'Three.js'],
      [/gsap|greensock/i, 'GSAP'],
      [/framer-motion|framer\.com/i, 'Framer Motion'],
      [/typescript|\.ts"/i, 'TypeScript'],
      [/webpack/i, 'Webpack'],
      [/vite/i, 'Vite'],
      [/vercel/i, 'Vercel'],
      [/netlify/i, 'Netlify'],
      [/github\.io/i, 'GitHub Pages'],
      [/wordpress|wp-content/i, 'WordPress'],
      [/webflow/i, 'Webflow'],
      [/framer\.com/i, 'Framer'],
      [/notion\.so/i, 'Notion'],
      [/sanity\.io/i, 'Sanity CMS'],
      [/contentful/i, 'Contentful'],
      [/graphql/i, 'GraphQL'],
      [/apollo/i, 'Apollo'],
      [/styled-components|styled\.div/i, 'Styled Components'],
      [/emotion/i, 'Emotion CSS'],
      [/sass|\.scss/i, 'Sass/SCSS'],
      [/less\.js|\.less/i, 'Less CSS']
    ];

    for (const [pattern, name] of patterns) {
      if (pattern.test(html)) techs.add(name);
    }

    return Array.from(techs);
  }

  estimateWordCount(html) {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.split(' ').filter((w) => w.length > 2).length;
  }
}

module.exports = PortfolioScannerAdapter;
