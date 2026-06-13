import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ProviderName =
  | 'linkedin'
  | 'github'
  | 'leetcode'
  | 'kaggle'
  | 'stackoverflow'
  | 'hackerrank'
  | 'portfolio'
  | 'certifications'
  | 'devblogs';

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

export interface ProviderInsightNormalized {
  profile?: {
    username?: string;
    name?: string;
    // LeetCode
    ranking?: number;
    reputation?: number;
    solvedProblems?: number;
    // LinkedIn
    profileCompleteness?: number;
    accountTrust?: number;
    // Stack Overflow
    totalBadges?: number;
    goldBadges?: number;
    silverBadges?: number;
    bronzeBadges?: number;
    answerCount?: number;
    questionCount?: number;
    // HackerRank / Certifications (shared key — use number)
    totalCertifications?: number;
    codingScore?: number;
    certScore?: number;
    // Portfolio
    url?: string;
    isReachable?: boolean;
    statusCode?: number;
    responseTimeMs?: number;
    // Dev Blogs
    totalArticles?: number;
    totalReactions?: number;
    brandingScore?: number;
    [key: string]: unknown;
  };
  activity?: {
    // LeetCode
    easy?: number;
    medium?: number;
    hard?: number;
    // LinkedIn
    accountActivityProxy?: number;
    // Stack Overflow
    soTopTags?: string[];
    namedBadges?: string[];
    acceptRate?: number;
    // HackerRank
    hrBadges?: string[];
    hrCertifications?: string[];
    // Portfolio
    technologies?: string[];
    hasSSL?: boolean;
    seoScore?: number;
    performanceScore?: number;
    // Certifications
    certifications?: string[];
    platforms?: string[];
    // Dev Blogs
    recentArticles?: Array<{ title: string; reactions: number; platform: string }>;
    blogTopTags?: string[];
    [key: string]: unknown;
  };
}

export interface IntegrationInsightsResponse {
  providers: Array<{
    provider: ProviderName;
    profileScore: number;
    activityScore: number;
    confidence: number;
    inferredSkills?: string[];
    normalized?: ProviderInsightNormalized;
    syncedAt?: string;
  }>;
  mergedSkills: string[];
  integrationScore: number;
  updatedAt?: string | null;
}

@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private readonly baseUrl = `${environment.apiBaseUrl}/integrations`;

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
    return this.http.post<any>(`${this.baseUrl}/oauth/start`, { provider });
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

  syncNow(provider?: ProviderName): Observable<any> {
    return this.http.post(`${this.baseUrl}/sync-now`, provider ? { provider } : {});
  }

  disconnect(provider: ProviderName): Observable<any> {
    return this.http.delete(`${this.baseUrl}/connections/${provider}`);
  }

  getInsights(): Observable<IntegrationInsightsResponse> {
    return this.http.get<IntegrationInsightsResponse>(`${this.baseUrl}/insights`);
  }
}
