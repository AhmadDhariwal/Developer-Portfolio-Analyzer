# Documentation Verification

Run this before merging documentation or feature-flow changes:

```powershell
node docs\verify-docs.js
```

The verifier checks:
- Markdown links inside `docs/` and root `README.md`
- Feature docs linked from `docs/PROJECT_INDEX.md`
- Required sections in every `docs/features/*.md`
- Required agent docs and documentation policy files

This is intentionally lightweight and dependency-free. It does not prove that every statement matches code; agents should still inspect the referenced implementation files for behavioral changes.
