import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import {
  IntegrationsService,
  IntegrationMarketplaceItem,
  ProviderName
} from '../../shared/services/integrations.service';

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

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadMarketplace();
    this.loadInsights();
    this.handleOAuthCallback();
  }

  handleOAuthCallback(): void {
    const query = this.route.snapshot.queryParamMap;
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
    if (item.authMode === 'manual') {
      this.manualConnect(item);
      return;
    }

    this.busyProvider = item.provider;
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
    const externalUsername = (this.manualUsername[item.provider] || '').trim();
    const apiKey = (this.manualApiKey[item.provider] || '').trim();

    if (!externalUsername) {
      this.errorMessage = `${item.name} username is required for manual connection.`;
      this.cdr.detectChanges();
      return;
    }

    this.busyProvider = item.provider;
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
    this.executeIngestion(provider, false);
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
          this.router.navigate([], {
            queryParams: {},
            replaceUrl: true
          });
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.busyProvider = '';
        this.errorMessage = err?.error?.message || `Ingestion failed for ${provider}.`;
        if (clearQueryAfter) {
          this.router.navigate([], {
            queryParams: {},
            replaceUrl: true
          });
        }
        this.cdr.detectChanges();
      }
    });
  }

  disconnect(item: IntegrationMarketplaceItem): void {
    this.busyProvider = item.provider;
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
        this.integrationScore = Number(insight?.integrationScore || 0);
        this.cdr.detectChanges();
      },
      error: () => {
        this.integrationScore = 0;
        this.cdr.detectChanges();
      }
    });
  }
}
