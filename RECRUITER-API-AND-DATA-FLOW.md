# Recruiter API and data flow

Both route families retain their existing methods and paths. Authenticated requests resolve organization context on the server. Controller responses keep their existing envelopes. Corrected evidence fields can represent unavailable values with null.

| Hub path under /api/recruiter-hub | Methods            | Canonical records                                                           |
| --------------------------------- | ------------------ | --------------------------------------------------------------------------- |
| /analytics/dashboard              | GET                | Jobs, matches, shortlists, audit events, visible candidates and memberships |
| /analytics                        | GET                | Same aggregation sources as dashboard                                       |
| /activity                         | GET                | Audit events and batched visible resources                                  |
| /candidates                       | GET                | Consenting User records and evidence                                        |
| /candidates/:id                   | GET                | Candidate profile and view event                                            |
| /candidates/:id/analyze           | POST               | Visible candidate and analysis event                                        |
| /jobs                             | GET, POST          | Owned Jobs                                                                  |
| /jobs/:id                         | GET, PATCH, DELETE | Owned Job and transactional pipeline cleanup                                |
| /jobs/:id/archive                 | POST               | Owned Job                                                                   |
| /matches                          | GET                | Owned RecruiterMatch records                                                |
| /matches/generate                 | POST               | Owned job, visible candidates and bulk match upserts                        |
| /matches/:id                      | GET                | Owned match and visible candidate                                           |
| /matches/:id/status               | PATCH              | Owned match                                                                 |
| /shortlists                       | GET, POST          | Owned RecruiterShortlist records and match synchronization                  |
| /shortlists/:id                   | PATCH, DELETE      | Owned shortlist and match synchronization                                   |
| /comparison                       | POST               | Visible candidates and optionally an owned job                              |
| /profile                          | GET, PATCH         | Recruiter User, organization and active teams                               |

The nine legacy routes under /api/recruiter are GET /dashboard, GET /candidates, GET /candidate/:id, POST /job, GET /jobs, PUT /job/:id, DELETE /job/:id, POST /match and POST /ai-rank. Legacy job operations preserve their older payload handling and share the pipeline deletion service. Legacy ranking remains on-demand. The legacy inline AI-ranking path operates on inputs supplied by the caller. Database-backed ranking uses server-resolved scope.

Invitation acceptance remains POST /api/auth/accept-invite. The incomplete-profile response points to /app/recruiter/profile?onboarding=recruiter. The guard recognizes the prior onboarding URL and redirects it to the recruiter profile. Existing recruiter workspace URLs remain registered.

External legacy consumer usage was not measured. The endpoints and compatibility exports were retained.
