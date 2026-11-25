const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const sass = require('sass');
const postcss = require('postcss');

const source = path.resolve(__dirname, '../src');
const globalCss = postcss.parse(
  sass.compile(path.join(source, 'styles.scss'), { logger: sass.Logger.silent }).css,
);

function themeTokens(theme) {
  const tokens = {};
  globalCss.walkRules((rule) => {
    if (
      rule.selectors.some(
        (selector) => selector === ':root' || selector === `[data-theme=${theme}]`,
      )
    ) {
      rule.walkDecls(/^--/, (declaration) => {
        tokens[declaration.prop] = declaration.value;
      });
    }
  });
  return tokens;
}

for (const page of ['admin-jobs', 'admin-teams', 'admin-dashboard']) {
  const css = postcss.parse(
    sass.compile(path.join(source, `app/features/admin/pages/${page}/${page}.component.scss`), {
      logger: sass.Logger.silent,
    }).css,
  );

  test(`${page} inherits resolved Light/Dark tokens, including System mode`, () => {
    const local = {};
    css.walkDecls(/^--/, (declaration) => {
      assert.doesNotMatch(declaration.prop, /^--(?:text-|border-strong)/);
      assert.match(declaration.value, /^var\(--/);
      local[declaration.prop] = declaration.value;
    });
    const resolved = {};
    for (const theme of ['light', 'dark']) {
      const tokens = { ...themeTokens(theme), ...local };
      const resolve = (value) =>
        value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
          assert.ok(tokens[name], `Missing ${theme} token ${name}`);
          return resolve(tokens[name]);
        });
      css.walkDecls((declaration) => {
        if (!declaration.prop.startsWith('--')) resolve(declaration.value);
        if (declaration.prop === 'color') {
          // Deliberate fixed text is limited to filled gradient buttons.
          assert.ok(
            /var\(|inherit|^#(?:081321|fff)$/.test(declaration.value),
            `Fixed foreground in ${declaration.parent.selector}: ${declaration.value}`,
          );
        }
      });
      resolved[theme] = resolve('var(--bg-panel)');
      const drawer = [];
      css.walkRules((rule) => {
        if (/^\.(?:detail-drawer|drawer|team-drawer|modal)$/.test(rule.selector)) {
          rule.walkDecls('background', (declaration) => drawer.push(declaration.value));
        }
      });
      assert.ok(drawer.length, 'Drawer/dialog surface must be covered');
      drawer.forEach((value) => assert.match(value, /^var\(--surface-/));
    }
    assert.notEqual(resolved.light, resolved.dark, 'Panel must follow resolved theme');
  });
}

function componentCss(relativePath) {
  return postcss.parse(
    sass.compile(path.join(source, relativePath), { logger: sass.Logger.silent }).css,
  );
}

function resolveValue(value, tokens) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    assert.ok(tokens[name], `Missing token ${name}`);
    return resolveValue(tokens[name], tokens);
  });
}

function resolvedStyles(css, selectors, tokens) {
  const styles = {};
  css.walkRules((rule) => {
    if (rule.selectors.some((selector) => selectors.includes(selector))) {
      rule.walkDecls((declaration) => {
        styles[declaration.prop] = resolveValue(declaration.value, tokens);
      });
    }
  });
  return styles;
}

function rgb(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

function contrast(foreground, background) {
  const luminance = (channels) =>
    channels.reduce((sum, channel, index) => {
      const value = channel / 255;
      const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      return sum + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function assertReadable(styles, description) {
  const ratio = contrast(rgb(styles.color), rgb(styles.background));
  assert.ok(ratio >= 4.5, `${description}: ${ratio.toFixed(2)}:1`);
  assert.ok(!styles.opacity || styles.opacity === '1', 'Do not fade the accessible color pair');
  assert.ok(!styles.filter || styles.filter === 'none', 'Do not filter the accessible color pair');
  return ratio.toFixed(2);
}

const themes = [
  ['Light', 'light'],
  ['Dark', 'dark'],
  ['System-Light', 'light'],
  ['System-Dark', 'dark'],
];

test('Teams primary buttons keep AA contrast in default, hover, focus, loading and disabled states', (t) => {
  const css = componentCss('app/features/admin/pages/admin-teams/admin-teams.component.scss');
  for (const [preference, theme] of themes) {
    for (const button of ['.btn-primary', '.btn-primary-sm']) {
      for (const state of ['', ':hover:not(:disabled)', ':focus-visible', ':disabled']) {
        const styles = resolvedStyles(css, [button, button + state], themeTokens(theme));
        const ratio = assertReadable(styles, `${preference} ${button}${state}`);
        if (button === '.btn-primary')
          t.diagnostic(`${preference} New Team ${state || 'default/loading'}: ${ratio}:1`);
      }
    }
    const focus = resolvedStyles(
      css,
      [':where(button, a, input, select, textarea):focus-visible'],
      themeTokens(theme),
    );
    assert.ok(focus.outline && focus['outline-offset'], 'Keep keyboard focus visible');
  }
});

test('shared messages keep AA body and Dismiss contrast for every variant and resolved theme', (t) => {
  const css = componentCss('app/shared/components/message/message.component.scss');
  for (const [preference, theme] of themes) {
    // Custom-property aliases resolve on the root before being inherited. This
    // also covers the existing Admin Developers page's local light-text palette.
    const rootTokens = themeTokens(theme);
    const tokens = Object.fromEntries(
      Object.entries(rootTokens).map(([name, value]) => [name, resolveValue(value, rootTokens)]),
    );
    tokens['--text-primary'] = '#f8fbff';
    tokens['--text-secondary'] = '#aab8d1';
    for (const variant of ['', '.success', '.error', '.warning']) {
      const message = resolvedStyles(css, ['.shared-message', '.shared-message' + variant], tokens);
      assertReadable(message, `${preference} message${variant}`);
      for (const state of ['', ':hover', ':focus-visible']) {
        const button = resolvedStyles(
          css,
          ['.shared-message button', '.shared-message button' + state],
          tokens,
        );
        if (button.background === 'transparent') button.background = message.background;
        const ratio = assertReadable(button, `${preference} Dismiss${variant}${state}`);
        if (!variant && !state) t.diagnostic(`${preference} Dismiss: ${ratio}:1`);
        if (state === ':focus-visible')
          assert.ok(button['box-shadow'], 'Keep keyboard focus visible');
      }
    }
  }
});

test('shared empty states keep AA text contrast in both themes despite page text overrides', (t) => {
  const css = componentCss('app/shared/components/empty-state/empty-state.component.scss');
  for (const [preference, theme] of themes) {
    const root = themeTokens(theme);
    const tokens = Object.fromEntries(
      Object.entries(root).map(([name, value]) => [name, resolveValue(value, root)]),
    );
    tokens['--text-primary'] = '#f8fbff';
    tokens['--text-muted'] = '#6f819f';
    for (const compact of [false, true]) {
      const panel = resolvedStyles(
        css,
        ['.ui-empty-state', ...(compact ? ['.ui-empty-state.is-compact'] : [])],
        tokens,
      );
      for (const selector of ['.empty-title', '.empty-desc']) {
        const content = resolvedStyles(css, [`.ui-empty-state ${selector}`], tokens);
        const ratio = assertReadable({ ...panel, ...content }, `${preference} ${selector}`);
        if (!compact) t.diagnostic(`${preference} ${selector}: ${ratio}:1`);
      }
    }
  }
});

test('Refresh label stays AA across the complete gradient in every resolved theme', (t) => {
  const css = componentCss(
    'app/features/admin/pages/admin-dashboard/admin-dashboard.component.scss',
  );
  for (const [preference, theme] of themes) {
    const styles = resolvedStyles(css, ['.btn', '.btn--primary', '.btn:hover'], themeTokens(theme));
    assert.match(styles.background, /^linear-gradient\(135deg in srgb,/);
    const stops = styles.background.match(/#[\da-f]{6}/gi).map(rgb);
    assert.equal(stops.length, 2);
    assert.ok(!styles.filter && !styles.opacity, 'Preserve the gradient contrast on hover');
    const ratios = Array.from({ length: 1001 }, (_, index) => {
      const fraction = index / 1000;
      const background = stops[0].map(
        (channel, channelIndex) => channel + (stops[1][channelIndex] - channel) * fraction,
      );
      return contrast(rgb(styles.color), background);
    });
    // Relative luminance is convex along an sRGB segment, so its maximum is at
    // an endpoint. White-text contrast therefore cannot dip below these stops.
    assert.deepEqual(rgb(styles.color), [255, 255, 255]);
    const minimum = Math.min(...ratios);
    assert.ok(minimum >= 4.5, `${preference} Refresh minimum: ${minimum.toFixed(2)}:1`);
    t.diagnostic(`${preference} Refresh minimum across 1001 positions: ${minimum.toFixed(2)}:1`);
    const focus = resolvedStyles(
      css,
      [':where(button, a, input, select, textarea):focus-visible'],
      themeTokens(theme),
    );
    assert.ok(focus.outline, 'Keep keyboard focus visible');
  }
});
