import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ProviderName = 'linkedin' | 'github' | 'leetcode' | 'kaggle';

export interface IntegrationMarketplaceItem {
  provider: ProviderName;
  name: string;
  description: string;
  category: string;
  authMode?: 'oauth2' | 'manual';
  status: 'connected' | 'disconnected' | 'error';
  externalUsername?: string;
  lastSyncedAt?: string | null;
}

export interface IntegrationInsightsResponse {
  providers: Array<{
    provider: ProviderName;
    profileScore: number;
    activityScore: number;
    confidence: number;
    syncedAt?: string;
  }>;
  mergedSkills: string[];
  integrationScore: number;
  updatedAt?: string | null;
}

@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private readonly baseUrl = 'http://localhost:5000/api/integrations';

  constructor(private readonly http: HttpClient) {}

  getMarketplace(): Observable<{ integrations: IntegrationMarketplaceItem[] }> {
    return this.http.get<{ integrations: IntegrationMarketplaceItem[] }>(`${this.baseUrl}/marketplace`);
  }

  startOAuth(provider: ProviderName): Observable<{
    provider: string;
    state?: string;
    authorizationUrl?: string;
    redirectUri?: string;
    authMode?: string;
    message?: string;
    hints?: any;
    missingConfig?: string[];
  }> {
    return this.http.post<any>(`${this.baseUrl}/oauth/start`, {
      provider
    });
  }

  oauthCallback(provider: ProviderName, code: string, state: string, username?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/oauth/callback`, { provider, code, state, username });
  }

  manualConnect(provider: ProviderName, externalUsername: string, apiKey = ''): Observable<any> {
    return this.http.post(`${this.baseUrl}/manual/connect`, { provider, externalUsername, apiKey });
  }

  ingest(provider: ProviderName): Observable<any> {
    return this.http.post(`${this.baseUrl}/ingest`, { provider });
  }

  disconnect(provider: ProviderName): Observable<any> {
    return this.http.delete(`${this.baseUrl}/connections/${provider}`);
  }

  getInsights(): Observable<IntegrationInsightsResponse> {
    return this.http.get<IntegrationInsightsResponse>(`${this.baseUrl}/insights`);
  }
}
