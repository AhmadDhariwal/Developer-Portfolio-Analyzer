// Focused rendered CSS regression. No app session, APIs or external data are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const sass = require('../../frontend/node_modules/sass');

const repository = path.resolve(__dirname, '../..');
const baseline = process.argv.includes('--baseline');
const stylesheets = [
  'frontend/src/app/core/layouts/main-layout/navbar/navbar.component.scss',
  'frontend/src/app/core/layouts/main-layout/sidebar/sidebar.component.scss',
  'frontend/src/app/core/layouts/main-layout/main-layout.component.scss'
];
const css = stylesheets
  .map((stylesheet) => {
    const source = baseline
      ? execFileSync('git', ['show', `:${stylesheet}`], { cwd: repository, encoding: 'utf8' })
      : fs.readFileSync(path.join(repository, stylesheet), 'utf8');
    return sass
      .compileString(source, { url: pathToFileURL(path.join(repository, stylesheet)) })
      .css.replaceAll(':host-context(.recruiter-workspace)', '.recruiter-workspace')
      .replaceAll(':host-context(.developer-workspace)', '.developer-workspace');
  })
  .join('\n');
const edge =
  process.env.INTEGRATION_TEST_BROWSER ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
assert.ok(fs.existsSync(edge), 'Installed Edge or INTEGRATION_TEST_BROWSER is required');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dpa-recruiter-toolbar-'));
const root = fs.realpathSync(directory);
const html = path.join(root, 'fixture.html');
fs.writeFileSync(
  html,
  `<!doctype html><style>
* { box-sizing: border-box; } :root { --navbar-height: 64px; --transition-base: 0.25s ease-in-out; } body { margin: 0; }
${css}</style><div class="dashboard-shell recruiter-workspace">
<aside class="sidebar closed"><div class="sidebar-logo">M</div></aside>
<div class="shell-body sidebar-closed"><nav class="navbar sidebar-closed">
<div class="navbar-left"><button class="menu-toggle">Menu</button><div class="search-bar"><input aria-label="Search"></div></div>
<div class="navbar-right"><button class="icon-btn">Theme</button><button class="icon-btn">Alerts</button>
<div class="user-avatar-block"><button class="avatar-button"><span class="avatar-circle">M</span>
<span class="user-info"><span class="user-name">Mia Member</span><span class="user-handle">mia-member</span></span>
</button></div></div></nav><main class="main-content"><h1>Jobs</h1></main></div></div><pre id="geometry"></pre><script>
setTimeout(() => {
const box = selector => document.querySelector(selector).getBoundingClientRect();
const frames = [];
function measure(direction, time) {
  const edge = box('.sidebar').right, toolbar = box('.navbar').left, content = box('.shell-body').left;
  frames.push({ direction, time, edge, toolbar, content, overlap: edge > toolbar + 1 || edge > content + 1 });
}
measure('initial', 0);
for (const open of [true, false]) {
  document.querySelector('.sidebar').classList.toggle('closed', !open);
  document.querySelector('.shell-body').classList.toggle('sidebar-closed', !open);
  document.querySelector('.navbar').classList.toggle('sidebar-closed', !open);
  void document.body.offsetWidth;
  const animations = document.getAnimations().filter(animation => ['sidebar', 'shell-body', 'navbar'].some(name => animation.effect.target.classList.contains(name)));
  if (animations.length < 3) throw Error('Expected sidebar, content and toolbar CSS transitions');
  animations.forEach(animation => animation.pause());
  for (const time of [0, 25, 50, 100, 150, 200, 250]) {
    animations.forEach(animation => { animation.currentTime = time; });
    measure(open ? 'opening' : 'closing', time);
  }
}
document.querySelector('#geometry').textContent = JSON.stringify({ width: innerWidth, frames, overlap: frames.some(frame => frame.overlap) });
}, 30);
</script>`
);

const results = [];
try {
  for (const width of [1470]) {
    let output;
    try {
      output = execFileSync(
        edge,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-first-run',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-sync',
          '--no-default-browser-check',
          `--user-data-dir=${path.join(root, `profile-${width}`)}`,
          `--window-size=${width},700`,
          '--virtual-time-budget=1000',
          '--dump-dom',
          pathToFileURL(html).href
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] }
      );
    } catch (error) {
      throw new Error('Isolated browser check failed: ' + (error.code || error.status));
    }
    const matched = output.match(/<pre id="geometry">([^<]+)<\/pre>/);
    assert.ok(matched, 'Browser must emit rendered geometry');
    const result = JSON.parse(matched[1]);
    assert.equal(
      result.overlap,
      baseline,
      baseline
        ? 'Staged baseline must reproduce the sidebar overlap'
        : 'Sidebar, toolbar and page must stay synchronized'
    );
    results.push(result);
  }
} finally {
  // Individually remove only this invocation's verified temporary files, then
  // their exact empty directories. Never use recursive filesystem deletion.
  function clean(current) {
    assert.ok(current === root || current.startsWith(root + path.sep));
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.resolve(current, entry.name);
      assert.ok(target.startsWith(root + path.sep) && !entry.isSymbolicLink());
      if (entry.isDirectory()) clean(target);
      else fs.unlinkSync(target);
    }
    fs.rmdirSync(current);
  }
  clean(root);
}
process.stdout.write(JSON.stringify({ baseline, results, temporaryFilesCleaned: true }) + '\n');
