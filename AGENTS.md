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
4. Remove unused imports and abandoned debugging code within the task's scope.
   File deletion is limited to verified task-owned temporary files under rule 5.
5. Delete duplicate or obsolete screenshots, Playwright traces, temporary scripts,
   logs, reports and generated artifacts only when verified to be temporary files
   created by the current task and no longer required or referenced. Verify each
   exact path and ownership before deletion; do not delete directories recursively.
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
repository free of verified task-owned temporary files that are no longer needed,
not merely passing tests.

## Repository tooling and scope

- Before editing, verify the requested source branch, target branch, current branch
  (`git branch --show-current`) and working-tree/index status (`git status --short`).
  Verify required branch refs exist and the checkout matches the authorized source;
  do not infer a PR target from the default branch. If a required source or target
  is unspecified or mismatched, confirm it with the user before editing. For tasks
  with no PR or branch integration, record the target as not applicable.
- Use that status to distinguish existing user work from task-owned changes.
  Preserve existing changes and record task-owned artifacts.
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

## Cloud Agent Safety & Git Workflow

### Before Every Task

- Read applicable `AGENTS.md` instructions.
- Complete the Git preflight above and inspect the architecture and relevant code.
- Make a focused plan including mandatory finalization before implementation.
- Avoid unrelated modifications or breaking changes.
- Never change APIs, dependencies, or schemas without approval.

### Branch & Pull Request Rules

- Never work directly on `main`, `develop`, or other protected branches.
- For code changes, use a new `feature/` or `fix/` branch unless the user explicitly
  requests an existing branch or different name. Create or switch branches only
  when authorized, using the verified source branch and PR target.
- Never overwrite, reset, or force-push existing work.
- Commit and push only when authorized for the task.
- Prepare a draft PR when requested and permitted.
- Never merge or squash-merge without explicit user approval. Squashing or rebasing
  into `main`, `develop`, or any other protected branch also requires explicit user
  approval. Preparing or approving code or a PR does not authorize these operations.
- Never enable auto-merge or delete branches without explicit user approval.

### Security & Production

- Never expose, log, or hardcode credentials or secrets.
- Never modify production configuration or deploy without explicit user approval.
- Never run destructive database or filesystem operations. The sole filesystem
  cleanup exception is verified task-owned temporary file deletion under mandatory
  finalization rule 5; it does not permit deleting user work, essential evidence or
  historical records, recursive directory deletion, or destructive Git cleanup.
- Preserve existing authentication, permissions, and data integrity.
- Ask before risky or irreversible actions.

### Completion & Control

- Complete mandatory finalization above and verify that changes remain within the
  approved task scope. Include PR details in the final report when applicable.
- Never claim incomplete or unverified work is complete.
- Stop after the authorized task; do not start additional work.
