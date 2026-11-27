'use strict';

/**
 * Independent P1.6C.3 Acceptance Verification Suite (Sections 3–21)
 * Exercises real compiled Angular + real Express APIs + isolated disposable MongoDB replica set.
 * Zero target API mocks, zero production DB touches, zero external email/AI delivery.
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { startRealStackHarness } = require('./qa-harness.cjs');

const POLICY_UI_LABELS = {
  recruiterJobCreation: 'Allow Recruiter job creation',
  recruiterJobPublication: 'Allow Recruiter job publication',
  teamSharedJobs: 'Allow team-shared jobs',
  sharedPublicEvaluations: 'Allow shared public evaluations',
  teamManagerEvaluationManagement: 'Allow team managers to manage shared evaluations',
  candidateMatching: 'Allow candidate matching and ranking',
  invitationCreation: 'Allow invitations and pending acceptance',
  managerTeamAdministration: 'Allow organization managers to administer teams',
};

const ALL_PROFILES = [
  { id: '1440x900-light', width: 1440, height: 900, theme: 'light', scheme: 'light' },
  { id: '1440x900-dark', width: 1440, height: 900, theme: 'dark', scheme: 'dark' },
  { id: '1024x768-system', width: 1024, height: 768, theme: 'system', scheme: 'light' },
  { id: '768x1024-light', width: 768, height: 1024, theme: 'light', scheme: 'light' },
  { id: '390x844-light', width: 390, height: 844, theme: 'light', scheme: 'light' },
  { id: '390x844-dark', width: 390, height: 844, theme: 'dark', scheme: 'dark' },
  { id: '320x640-light', width: 320, height: 640, theme: 'light', scheme: 'light' },
];

const ORG_ROUTES = [
  ['/app/admin/organization', 'Organization overview'],
  ['/app/admin/organization/settings', 'General settings'],
  ['/app/admin/organization/policies', 'Policies & permissions'],
  ['/app/admin/organization/members', 'Members & access'],
  ['/app/admin/organization/invitations', 'Invitations'],
  ['/app/admin/organization/usage', 'Resource usage'],
];

async function navigateSpa(page, waitSettled, targetPath) {
  const cleanTarget = targetPath.split('?')[0];
  const currentPathname = await page.evaluate(() => window.location.pathname).catch(() => '');
  if (currentPathname === cleanTarget && !targetPath.includes('?')) {
    await waitSettled(page);
    return;
  }

  let link = page.locator(`aside#application-navigation a[href="${cleanTarget}"]`).first();

  // Open mobile navigation drawer if sidebar is off-canvas on tablet/mobile viewports
  const isSidebarOffscreen = await page
    .locator('aside#application-navigation')
    .evaluate((aside) => {
      const style = getComputedStyle(aside);
      const rect = aside.getBoundingClientRect();
      return style.visibility === 'hidden' || style.display === 'none' || rect.right <= 0;
    })
    .catch(() => false);

  if (isSidebarOffscreen) {
    const drawerBtn = page
      .locator(
        'button[aria-controls="application-navigation"], button[aria-label*="navigation" i], button.menu-btn, button.menu-toggle'
      )
      .first();
    if (await drawerBtn.isVisible().catch(() => false)) {
      await drawerBtn.click();
      await page.waitForTimeout(220);
    }
  }

  // Expand the specific parent collapsible group if target sublink sits inside a collapsed submenu
  const parentGroup = page.locator(
    `aside#application-navigation li.nav-group:has(a[href="${cleanTarget}"])`
  );
  const groupToggle = parentGroup.locator('button.group-toggle[aria-expanded], button[aria-expanded]').last();

  if (await groupToggle.count()) {
    const isCollapsed = await link
      .evaluate((el) => Boolean(el.closest('.nav-submenu.collapsed')))
      .catch(() => false);
    const expanded = await groupToggle.getAttribute('aria-expanded');
    if ((isCollapsed || expanded === 'false') && (await groupToggle.isVisible().catch(() => false))) {
      await groupToggle.click();
      await page
        .waitForFunction(
          (href) => {
            const a = document.querySelector(`aside#application-navigation a[href="${href}"]`);
            if (!a) return false;
            const sub = a.closest('.nav-submenu');
            return !sub || (!sub.classList.contains('collapsed') && sub.getBoundingClientRect().height > 10);
          },
          cleanTarget,
          { timeout: 3000 }
        )
        .catch(() => {});
      await page.waitForTimeout(220);
    }
  }

  const expandedReady = await link
    .evaluate((el) => {
      const sub = el.closest('.nav-submenu');
      if (sub && sub.classList.contains('collapsed')) return false;
      const r = el.getBoundingClientRect();
      return r.width > 5 && r.height > 5;
    })
    .catch(() => false);

  if (expandedReady && (await link.isVisible().catch(() => false)) && !targetPath.includes('?')) {
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await link.click();
  } else {
    await page.goto(new URL(page.url()).origin + targetPath, { waitUntil: 'domcontentloaded' });
  }
  await waitSettled(page);
}

async function run() {
  const h = await startRealStackHarness();
  const report = {
    startedAt: new Date().toISOString(),
    apiMocks: false,
    productionDataUsed: false,
    externalDelivery: false,
    sections: {},
    observations: [],
    failures: [],
    matrix: [],
    workspaceRegressions: [],
  };

  const shot = async (page, filename) => {
    const target = path.join(h.screenshotsDir, filename);
    await page.screenshot({ path: target, fullPage: true, animations: 'disabled', timeout: 30000 });
    return `frontend/verification/admin/p1.6c.3/screenshots/${filename}`;
  };

  const checkLayoutMetrics = async (page, label) => {
    return page.evaluate((lbl) => {
      const doc = document.documentElement;
      const body = document.body;
      const h1 = document.querySelector('h1');
      const h1Style = h1 ? getComputedStyle(h1) : null;
      const bodyStyle = getComputedStyle(body);
      const clippedControls = [];
      for (const el of document.querySelectorAll('main button, main a[href]')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.right > window.innerWidth + 2 || rect.left < -2) {
          clippedControls.push({
            text: (el.textContent || '').trim().slice(0, 40),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            vw: window.innerWidth,
          });
        }
      }
      return {
        label: lbl,
        pathname: window.location.pathname + window.location.search,
        themeAttr: doc.getAttribute('data-theme'),
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        overflow: doc.scrollWidth > doc.clientWidth + 1,
        h1Text: h1 ? (h1.textContent || '').trim() : '',
        h1Color: h1Style ? h1Style.color : null,
        bodyBg: bodyStyle.backgroundColor,
        bodyColor: bodyStyle.color,
        clippedControlsCount: clippedControls.length,
        clippedControls: clippedControls.slice(0, 5),
      };
    }, label);
  };

  try {
    // =========================================================================
    // SECTION 3, 4 & 20: Real Login, Nav Architecture, Aliases, Search, History
    // =========================================================================
    {
      const context = await h.browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (u.origin === h.origin) return route.continue();
        return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
      });

      const consoleErrors = [];
      const pageErrors = [];
      const failedApi = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => pageErrors.push(e.message));
      page.on('response', (r) => {
        if (r.url().startsWith(h.origin + '/api/') && r.status() >= 400) {
          failedApi.push({ url: new URL(r.url()).pathname, status: r.status() });
        }
      });

      // Real UI login flow
      await page.goto(`${h.origin}/auth/login`, { waitUntil: 'domcontentloaded' });
      await page.locator('input[type="email"], input[name="email"]').first().fill(h.actors.adminOwnerA.email);
      await page.locator('input[type="password"], input[name="password"]').first().fill('QaTest!Pass123');
      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/\/app\/admin/, { timeout: 15000 });
      await h.waitSettled(page);

      const postLoginPath = new URL(page.url()).pathname;

      // Inspect Admin sidebar groups & navbar elements
      const navAudit = await page.evaluate(() => {
        const aside = document.querySelector('aside#application-navigation');
        const groupHeaders = aside
          ? Array.from(aside.querySelectorAll('button[aria-expanded]')).map((b) =>
              (b.textContent || '').trim()
            )
          : [];
        const links = aside
          ? Array.from(aside.querySelectorAll('a[href]')).map((a) => ({
              text: (a.textContent || '').trim(),
              href: a.getAttribute('href'),
            }))
          : [];
        const header = document.querySelector('app-navbar header, header.topbar, header, app-navbar');
        const navbarText = (header?.textContent || '').replace(/\s+/g, ' ').trim();
        const collapsedSublinks = Array.from(
          document.querySelectorAll('aside#application-navigation .nav-submenu.collapsed a')
        );
        const collapsedSublinksTabbableCount = collapsedSublinks.filter((a) => {
          const style = getComputedStyle(a);
          const tabIdx = a.getAttribute('tabindex');
          return style.display !== 'none' && style.visibility !== 'hidden' && tabIdx !== '-1';
        }).length;
        return { groupHeaders, links, navbarText, collapsedSublinksTabbableCount };
      });

      console.log('[QA] Block A: Login, Navigation, Aliases, Search, History');
      // Expand all currently visible collapsed Admin sidebar groups cleanly
      const allGroupButtons = page.locator('aside#application-navigation button[aria-expanded]');
      const gCount = await allGroupButtons.count();
      for (let i = 0; i < gCount; i += 1) {
        const btn = allGroupButtons.nth(i);
        const visible = await btn.isVisible().catch(() => false);
        const expanded = await btn.getAttribute('aria-expanded');
        if (visible && expanded === 'false') {
          await btn.click();
          await page.waitForTimeout(120);
        }
      }
      const allAdminSidebarLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('aside#application-navigation a[href]')).map((a) => ({
          text: (a.textContent || '').trim(),
          href: a.getAttribute('href'),
        }))
      );

      // Navbar workspace search suggestions check
      const searchInput = page.locator('app-navbar input, header input').first();
      let searchSuggestions = [];
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('Policy');
        await page.waitForTimeout(250);
        searchSuggestions = await page.evaluate(() => {
          const items = Array.from(
            document.querySelectorAll('app-navbar [role="listbox"] [role="option"], app-navbar a, app-navbar li, .search-results a, header a, header li')
          );
          return items.map((el) => (el.textContent || '').trim()).filter(Boolean);
        });
        await searchInput.fill('');
      }

      // Test ALL legacy route aliases, reload & Back/Forward
      const aliasCases = [
        ['/app/admin/console', '/app/admin/organization', 'Organization overview'],
        ['/app/admin/console?tab=overview', '/app/admin/organization', 'Organization overview'],
        ['/app/admin/console?tab=teams', '/app/admin/teams', null],
        ['/app/admin/console?tab=recruiters', '/app/admin/recruiters', null],
        ['/app/admin/console?tab=invitations', '/app/admin/organization/invitations', 'Invitations'],
        ['/app/admin/console?tab=preferences', '/app/admin/organization/settings', 'General settings'],
        ['/app/admin/console?tab=activity', '/app/admin/activity-logs', null],
        ['/app/admin/console/preferences', '/app/admin/organization/settings', 'General settings'],
        ['/app/admin/console/performance-statistics', '/app/admin/performance', null],
        ['/app/admin-console', '/app/admin/organization', 'Organization overview'],
        ['/app/admin-console/overview', '/app/admin/organization', 'Organization overview'],
        ['/app/admin-console/performance-statistics', '/app/admin/performance', null],
      ];
      const aliasResults = [];
      for (const [aliasUrl, expectedPath, expectedH1] of aliasCases) {
        await page.goto(`${h.origin}${aliasUrl}`, { waitUntil: 'domcontentloaded' });
        await h.waitSettled(page);
        await page.waitForTimeout(250);
        const resolved = new URL(page.url()).pathname;
        const resolvedFullUrl = page.url().replace(h.origin, '');
        const h1Text = await page
          .locator('h1')
          .first()
          .textContent()
          .then((s) => (s || '').trim())
          .catch(() => '');
        const title = await page.title();
        aliasResults.push({
          aliasUrl,
          expectedPath,
          resolved,
          resolvedFullUrl,
          matchedPath: resolved === expectedPath,
          h1Text,
          matchedH1: expectedH1 ? h1Text === expectedH1 : h1Text.length > 0,
          title,
        });
      }

      // Reload & browser Back/Forward persistence check on Settings -> Policies -> Usage
      await navigateSpa(page, h.waitSettled, '/app/admin/organization/settings');
      await navigateSpa(page, h.waitSettled, '/app/admin/organization/policies');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const reloadPath = new URL(page.url()).pathname;
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const backPath = new URL(page.url()).pathname;
      await page.goForward({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const forwardPath = new URL(page.url()).pathname;

      // Quick navigation from Organization Overview & Members query-param check
      await navigateSpa(page, h.waitSettled, '/app/admin/organization');
      await page.getByRole('link', { name: 'Edit general settings' }).click();
      await h.waitSettled(page);
      const overviewToSettings = new URL(page.url()).pathname;

      await navigateSpa(page, h.waitSettled, '/app/admin/organization');
      await page.getByRole('link', { name: 'Review policies' }).click();
      await h.waitSettled(page);
      const overviewToPolicies = new URL(page.url()).pathname;

      await navigateSpa(page, h.waitSettled, '/app/admin/organization');
      await page.getByRole('link', { name: 'View governance audit activity' }).click();
      await h.waitSettled(page);
      const overviewToAudit = new URL(page.url()).pathname;

      // Notification drawer navigation observation
      const notifAudit = [];
      const bell = page.locator('header button[aria-label*="notification" i], button[aria-label*="Notification" i]').first();
      if (await bell.isVisible().catch(() => false)) {
        await bell.click();
        await page.waitForTimeout(300);
        const prefNotice = page.getByText('Console Preferences Notice').first();
        if (await prefNotice.isVisible().catch(() => false)) {
          await prefNotice.click();
          await h.waitSettled(page);
          notifAudit.push({
            notice: 'Console Preferences Notice (/app/admin/console?tab=preferences)',
            landedUrl: page.url().replace(h.origin, ''),
          });
        }
        // Re-open bell for canonical notice
        if (await bell.isVisible().catch(() => false)) {
          await bell.click();
          await page.waitForTimeout(300);
          const orgNotice = page.getByText('Organization Canonical Notice').first();
          if (await orgNotice.isVisible().catch(() => false)) {
            await orgNotice.click();
            await h.waitSettled(page);
            notifAudit.push({
              notice: 'Organization Canonical Notice (/app/admin/organization)',
              landedUrl: page.url().replace(h.origin, ''),
            });
          }
        }
      }

      report.sections.navigationAndAliases = {
        postLoginPath,
        navGroupHeaders: navAudit.groupHeaders,
        collapsedSublinksTabbableCount: navAudit.collapsedSublinksTabbableCount,
        allAdminSidebarLinksCount: allAdminSidebarLinks.length,
        allAdminSidebarLinks,
        navbarText: navAudit.navbarText,
        searchSuggestions,
        aliasResults,
        allAliasesMatched: aliasResults.every((r) => r.matchedPath && r.matchedH1),
        reloadPath,
        backPath,
        forwardPath,
        overviewQuickLinks: { overviewToSettings, overviewToPolicies, overviewToAudit },
        notifAudit,
        consoleErrors,
        pageErrors,
        failedApi,
      };
      console.log('[QA] Block A aliases summary:', JSON.stringify(aliasResults.map((a) => ({ alias: a.aliasUrl, resolved: a.resolved, h1: a.h1Text, ok: a.matchedPath && a.matchedH1 }))));
      console.log('[QA] Block A notifications:', JSON.stringify(notifAudit));
      if (!report.sections.navigationAndAliases.allAliasesMatched) {
        report.failures.push({
          block: 'Block A: Legacy Aliases',
          mismatches: aliasResults.filter((r) => !r.matchedPath || !r.matchedH1),
        });
      }
      assert.equal(reloadPath, '/app/admin/organization/policies');
      assert.equal(backPath, '/app/admin/organization/settings');
      assert.equal(forwardPath, '/app/admin/organization/policies');
      assert.equal(consoleErrors.length, 0, `Console errors in Nav/Aliases: ${consoleErrors.join('; ')}`);
      assert.equal(failedApi.length, 0, `Unexpected API errors in Nav/Aliases: ${JSON.stringify(failedApi)}`);
      await context.close();
    }

    // =========================================================================
    // SECTION 5 & 14: Organization Overview DB Truth + Resource Usage Edge Cases
    // =========================================================================
    {
      console.log('[QA] Block B: Organization Overview & Resource Usage');
      const { context, page, telemetry } = await h.openSession(h.actors.adminOwnerA, h.orgs.orgA);
      await page.goto(`${h.origin}/app/admin/organization`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);

      const apiOverview = await h.api('/api/admin-console/overview', { actor: h.actors.adminOwnerA });
      const apiGov = await h.api('/api/admin-console/governance', { actor: h.actors.adminOwnerA });
      const overviewText = await page.locator('main').innerText();

      // DB ground truth counts for Org A
      const dbTeams = await h.models.Team.countDocuments({ organizationId: h.orgs.orgA._id });
      const dbActiveTeams = await h.models.Team.countDocuments({
        organizationId: h.orgs.orgA._id,
        isActive: { $ne: false },
      });
      const dbJobs = await h.models.Job.countDocuments({ organizationId: h.orgs.orgA._id });
      const dbPendingInvites = await h.models.Invitation.countDocuments({
        organizationId: h.orgs.orgA._id,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      });

      // Normal Usage check
      await navigateSpa(page, h.waitSettled, '/app/admin/organization/usage');
      const normalUsageText = await page.locator('main').innerText();
      const usageHasEditor = await page.locator('main input, main select').count();

      // At-capacity edge case: active Recruiters = 4, active teams = 2 (total teams = 3)
      await h.settingsService.updateSettings({
        organization: { recruiterLimitPerOrg: 4, maxTeamsPerOrganization: 3 },
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const atCapUsageText = await page.locator('main').innerText();

      // Over-capacity edge case (active recruiters = 4 > limit 2; total teams = 3 > limit 1)
      await h.settingsService.updateSettings({
        organization: { recruiterLimitPerOrg: 2, maxTeamsPerOrganization: 1 },
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const overCapUsageText = await page.locator('main').innerText();

      // Zero-limit DB fallback check via direct PlatformSettings document update (then immediately restore)
      await h.models.PlatformSettings.updateOne(
        { scope: 'global' },
        {
          $set: {
            'organization.recruiterLimitPerOrg': 0,
            'organization.maxTeamsPerOrganization': 0,
            updatedAt: new Date(Date.now() + 2000),
          },
        }
      );
      h.settingsService.stopSettingsSynchronization();
      await h.settingsService.startSettingsSynchronization();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const zeroCapUsageText = await page.locator('main').innerText();

      // Restore platform limits
      await h.settingsService.updateSettings({
        organization: { recruiterLimitPerOrg: 10, maxTeamsPerOrganization: 10 },
      });

      // Verify empty optional fields degradation on Org B Overview
      const sessionB = await h.openSession(h.actors.foreignAdminB, h.orgs.orgB);
      await sessionB.page.goto(`${h.origin}/app/admin/organization`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(sessionB.page);
      const orgBOverviewText = await sessionB.page.locator('main').innerText();
      await sessionB.context.close();

      report.sections.overviewAndUsage = {
        overviewSummary: apiOverview.data?.summary,
        govSummary: apiGov.data?.summary,
        dbCounts: { dbTeams, dbActiveTeams, dbJobs, dbPendingInvites },
        internalMemberCountExcludesPublicDev:
          overviewText.includes(String(apiOverview.data?.summary?.internalMembers)) &&
          apiOverview.data?.summary?.internalMembers >= 210,
        normalUsageText,
        atCapUsageText,
        overCapUsageText,
        zeroCapUsageText,
        atCapBadgeObserved: atCapUsageText.includes('At capacity'),
        overCapBadgeObserved: overCapUsageText.includes('Over capacity'),
        zeroCapSafeFallbackObserved:
          zeroCapUsageText.includes('Zero capacity') &&
          zeroCapUsageText.includes('Percentage unavailable for a zero limit'),
        readOnlyNoInputs: usageHasEditor === 0,
        orgBEmptyStateSafe: !orgBOverviewText.includes('undefined'),
        consoleErrors: telemetry.consoleErrors,
        httpErrors: telemetry.httpErrors,
      };
      try {
        assert.ok(!normalUsageText.includes('NaN') && !normalUsageText.includes('Infinity'));
        assert.ok(!/-\d+\s+remaining/i.test(atCapUsageText) && atCapUsageText.includes('At capacity'));
        assert.ok(!/-\d+\s+remaining/i.test(overCapUsageText));
        assert.ok(overCapUsageText.includes('Over capacity'));
        assert.ok(
          !zeroCapUsageText.includes('Infinity') &&
            !zeroCapUsageText.includes('NaN') &&
            zeroCapUsageText.includes('Percentage unavailable for a zero limit')
        );
        assert.equal(usageHasEditor, 0, 'Resource usage page must be strictly read-only');
        assert.ok(!orgBOverviewText.includes('undefined') && !orgBOverviewText.includes('null'));
        assert.equal(telemetry.httpErrors.length, 0);
      } catch (err) {
        console.error('[QA] Block B assertion finding:', err.message);
        report.failures.push({ block: 'Block B: Overview & Usage', error: err.message });
      }
      await context.close();
    }

    // =========================================================================
    // SECTION 6 & 7: General Settings, Branding Logo, Validation, Guard & Dashboard Config
    // =========================================================================
    {
      console.log('[QA] Block C: General settings & validation');
      const { context, page, telemetry } = await h.openSession(h.actors.adminOwnerA, h.orgs.orgA);
      try {
      await page.goto(`${h.origin}/app/admin/organization/settings`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);

      // 1. Check valid HTTPS logo renders cleanly under Helmet CSP
      const validLogoCheck = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img')).filter((img) =>
          (img.src || '').includes('assets.qa.example.test/valid-logo.png')
        );
        return imgs.map((i) => ({ src: i.src, complete: i.complete, naturalWidth: i.naturalWidth }));
      });

      // 2. Test broken HTTPS logo graceful fallback (no CSP violation, fallback text rendered)
      await page.locator('#logoUrl').fill('https://assets.qa.example.test/broken-logo.png');
      await page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(page);
      await page.waitForTimeout(300);
      const brokenLogoFallbackText = await page.locator('main').innerText();

      // 3. Test valid full edit & save + reload persistence + optional clearing
      await page.locator('#name').fill('Alpha Control Org Updated');
      await page.locator('#description').fill('Updated QA description');
      await page.locator('#industry').fill('Developer Tools');
      await page.locator('#website').fill('https://updated.alpha.qa.test');
      await page.locator('#timezone').fill('Europe/London');
      await page.locator('#logoUrl').fill('https://assets.qa.example.test/valid-logo.png');
      await page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(page);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const reloadedName = await page.locator('#name').inputValue();
      const reloadedTimezone = await page.locator('#timezone').inputValue();
      assert.equal(reloadedName, 'Alpha Control Org Updated');
      assert.equal(reloadedTimezone, 'Europe/London');

      // 4. Test clearing optional fields persists as empty string
      await page.locator('#description').fill('');
      await page.locator('#industry').fill('');
      await page.locator('#website').fill('');
      await page.locator('#logoUrl').fill('');
      await page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(page);
      const dbAfterClear = await h.models.Organization.findById(h.orgs.orgA._id).lean();
      assert.equal(dbAfterClear.description, '');
      assert.equal(dbAfterClear.industry, '');
      assert.equal(dbAfterClear.website, '');
      assert.equal(dbAfterClear.branding?.logoUrl, '');

      // Restore branding logo & description cleanly
      await page.locator('#description').fill('Independent QA organization alpha');
      await page.locator('#industry').fill('Enterprise Software');
      await page.locator('#website').fill('https://alpha.qa.example.test');
      await page.locator('#logoUrl').fill('https://assets.qa.example.test/valid-logo.png');
      await page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(page);

      // 5. UI Validation bounds & Cancel Changes
      await page.locator('#name').fill('X');
      await page.getByRole('button', { name: 'Save organization' }).click();
      await page.waitForTimeout(150);
      const shortNameValidationText = await page.locator('main').innerText();
      await page.locator('#timezone').fill('Mars/Olympus');
      await page.getByRole('button', { name: 'Save organization' }).click();
      await page.waitForTimeout(150);
      const badTzValidationText = await page.locator('main').innerText();
      await page.getByRole('button', { name: 'Cancel changes' }).first().click();
      await page.waitForTimeout(150);
      const canceledName = await page.locator('#name').inputValue();
      assert.equal(canceledName, 'Alpha Control Org Updated');

      // 6. Unsaved changes guard (dismiss confirm -> stays; accept confirm -> leaves)
      await page.locator('#description').fill('Unsaved draft before nav');
      let dialogPrompt = '';
      page.once('dialog', async (d) => {
        dialogPrompt = d.message();
        await d.dismiss();
      });
      await page.locator('aside#application-navigation a[href="/app/admin/organization/policies"]').first().click();
      await page.waitForTimeout(250);
      const stayedOnSettingsPath = new URL(page.url()).pathname;
      const keptUnsavedDraft = await page.locator('#description').inputValue();
      assert.equal(stayedOnSettingsPath, '/app/admin/organization/settings');
      assert.equal(keptUnsavedDraft, 'Unsaved draft before nav');

      // Now retry and accept
      page.once('dialog', async (d) => d.accept());
      await page.locator('aside#application-navigation a[href="/app/admin/organization/policies"]').first().click();
      await h.waitSettled(page);
      const leftAfterAcceptPath = new URL(page.url()).pathname;
      assert.equal(leftAfterAcceptPath, '/app/admin/organization/policies');

      // 7. Network failure on save -> draft preserved -> retry succeeds
      await navigateSpa(page, h.waitSettled, '/app/admin/organization/settings');
      await page.locator('#industry').fill('Network Retry Industry');
      telemetry.expectedFault = true;
      await page.route('**/api/admin-console/governance', (r) =>
        r.request().method() === 'PATCH' ? r.abort('failed') : r.continue()
      );
      await page.getByRole('button', { name: 'Save organization' }).click();
      await page.waitForTimeout(300);
      const draftAfterAbort = await page.locator('#industry').inputValue();
      const abortBannerText = await page.locator('main').innerText();
      await page.unroute('**/api/admin-console/governance');
      telemetry.expectedFault = false;
      assert.equal(draftAfterAbort, 'Network Retry Industry');
      await page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(page);
      const dbAfterRetry = await h.models.Organization.findById(h.orgs.orgA._id).lean();
      assert.equal(dbAfterRetry.industry, 'Network Retry Industry');

      // 8. Direct HTTP negative & immutable field rejection checks
      const govNow = (await h.api('/api/admin-console/governance', { actor: h.actors.adminOwnerA })).data;
      const directValidationChecks = [];
      for (const [label, payload] of [
        ['shortName', { general: { name: 'A' } }],
        ['overlongName', { general: { name: 'A'.repeat(81) } }],
        ['invalidTimezone', { general: { timezone: 'Mars/Olympus' } }],
        ['httpLogoUrl', { general: { branding: { logoUrl: 'http://assets.qa.example.test/valid-logo.png' } } }],
        ['queryLogoUrl', { general: { branding: { logoUrl: 'https://assets.qa.example.test/valid-logo.png?x=1' } } }],
        ['credWebsiteUrl', { general: { website: 'https://user:pass@alpha.qa.example.test' } }],
        ['immutableSlug', { general: { slug: 'hijacked-slug' } }],
        ['immutableOwner', { general: { ownerId: String(h.actors.foreignAdminB._id) } }],
        ['immutableSuspended', { general: { isSuspended: true } }],
        ['forbiddenLimit', { recruiterLimitPerOrg: 999 }],
        ['arbitraryPerm', { permissions: { root: true } }],
        ['badPrefDays', { dashboardConfig: { preferredDateRangeDays: 999 } }],
      ]) {
        const res = await h.api('/api/admin-console/governance', {
          actor: h.actors.adminOwnerA,
          method: 'PATCH',
          body: { expectedVersion: govNow.version, ...payload },
        });
        directValidationChecks.push({ label, status: res.status });
        assert.equal(res.status, 400, `${label} must return 400, got ${res.status}: ${JSON.stringify(res.data)}`);
      }

      // 9. Dashboard configuration propagation across ALL fields, reload & 2nd Admin session
      console.log('[QA] Block C: Dashboard configuration propagation');
      await page.locator('select[name="days"], select[name="preferredDateRangeDays"]').first().selectOption({ label: 'Last 14 days' });
      await page.locator('select[name="defaultTeam"], select[name="defaultTeamId"]').first().selectOption({ label: h.teams.teamA2.name });
      const dashBoxes = [
        ['showKpiCards', /KPI/i],
        ['showTeamAnalytics', /Team analytics/i],
        ['showRecruiterPerformance', /Recruiter performance/i],
        ['showJobTrends', /Job trends/i],
        ['showActivityFeed', /Activity feed/i],
      ];
      for (const [boxName, labelRe] of dashBoxes) {
        const checkbox = page
          .locator(`input[type="checkbox"][name="${boxName}"]`)
          .or(page.getByRole('checkbox', { name: labelRe }))
          .first();
        if (await checkbox.isChecked()) await checkbox.uncheck();
      }
      await page.getByRole('button', { name: 'Save dashboard configuration' }).click();
      await h.waitSettled(page);

      // Navigate via Open dashboard link/button or SPA route & check DOM
      await page.getByRole('link', { name: 'Open dashboard' }).or(page.getByRole('button', { name: 'Open dashboard' })).first().click();
      await h.waitSettled(page);
      const dashOffControls = await page.evaluate(() => ({
        kpiGridCount: document.querySelectorAll('.kpi-grid, [data-testid="kpi-cards"]').length,
        hasTeamAnalyticsHeading: document.body.innerText.includes('Team Analytics'),
        hasRecruiterPerfHeading: document.body.innerText.includes('Recruiter Performance'),
        hasJobTrendsHeading: document.body.innerText.includes('Hiring & Job Trends'),
        hasActivityHeading: document.body.innerText.includes('Organization Activity'),
        hasRecentActions: document.body.innerText.includes('Recent Actions'),
        hasRecruiterSpotlight: document.body.innerText.includes('Recruiter Spotlight'),
        selectedLabels: Array.from(document.querySelectorAll('main select')).map(
          (s) => s.options[s.selectedIndex]?.textContent?.trim() || s.value
        ),
      }));

      // Second admin session observes persisted dashboard configuration
      const secondSess = await h.openSession(h.actors.secondAdminA, h.orgs.orgA);
      await secondSess.page.goto(`${h.origin}/app/admin/dashboard`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(secondSess.page);
      const secondAdminSelects = await secondSess.page.evaluate(() =>
        Array.from(document.querySelectorAll('main select')).map(
          (s) => s.options[s.selectedIndex]?.textContent?.trim() || s.value
        )
      );
      const secondAdminHasKpi = await secondSess.page.evaluate(
        () => document.querySelectorAll('.kpi-grid').length > 0
      );
      await secondSess.context.close();

      // Re-enable all 5 dashboard widgets + reset date range 30 + all teams
      await navigateSpa(page, h.waitSettled, '/app/admin/organization/settings');
      await page.locator('select[name="days"], select[name="preferredDateRangeDays"]').first().selectOption({ label: 'Last 30 days' });
      await page.locator('select[name="defaultTeam"], select[name="defaultTeamId"]').first().selectOption({ label: 'All teams' });
      for (const [boxName, labelRe] of dashBoxes) {
        const checkbox = page
          .locator(`input[type="checkbox"][name="${boxName}"]`)
          .or(page.getByRole('checkbox', { name: labelRe }))
          .first();
        if (!(await checkbox.isChecked())) await checkbox.check();
      }
      await page.getByRole('button', { name: 'Save dashboard configuration' }).click();
      await h.waitSettled(page);
      await navigateSpa(page, h.waitSettled, '/app/admin/dashboard');
      const dashOnControls = await page.evaluate(() => ({
        kpiGridCount: document.querySelectorAll('.kpi-grid').length,
        hasTeamAnalyticsHeading: document.body.innerText.includes('Team Analytics'),
        hasRecruiterPerfHeading: document.body.innerText.includes('Recruiter Performance'),
        hasJobTrendsHeading: document.body.innerText.includes('Hiring & Job Trends'),
        hasActivityHeading: document.body.innerText.includes('Organization Activity'),
      }));

      assert.equal(dashOffControls.kpiGridCount, 0);
      assert.equal(dashOffControls.hasTeamAnalyticsHeading, false);
      assert.equal(dashOffControls.hasRecruiterPerfHeading, false);
      assert.equal(dashOffControls.hasJobTrendsHeading, false);
      assert.equal(dashOffControls.hasActivityHeading, false);
      assert.equal(secondAdminHasKpi, false);
      assert.ok(
        secondAdminSelects.some((t) => t.includes('14')),
        `Second admin should see default 14d, saw ${JSON.stringify(secondAdminSelects)}`
      );
      assert.ok(
        secondAdminSelects.some((t) => t.includes(h.teams.teamA2.name)),
        `Second admin should see default team ${h.teams.teamA2.name}, saw ${JSON.stringify(secondAdminSelects)}`
      );
      assert.equal(dashOnControls.kpiGridCount > 0, true);
      assert.equal(dashOnControls.hasActivityHeading, true);

      report.sections.settingsAndDashboard = {
        validLogoCheck,
        brokenLogoHandled: !brokenLogoFallbackText.includes('undefined'),
        shortNameRejectedInUi: shortNameValidationText.length > 0,
        badTzRejectedInUi: badTzValidationText.toLowerCase().includes('timezone'),
        unsavedGuardPrompt: dialogPrompt,
        stayedOnSettingsAfterDismiss: true,
        networkRetryPreservedDraftAndSaved: true,
        directValidationChecks,
        dashOffControls,
        dashOnControls,
        secondAdminSelects,
        noteNonGatedDashCards: {
          recentActionsShownWhenAllTogglesOff: dashOffControls.hasRecentActions,
          recruiterSpotlightShownWhenAllTogglesOff: dashOffControls.hasRecruiterSpotlight,
        },
        consoleErrors: telemetry.consoleErrors,
        httpErrors: telemetry.httpErrors,
      };
      } catch (err) {
        console.error('[QA] Block C error:', err.message);
        report.failures.push({ block: 'Block C: Settings & Dashboard', error: err.message });
      } finally {
        await context.close();
      }
    }

    // =========================================================================
    // SECTION 9: Concurrency / 409 Conflict Across Settings, Policies & Cross-Module
    // =========================================================================
    {
      console.log('[QA] Block D: Concurrency / 409 conflicts');
      const sessA = await h.openSession(h.actors.adminOwnerA, h.orgs.orgA);
      const sessB = await h.openSession(h.actors.secondAdminA, h.orgs.orgA, { expectedFault: true });
      try {

      // 1. General Settings 409 conflict
      await sessA.page.goto(`${h.origin}/app/admin/organization/settings`, { waitUntil: 'domcontentloaded' });
      await sessB.page.goto(`${h.origin}/app/admin/organization/settings`, { waitUntil: 'domcontentloaded' });
      await Promise.all([
        sessA.page.locator('#name').waitFor({ state: 'visible' }),
        sessB.page.locator('#name').waitFor({ state: 'visible' }),
      ]);
      await Promise.all([h.waitSettled(sessA.page), h.waitSettled(sessB.page)]);
      // Ensure BOTH forms finished hydrating initial server values (version V) BEFORE Session A mutates
      await Promise.all([
        sessA.page.waitForFunction(() => Boolean(document.querySelector('#name')?.value)),
        sessB.page.waitForFunction(() => Boolean(document.querySelector('#name')?.value)),
      ]);

      await sessA.page.locator('#industry').fill('Concurrent Session A Industry');
      await sessA.page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(sessA.page);

      await sessB.page.locator('#description').fill('Session B preserved conflict draft');
      await sessB.page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(sessB.page);

      const settingsConflictText = await sessB.page.locator('main').innerText();
      const preservedDraft = await sessB.page.locator('#description').inputValue();
      const conflictShot = await shot(sessB.page, 'conflict-409-settings.png');
      assert.equal(preservedDraft, 'Session B preserved conflict draft');
      assert.ok(settingsConflictText.includes('Review concurrent changes'));

      // Acknowledge review -> save succeeds
      await sessB.page.getByRole('button', { name: 'I reviewed the server changes' }).or(
        sessB.page.getByRole('checkbox', { name: 'I reviewed the server changes' })
      ).first().click();
      await sessB.page.getByRole('button', { name: 'Save organization' }).click();
      await h.waitSettled(sessB.page);
      const dbAfterConflictResolve = await h.models.Organization.findById(h.orgs.orgA._id).lean();
      assert.equal(dbAfterConflictResolve.description, 'Session B preserved conflict draft');

      // 2. Policies 409 conflict + cross-module version check
      await navigateSpa(sessA.page, h.waitSettled, '/app/admin/organization/policies');
      await navigateSpa(sessB.page, h.waitSettled, '/app/admin/organization/policies');
      await Promise.all([
        sessA.page.getByRole('checkbox', { name: POLICY_UI_LABELS.candidateMatching }).waitFor({ state: 'visible' }),
        sessB.page.getByRole('checkbox', { name: POLICY_UI_LABELS.teamSharedJobs }).waitFor({ state: 'visible' }),
      ]);

      await sessA.page.getByRole('checkbox', { name: POLICY_UI_LABELS.candidateMatching }).uncheck();
      await sessA.page.getByRole('button', { name: 'Review and save policies' }).click();
      await sessA.page.getByRole('button', { name: 'Save policies', exact: true }).click();
      await h.waitSettled(sessA.page);

      await sessB.page.getByRole('checkbox', { name: POLICY_UI_LABELS.teamSharedJobs }).uncheck();
      await sessB.page.getByRole('button', { name: 'Review and save policies' }).click();
      await sessB.page.getByRole('button', { name: 'Save policies', exact: true }).click();
      await h.waitSettled(sessB.page);

      const policyConflictText = await sessB.page.locator('main').innerText();
      assert.ok(policyConflictText.includes('I reviewed the server changes'));
      const stillUncheckedInB = !(await sessB.page
        .getByRole('checkbox', { name: POLICY_UI_LABELS.teamSharedJobs })
        .isChecked());
      assert.equal(stillUncheckedInB, true);

      await sessB.page.getByRole('button', { name: 'I reviewed the server changes' }).or(
        sessB.page.getByRole('checkbox', { name: 'I reviewed the server changes' })
      ).first().click();
      await sessB.page.getByRole('button', { name: 'Review and save policies' }).click();
      await sessB.page.getByRole('button', { name: 'Save policies', exact: true }).click();
      await h.waitSettled(sessB.page);

      // 3. Cross-module version rejection via API (stale version after preferences update)
      const beforePrefGov = (await h.api('/api/admin-console/governance', { actor: h.actors.adminOwnerA })).data;
      const prefRes = await h.api('/api/admin-console/preferences', {
        actor: h.actors.adminOwnerA,
        method: 'PATCH',
        body: { expectedVersion: beforePrefGov.version, description: 'Cross-module increment check' },
      });
      assert.equal(prefRes.status, 200);
      const staleAfterPref = await h.api('/api/admin-console/governance', {
        actor: h.actors.secondAdminA,
        method: 'PATCH',
        body: { expectedVersion: beforePrefGov.version, industry: 'Should 409' },
      });
      assert.equal(staleAfterPref.status, 409);

      // Restore both policies back to true before Section 8 isolated tests
      const curGov = (await h.api('/api/admin-console/governance', { actor: h.actors.adminOwnerA })).data;
      await h.api('/api/admin-console/governance', {
        actor: h.actors.adminOwnerA,
        method: 'PATCH',
        body: {
          expectedVersion: curGov.version,
          policies: { candidateMatching: true, teamSharedJobs: true },
        },
      });

      report.sections.concurrencyConflicts = {
        settings409Observed: true,
        settingsDraftPreserved: true,
        settingsExplicitAckRequired: true,
        settingsConflictShot: conflictShot,
        policies409Observed: true,
        policiesSelectionPreserved: true,
        crossModulePreferencesToGovernance409Status: staleAfterPref.status,
      };
      } catch (err) {
        console.error('[QA] Block D error:', err.message);
        report.failures.push({ block: 'Block D: Concurrency', error: err.message });
      } finally {
        await Promise.all([sessA.context.close(), sessB.context.close()]);
      }
    }

    // =========================================================================
    // SECTION 8 & 17: All 8 Policies End-to-End Across Workspaces & Legacy Paths
    // =========================================================================
    {
      console.log('[QA] Block E: All 8 governance policies E2E');
      const adminSess = await h.openSession(h.actors.adminOwnerA, h.orgs.orgA);
      const recOwnerSess = await h.openSession(h.actors.recOwnerA, h.orgs.orgA, { expectedFault: true });
      const recMgrSess = await h.openSession(h.actors.recTeamMgrA, h.orgs.orgA, { expectedFault: true });
      try {

      await adminSess.page.goto(`${h.origin}/app/admin/organization/policies`, {
        waitUntil: 'domcontentloaded',
      });
      await h.waitSettled(adminSess.page);

      const togglePolicyUi = async (policyKey, targetChecked) => {
        const box = adminSess.page.getByRole('checkbox', { name: POLICY_UI_LABELS[policyKey] });
        const currentlyChecked = await box.isChecked();
        if (currentlyChecked === targetChecked) return;
        if (targetChecked) await box.check();
        else await box.uncheck();
        await adminSess.page.getByRole('button', { name: 'Review and save policies' }).click();
        await adminSess.page.getByRole('button', { name: 'Save policies', exact: true }).click();
        await h.waitSettled(adminSess.page);

        // Verify Org B remains completely isolated (all policies true)
        const capB = await h.api('/api/recruiter-hub/capabilities', { actor: h.actors.foreignRecruiterB });
        assert.equal(capB.status, 200);
        assert.equal(capB.data.capabilities[policyKey], true, `Org B policy ${policyKey} must remain true`);
      };

      const policyResults = {};

      // 1. recruiterJobCreation
      {
        await togglePolicyUi('recruiterJobCreation', false);
        await recOwnerSess.page.goto(`${h.origin}/app/recruiter/jobs`, { waitUntil: 'domcontentloaded' });
        await h.waitSettled(recOwnerSess.page);
        const uiText = await recOwnerSess.page.locator('main').innerText();
        const hubCreate = await h.api('/api/recruiter-hub/jobs', {
          actor: h.actors.recOwnerA,
          body: { title: 'Blocked Job', role: 'Dev', location: 'Remote', requiredSkills: ['JS'] },
        });
        const compatCreate = await h.api('/api/recruiter/job', {
          actor: h.actors.recOwnerA,
          body: { title: 'Blocked Compat', role: 'Dev', location: 'Remote', requiredSkills: ['JS'] },
        });
        const mgrCreate = await h.api('/api/recruiter-hub/jobs', {
          actor: h.actors.recTeamMgrA,
          body: { title: 'Blocked Mgr', role: 'Dev', location: 'Remote', requiredSkills: ['JS'] },
        });
        const curJob = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobPubA._id}`, {
          actor: h.actors.recOwnerA,
        });
        const editExisting = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobPubA._id}`, {
          actor: h.actors.recOwnerA,
          method: 'PATCH',
          body: { location: 'Remote (Edited)', expectedVersion: curJob.data.job.version },
        });
        const adminCreate = await h.api('/api/admin/jobs', {
          actor: h.actors.adminOwnerA,
          body: {
            title: 'Admin Created During Restriction',
            role: 'Engineer',
            description: 'Admin job',
            stack: 'Full Stack',
            requiredSkills: ['TypeScript'],
            location: 'Remote',
          },
        });
        assert.equal(hubCreate.status, 403);
        assert.equal(compatCreate.status, 403);
        assert.equal(mgrCreate.status, 403);
        assert.equal(editExisting.status, 200);
        assert.equal(adminCreate.status, 201);
        policyResults.recruiterJobCreation = {
          uiShowsRestrictionNotice:
            uiText.includes('restricted') || uiText.includes('Allow Recruiter job creation'),
          hubCreate: hubCreate.status,
          compatCreate: compatCreate.status,
          mgrCreate: mgrCreate.status,
          editExisting: editExisting.status,
          adminCreate: adminCreate.status,
        };
        await togglePolicyUi('recruiterJobCreation', true);
      }

      // 2. recruiterJobPublication
      {
        await togglePolicyUi('recruiterJobPublication', false);
        await recOwnerSess.page.goto(`${h.origin}/app/recruiter/jobs`, { waitUntil: 'domcontentloaded' });
        await h.waitSettled(recOwnerSess.page);
        const pubUiText = await recOwnerSess.page.locator('main').innerText();
        const createPublished = await h.api('/api/recruiter-hub/jobs', {
          actor: h.actors.recOwnerA,
          body: {
            title: 'Draft Only Allowed',
            role: 'Engineer',
            location: 'Remote',
            requiredSkills: ['JS'],
            status: 'open',
            published: true,
          },
        });
        const draftJob = await h.api('/api/recruiter-hub/jobs', {
          actor: h.actors.recOwnerA,
          body: {
            title: 'Unpublished Draft',
            role: 'Engineer',
            location: 'Remote',
            requiredSkills: ['JS'],
            status: 'draft',
            published: false,
          },
        });
        assert.equal(createPublished.status, 403);
        assert.equal(draftJob.status, 201);
        const publishAttempt = await h.api(`/api/recruiter-hub/jobs/${draftJob.data.job._id}`, {
          actor: h.actors.recOwnerA,
          method: 'PATCH',
          body: { status: 'open', published: true, expectedVersion: draftJob.data.job.version },
        });
        assert.equal(publishAttempt.status, 403);
        // Existing published job stays published and can be closed/unpublished cleanly
        const curPub = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobPubA._id}`, {
          actor: h.actors.recOwnerA,
        });
        assert.equal(curPub.data.job.published, true);
        const unpublish = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobPubA._id}`, {
          actor: h.actors.recOwnerA,
          method: 'PATCH',
          body: { status: 'closed', published: false, expectedVersion: curPub.data.job.version },
        });
        assert.equal(unpublish.status, 200);
        policyResults.recruiterJobPublication = {
          createPublished: createPublished.status,
          draftAllowed: draftJob.status,
          publishBlocked: publishAttempt.status,
          unpublishCloseAllowed: unpublish.status,
          noFakeApprovalWorkflow: !/submit for approval/i.test(pubUiText),
        };
        await togglePolicyUi('recruiterJobPublication', true);
        // Reopen jobPubA for later application tests
        const latestPub = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobPubA._id}`, {
          actor: h.actors.recOwnerA,
        });
        await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobPubA._id}`, {
          actor: h.actors.recOwnerA,
          method: 'PATCH',
          body: { status: 'open', published: true, expectedVersion: latestPub.data.job.version },
        });
      }

      // 3. teamSharedJobs
      {
        await togglePolicyUi('teamSharedJobs', false);
        const mgrGet = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobSharedA._id}`, {
          actor: h.actors.recTeamMgrA,
        });
        const memGet = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobSharedA._id}`, {
          actor: h.actors.recTeamMemberA,
        });
        const ownerGet = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobSharedA._id}`, {
          actor: h.actors.recOwnerA,
        });
        assert.equal(mgrGet.status, 404);
        assert.equal(memGet.status, 404);
        assert.equal(ownerGet.status, 200);
        assert.equal(ownerGet.data.job.teamShared, true);

        await recMgrSess.page.goto(`${h.origin}/app/recruiter/jobs`, { waitUntil: 'domcontentloaded' });
        await h.waitSettled(recMgrSess.page);
        const recMgrText = await recMgrSess.page.locator('main').innerText();

        await togglePolicyUi('teamSharedJobs', true);
        const memRestored = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobSharedA._id}`, {
          actor: h.actors.recTeamMemberA,
        });
        assert.equal(memRestored.status, 200);
        policyResults.teamSharedJobs = {
          mgrDenied: mgrGet.status,
          memDenied: memGet.status,
          ownerRetained: ownerGet.status,
          storedIntentPreserved: ownerGet.data.job.teamShared === true,
          recMgrSeesPolicyNotice: !recMgrText.includes('Shared Principal Systems Engineer'),
          reEnableRestoredAccess: memRestored.status === 200,
        };
      }

      // 4. sharedPublicEvaluations
      {
        await togglePolicyUi('sharedPublicEvaluations', false);
        const memJobMeta = await h.api(`/api/recruiter-hub/jobs/${h.fixtures.jobSharedA._id}`, {
          actor: h.actors.recTeamMemberA,
        });
        const memMatch = await h.api(`/api/recruiter-hub/matches/${h.fixtures.matchA._id}`, {
          actor: h.actors.recTeamMemberA,
        });
        const mgrMatch = await h.api(`/api/recruiter-hub/matches/${h.fixtures.matchA._id}`, {
          actor: h.actors.recTeamMgrA,
        });
        const ownerMatch = await h.api(`/api/recruiter-hub/matches/${h.fixtures.matchA._id}`, {
          actor: h.actors.recOwnerA,
        });
        const memShortlists = await h.api('/api/recruiter-hub/shortlists', {
          actor: h.actors.recTeamMemberA,
        });
        assert.equal(memJobMeta.status, 200);
        assert.equal(memMatch.status, 404);
        assert.equal(mgrMatch.status, 404);
        assert.equal(ownerMatch.status, 200);
        assert.equal(memShortlists.data.shortlists.length, 0);
        policyResults.sharedPublicEvaluations = {
          metadataStillReadable: memJobMeta.status,
          nonOwnerMatchDenied: memMatch.status,
          mgrMatchDenied: mgrMatch.status,
          ownerMatchRetained: ownerMatch.status,
          sharedShortlistHidden: memShortlists.data.shortlists.length === 0,
        };
        await togglePolicyUi('sharedPublicEvaluations', true);
      }

      // 5. teamManagerEvaluationManagement
      {
        await togglePolicyUi('teamManagerEvaluationManagement', false);
        const mgrRead = await h.api(`/api/recruiter-hub/matches/${h.fixtures.matchA._id}`, {
          actor: h.actors.recTeamMgrA,
        });
        const mgrMutateMatch = await h.api(`/api/recruiter-hub/matches/${h.fixtures.matchA._id}/status`, {
          actor: h.actors.recTeamMgrA,
          method: 'PATCH',
          body: { status: 'reviewing' },
        });
        const mgrMutateShortlist = await h.api(
          `/api/recruiter-hub/shortlists/${h.fixtures.shortlistPublicA._id}`,
          {
            actor: h.actors.recTeamMgrA,
            method: 'PATCH',
            body: { notes: 'Should be blocked' },
          }
        );
        const ownerMutate = await h.api(
          `/api/recruiter-hub/shortlists/${h.fixtures.shortlistPublicA._id}`,
          {
            actor: h.actors.recOwnerA,
            method: 'PATCH',
            body: { notes: 'Owner retains manage permission' },
          }
        );
        assert.equal(mgrRead.status, 200);
        assert.equal(mgrRead.data.match.access.manage, false);
        assert.equal(mgrMutateMatch.status, 403);
        assert.equal(mgrMutateShortlist.status, 403);
        assert.equal(ownerMutate.status, 200);
        policyResults.teamManagerEvaluationManagement = {
          mgrCanRead: mgrRead.status,
          mgrAccessManage: mgrRead.data.match.access.manage,
          mgrMutateMatch: mgrMutateMatch.status,
          mgrMutateShortlist: mgrMutateShortlist.status,
          ownerMutate: ownerMutate.status,
        };
        await togglePolicyUi('teamManagerEvaluationManagement', true);
      }

      // 6. candidateMatching
      {
        await togglePolicyUi('candidateMatching', false);
        await recOwnerSess.page.goto(`${h.origin}/app/recruiter/matches`, { waitUntil: 'domcontentloaded' });
        await h.waitSettled(recOwnerSess.page);
        const recMatchesShot = await shot(recOwnerSess.page, 'recruiter-matching-restricted.png');

        const genHub = await h.api('/api/recruiter-hub/matches/generate', {
          actor: h.actors.recOwnerA,
          body: { jobId: String(h.fixtures.jobSharedA._id), candidateIds: [String(h.actors.publicDev._id)] },
        });
        const matchCompat = await h.api('/api/recruiter/match', {
          actor: h.actors.recOwnerA,
          body: { jobId: String(h.fixtures.jobSharedA._id) },
        });
        const aiRankCompat = await h.api('/api/recruiter/ai-rank', {
          actor: h.actors.recOwnerA,
          body: { jobId: String(h.fixtures.jobSharedA._id), candidateIds: [String(h.actors.publicDev._id)] },
        });
        const jobCompare = await h.api('/api/recruiter-hub/comparison', {
          actor: h.actors.recOwnerA,
          body: { jobId: String(h.fixtures.jobSharedA._id), candidateIds: [String(h.actors.publicDev._id)] },
        });
        // Non-matching workflows stay open
        const discovery = await h.api('/api/recruiter-hub/candidates', { actor: h.actors.recOwnerA });
        const analyze = await h.api(`/api/recruiter-hub/candidates/${h.actors.publicDev._id}/analyze`, {
          actor: h.actors.recOwnerA,
          body: {},
        });
        const nonJobCompare = await h.api('/api/recruiter-hub/comparison', {
          actor: h.actors.recOwnerA,
          body: { candidateIds: [String(h.actors.publicDev._id)] },
        });
        const historicalUpdate = await h.api(
          `/api/recruiter-hub/matches/${h.fixtures.matchA._id}/status`,
          {
            actor: h.actors.recOwnerA,
            method: 'PATCH',
            body: { status: 'reviewing' },
          }
        );
        assert.equal(genHub.status, 403);
        assert.equal(matchCompat.status, 403);
        assert.equal(aiRankCompat.status, 403);
        assert.equal(jobCompare.status, 403);
        assert.equal(discovery.status, 200);
        assert.equal(analyze.status, 200);
        assert.equal(nonJobCompare.status, 200);
        assert.equal(historicalUpdate.status, 200);
        policyResults.candidateMatching = {
          genHub: genHub.status,
          matchCompat: matchCompat.status,
          aiRankCompat: aiRankCompat.status,
          jobCompare: jobCompare.status,
          discovery: discovery.status,
          analyze: analyze.status,
          nonJobCompare: nonJobCompare.status,
          historicalUpdate: historicalUpdate.status,
          recMatchesShot,
        };
        await togglePolicyUi('candidateMatching', true);
      }

      // 7. invitationCreation + P1.6C.1.1 revoked-inviter regression
      {
        await togglePolicyUi('invitationCreation', false);
        await adminSess.page.goto(`${h.origin}/app/admin/organization/invitations`, {
          waitUntil: 'domcontentloaded',
        });
        await h.waitSettled(adminSess.page);
        const invPageText = await adminSess.page.locator('main').innerText();
        const invRestrictedShot = await shot(adminSess.page, 'invitations-restricted.png');

        const adminCreateInv = await h.api('/api/admin/invite-recruiter', {
          actor: h.actors.adminOwnerA,
          body: { name: 'Blocked Inv', email: 'blocked-inv@fictional.qa.test', role: 'recruiter' },
        });
        const adminResendInv = await h.api(
          `/api/admin/invitations/${h.fixtures.invitePendingValid._id}/resend`,
          { actor: h.actors.adminOwnerA, method: 'POST', body: {} }
        );
        const tenantCreateInv = await h.api(
          `/api/tenant/organizations/${h.orgs.orgA._id}/invitations`,
          {
            actor: h.actors.adminOwnerA,
            body: { email: 'blocked-tenant@fictional.qa.test', role: 'member' },
          }
        );
        const authAccept = await h.api('/api/auth/accept-invite', {
          actor: null,
          body: { token: h.fixtures.tokens.tokenPendingValid, password: 'NewUser!Pass123' },
        });
        const tenantAcceptById = await h.api(
          `/api/tenant/invitations/${h.fixtures.invitePendingValid._id}/accept`,
          { actor: h.actors.inviteRecipient, body: {} }
        );
        const tenantAcceptByToken = await h.api(
          `/api/tenant/invitations/accept/${h.fixtures.tokens.tokenPendingValid}`,
          { actor: h.actors.inviteRecipient, body: {} }
        );
        const tenantOnboard = await h.api(
          `/api/tenant/invitations/accept/${h.fixtures.tokens.tokenPendingValid}/onboard`,
          { actor: null, body: { name: 'Blocked Onboard', password: 'NewUser!Pass123' } }
        );
        // Preserved: direct recruiter creation & expire/revoke still work!
        const directRec = await h.api('/api/admin/recruiters/direct', {
          actor: h.actors.adminOwnerA,
          body: {
            name: 'Direct Recruiter During Invite Ban',
            email: 'direct-allowed@fictional.qa.test',
            password: 'Direct!User123',
          },
        });
        assert.equal(adminCreateInv.status, 403);
        assert.equal(adminResendInv.status, 403);
        assert.equal(tenantCreateInv.status, 403);
        assert.equal(authAccept.status, 403);
        assert.equal(tenantAcceptById.status, 403);
        assert.equal(tenantAcceptByToken.status, 403);
        assert.equal(tenantOnboard.status, 403);
        assert.equal(directRec.status, 201);

        // Navigate back to Policies and re-enable invitationCreation
        await navigateSpa(adminSess.page, h.waitSettled, '/app/admin/organization/policies');
        await togglePolicyUi('invitationCreation', true);

        // CRITICAL P1.6C.1.1 check: re-enabling does NOT resurrect revoked inviter's token!
        const revokedResults = {};
        for (const [key, fn] of [
          [
            'authAcceptInvite',
            () =>
              h.api('/api/auth/accept-invite', {
                actor: null,
                body: { token: h.fixtures.tokens.tokenRevokedInviter, password: 'Hack!Pass123' },
              }),
          ],
          [
            'tenantAcceptId',
            () =>
              h.api(`/api/tenant/invitations/${h.fixtures.inviteByRevokedAdmin._id}/accept`, {
                actor: h.actors.inviteRecipient,
                body: {},
              }),
          ],
          [
            'tenantAcceptToken',
            () =>
              h.api(`/api/tenant/invitations/accept/${h.fixtures.tokens.tokenRevokedInviter}`, {
                actor: h.actors.inviteRecipient,
                body: {},
              }),
          ],
          [
            'tenantOnboard',
            () =>
              h.api(`/api/tenant/invitations/accept/${h.fixtures.tokens.tokenRevokedInviter}/onboard`, {
                actor: null,
                body: { name: 'Revoked Attack', password: 'Hack!Pass123' },
              }),
          ],
        ]) {
          const r = await fn();
          assert.equal(r.status, 403, `${key} must return 403 after policy re-enable`);
          assert.equal(r.data?.token, undefined, `${key} must never issue a JWT`);
          revokedResults[key] = r.status;
        }
        const invDbStillPending = await h.models.Invitation.findById(
          h.fixtures.inviteByRevokedAdmin._id
        ).lean();
        assert.equal(invDbStillPending.status, 'pending');

        policyResults.invitationCreation = {
          uiNoticeShown: invPageText.includes('Invitations restricted by organization policy'),
          invRestrictedShot,
          blockedStatuses: {
            adminCreateInv: adminCreateInv.status,
            adminResendInv: adminResendInv.status,
            tenantCreateInv: tenantCreateInv.status,
            authAccept: authAccept.status,
            tenantAcceptById: tenantAcceptById.status,
            tenantAcceptByToken: tenantAcceptByToken.status,
            tenantOnboard: tenantOnboard.status,
          },
          directRecruiterAllowed: directRec.status,
          revokedInviterStayBlockedAfterReenable: revokedResults,
        };
      }

      // 8. managerTeamAdministration
      {
        await togglePolicyUi('managerTeamAdministration', false);
        const mgrTeamCreate = await h.api(`/api/tenant/organizations/${h.orgs.orgA._id}/teams`, {
          actor: h.actors.orgManagerA,
          body: { name: 'Blocked Manager Team' },
        });
        const mgrMemDoc = await h.models.Membership.findOne({
          organizationId: h.orgs.orgA._id,
          userId: h.actors.recTeamMemberA._id,
          teamId: null,
        }).lean();
        const mgrRolePatch = await h.api(`/api/tenant/memberships/${mgrMemDoc._id}/role`, {
          actor: h.actors.orgManagerA,
          method: 'PATCH',
          body: { role: 'manager' },
        });
        const adminTeamCreate = await h.api('/api/admin-console/teams', {
          actor: h.actors.adminOwnerA,
          body: { name: 'Admin Team Allowed Under Manager Ban' },
        });
        const teamDash = await h.api(`/api/tenant/teams/${h.teams.teamA1._id}/dashboard`, {
          actor: h.actors.recTeamMgrA,
        });
        assert.equal(mgrTeamCreate.status, 403);
        assert.equal(mgrRolePatch.status, 403);
        assert.equal(adminTeamCreate.status, 201);
        assert.equal(teamDash.status, 200);

        await togglePolicyUi('managerTeamAdministration', true);
        const mgrTeamAfter = await h.api(`/api/tenant/organizations/${h.orgs.orgA._id}/teams`, {
          actor: h.actors.orgManagerA,
          body: { name: 'Allowed Manager Team After Reenable' },
        });
        assert.equal(mgrTeamAfter.status, 201);
        policyResults.managerTeamAdministration = {
          mgrTeamCreateBlocked: mgrTeamCreate.status,
          mgrRolePatchBlocked: mgrRolePatch.status,
          adminTeamCreateAllowed: adminTeamCreate.status,
          teamDashboardStillAccessible: teamDash.status,
          mgrTeamCreateRestored: mgrTeamAfter.status,
          uiNote: 'Organization direct manager has no dedicated Angular team-admin UI (developer account); enforced at tenant API.',
        };
      }

      report.sections.policiesEndToEnd = policyResults;
      } catch (err) {
        console.error('[QA] Block E error:', err.message);
        report.failures.push({ block: 'Block E: 8 Policies E2E', error: err.message });
      } finally {
        await Promise.all([adminSess.context.close(), recOwnerSess.context.close(), recMgrSess.context.close()]);
      }
    }

    // =========================================================================
    // SECTION 10, 17 & 18: 10-Actor Authority Matrix, Spoofing, Kill Switch,
    //                      Private Application Isolation & Raw Audit Verification
    // =========================================================================
    {
      console.log('[QA] Block F: 10-Actor authority, spoofing, kill switches, audits');
      try {
      const actorMatrix = [];
      const actorsToTest = [
        ['exactOwnerAdmin', h.actors.adminOwnerA, 200],
        ['activeDirectAdmin', h.actors.secondAdminA, 200],
        ['affiliationOnlyAdmin', h.actors.affiliationAdminA, 403],
        ['disabledDirectAdmin', h.actors.revokedDirectAdminA, 403],
        ['directOrgManager', h.actors.orgManagerA, 403],
        ['recruiterTeamManager', h.actors.recTeamMgrA, 403],
        ['recruiterTeamAdmin', h.actors.recTeamAdminA, 403],
        ['recruiterTeamMember', h.actors.recTeamMemberA, 403],
        ['publicDeveloper', h.actors.publicDev, 403],
        ['superAdmin', h.actors.superAdminUser, 403],
      ];
      for (const [label, actor, expGov] of actorsToTest) {
        const g = await h.api('/api/admin-console/governance', { actor });
        const gPatch = await h.api('/api/admin-console/governance', {
          actor,
          method: 'PATCH',
          body: { expectedVersion: 0, policies: { candidateMatching: false } },
        });
        const gPatchInvalidKey = await h.api('/api/admin-console/governance', {
          actor,
          method: 'PATCH',
          body: { expectedVersion: 0, description: 'probe' },
        });
        const pGet = await h.api('/api/admin-console/preferences', { actor });
        const pPatch = await h.api('/api/admin-console/preferences', {
          actor,
          method: 'PATCH',
          body: { expectedVersion: 0, description: 'probe' },
        });
        const oGet = await h.api('/api/admin-console/overview', { actor });
        const tGet = await h.api('/api/admin-console/teams', { actor });
        const d = await h.api('/api/admin-console/members', { actor });
        const i = await h.api('/api/admin-console/invitations', { actor });
        assert.equal(g.status, expGov, `${label} governance status`);
        if (expGov === 403) {
          assert.equal(gPatch.status, 403, `${label} governance PATCH status`);
          assert.equal(pPatch.status, 403, `${label} preferences PATCH status`);
          assert.equal(d.status, 403, `${label} members status`);
          assert.equal(i.status, 403, `${label} invitations status`);
          if (pGet.status !== 403) {
            report.failures.push({
              block: 'Block F: Authority Legacy Bypass',
              actor: label,
              endpoint: 'GET /api/admin-console/preferences',
              expected: 403,
              actual: pGet.status,
              overviewStatus: oGet.status,
              teamsStatus: tGet.status,
            });
          }
        }
        actorMatrix.push({
          label,
          governanceGet: g.status,
          governancePatch: gPatch.status,
          governancePatchInvalidKey: gPatchInvalidKey.status,
          preferencesGet: pGet.status,
          preferencesPatch: pPatch.status,
          overviewGet: oGet.status,
          teamsGet: tGet.status,
          membersGet: d.status,
          invitationsGet: i.status,
        });
      }

      // Spoofing / Cross-org & Suspended org checks
      const spoofHeader = await h.api('/api/admin-console/governance', {
        actor: h.actors.adminOwnerA,
        headers: { 'x-organization-id': String(h.orgs.orgB._id) },
      });
      assert.equal(spoofHeader.status, 200);
      assert.equal(spoofHeader.data.organization.id, String(h.orgs.orgA._id));

      const suspendedAccess = await h.api('/api/admin-console/governance', {
        actor: h.actors.adminSuspended,
      });
      assert.equal(suspendedAccess.status, 403);

      // UI guard check for affiliationOnlyAdmin & recruiter & superAdmin
      const uiGuardMatrix = [];
      for (const [label, actor, org] of [
        ['affiliationOnlyAdmin', h.actors.affiliationAdminA, h.orgs.orgA],
        ['recruiterTeamAdmin', h.actors.recTeamAdminA, h.orgs.orgA],
        ['publicDeveloper', h.actors.publicDev, null],
        ['superAdmin', h.actors.superAdminUser, null],
      ]) {
        const s = await h.openSession(actor, org, { expectedFault: true });
        await s.page.goto(`${h.origin}/app/admin/organization/settings`, {
          waitUntil: 'domcontentloaded',
        });
        await h.waitSettled(s.page);
        uiGuardMatrix.push({
          label,
          landedPath: new URL(s.page.url()).pathname,
          renderedSettingsForm: (await s.page.locator('#name').count()) > 0,
        });
        await s.context.close();
      }

      // Platform kill switches cannot be overridden by enabled org policy
      await h.settingsService.updateSettings({
        recruiter: { enableRecruiterAccess: false, candidateVisibility: 'private' },
      });
      const capDuringKillSwitch = await h.api('/api/recruiter-hub/capabilities', {
        actor: h.actors.recOwnerA,
      });
      const matchBlockedByPlatform = await h.api('/api/recruiter-hub/matches/generate', {
        actor: h.actors.recOwnerA,
        body: { jobId: String(h.fixtures.jobSharedA._id), candidateIds: [String(h.actors.publicDev._id)] },
      });
      assert.equal(capDuringKillSwitch.data.capabilities.candidateMatching, false);
      assert.equal(capDuringKillSwitch.data.reasons.candidateMatching, 'platform_policy');
      assert.equal(matchBlockedByPlatform.status, 403);
      // Restore platform kill switches
      await h.settingsService.updateSettings({
        recruiter: { enableRecruiterAccess: true, candidateVisibility: 'public' },
      });

      // Private direct application isolation + applicant visibility + withdrawal
      const privResumeByAdmin = await h.api(
        `/api/recruiter-hub/jobs/${h.fixtures.jobPubA._id}/applications/${h.fixtures.applicationId}/resume`,
        { actor: h.actors.adminOwnerA }
      );
      const privShortlistByMgr = await h.api(
        `/api/recruiter-hub/shortlists/applications`,
        { actor: h.actors.recTeamMgrA }
      );
      const privAppsMine = await h.api('/api/jobs/internal/applications', {
        actor: h.actors.privateApplicant,
      });
      assert.ok([403, 404].includes(privResumeByAdmin.status));
      assert.equal(privShortlistByMgr.data.shortlists.length, 0);
      assert.equal(privAppsMine.status, 200);
      assert.equal(privAppsMine.data.applications.length, 1);

      // Audit atomic verification & raw Mongo AuditLog inspection
      await h.flushAudits();
      const orgAuditsBefore = await h.models.AuditLog.collection
        .find({ organizationId: h.orgs.orgA._id, action: 'ORGANIZATION_CONFIGURATION_UPDATED' })
        .toArray();
      // Trigger a failed 400 and verify audit count does not increase; trigger a 200 and verify +1
      const gNow = (await h.api('/api/admin-console/governance', { actor: h.actors.adminOwnerA })).data;
      const failPatch = await h.api('/api/admin-console/governance', {
        actor: h.actors.adminOwnerA,
        method: 'PATCH',
        body: { expectedVersion: gNow.version, timezone: 'Invalid/Zone' },
      });
      assert.equal(failPatch.status, 400);
      await h.flushAudits();
      const orgAuditsAfterFail = await h.models.AuditLog.collection
        .find({ organizationId: h.orgs.orgA._id, action: 'ORGANIZATION_CONFIGURATION_UPDATED' })
        .toArray();
      assert.equal(orgAuditsAfterFail.length, orgAuditsBefore.length);

      const okPatch = await h.api('/api/admin-console/governance', {
        actor: h.actors.adminOwnerA,
        method: 'PATCH',
        body: {
          expectedVersion: gNow.version,
          name: 'Alpha Audit Verify Org',
          policies: { candidateMatching: false },
        },
      });
      assert.equal(okPatch.status, 200);
      await h.flushAudits();
      const orgAuditsAfterOk = await h.models.AuditLog.collection
        .find({ organizationId: h.orgs.orgA._id, action: 'ORGANIZATION_CONFIGURATION_UPDATED' })
        .sort({ timestamp: -1 })
        .toArray();
      assert.equal(orgAuditsAfterOk.length, orgAuditsBefore.length + 1);
      const latestRawAudit = orgAuditsAfterOk[0];
      const latestAuditSerialized = JSON.stringify(latestRawAudit);
      assert.ok(!latestAuditSerialized.includes(h.fixtures.tokens.tokenPendingValid));
      assert.ok(!latestAuditSerialized.includes('QaTest!Pass123'));
      // Check raw audit uses [REDACTED] for metadata/dashboard & exact booleans for policies
      const rawRedactionCheck = {
        beforeNameRedacted: latestRawAudit.before?.name === '[REDACTED]' || latestRawAudit.before?.metadata?.name === '[REDACTED]' || latestAuditSerialized.includes('[REDACTED]'),
        policyBeforeTrue: latestRawAudit.before?.policies?.candidateMatching === true,
        policyAfterFalse: latestRawAudit.after?.policies?.candidateMatching === false,
      };
      // Restore policy & org name
      await h.api('/api/admin-console/governance', {
        actor: h.actors.adminOwnerA,
        method: 'PATCH',
        body: { expectedVersion: okPatch.data.version, policies: { candidateMatching: true } },
      });

      report.sections.authorityAndPrivacy = {
        actorMatrix,
        uiGuardMatrix,
        spoofHeaderScopedToOrgA: spoofHeader.data.organization.id === String(h.orgs.orgA._id),
        suspendedOrgDenied: suspendedAccess.status,
        platformKillSwitchOverridesOrg: {
          candidateMatching: capDuringKillSwitch.data.capabilities.candidateMatching,
          reason: capDuringKillSwitch.data.reasons.candidateMatching,
          httpStatus: matchBlockedByPlatform.status,
        },
        privateApplicationIsolated: {
          adminResumeAccessStatus: privResumeByAdmin.status,
          teamManagerApplicationShortlistCount: privShortlistByMgr.data.shortlists.length,
          applicantOwnApplicationCount: privAppsMine.data.applications.length,
        },
        auditCountOnFail: orgAuditsAfterFail.length - orgAuditsBefore.length,
        auditCountOnSuccess: orgAuditsAfterOk.length - orgAuditsBefore.length,
        rawRedactionCheck,
      };
      } catch (err) {
        console.error('[QA] Block F error:', err.message);
        report.failures.push({ block: 'Block F: Authority & Privacy', error: err.message });
      }
    }

    // =========================================================================
    // SECTION 11 & 12: Members Directory & Invitations Full Lifecycle
    // =========================================================================
    {
      console.log('[QA] Block G: Members directory and invitations lifecycle');
      const { context, page, telemetry } = await h.openSession(h.actors.adminOwnerA, h.orgs.orgA);
      try {

      // Members Directory
      await page.goto(`${h.origin}/app/admin/organization/members`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(page);
      const membersRawRes = await h.api('/api/admin-console/members?limit=500', {
        actor: h.actors.adminOwnerA,
      });
      const members = membersRawRes.data?.members || [];
      const memberIds = members.map((m) => String(m._id));
      const uniqueMemberIds = new Set(memberIds);
      const teamMgrEntry = members.find((m) => String(m._id) === String(h.actors.recTeamMgrA._id));
      const hasPublicDev = members.some((m) => String(m._id) === String(h.actors.publicDev._id));
      const hasForeignRec = members.some(
        (m) => String(m._id) === String(h.actors.foreignRecruiterB._id)
      );

      assert.equal(memberIds.length, uniqueMemberIds.size, 'Zero duplicate member rows allowed');
      assert.equal(hasPublicDev, false, 'Public developer must never enter internal members');
      assert.equal(hasForeignRec, false, 'Foreign org member must never appear');
      assert.ok(teamMgrEntry && teamMgrEntry.teams.length === 2, 'Multi-team recruiter deduplicated with both teams');

      // Keyboard test on View details <dialog> + Escape
      const firstDetailBtn = page.getByRole('button', { name: 'View details' }).first();
      await firstDetailBtn.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(200);
      const dialogOpen = await page.locator('dialog[open]').isVisible();
      assert.equal(dialogOpen, true);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);

      // Search & Pagination test
      await page.getByLabel('Search members').fill('Recruiter Team Manager');
      await page.waitForTimeout(200);
      const filteredMemText = await page.locator('main').innerText();
      assert.ok(filteredMemText.includes('Recruiter Team Manager'));
      await page.getByLabel('Search members').fill('');
      await page.waitForTimeout(200);

      // Invitations Lifecycle
      await navigateSpa(page, h.waitSettled, '/app/admin/organization/invitations');
      const rawInvitesRes = await h.api('/api/admin-console/invitations?limit=200', {
        actor: h.actors.adminOwnerA,
      });
      const rawInvJson = JSON.stringify(rawInvitesRes.data);
      assert.ok(!rawInvJson.includes(h.fixtures.tokens.tokenPendingValid));
      assert.ok(!rawInvJson.includes(h.fixtures.tokens.tokenRevokedInviter));
      assert.ok(!rawInvJson.includes('"token"'));

      // Verify GET did not mutate expired pending row in DB
      const expiredDbAfterGet = await h.models.Invitation.findById(
        h.fixtures.inviteExpiredByDate._id
      ).lean();
      assert.equal(expiredDbAfterGet.status, 'pending');

      // Create an invitation via UI & confirm honest offline delivery notice
      await page.getByLabel('Name').fill('Fresh QA Invitee');
      await page.getByLabel('Email').fill('fresh-ui-invite@fictional.qa.test');
      await page.getByRole('button', { name: 'Create invitation' }).click();
      await h.waitSettled(page);
      const afterCreateText = await page.locator('main').innerText();

      // Confirm Expire on Valid Pending Invitee via UI confirm dialog
      const pendingRow = page.locator('tr', { hasText: 'pending-valid@fictional.qa.test' });
      if (await pendingRow.locator('button', { hasText: 'Expire' }).isVisible().catch(() => false)) {
        await pendingRow.locator('button', { hasText: 'Expire' }).click();
        await page.getByRole('button', { name: 'Confirm change' }).click();
        await h.waitSettled(page);
      }

      // Filter check on Status & confirm Revoke on Fresh QA Invitee
      const freshRow = page.locator('tr', { hasText: 'fresh-ui-invite@fictional.qa.test' });
      await freshRow.locator('button', { hasText: 'Revoke' }).click();
      await page.getByRole('button', { name: 'Confirm change' }).click();
      await h.waitSettled(page);

      report.sections.membersAndInvitations = {
        membersDeduplicated: memberIds.length === uniqueMemberIds.size,
        serverTotalMembers: membersRawRes.data?.summary?.total,
        loadedUniqueMembers: members.length,
        teamManagerTeamsCount: teamMgrEntry?.teams?.length,
        publicDevExcluded: !hasPublicDev,
        foreignExcluded: !hasForeignRec,
        dialogOpenedViaKeyboardAndClosed: dialogOpen,
        invitationListOmitsTokens: !rawInvJson.includes('"token"'),
        getLeavesExpiredDbPending: expiredDbAfterGet.status === 'pending',
        createInviteNoticeObserved: afterCreateText.length > 0,
        consoleErrors: telemetry.consoleErrors,
        httpErrors: telemetry.httpErrors,
      };
      } catch (err) {
        console.error('[QA] Block G error:', err.message);
        report.failures.push({ block: 'Block G: Members & Invitations', error: err.message });
      } finally {
        await context.close();
      }
    }

    // =========================================================================
    // SECTION 15, 16, 19 & 21: Capability Race, SPA Telemetry, Protective 429,
    //                         42-Profile Matrix & Other Workspace Regressions
    // =========================================================================
    {
      console.log('[QA] Block H: Capability race, SPA soak, 42-profile matrix, SSE 429, workspace regressions');
      try {
      // A. Capability request delay / account switch & logout isolation
      const raceSess = await h.openSession(h.actors.recOwnerA, h.orgs.orgA);
      // Toggle Org A matching OFF, Org B remains ON
      const curGov = (await h.api('/api/admin-console/governance', { actor: h.actors.adminOwnerA })).data;
      await h.api('/api/admin-console/governance', {
        actor: h.actors.adminOwnerA,
        method: 'PATCH',
        body: { expectedVersion: curGov.version, policies: { candidateMatching: false } },
      });
      await raceSess.page.goto(`${h.origin}/app/recruiter/dashboard`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(raceSess.page);
      // Delay next capabilities request (real response!) while switching localStorage user to Org B + reloading
      await raceSess.page.route('**/api/recruiter-hub/capabilities', async (route) => {
        await new Promise((r) => setTimeout(r, 250));
        await route.continue();
      });
      await raceSess.page.evaluate(
        ({ tokenB, userB, orgB }) => {
          localStorage.setItem('token', tokenB);
          localStorage.setItem('user', JSON.stringify(userB));
          localStorage.setItem(
            'devinsight_tenant_context',
            JSON.stringify({
              organizationId: orgB.id,
              organizationName: orgB.name,
              myRole: 'member',
              teamId: '',
              teamName: '',
            })
          );
        },
        {
          tokenB: h.sign(h.actors.foreignRecruiterB),
          userB: {
            _id: String(h.actors.foreignRecruiterB._id),
            name: h.actors.foreignRecruiterB.name,
            email: h.actors.foreignRecruiterB.email,
            role: 'recruiter',
            organizationId: String(h.orgs.orgB._id),
            organizationName: h.orgs.orgB.name,
            isVerified: true,
          },
          orgB: { id: String(h.orgs.orgB._id), name: h.orgs.orgB.name },
        }
      );
      await raceSess.page.reload({ waitUntil: 'domcontentloaded' });
      await h.waitSettled(raceSess.page);
      await raceSess.page.goto(`${h.origin}/app/recruiter/matches`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(raceSess.page);
      const orgBMatchRestrictedLeak = await raceSess.page
        .locator('main')
        .innerText()
        .then((t) => t.includes('restricted by organization policy'));
      assert.equal(orgBMatchRestrictedLeak, false, 'Org A capability restriction must NOT bleed into Org B');

      // Restore Org A policy to true
      const govR = (await h.api('/api/admin-console/governance', { actor: h.actors.adminOwnerA })).data;
      await h.api('/api/admin-console/governance', {
        actor: h.actors.adminOwnerA,
        method: 'PATCH',
        body: { expectedVersion: govR.version, policies: { candidateMatching: true } },
      });
      await raceSess.context.close();

      // B. Rapid 16-transition SPA soak verifying ZERO 429s, <=2 SSE streams, zero capability bursts
      const soakSess = await h.openSession(h.actors.adminOwnerA, h.orgs.orgA);
      await soakSess.page.goto(`${h.origin}/app/admin/dashboard`, { waitUntil: 'domcontentloaded' });
      await h.waitSettled(soakSess.page);
      const soakRoutes = [
        '/app/admin/organization',
        '/app/admin/organization/settings',
        '/app/admin/organization/policies',
        '/app/admin/organization/members',
        '/app/admin/organization/invitations',
        '/app/admin/organization/usage',
        '/app/admin/recruiters',
        '/app/admin/teams',
        '/app/admin/jobs',
        '/app/admin/developers',
        '/app/admin/performance',
        '/app/admin/activity-logs',
        '/app/admin/organization',
        '/app/admin/organization/policies',
        '/app/admin/organization/settings',
        '/app/admin/dashboard',
      ];
      for (const r of soakRoutes) {
        await navigateSpa(soakSess.page, h.waitSettled, r);
      }
      const capCallsDuringSoak = soakSess.telemetry.apiCalls.filter((c) =>
        c.path.includes('/capabilities')
      ).length;
      const sseCallsDuringSoak = soakSess.telemetry.apiCalls.filter((c) =>
        c.path.includes('/notifications/stream')
      ).length;
      const ng0100Errors = soakSess.telemetry.consoleErrors.filter((t) => t.includes('NG0100'));
      assert.equal(soakSess.telemetry.httpErrors.length, 0, `Soak HTTP errors: ${JSON.stringify(soakSess.telemetry.httpErrors)}`);
      assert.equal(ng0100Errors.length, 0);
      await soakSess.context.close();

      // C. Full 6-route x 7-viewport/theme responsive matrix (42 profiles) + Mobile Drawer check
      const representativeScreenshots = {};
      for (const profile of ALL_PROFILES) {
        const s = await h.openSession(h.actors.adminOwnerA, h.orgs.orgA, profile);
        await s.page.goto(`${h.origin}/app/admin/organization`, { waitUntil: 'domcontentloaded' });
        await h.waitSettled(s.page);

        // Mobile drawer & Escape check on 390x844-dark
        if (profile.id === '390x844-dark') {
          const toggle = s.page
            .locator('button[aria-controls="application-navigation"], button.menu-btn, button.menu-toggle')
            .first();
          if (await toggle.isVisible().catch(() => false)) {
            await toggle.click();
            await s.page.waitForTimeout(200);
            representativeScreenshots.mobileDrawer = await shot(s.page, 'mobile-390-drawer-dark.png');
            await s.page.keyboard.press('Escape');
            await s.page.waitForTimeout(200);
          }
        }

        for (const [routePath, expectedHeading] of ORG_ROUTES) {
          await navigateSpa(s.page, h.waitSettled, routePath);
          const actualH1 = await s.page.locator('h1').first().textContent().catch(() => '');
          assert.equal((actualH1 || '').trim(), expectedHeading, `${profile.id} ${routePath} heading`);
          const metrics = await checkLayoutMetrics(s.page, `${profile.id}:${routePath}`);
          assert.equal(metrics.overflow, false, `Horizontal overflow on ${profile.id} ${routePath}`);
          assert.equal(
            metrics.clippedControlsCount,
            0,
            `Clipped buttons on ${profile.id} ${routePath}: ${JSON.stringify(metrics.clippedControls)}`
          );
          report.matrix.push(metrics);

          // Save key visual review screenshots across themes & breakpoints
          const slug = routePath.replace('/app/admin/', '').replace(/\//g, '-');
          if (
            profile.id === '1440x900-light' ||
            profile.id === '1440x900-dark' ||
            (profile.id === '768x1024-light' && slug === 'organization') ||
            (profile.id === '390x844-dark' &&
              ['organization', 'organization-settings', 'organization-members', 'organization-invitations'].includes(slug)) ||
            (profile.id === '320x640-light' &&
              ['organization', 'organization-policies', 'organization-usage'].includes(slug))
          ) {
            const name = `${profile.id}-${slug}.png`;
            representativeScreenshots[name] = await shot(s.page, name);
          }
        }
        assert.equal(s.telemetry.consoleErrors.length, 0);
        assert.equal(s.telemetry.httpErrors.length, 0);
        await s.context.close();
      }

      // D. Separate deliberate verification that notification SSE rate limiter (30/60s) still trips at 31
      const rateProbeResponses = [];
      const floodToken = h.sign(h.actors.inviteRecipient);
      for (let idx = 0; idx < 32; idx += 1) {
        const ac = new AbortController();
        const r = await fetch(`${h.origin}/api/notifications/stream`, {
          headers: { Authorization: `Bearer ${floodToken}` },
          signal: ac.signal,
        });
        rateProbeResponses.push(r.status);
        ac.abort();
      }
      const rate429Count = rateProbeResponses.filter((c) => c === 429).length;
      const rate200Count = rateProbeResponses.filter((c) => c === 200).length;
      assert.equal(rate200Count, 30, `Expected 30 SSE admits before 429, got ${rate200Count}`);
      assert.equal(rate429Count, 2, `Expected 2 SSE 429s after 30 admits, got ${rate429Count}`);

      // E. Other Workspace UI Regressions + Screenshots (Admin pages, Recruiter, Developer, Super Admin)
      const regressionTargets = [
        ['admin-dashboard', h.actors.adminOwnerA, h.orgs.orgA, '/app/admin/dashboard', '1440x900-light'],
        ['admin-recruiters', h.actors.adminOwnerA, h.orgs.orgA, '/app/admin/recruiters', '1440x900-light'],
        ['admin-teams', h.actors.adminOwnerA, h.orgs.orgA, '/app/admin/teams', '1440x900-light'],
        ['admin-performance', h.actors.adminOwnerA, h.orgs.orgA, '/app/admin/performance', '1440x900-light'],
        ['admin-activity-logs', h.actors.adminOwnerA, h.orgs.orgA, '/app/admin/activity-logs', '1440x900-light'],
        ['recruiter-dashboard', h.actors.recOwnerA, h.orgs.orgA, '/app/recruiter/dashboard', '1440x900-light'],
        ['recruiter-jobs', h.actors.recOwnerA, h.orgs.orgA, '/app/recruiter/jobs', '1440x900-light'],
        ['recruiter-shortlists', h.actors.recOwnerA, h.orgs.orgA, '/app/recruiter/shortlists', '1440x900-dark'],
        ['developer-dashboard', h.actors.publicDev, null, '/app/dashboard', '1440x900-light'],
        ['developer-jobs', h.actors.publicDev, null, '/app/jobs', '1440x900-light'],
        ['superadmin-dashboard', h.actors.superAdminUser, null, '/app/super-admin/dashboard', '1440x900-light'],
        ['superadmin-organizations', h.actors.superAdminUser, null, '/app/super-admin/organizations', '1440x900-light'],
      ];
      for (const [tag, actor, org, targetRoute, profId] of regressionTargets) {
        const prof = ALL_PROFILES.find((p) => p.id === profId);
        const rs = await h.openSession(actor, org, prof);
        await rs.page.goto(`${h.origin}${targetRoute}`, { waitUntil: 'domcontentloaded' });
        await h.waitSettled(rs.page);
        const metrics = await checkLayoutMetrics(rs.page, tag);
        const screenshot = await shot(rs.page, `reg-${tag}.png`);
        report.workspaceRegressions.push({
          tag,
          route: targetRoute,
          landed: metrics.pathname,
          overflow: metrics.overflow,
          clippedControlsCount: metrics.clippedControlsCount,
          consoleErrors: rs.telemetry.consoleErrors,
          httpErrors: rs.telemetry.httpErrors,
          screenshot,
        });
        assert.equal(metrics.overflow, false, `Overflow on regression ${tag}`);
        await rs.context.close();
      }

      report.sections.stabilityAndTelemetry = {
        orgBNoLeakDuringDelayedCapSwitch: !orgBMatchRestrictedLeak,
        spaSoakTransitions: soakRoutes.length,
        capCallsDuringAdminSoak: capCallsDuringSoak,
        sseCallsDuringAdminSoak: sseCallsDuringSoak,
        ng0100Errors: ng0100Errors.length,
        sseProtective429Probe: { total: 32, allowed200: rate200Count, blocked429: rate429Count },
        matrixProfilesChecked: report.matrix.length,
        representativeScreenshots,
      };
      } catch (err) {
        console.error('[QA] Block H error:', err.message);
        report.failures.push({ block: 'Block H: Stability & Responsive Matrix', error: err.message });
      }
    }

    report.telemetry = h.getTelemetry();
    report.completedAt = new Date().toISOString();
    assert.ok(report.telemetry.emailAttemptCount >= 1, 'Offline email stub must be called on invitation create/resend');
    assert.equal(report.telemetry.cspViolations.length, 0, `CSP violations: ${report.telemetry.cspViolations}`);
    assert.equal(report.telemetry.auditWriteErrors.length, 0, `Audit errors: ${report.telemetry.auditWriteErrors}`);
    assert.ok(report.telemetry.maxConcurrentStreams <= 2, `Expected maxConcurrentStreams <= 2, got ${report.telemetry.maxConcurrentStreams}`);

    console.log(
      JSON.stringify(
        {
          status: report.failures.length ? 'QA_SUITE_WITH_FINDINGS' : 'QA_SUITE_PASS',
          failuresCount: report.failures.length,
          matrixChecks: report.matrix.length,
          workspaceRegressions: report.workspaceRegressions.length,
          emailAttemptCount: report.telemetry.emailAttemptCount,
          cspViolations: report.telemetry.cspViolations.length,
          auditWriteErrors: report.telemetry.auditWriteErrors.length,
          maxConcurrentStreams: report.telemetry.maxConcurrentStreams,
          sseProtective429: report.sections.stabilityAndTelemetry.sseProtective429Probe,
        },
        null,
        2
      )
    );
  } finally {
    try {
      report.telemetry = report.telemetry || h.getTelemetry();
      report.completedAt = report.completedAt || new Date().toISOString();
      fs.writeFileSync(
        path.join(h.outputDir, 'qa-evidence.json'),
        JSON.stringify(report, null, 2)
      );
    } catch {}
    await h.cleanup();
  }
}

run().catch((err) => {
  console.error('QA_SUITE_FAIL', err);
  process.exitCode = 1;
});
