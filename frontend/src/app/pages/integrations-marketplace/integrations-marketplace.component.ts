import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { finalize } from 'rxjs/operators';
import { KaggleLinkedProfileComponent } from './components/kaggle-linked-profile.component';
import {
  IntegrationsService,
  IntegrationMarketplaceItem,
  ProviderName,
} from '../../shared/services/integrations.service';

// ── Provider metadata for richer UI ──────────────────────────────────────
const PROVIDER_META: Record<
  string,
  {
    icon: string;
    color: string;
    categoryGroup: 'code' | 'algo' | 'community' | 'knowledge';
    inputLabel: string;
    inputPlaceholder: string;
    inputHint: string;
    impact: string[];
  }
> = {
  github: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`,
    color: '#a3a6ff',
    categoryGroup: 'code',
    inputLabel: 'GitHub Username',
    inputPlaceholder: 'your-github-handle',
    inputHint: 'Syncs commit history, repositories, and pull requests',
    impact: ['Repo AST Analysis', 'Language proficiencies', 'PR velocity'],
  },
  linkedin: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
    color: '#53ddfc',
    categoryGroup: 'community',
    inputLabel: '',
    inputPlaceholder: '',
    inputHint: 'Secure OAuth2 OpenID Connect for verified basic profile identity',
    impact: ['OpenID profile identity', 'Basic profile claims', 'Name and optional email claims'],
  },
  leetcode: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z"/></svg>`,
    color: '#f59e0b',
    categoryGroup: 'algo',
    inputLabel: 'LeetCode Username',
    inputPlaceholder: 'your-leetcode-username',
    inputHint: 'Extracts contest percentile, difficulty split and streaks',
    impact: ['DSA & Algo problem counts', 'Difficulty distribution', 'Contest ranking'],
  },
  kaggle: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.825 23.859c-.022.092-.117.141-.281.141h-3.139c-.187 0-.351-.082-.492-.248l-5.178-6.589-1.448 1.374v5.111c0 .235-.117.352-.351.352H5.505c-.236 0-.354-.117-.354-.352V.353c0-.233.118-.353.354-.353h2.431c.234 0 .351.12.351.353v14.343l6.203-6.272c.165-.165.33-.246.495-.246h3.239c.144 0 .236.06.285.18.046.149.034.255-.036.315l-6.555 6.344 6.836 8.507c.095.104.117.208.07.336z"/></svg>`,
    color: '#20beff',
    categoryGroup: 'algo',
    inputLabel: 'Kaggle Username',
    inputPlaceholder: 'your-kaggle-username',
    inputHint: 'Public resource samples only. Ownership unverified; no scoring impact.',
    impact: ['Public resource observations', 'Notebook & dataset samples'],
  },
  stackoverflow: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.986 21.865v-6.404h2.134V24H1.844v-8.539h2.13v6.404h15.012zM6.111 19.731H16.85v-2.137H6.111v2.137zm.259-4.852 10.48 2.189.451-2.07-10.478-2.187-.453 2.068zm1.359-5.056 9.705 4.53.903-1.95-9.706-4.53-.902 1.95zm2.715-4.785 8.217 6.855 1.359-1.62-8.216-6.853-1.36 1.618zM15.751 0l-1.746 1.294 6.405 8.604 1.746-1.294L15.751 0z"/></svg>`,
    color: '#f48024',
    categoryGroup: 'community',
    inputLabel: 'Stack Overflow User ID',
    inputPlaceholder: 'numeric user ID (e.g. 123456)',
    inputHint: 'Found in your profile URL (stackoverflow.com/users/ID/name)',
    impact: ['Reputation & badge metrics', 'Top discussion tags', 'Answers & questions'],
  },
  portfolio: {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    color: '#a78bfa',
    categoryGroup: 'code',
    inputLabel: 'Portfolio Site URL',
    inputPlaceholder: 'https://yourportfolio.dev',
    inputHint: 'HTML scan, response latency, and tech stack detection',
    impact: ['Tech stack detection', 'Response latency check', 'SEO metadata signals'],
  },
  certifications: {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`,
    color: '#34d399',
    categoryGroup: 'knowledge',
    inputLabel: 'Certifications (comma-separated)',
    inputPlaceholder: 'AWS Solutions Architect, Google Cloud Professional',
    inputHint: 'Self-reported certification names (comma-separated). Unverified.',
    impact: ['Self-reported credentials', 'Inferred domain skills', 'Certification catalog'],
  },
  devblogs: {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    color: '#fb7185',
    categoryGroup: 'knowledge',
    inputLabel: 'Dev.to Username',
    inputPlaceholder: 'devto@your-handle',
    inputHint: 'Use devto@username. Up to 30 public Dev.to posts per read.',
    impact: ['Technical thought leadership', 'Article publication history', 'Reaction signals'],
  },
};

export interface IngestionLogEntry {
  time: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

@Component({
  selector: 'app-integrations-marketplace',
  standalone: true,
  imports: [CommonModule, FormsModule, KaggleLinkedProfileComponent],
  templateUrl: './integrations-marketplace.component.html',
  styleUrl: './integrations-marketplace.component.scss',
})
export class IntegrationsMarketplaceComponent implements OnInit {
  integrations: IntegrationMarketplaceItem[] = [];
  isLoading = false;
  syncAllLoading = false;
  errorMessage = '';
  busyProvider: ProviderName | '' = '';
  busyAction: 'connect' | 'sync' | 'disconnect' | '' = '';

  activeCategory: 'all' | 'connected' | 'code' | 'algo' | 'community' | 'knowledge' = 'all';
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

  handleOAuthCallback(): void {
    const query = this.route.snapshot.queryParamMap;

    const success = query.get('success');
    if (success === 'github') {
      this.router.navigate([], { queryParams: { success: null }, queryParamsHandling: 'merge' });
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

    this.busyProvider = providerFromState;
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
        this.busyProvider = '';
        this.errorMessage =
          err?.error?.message || `OAuth callback failed for ${providerFromState}.`;
        this.addTerminalLog(
          'error',
          `OAuth callback failure for ${providerFromState}: ${this.errorMessage}`,
        );
        this.isLoading = false;
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
          this.busyProvider = '';
          this.addTerminalLog(
            'success',
            `Ingestion completed for ${provider}. Insights recalculated.`,
          );
          this.loadMarketplace();
          this.loadInsights();
          if (clearQueryAfter) {
            this.router.navigate([], { queryParams: {}, replaceUrl: true });
          }
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.busyProvider = '';
          this.errorMessage = err?.error?.message || `Ingestion failed for ${provider}.`;
          this.addTerminalLog(
            'error',
            `Ingestion pipeline error for ${provider}: ${this.errorMessage}`,
          );
          if (clearQueryAfter) {
            this.router.navigate([], { queryParams: {}, replaceUrl: true });
          }
          this.cdr.detectChanges();
        },
      });
  }

  private executeSyncNow(provider: ProviderName): void {
    if (this.isProviderUnavailable(provider)) return;
    this.busyAction = 'sync';
    this.addTerminalLog('info', `Triggering live synchronization for adapter: ${provider}…`);

    this.integrationsService.syncNow(provider).subscribe({
      next: () => {
        this.busyProvider = '';
        this.addTerminalLog('success', `Sync finished for ${provider}. New data parsed.`);
        this.loadMarketplace();
        this.loadInsights();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyProvider = '';
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
        this.addTerminalLog('info', `Disconnected ${item.name}. Ingestion pipeline purged.`);
        this.loadMarketplace();
        this.loadInsights();
        this.cdr.detectChanges();
      },
      error: () => {
        this.busyProvider = '';
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

  // ── Telemetry & category helpers ──────────────────────────────────────

  getCategoryStats(group: 'code' | 'algo' | 'community' | 'knowledge'): string {
    const list = this.integrations.filter(
      (item) => PROVIDER_META[item.provider]?.categoryGroup === group,
    );
    const connected = list.filter((item) => item.status === 'connected').length;
    return `${connected}/${list.length}`;
  }

  getCategoryPercent(group: 'code' | 'algo' | 'community' | 'knowledge'): number {
    const list = this.integrations.filter(
      (item) => PROVIDER_META[item.provider]?.categoryGroup === group,
    );
    if (!list.length) return 0;
    const connected = list.filter((item) => item.status === 'connected').length;
    return Math.round((connected / list.length) * 100);
  }

  getCategoryTotal(group: 'code' | 'algo' | 'community' | 'knowledge'): number {
    return this.integrations.filter((item) => PROVIDER_META[item.provider]?.categoryGroup === group)
      .length;
  }

  // ── UI helpers ────────────────────────────────────────────────────────

  isProviderUnavailable(provider: string): boolean {
    return (
      provider === 'kaggle' &&
      this.integrations.find((item) => item.provider === provider)?.available !== true
    );
  }

  getInputLabel(provider: string): string {
    return PROVIDER_META[provider]?.inputLabel || 'Username';
  }

  getInputPlaceholder(provider: string): string {
    return PROVIDER_META[provider]?.inputPlaceholder || 'Enter username';
  }

  getInputHint(provider: string): string {
    return PROVIDER_META[provider]?.inputHint || '';
  }

  getImpactItems(provider: string): string[] {
    return PROVIDER_META[provider]?.impact || [];
  }

  getScoreHealthLabel(score: number): string {
    if (score >= 75) return 'Optimal';
    if (score >= 50) return 'Healthy';
    if (score >= 25) return 'Developing';
    return 'Initializing';
  }

  getScoreHealthClass(score: number): string {
    if (score >= 75) return 'health--excellent';
    if (score >= 50) return 'health--good';
    if (score >= 25) return 'health--fair';
    return 'health--low';
  }
}
