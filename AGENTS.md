# Project instructions

These instructions apply to every coding task in this repository. Include finalization
in the task plan and complete it after implementation and testing, before reporting
completion. Read and follow these rules when running project commands. A passing test
suite alone does not mean the task is complete.

## Mandatory finalization: formatting, file organization and cleanup

1. Follow existing modular folder conventions. Keep components, templates, styles,
   services, models, utilities and tests in appropriate locations.
2. Format every changed source file using the repository's configured formatter.
   Never leave compressed or poorly structured single-line implementations.
3. Run the formatter in write mode, then confirm all changed files pass the
   formatting check.
4. Remove unused imports, abandoned debugging code, duplicate temporary files and
   unnecessary generated artifacts within the task's scope.
5. Delete obsolete screenshots, Playwright traces, temporary scripts and redundant
   reports created during the task only after checking they are not required or
   referenced. Verify ownership before deleting any file.
6. Preserve essential final screenshots, verification evidence, tests, fixtures,
   documentation, source assets, licenses and historical records.
7. Never delete unrelated or untracked user work. Untracked status does not establish
   that a file is disposable. Do not use destructive Git cleanup or reset commands.
8. Avoid repository-wide formatting and unrelated refactoring.
9. Re-run relevant tests, typechecks, builds, formatting checks and Git whitespace
   validation after cleanup.
10. Verify moved or deleted files have no broken references and no working
    functionality has changed.
11. Report exact changed, moved and deleted files, formatting results, test results
    and remaining issues. For a long inventory, link a retained report with exact
    paths and summarize results in the final response.

Completion requires clean, readable, modular, properly formatted code and a
repository free of unnecessary task-generated artifacts, not merely passing tests.

## Repository tooling and scope

- Inspect `git status --short` before editing to distinguish existing user work from
  task-owned changes. Preserve existing changes and record task-owned artifacts.
- Use the installed Prettier executable at
  `frontend/node_modules/prettier/bin/prettier.cjs`. Pass explicit changed file paths
  to `--write`, then the same paths to `--check`; do not format the whole repository.
- Frontend formatting uses `frontend/.prettierrc`, including the Angular HTML parser.
  Backend has no formatter configuration: retain established per-file conventions
  and use the same options for write and check. Do not reformat assets or licenses.
- Frontend validation: run `npm test -- --watch=false` and `npm run build` from
  `frontend` when relevant, and run its installed TypeScript compiler with
  `--noEmit -p frontend/tsconfig.app.json` from the repository root.
- Backend validation: run relevant `node --test` suites under `backend/src/tests`.
  Check changed backend JavaScript with `node --check` when applicable. Report
  integration prerequisites or skipped tests accurately.
- Run `git diff --check` after final edits. Check staged changes with
  `git diff --cached --check` if applicable.
- Keep reusable verification scripts in the existing script folders and essential
  evidence in the existing verification folders. Remove task-owned temporary logs
  only after retaining their relevant results.
- These are instructions for coding agents, not shell hooks. Do not attach cleanup
  to every shell command or silently delete artifacts during ordinary commands.
