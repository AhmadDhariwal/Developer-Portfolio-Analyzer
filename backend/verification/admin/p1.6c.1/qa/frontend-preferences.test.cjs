// Execute the actual TypeScript method bodies; only framework lifecycle/view
// dependencies are replaced. Existing frontend files are read, never rewritten.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const frontend = path.resolve(__dirname, "../../../../../frontend");
const ts = require(path.join(frontend, "node_modules/typescript"));
const { Subject } = require(path.join(frontend, "node_modules/rxjs"));
function actualMethods(relative, names, context = {}) {
  const text = fs.readFileSync(path.join(frontend, relative), "utf8");
  const source = ts.createSourceFile(
    "actual.ts",
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(ts.isClassDeclaration);
  return Object.fromEntries(
    names.map((name) => {
      const method = declaration.members.find(
        (node) => node.name?.getText(source) === name,
      );
      assert.ok(method, `Actual method ${name} exists`);
      const fn = ts.factory.createFunctionDeclaration(
        undefined,
        undefined,
        name,
        method.typeParameters,
        method.parameters,
        method.type,
        method.body,
      );
      const printed = ts
        .createPrinter()
        .printNode(ts.EmitHint.Unspecified, fn, source);
      const javascript = ts.transpileModule(printed, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      return [name, vm.runInNewContext(`(${javascript})`, { ...context })];
    }),
  );
}
function preferencesFixture() {
  const calls = [];
  const source = new Subject();
  const methods = actualMethods(
    "src/app/features/admin/pages/admin-console/admin-console.component.ts",
    [
      "savePreferences",
      "runMutation",
      "syncLoading",
      "dismissMessages",
      "invalidateTabs",
    ],
    { takeUntilDestroyed: () => (observable) => observable },
  );
  const context = {
    ...methods,
    prefForm: {
      name: "QA changed name",
      description: "",
      preferredDateRangeDays: 30,
      defaultTeamId: "",
      showKpiCards: true,
      showTeamAnalytics: true,
      showRecruiterPerformance: true,
      showJobTrends: true,
      showActivityFeed: true,
    },
    preferences: { organization: { _id: "qa-org", governanceVersion: 7 } },
    allowedDateRanges: [7, 14, 30, 60, 90],
    teamOptions: [],
    tabStates: Object.fromEntries(
      ["overview", "teams", "recruiters", "invitations", "preferences"].map(
        (name) => [name, { loaded: true, loading: false, error: "" }],
      ),
    ),
    mutationCount: 0,
    teamOptionsLoading: false,
    cdr: { detectChanges() {}, markForCheck() {} },
    consoleService: {
      updatePreferences(payload) {
        calls.push(payload);
        return source;
      },
    },
    tenantContext: { syncOrganization() {} },
  };
  return { context, source, calls };
}
test("actual preference methods forward loaded version, preserve stale edits and never auto-retry a 409", () => {
  const { context, source, calls } = preferencesFixture();
  context.savePreferences();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedVersion, 7);
  assert.equal(context.loading, true);
  source.error({
    status: 409,
    error: {
      message:
        "Organization configuration changed. Refresh and review before retrying.",
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(context.preferences.organization.governanceVersion, 7);
  assert.equal(context.prefForm.name, "QA changed name");
  assert.match(context.error, /Refresh and review/);
  assert.equal(context.loading, false);
  assert.equal(context.mutationCount, 0);
});
test("actual preference success uses the committed response version and settles loading", () => {
  const { context, source, calls } = preferencesFixture();
  context.savePreferences();
  source.next({
    message: "Organization preferences updated.",
    organization: {
      _id: "qa-org",
      name: "Committed QA name",
      description: "",
      governanceVersion: 8,
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(context.preferences.organization.governanceVersion, 8);
  assert.equal(context.prefForm.name, "Committed QA name");
  assert.equal(context.loading, false);
  assert.equal(context.tabStates.preferences.loaded, true);
});
test("actual governance client forwards false flags/version and chooses scoped capability routes", () => {
  const calls = [];
  const methods = actualMethods(
    "src/app/shared/services/organization-governance.service.ts",
    [
      "getGovernance",
      "updateGovernance",
      "getCapabilities",
      "getMembers",
      "getInvitations",
    ],
    { environment: { apiBaseUrl: "/api" } },
  );
  const client = {
    ...methods,
    base: "/api/admin-console",
    http: {
      get(...args) {
        calls.push(["GET", ...args]);
      },
      patch(...args) {
        calls.push(["PATCH", ...args]);
      },
    },
  };
  const patch = { expectedVersion: 4, policies: { candidateMatching: false } };
  client.updateGovernance(patch);
  client.getCapabilities("admin");
  client.getCapabilities("recruiter");
  client.getInvitations("revoked");
  assert.equal(calls[0][1], "/api/admin-console/governance");
  assert.equal(calls[0][2], patch);
  assert.equal(calls[0][2].policies.candidateMatching, false);
  assert.equal(calls[1][1], "/api/admin-console/capabilities");
  assert.equal(calls[2][1], "/api/recruiter-hub/capabilities");
  assert.equal(calls[3][2].params.status, "revoked");
});
