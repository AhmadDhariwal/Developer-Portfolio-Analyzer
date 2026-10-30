import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { finalize } from 'rxjs/operators';
import { IntegrationsPageHeaderComponent } from './components/integrations-page-header/integrations-page-header.component';
import { IntegrationTelemetryComponent } from './components/integration-telemetry/integration-telemetry.component';
import { IntegrationCategoryFiltersComponent } from './components/integration-category-filters/integration-category-filters.component';
import { IngestionActivityTerminalComponent } from './components/ingestion-activity-terminal/ingestion-activity-terminal.component';
import { IntegrationProviderCardComponent } from './components/integration-provider-card/integration-provider-card.component';
import { PROVIDER_META } from './config/provider-metadata';
import {
  IngestionLogEntry,
  MarketplaceCategory,
  CategoryGroup,
  BusyAction,
} from './config/marketplace.models';
import * as presentation from './utils/marketplace-presentation';
export type { IngestionLogEntry } from './config/marketplace.models';
import {
  IntegrationsService,
  IntegrationMarketplaceItem,
  ProviderName,
} from '../../shared/services/integrations.service';

@Component({
  selector: 'app-integrations-marketplace',
  standalone: true,
  imports: [
    CommonModule,
    IntegrationsPageHeaderComponent,
    IntegrationTelemetryComponent,
    IntegrationCategoryFiltersComponent,
    IngestionActivityTerminalComponent,
    IntegrationProviderCardComponent,
  ],
  templateUrl: './integrations-marketplace.component.html',
  styleUrl: './integrations-marketplace.component.scss',
})
export class IntegrationsMarketplaceComponent implements OnInit {
  integrations: IntegrationMarketplaceItem[] = [];
  isLoading = false;
  syncAllLoading = false;
  errorMessage = '';
  busyProvider: ProviderName | '' = '';
  busyAction: BusyAction = '';
  isProcessingOAuthCallback = false;

  activeCategory: MarketplaceCategory = 'all';
  searchQuery = '';
  isTerminalOpen = false;

  terminalLogs: IngestionLogEntry[] = [];

  readonly providerIconHtml: Record<string, SafeHtml>;
  readonly providerColor: Record<string, string>;
  integrationScore = 0;
  manualUsername: Partial<Record<ProviderName, string>> = {};
  manualApiKey: Partial<Record<ProviderName, string>> = {};

  get connectedCount(): number {
    return this.integrations.filter((item) => item.status === 'connected').length;
  }

  get disconnectedCount(): number {
    return this.integrations.filter((item) => item.status !== 'connected').length;
  }

  get oauthCount(): number {
    return this.integrations.filter((item) => item.authMode === 'oauth2').length;
  }

  get manualCount(): number {
    return this.integrations.filter((item) => item.authMode === 'manual').length;
  }

  get connectedIntegrations(): IntegrationMarketplaceItem[] {
    return this.integrations.filter((item) => item.status === 'connected');
  }

  get availableIntegrations(): IntegrationMarketplaceItem[] {
    return this.integrations.filter((item) => item.status !== 'connected');
  }

  get displayedIntegrations(): IntegrationMarketplaceItem[] {
    const query = this.searchQuery.trim().toLowerCase();
    return this.integrations.filter((item) => {
      // Category filter
      if (this.activeCategory === 'connected' && item.status !== 'connected') {
        return false;
      }
      if (this.activeCategory !== 'all' && this.activeCategory !== 'connected') {
        const group = PROVIDER_META[item.provider]?.categoryGroup;
        if (group !== this.activeCategory) {
          return false;
        }
      }

      // Search filter
      if (!query) return true;
      const meta = PROVIDER_META[item.provider];
      const matchName = item.name.toLowerCase().includes(query);
      const matchDesc = item.description.toLowerCase().includes(query);
      const matchCat = item.category.toLowerCase().includes(query);
      const matchImpact = meta?.impact.some((tag) => tag.toLowerCase().includes(query));
      const matchUser = (item.externalUsername || '').toLowerCase().includes(query);

      return matchName || matchDesc || matchCat || matchImpact || matchUser;
    });
  }

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer,
  ) {
    const icons: Record<string, SafeHtml> = {};
    const colors: Record<string, string> = {};

    for (const [key, meta] of Object.entries(PROVIDER_META)) {
      icons[key] = this.sanitizer.bypassSecurityTrustHtml(meta.icon || '');
      colors[key] = meta.color || '#94a3b8';
    }

    this.providerIconHtml = icons;
    this.providerColor = colors;
  }

  ngOnInit(): void {
    this.loadMarketplace();
    this.loadInsights();
    this.handleOAuthCallback();
  }

  @HostListener('window:pageshow', ['$event'])
  onPageShow(event?: PageTransitionEvent): void {
    if (this.busyAction === 'connect' && !this.isProcessingOAuthCallback) {
      this.busyProvider = '';
      this.busyAction = '';
      this.cdr.detectChanges();
    }
    if (event?.persisted) {
      this.loadMarketplace();
      this.loadInsights();
    }
  }

  @HostListener('window:pagehide')
  onPageHide(): void {
    if (this.busyAction === 'connect' && !this.isProcessingOAuthCallback) {
      this.busyProvider = '';
      this.busyAction = '';
    }
  }

  @HostListener('window:focus')
  @HostListener('document:visibilitychange')
  onWindowFocusOrVisibility(): void {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      if (this.busyAction === 'connect' && !this.isProcessingOAuthCallback) {
        this.busyProvider = '';
        this.busyAction = '';
        this.cdr.detectChanges();
      }
    }
  }

  handleOAuthCallback(): void {
    const query = this.route.snapshot.queryParamMap;

    const error = query.get('error');
    if (error) {
      this.busyProvider = '';
      this.busyAction = '';
      this.isProcessingOAuthCallback = false;
      const errorDescription = query.get('error_description');
      const friendlyMessage =
        errorDescription ||
        (error === 'user_cancelled_authorize' || error === 'access_denied'
          ? 'OAuth authorization was cancelled or denied.'
          : error === 'callback_failed'
            ? 'OAuth authentication failed.'
            : `OAuth authorization error: ${error}`);
      this.errorMessage = friendlyMessage;
      this.addTerminalLog('warn', friendlyMessage);
      this.router.navigate([], {
        queryParams: { error: null, error_description: null, state: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      this.cdr.detectChanges();
      return;
    }

    const success = query.get('success');
    if (success === 'github') {
      this.router.navigate([], {
        queryParams: { success: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      this.addTerminalLog(
        'success',
        'GitHub OAuth callback accepted. Triggering automated AST ingestion…',
      );
      this.executeIngestion('github', true);
      return;
    }

    const code = query.get('code');
    const state = query.get('state');
    if (!code || !state) return;

    // GitHub returns through the backend callback. LinkedIn uses this frontend redirect;
    // state is opaque and is validated against the owned server-side attempt.
    const providerFromState: ProviderName = 'linkedin';

    this.isProcessingOAuthCallback = true;
    this.busyProvider = providerFromState;
    this.busyAction = 'connect';
    this.addTerminalLog('info', `Processing OAuth callback for ${providerFromState}…`);

    this.integrationsService.oauthCallback(providerFromState, code, state).subscribe({
      next: () => {
        this.addTerminalLog(
          'success',
          `OAuth handshake validated for ${providerFromState}. Initiating data sync…`,
        );
        this.executeIngestion(providerFromState, true);
      },
      error: (err) => {
        this.isProcessingOAuthCallback = false;
        this.busyProvider = '';
        this.busyAction = '';
        this.errorMessage =
          err?.error?.message || `OAuth callback failed for ${providerFromState}.`;
        this.addTerminalLog(
          'error',
          `OAuth callback failure for ${providerFromState}: ${this.errorMessage}`,
        );
        this.isLoading = false;
        this.router.navigate([], {
          queryParams: { code: null, state: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
        this.cdr.detectChanges();
      },
    });
  }

  loadMarketplace(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.integrationsService
      .getMarketplace()
      .pipe(
        finalize(() => {
          this.isLoading = false;
          this.cdr.detectChanges();
        }),
      )
      .subscribe({
        next: (res) => {
          const raw = Array.isArray(res?.integrations) ? res.integrations : [];
          // Retire HackerRank (no supported stats ingestion) and ensure clean Dev.to / LinkedIn metadata
          this.integrations = raw
            .filter((item) => item.provider !== 'hackerrank')
            .map((item) => {
              if (item.provider === 'devblogs') {
                return {
                  ...item,
                  name: 'Dev.to',
                  description:
                    item.description?.replace(/Hashnode/gi, 'Dev.to') || item.description,
                };
              }
              if (item.provider === 'linkedin') {
                return {
                  ...item,
                  description:
                    'Connect LinkedIn OpenID basic profile and optional email claims. Endorsements and network analytics are unavailable.',
                };
              }
              return item;
            });

          this.integrations.forEach((item) => {
            if (!this.manualUsername[item.provider]) {
              this.manualUsername[item.provider] = item.externalUsername || '';
            }
          });
          this.addTerminalLog(
            'info',
            `Marketplace state refreshed. ${this.connectedCount} connected, ${this.disconnectedCount} available.`,
          );
          this.cdr.detectChanges();
        },
        error: () => {
          this.errorMessage = 'Failed to load integrations marketplace.';
          this.addTerminalLog('error', 'Failed to retrieve marketplace catalog from API.');
          this.cdr.detectChanges();
        },
      });
  }

  connect(item: IntegrationMarketplaceItem): void {
    if (this.isProviderUnavailable(item.provider)) return;
    if (this.busyProvider === item.provider) return;
    if (item.authMode === 'manual') {
      this.manualConnect(item);
      return;
    }

    this.busyProvider = item.provider;
    this.busyAction = 'connect';
    this.addTerminalLog('info', `Requesting OAuth2 authorization URL for ${item.name}…`);

    this.integrationsService.startOAuth(item.provider).subscribe({
      next: (oauth) => {
        if (!oauth?.authorizationUrl) {
          this.busyProvider = '';
          this.busyAction = '';
          this.errorMessage = oauth?.message || `Could not start OAuth for ${item.name}.`;
          this.addTerminalLog(
            'error',
            `OAuth initiation failed for ${item.name}: ${this.errorMessage}`,
          );
          this.cdr.detectChanges();
          return;
        }
        this.addTerminalLog('info', `Redirecting to ${item.name} authentication portal…`);
        globalThis.location.href = oauth.authorizationUrl;
      },
      error: (err) => {
        this.busyProvider = '';
        this.busyAction = '';
        this.errorMessage = err?.error?.message || `Could not start OAuth for ${item.name}.`;
        this.addTerminalLog('error', `OAuth initiation error: ${this.errorMessage}`);
        this.cdr.detectChanges();
      },
    });
  }

  manualConnect(item: IntegrationMarketplaceItem): void {
    if (this.isProviderUnavailable(item.provider)) return;
    if (this.busyProvider === item.provider) return;
    const externalUsername = (this.manualUsername[item.provider] || '').trim();
    const apiKey = (this.manualApiKey[item.provider] || '').trim();

    if (!externalUsername) {
      this.errorMessage = `${item.name}: ${this.getInputLabel(item.provider)} is required.`;
      this.cdr.detectChanges();
      return;
    }

    this.busyProvider = item.provider;
    this.busyAction = 'connect';
    this.addTerminalLog('info', `Connecting ${item.name} with handle "${externalUsername}"…`);

    this.integrationsService.manualConnect(item.provider, externalUsername, apiKey).subscribe({
      next: () => {
        this.addTerminalLog(
          'success',
          `${item.name} successfully linked. Commencing ingestion pass…`,
        );
        this.runIngestion(item.provider);
      },
      error: (err) => {
        this.busyProvider = '';
        this.busyAction = '';
        this.errorMessage = err?.error?.message || `Could not connect ${item.name}.`;
        this.addTerminalLog('error', `Connection rejected for ${item.name}: ${this.errorMessage}`);
        this.cdr.detectChanges();
      },
    });
  }

  runIngestion(provider: ProviderName): void {
    this.executeSyncNow(provider);
  }

  syncAll(): void {
    if (this.syncAllLoading || this.busyProvider !== '') return;
    this.syncAllLoading = true;
    this.addTerminalLog('info', 'Triggered broadcast sync across all connected platform adapters…');

    this.integrationsService
      .syncNow()
      .pipe(
        finalize(() => {
          this.syncAllLoading = false;
          this.cdr.detectChanges();
        }),
      )
      .subscribe({
        next: () => {
          this.addTerminalLog(
            'success',
            'Broadcast synchronization complete. All platform telemetry updated.',
          );
          this.loadMarketplace();
          this.loadInsights();
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.errorMessage = err?.error?.message || 'Sync all failed.';
          this.addTerminalLog('error', `Broadcast sync failed: ${this.errorMessage}`);
          this.cdr.detectChanges();
        },
      });
  }

  private executeIngestion(provider: ProviderName, clearQueryAfter = false): void {
    this.isLoading = true;
    this.integrationsService
      .ingest(provider)
      .pipe(
        finalize(() => {
          this.isLoading = false;
        }),
      )
      .subscribe({
        next: () => {
          this.isProcessingOAuthCallback = false;
          this.busyProvider = '';
          this.busyAction = '';
          this.addTerminalLog(
            'success',
            `Ingestion completed for ${provider}. Insights recalculated.`,
          );
          this.loadMarketplace();
          this.loadInsights();
          if (clearQueryAfter) {
            this.router.navigate([], {
              queryParams: { code: null, state: null, success: null },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          }
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.isProcessingOAuthCallback = false;
          this.busyProvider = '';
          this.busyAction = '';
          this.errorMessage = err?.error?.message || `Ingestion failed for ${provider}.`;
          this.addTerminalLog(
            'error',
            `Ingestion pipeline error for ${provider}: ${this.errorMessage}`,
          );
          if (clearQueryAfter) {
            this.router.navigate([], {
              queryParams: { code: null, state: null, success: null },
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          }
          this.cdr.detectChanges();
        },
      });
  }

  private executeSyncNow(provider: ProviderName): void {
    if (this.isProviderUnavailable(provider)) return;
    this.busyProvider = provider;
    this.busyAction = 'sync';
    this.addTerminalLog('info', `Triggering live synchronization for adapter: ${provider}…`);

    this.integrationsService.syncNow(provider).subscribe({
      next: () => {
        this.busyProvider = '';
        this.busyAction = '';
        this.addTerminalLog('success', `Sync finished for ${provider}. New data parsed.`);
        this.loadMarketplace();
        this.loadInsights();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyProvider = '';
        this.busyAction = '';
        this.errorMessage = err?.error?.message || `Sync failed for ${provider}.`;
        this.addTerminalLog('error', `Sync failure for ${provider}: ${this.errorMessage}`);
        this.cdr.detectChanges();
      },
    });
  }

  disconnect(item: IntegrationMarketplaceItem): void {
    if (this.busyProvider === item.provider) return;
    this.busyProvider = item.provider;
    this.busyAction = 'disconnect';
    this.addTerminalLog('warn', `Terminating connection stream with ${item.name}…`);

    this.integrationsService.disconnect(item.provider).subscribe({
      next: () => {
        this.busyProvider = '';
        this.busyAction = '';
        this.addTerminalLog('info', `Disconnected ${item.name}. Ingestion pipeline purged.`);
        this.loadMarketplace();
        this.loadInsights();
        this.cdr.detectChanges();
      },
      error: () => {
        this.busyProvider = '';
        this.busyAction = '';
        this.errorMessage = `Failed to disconnect ${item.name}.`;
        this.addTerminalLog('error', `Disconnect command failed for ${item.name}.`);
        this.cdr.detectChanges();
      },
    });
  }

  private loadInsights(): void {
    this.integrationsService.getInsights().subscribe({
      next: (insight) => {
        const score = Number(insight?.integrationScore);
        this.integrationScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
        this.cdr.detectChanges();
      },
      error: () => {
        this.integrationScore = 0;
        this.cdr.detectChanges();
      },
    });
  }

  toggleTerminal(): void {
    this.isTerminalOpen = !this.isTerminalOpen;
    this.cdr.detectChanges();
  }

  private addTerminalLog(level: 'info' | 'success' | 'warn' | 'error', message: string): void {
    const now = new Date();
    const time = now.toTimeString().split(' ')[0] || '00:00:00';
    this.terminalLogs.unshift({ time, level, message });
    if (this.terminalLogs.length > 30) {
      this.terminalLogs.pop();
    }
  }

  // Pure presentation helpers are also available to existing page callers.
  getCategoryStats(group: CategoryGroup): string {
    return presentation.getCategoryStats(this.integrations, group);
  }
  getCategoryPercent(group: CategoryGroup): number {
    return presentation.getCategoryPercent(this.integrations, group);
  }
  getCategoryTotal(group: CategoryGroup): number {
    return presentation.getCategoryTotal(this.integrations, group);
  }
  isProviderUnavailable(provider: ProviderName): boolean {
    return presentation.isProviderUnavailable(this.integrations, provider);
  }
  readonly getInputLabel = presentation.getInputLabel;
  readonly getInputPlaceholder = presentation.getInputPlaceholder;
  readonly getInputHint = presentation.getInputHint;
  readonly getImpactItems = presentation.getImpactItems;
  readonly getScoreHealthLabel = presentation.getScoreHealthLabel;
  readonly getScoreHealthClass = presentation.getScoreHealthClass;
}
