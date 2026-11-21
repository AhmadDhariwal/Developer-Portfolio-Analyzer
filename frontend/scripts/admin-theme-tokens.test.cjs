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
