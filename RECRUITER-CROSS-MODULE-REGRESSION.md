# Recruiter cross-module regression

- Developer candidate discovery remains controlled by explicit User visibility. The recruiter API checks current consent on candidate reads and suppresses previously generated match details after withdrawal. Public portfolio drafts are excluded from Recruiter evidence.
- GitHub analysis remains a read-side source. The ranking breakdown preserves an unavailable GitHub score separately from a measured zero. More comprehensive unavailable-evidence handling for legacy resume and readiness projections remains open.
- Recruiter Job CRUD shares the database model across Recruiter and Admin. The Developer Jobs Hub still uses its existing independent job providers. No Developer job application workflow was added.
- Invitations preserve public acceptance and add the assigned team membership in the same transaction as the account. The shared notification route remains available. Per-event recruiter notifications and email retry expansion remain open.
- Admin reporting reads canonical recruiter audit events. Super Admin recruiter analytics counts canonical match records and analysis events instead of unrelated developer recommendations.
- Angular authentication checks protected child navigation. Recruiter sidebar and quick search point to available workspace pages. The browser summary service does not retain prior account responses.

See the final acceptance report for executed suites and remaining integration prerequisites.
