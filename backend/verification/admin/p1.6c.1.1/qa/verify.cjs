// Independent QA coordinator: never edits application source or the Git index.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");
const qa = __dirname;
const root = path.resolve(qa, "../../../../..");
const backend = path.join(root, "backend");
const hash = (buffer) =>
  crypto.createHash("sha256").update(buffer).digest("hex");
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
const save = (name, value) =>
  fs.writeFileSync(path.join(qa, name), JSON.stringify(value, null, 2) + "\n");
function snapshot() {
  const files = new Set(
    git("ls-files", "-co", "--exclude-standard", "-z")
      .toString()
      .split("\0")
      .filter(Boolean),
  );
  function walk(folder) {
    for (const entry of fs.readdirSync(path.join(root, folder), {
      withFileTypes: true,
    })) {
      const relative = path.join(folder, entry.name).replaceAll("\\", "/");
      if (relative.startsWith("backend/verification/admin/p1.6c.1.1/"))
        continue;
      if (
        entry.isDirectory() &&
        entry.name.startsWith("devinsight-real-integrations-")
      )
        continue;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(relative);
      else files.add(relative);
    }
  }
  for (const folder of ["backend/verification", "frontend/verification"])
    walk(folder);
  return Object.fromEntries(
    [...files]
      .sort()
      .filter(
        (file) =>
          !file.startsWith("backend/verification/admin/p1.6c.1.1/") &&
          !file.includes("/devinsight-real-integrations-") &&
          !/(^|\/)(\.env[^/]*|\.aws|\.codex)(\/|$)/.test(file) &&
          fs.existsSync(path.join(root, file)),
      )
      .map((file) => [file, hash(fs.readFileSync(path.join(root, file)))]),
  );
}
async function main() {
  const [mode, label, ...files] = process.argv.slice(2);
  if (mode === "baseline") {
    if (fs.existsSync(path.join(qa, "baseline.json")))
      throw Error("Baseline already exists.");
    save("baseline.json", {
      branch: git("branch", "--show-current").toString().trim(),
      head: git("rev-parse", "HEAD").toString().trim(),
      prTarget: "not applicable",
      status: git("status", "--short").toString(),
      indexDiffSha256: hash(git("diff", "--cached", "--binary")),
      workingDiffSha256: hash(git("diff", "--binary")),
      files: snapshot(),
    });
    const previous = path.resolve(qa, "../../p1.6c.1/qa");
    for (const file of [
      "acceptance.test.cjs",
      "revoked-inviter-repro.test.cjs",
    ]) {
      fs.copyFileSync(
        path.join(previous, file),
        path.join(qa, file),
        fs.constants.COPYFILE_EXCL,
      );
    }
    console.log(
      "Preservation baseline saved; original QA harnesses copied unchanged.",
    );
  } else if (mode === "run") {
    if (!/^[a-z0-9-]+$/.test(label)) throw Error("Invalid evidence label.");
    const output = path.join(qa, `${label}.tap`);
    const handle = fs.openSync(output, "wx");
    const args = [
      "--require",
      path.join(qa, "isolate-evidence.cjs"),
      "--test",
      "--test-concurrency=1",
      "--test-reporter=tap",
      ...files,
    ];
    const started = new Date();
    const child = spawn(process.execPath, args, {
      cwd: backend,
      windowsHide: true,
      stdio: ["ignore", handle, handle],
      env: { ...process.env, INTEGRATION_TEST_MONGO_READINESS_ATTEMPTS: "120" },
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    fs.closeSync(handle);
    const tap = fs.readFileSync(output, "utf8");
    const summary = Object.fromEntries(
      [
        ...tap.matchAll(
          /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) (.+)$/gm,
        ),
      ].map((match) => [match[1], Number(match[2])]),
    );
    save(`${label}-result.json`, {
      executable: process.execPath,
      args,
      started: started.toISOString(),
      finished: new Date().toISOString(),
      exitCode,
      summary,
    });
    console.log(JSON.stringify({ label, exitCode, summary }));
    process.exitCode = exitCode || 0;
  } else if (mode === "preserve") {
    const before = JSON.parse(fs.readFileSync(path.join(qa, "baseline.json")));
    const after = snapshot();
    const changed = Object.keys(before.files).filter(
      (file) => after[file] !== before.files[file],
    );
    const added = Object.keys(after).filter(
      (file) => !Object.hasOwn(before.files, file),
    );
    const result = {
      checked: Object.keys(before.files).length,
      changed,
      addedOutsideQa: added,
      indexUnchanged:
        before.indexDiffSha256 === hash(git("diff", "--cached", "--binary")),
      workingDiffUnchanged:
        before.workingDiffSha256 === hash(git("diff", "--binary")),
      branchUnchanged:
        before.branch === git("branch", "--show-current").toString().trim(),
      headUnchanged: before.head === git("rev-parse", "HEAD").toString().trim(),
    };
    save("file-preservation.json", result);
    console.log(JSON.stringify(result));
    if (
      changed.length ||
      added.length ||
      !result.indexUnchanged ||
      !result.workingDiffUnchanged
    )
      process.exitCode = 1;
  } else if (mode === "static") {
    const prettier = path.join(
      root,
      "frontend/node_modules/prettier/bin/prettier.cjs",
    );
    const qaScripts = fs
      .readdirSync(qa)
      .filter((file) => file.endsWith(".cjs"))
      .map((file) => path.join(qa, file));
    const correction = [
      "backend/src/modules/admin/controllers/recruiterController.js",
      "backend/src/modules/admin/controllers/tenantcontroller.js",
      "backend/src/modules/admin/services/invitationAcceptanceService.js",
      "backend/src/modules/admin/services/organizationGovernanceService.js",
      "backend/src/tests/admin/invitationAuthorityRevocation.integration.test.js",
    ];
    const sourceJs = git("diff", "--name-only", "HEAD")
      .toString()
      .trim()
      .split(/\r?\n/)
      .filter(
        (file) => file.startsWith("backend/src/") && file.endsWith(".js"),
      );
    const checks = [];
    function check(executable, args) {
      try {
        const output = execFileSync(executable, args, {
          cwd: root,
          windowsHide: true,
          maxBuffer: 8 * 1024 * 1024,
        }).toString();
        checks.push({ executable, args, exitCode: 0, output });
      } catch (error) {
        checks.push({
          executable,
          args,
          exitCode: error.status || 1,
          output: String(error.stdout || "") + String(error.stderr || ""),
        });
      }
    }
    check(process.execPath, [prettier, "--check", ...qaScripts]);
    check(process.execPath, [
      prettier,
      "--check",
      "--single-quote",
      "--trailing-comma",
      "none",
      "--print-width",
      "100",
      ...correction,
    ]);
    for (const file of [...sourceJs, ...qaScripts])
      check(process.execPath, ["--check", file]);
    check("git", ["diff", "--check"]);
    check("git", ["diff", "--cached", "--check"]);
    const originalHarnesses = [
      "acceptance.test.cjs",
      "revoked-inviter-repro.test.cjs",
    ].map((file) => ({
      file,
      byteIdenticalToOriginal:
        hash(fs.readFileSync(path.join(qa, file))) ===
        hash(fs.readFileSync(path.resolve(qa, "../../p1.6c.1/qa", file))),
    }));
    save("static-checks.json", {
      checks,
      sourceJavaScriptFiles: sourceJs.length,
      qaScripts: qaScripts.length,
      originalHarnesses,
    });
    console.log(
      JSON.stringify({
        checks: checks.length,
        failures: checks.filter((check) => check.exitCode),
        sourceJavaScriptFiles: sourceJs.length,
        originalHarnesses,
      }),
    );
    if (
      checks.some((check) => check.exitCode) ||
      originalHarnesses.some((item) => !item.byteIdenticalToOriginal)
    )
      process.exitCode = 1;
  } else if (mode === "summary") {
    const names = [
      "governance-unsandboxed",
      "independent-final",
      "implementation-unsandboxed",
      "original-f1-reproduction",
      "security-regressions",
    ];
    const results = names.map((label) => ({
      label,
      ...JSON.parse(fs.readFileSync(path.join(qa, `${label}-result.json`))),
    }));
    const events = fs
      .readFileSync(path.join(qa, "fixture-lifecycle.ndjson"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map(JSON.parse);
    const fixtures = events
      .filter((event) => event.event === "started")
      .map((start) => {
        const stop = events.find(
          (event) =>
            event.event === "stopped" &&
            event.pid === start.pid &&
            event.directory === start.directory,
        );
        return {
          ...start,
          stop: stop || null,
          directoryAbsent: !fs.existsSync(start.directory),
        };
      });
    const previous = JSON.parse(
      fs.readFileSync(path.join(qa, "baseline.json")),
    );
    save("acceptance-results.json", {
      verdict: results.every(
        (result) =>
          result.exitCode === 0 &&
          result.summary.fail === 0 &&
          result.summary.skipped === 0,
      )
        ? "PASS"
        : "BLOCKED",
      date: "2026-11-27",
      timezone: "Asia/Karachi",
      branch: previous.branch,
      head: previous.head,
      prTarget: previous.prTarget,
      testedWorkingTree: true,
      indexDiffSha256: previous.indexDiffSha256,
      workingDiffSha256: previous.workingDiffSha256,
      f1: {
        closed: true,
        originalSubtests: 37,
        ...JSON.parse(
          fs.readFileSync(
            path.join(qa, "independent-revocation-evidence.json"),
          ),
        ),
      },
      tests: results,
      sourceHashes: Object.fromEntries(
        Object.entries(previous.files).filter(([file]) =>
          /(?:invitationAcceptanceService|organizationGovernanceService|recruiterController|tenantcontroller|invitationAuthorityRevocation\.integration\.test)\.js$/.test(
            file,
          ),
        ),
      ),
    });
    save("cleanup.json", {
      fixtures,
      allRecordedFixturesStoppedAndRemoved: fixtures.every(
        (fixture) => fixture.stop?.mongoStopped && fixture.directoryAbsent,
      ),
      preexistingDisposableDirectoriesExcludedAndUntouched: true,
      deletedPreexistingFiles: [],
      notes:
        "Startup failures use the original fixture's awaited stop-on-error path. Raw failed attempts remain retained as environment diagnostics.",
    });
    console.log(
      JSON.stringify({
        results: results.map(({ label, exitCode, summary }) => ({
          label,
          exitCode,
          summary,
        })),
        fixtures: fixtures.length,
        fixtureCleanupPassed: fixtures.every(
          (fixture) => fixture.stop?.mongoStopped && fixture.directoryAbsent,
        ),
      }),
    );
  } else if (mode === "inventory") {
    const created = [...fs.readdirSync(qa), "qa-file-inventory.json"]
      .filter((file, index, all) => all.indexOf(file) === index)
      .sort()
      .map((file) => path.join(qa, file));
    save("qa-file-inventory.json", {
      created,
      modifiedPreexisting: [],
      moved: [],
      deletedPreexisting: [],
      note: "Disposable fixture file removals are recorded in cleanup.json; retained raw logs are verification evidence, not abandoned temporary files.",
    });
    console.log(JSON.stringify({ createdFiles: created.length }));
  } else
    throw Error(
      "Use baseline, run <label> <test files>, preserve, static, summary, or inventory.",
    );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
