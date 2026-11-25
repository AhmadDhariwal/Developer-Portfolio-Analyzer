# Recruiter component ownership

The RecruiterModule declares 11 feature pages. The recruiter notification route mounts the shared NotificationsComponent.

| Page              | State and presentation ownership                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard         | Dashboard reads its summary through RecruiterHubService. Stat cards, charts and activity timeline display it.                                                                                                  |
| Candidates        | CandidatesComponent owns applied filters, pagination and comparison selection. CandidateFilterBarComponent owns the editable draft and emits it at submission. CandidateCardComponent emits candidate actions. |
| Candidate details | CandidateService loads the profile and deterministic summary. The page renders evidence and actions.                                                                                                           |
| Jobs              | JobsComponent owns the editor and CRUD actions. JobCardComponent renders a job and emits actions.                                                                                                              |
| Job details       | The page loads the job and requests match generation.                                                                                                                                                          |
| Matches           | MatchesComponent owns job selection and pipeline actions. MatchCardComponent renders scores and status.                                                                                                        |
| Shortlists        | ShortlistsComponent owns pipeline advancement and confirmation. ShortlistCardComponent presents each entry.                                                                                                    |
| Comparison        | ComparisonComponent owns the selections and request. ComparisonTableComponent renders metrics and excludes missing values from best-value highlighting.                                                        |
| Analytics         | RecruiterAnalyticsComponent loads analytics. RecruiterPerformanceChartComponent renders chart series.                                                                                                          |
| Activity logs     | The page owns query filters. ActivityTimelineComponent renders scoped events.                                                                                                                                  |
| Profile           | RecruiterProfileComponent owns the reactive form and profile request.                                                                                                                                          |
| Notifications     | Shared NotificationsComponent uses the existing notifications APIs.                                                                                                                                            |

The 12 Recruiter standalone components are CandidateCard, CandidateFilterBar, JobCard, MatchCard, ShortlistCard, ComparisonTable, RecruiterStatCard, RecruiterPerformanceChart, ActivityTimeline, EmptyState, Loader and RecruiterBackButton. The feature reuses the shared searchable select and confirmation dialog. The touched frontend files retain Angular component naming and separate templates and styles.

The first two Recruiter specifications exercise filter component interaction and dashboard and analytics refresh after a scope change. Broader page-level component tests, responsive browser verification and visual parity across themes remain open.
