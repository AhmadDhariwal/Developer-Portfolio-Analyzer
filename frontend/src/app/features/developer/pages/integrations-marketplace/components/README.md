# Integrations Marketplace components

Each component owns its template, styles and TypeScript in a matching folder. Colocated tests move with their component. Names describe responsibility: integration telemetry, provider controls, category filters and ingestion activity.

| Folder / component                                                      | Responsibility                                                                       | Used by                                                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `integrations-page-header/` — `IntegrationsPageHeaderComponent`         | Page heading, search and Sync All                                                    | `IntegrationsMarketplaceComponent`, on the existing `header[appIntegrationsPageHeader]` element |
| `integration-telemetry/` — `IntegrationTelemetryComponent`              | Four overview cards: health, connection mix, portfolio impact and ingestion pipeline | Marketplace parent, on `section[appIntegrationTelemetry]`                                       |
| `integration-category-filters/` — `IntegrationCategoryFiltersComponent` | Category tabs and platform counts                                                    | Marketplace parent, on `nav[appIntegrationCategoryFilters]`                                     |
| `integration-provider-card/` — `IntegrationProviderCardComponent`       | Provider status, manual input and Connect/Sync/Disconnect controls                   | Marketplace parent, on each `article[appIntegrationProviderCard]`                               |
| `ingestion-activity-terminal/` — `IngestionActivityTerminalComponent`   | Collapsible ingestion log feed                                                       | Marketplace parent, on `section[appIngestionActivityTerminal]`                                  |
| `kaggle-linked-profile/` — `KaggleLinkedProfileComponent`               | Unverified Kaggle reference link; save/update/remove                                 | Marketplace provider card, using `app-kaggle-linked-profile`                                    |
| `hackerrank-linked-profile/` — `HackerRankLinkedProfileComponent`       | Retained unverified HackerRank reference-link implementation                         | Its colocated tests; currently not rendered by the Marketplace, which retires HackerRank cards  |

The parent at `../integrations-marketplace.component.ts` owns shared state, provider API orchestration and OAuth handling. Extracted page sections receive typed inputs and emit action intent. The existing linked-profile components retain their original service behavior.

Provider display metadata lives in `../config/provider-metadata.ts`, feature types in `../config/marketplace.models.ts`, pure presentation helpers in `../utils/marketplace-presentation.ts`, and shared scoped Sass mixins in `../styles/_marketplace-primitives.scss`.

Attribute selectors match the responsibility-specific component names and are wired in the parent template. The original semantic elements remain the component hosts; no section needs a new wrapper element.
