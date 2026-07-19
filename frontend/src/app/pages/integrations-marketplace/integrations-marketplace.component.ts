import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { finalize } from 'rxjs/operators';
import {
  IntegrationsService,
  IntegrationMarketplaceItem,
  ProviderName
} from '../../shared/services/integrations.service';

// ── Provider metadata for richer UI ──────────────────────────────────────
const PROVIDER_META: Record<string, {
  icon: string;
  color: string;
  inputLabel: string;
  inputPlaceholder: string;
  inputHint: string;
  impact: string[];
}> = {
  github: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>`,
    color: '#e2e8f0',
    inputLabel: 'GitHub Username',
    inputPlaceholder: 'your-github-handle',
    inputHint: '',
    impact: ['Code quality score', 'Language skills', 'Project impact']
  },
  linkedin: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
    color: '#0ea5e9',
    inputLabel: '',
    inputPlaceholder: '',
    inputHint: '',
    impact: ['Professional branding', 'Network signals', 'Profile completeness']
  },
  leetcode: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.278l3.501 2.831c.593.48 1.461.387 1.94-.207a1.384 1.384 0 0 0-.207-1.943l-3.5-2.831c-.8-.647-1.766-1.045-2.774-1.202l2.015-2.158A1.384 1.384 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z"/></svg>`,
    color: '#f59e0b',
    inputLabel: 'LeetCode Username',
    inputPlaceholder: 'your-leetcode-username',
    inputHint: '',
    impact: ['DSA skills', 'Problem-solving score', 'Interview readiness']
  },
  kaggle: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.825 23.859c-.022.092-.117.141-.281.141h-3.139c-.187 0-.351-.082-.492-.248l-5.178-6.589-1.448 1.374v5.111c0 .235-.117.352-.351.352H5.505c-.236 0-.354-.117-.354-.352V.353c0-.233.118-.353.354-.353h2.431c.234 0 .351.12.351.353v14.343l6.203-6.272c.165-.165.33-.246.495-.246h3.239c.144 0 .236.06.285.18.046.149.034.255-.036.315l-6.555 6.344 6.836 8.507c.095.104.117.208.07.336z"/></svg>`,
    color: '#20beff',
    inputLabel: 'Kaggle Username',
    inputPlaceholder: 'your-kaggle-username',
    inputHint: '',
    impact: ['ML/AI skills', 'Competition score', 'Data science credibility']
  },
  stackoverflow: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.986 21.865v-6.404h2.134V24H1.844v-8.539h2.13v6.404h15.012zM6.111 19.731H16.85v-2.137H6.111v2.137zm.259-4.852 10.48 2.189.451-2.07-10.478-2.187-.453 2.068zm1.359-5.056 9.705 4.53.903-1.95-9.706-4.53-.902 1.95zm2.715-4.785 8.217 6.855 1.359-1.62-8.216-6.853-1.36 1.618zM15.751 0l-1.746 1.294 6.405 8.604 1.746-1.294L15.751 0z"/></svg>`,
    color: '#f48024',
    inputLabel: 'Stack Overflow Username or User ID',
    inputPlaceholder: 'username or 12345678',
    inputHint: 'Enter your numeric user ID or display name',
    impact: ['Backend credibility', 'Community reputation', 'Problem-solving score']
  },
  hackerrank: {
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c1.285 0 9.75 4.886 10.392 6 .645 1.115.645 10.885 0 12S13.287 24 12 24C10.715 24 2.25 19.114 1.608 18 .963 16.886.963 7.116 1.608 6 2.25 4.886 10.715 0 12 0zm-1.24 7.666c-.2.022-.43.088-.61.22-.18.13-.28.31-.28.51v.67c0 .2.1.38.28.51.18.13.41.2.61.22h.48v1.33h-1.33c-.2 0-.38.1-.51.28-.13.18-.2.41-.22.61v.48c.02.2.09.43.22.61.13.18.31.28.51.28h1.33v1.33h-.48c-.2.02-.43.09-.61.22-.18.13-.28.31-.28.51v.67c0 .2.1.38.28.51.18.13.41.2.61.22h3.33c.2-.02.43-.09.61-.22.18-.13.28-.31.28-.51v-.67c0-.2-.1-.38-.28-.51-.18-.13-.41-.2-.61-.22h-.48v-4.67h.48c.2-.02.43-.09.61-.22.18-.13.28-.31.28-.51v-.67c0-.2-.1-.38-.28-.51-.18-.13-.41-.2-.61-.22h-3.33z"/></svg>`,
    color: '#2ec866',
    inputLabel: 'HackerRank Username',
    inputPlaceholder: 'your-hackerrank-username',
    inputHint: '',
    impact: ['Verified certifications', 'Coding badges', 'Skill validation']
  },
  portfolio: {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    color: '#a78bfa',
    inputLabel: 'Portfolio URL',
    inputPlaceholder: 'https://yourname.dev',
    inputHint: 'Full URL including https://',
    impact: ['Technology stack', 'SEO & performance', 'Personal branding']
  },
  certifications: {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>`,
    color: '#34d399',
    inputLabel: 'Certifications (comma-separated)',
    inputPlaceholder: 'AWS Solutions Architect, Google Cloud Professional',
    inputHint: 'Separate multiple certifications with commas',
    impact: ['Verified skills score', 'Hiring credibility', 'Recommendations']
  },
  devblogs: {
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    color: '#fb7185',
    inputLabel: 'Dev.to or Hashnode Username',
    inputPlaceholder: 'your-blog-username',
    inputHint: 'Works with Dev.to and Hashnode',
    impact: ['Developer branding', 'Technical writing', 'Community presence']
  }
};

@Component({
  selector: 'app-integrations-marketplace',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './integrations-marketplace.component.html',
  styleUrl: './integrations-marketplace.component.scss'
})
export class IntegrationsMarketplaceComponent implements OnInit {
  integrations: IntegrationMarketplaceItem[] = [];
  isLoading = false;
  errorMessage = '';
  busyProvider: ProviderName | '' = '';
  busyAction: 'connect' | 'sync' | 'disconnect' | '' = '';

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

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer
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

    // Check for success redirect from backend GET callback
    const success = query.get('success');
    if (success === 'github') {
      this.router.navigate([], { queryParams: { success: null }, queryParamsHandling: 'merge' });
      this.executeIngestion('github', true);
      return;
    }

    const code = query.get('code');
    const state = query.get('state');
    if (!code || !state) return;

    const providerFromState = state.split(':')[0] as ProviderName;
    if (!providerFromState) return;

    this.busyProvider = providerFromState;
    this.integrationsService.oauthCallback(providerFromState, code, state).subscribe({
      next: () => {
        this.executeIngestion(providerFromState, true);
      },
      error: (err) => {
        this.busyProvider = '';
        this.errorMessage = err?.error?.message || `OAuth callback failed for ${providerFromState}.`;
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadMarketplace(): void {
    this.isLoading = true;
    this.errorMessage = '';

    this.integrationsService.getMarketplace().pipe(
      finalize(() => {
        this.isLoading = false;
        this.cdr.detectChanges();
      })
    ).subscribe({
      next: (res) => {
        this.integrations = Array.isArray(res?.integrations) ? res.integrations : [];
        this.integrations.forEach((item) => {
          if (!this.manualUsername[item.provider]) {
            this.manualUsername[item.provider] = item.externalUsername || '';
          }
        });
        this.cdr.detectChanges();
      },
      error: () => {
        this.errorMessage = 'Failed to load integrations marketplace.';
        this.cdr.detectChanges();
      }
    });
  }

  connect(item: IntegrationMarketplaceItem): void {
    if (this.busyProvider === item.provider) return;
    if (item.authMode === 'manual') {
      this.manualConnect(item);
      return;
    }

    this.busyProvider = item.provider;
    this.busyAction = 'connect';
    this.integrationsService.startOAuth(item.provider).subscribe({
      next: (oauth) => {
        if (!oauth?.authorizationUrl) {
          this.busyProvider = '';
          this.errorMessage = oauth?.message || `Could not start OAuth for ${item.name}.`;
          this.cdr.detectChanges();
          return;
        }
        globalThis.location.href = oauth.authorizationUrl;
      },
      error: (err) => {
        this.busyProvider = '';
        this.errorMessage = err?.error?.message || `Could not start OAuth for ${item.name}.`;
        this.cdr.detectChanges();
      }
    });
  }

  manualConnect(item: IntegrationMarketplaceItem): void {
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
    this.integrationsService.manualConnect(item.provider, externalUsername, apiKey).subscribe({
      next: () => {
        this.runIngestion(item.provider);
      },
      error: (err) => {
        this.busyProvider = '';
        this.errorMessage = err?.error?.message || `Could not connect ${item.name}.`;
        this.cdr.detectChanges();
      }
    });
  }

  runIngestion(provider: ProviderName): void {
    this.executeSyncNow(provider);
  }

  private executeIngestion(provider: ProviderName, clearQueryAfter = false): void {
    this.isLoading = true;
    this.integrationsService.ingest(provider).pipe(
      finalize(() => {
        this.isLoading = false;
      })
    ).subscribe({
      next: () => {
        this.busyProvider = '';
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
        if (clearQueryAfter) {
          this.router.navigate([], { queryParams: {}, replaceUrl: true });
        }
        this.cdr.detectChanges();
      }
    });
  }

  private executeSyncNow(provider: ProviderName): void {
    this.busyAction = 'sync';
    this.integrationsService.syncNow(provider).subscribe({
      next: () => {
        this.busyProvider = '';
        this.loadMarketplace();
        this.loadInsights();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyProvider = '';
        this.errorMessage = err?.error?.message || `Sync failed for ${provider}.`;
        this.cdr.detectChanges();
      }
    });
  }

  disconnect(item: IntegrationMarketplaceItem): void {
    if (this.busyProvider === item.provider) return;
    this.busyProvider = item.provider;
    this.busyAction = 'disconnect';
    this.integrationsService.disconnect(item.provider).subscribe({
      next: () => {
        this.busyProvider = '';
        this.loadMarketplace();
        this.loadInsights();
        this.cdr.detectChanges();
      },
      error: () => {
        this.busyProvider = '';
        this.errorMessage = `Failed to disconnect ${item.name}.`;
        this.cdr.detectChanges();
      }
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
      }
    });
  }

  // ── UI helpers ────────────────────────────────────────────────────────

  // `providerIconHtml` and `providerColor` replace the previous template helper functions
  // to keep Angular templates stable during change detection.

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
    if (score >= 75) return 'Excellent';
    if (score >= 50) return 'Good';
    if (score >= 25) return 'Fair';
    return 'Getting started';
  }

  getScoreHealthClass(score: number): string {
    if (score >= 75) return 'health--excellent';
    if (score >= 50) return 'health--good';
    if (score >= 25) return 'health--fair';
    return 'health--low';
  }
}
