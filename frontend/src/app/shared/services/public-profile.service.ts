import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface PublicProfileSkill {
  name: string;
  score: number;
}

export interface PublicProfileAnalytics {
  totalViews: number;
  uniqueViews: number;
  lastViewedAt: string | null;
  last7Days?: Array<{ date: string; count: number }>;
}

export interface PublicProfilePayload {
  slug: string;
  isPublic: boolean;
  headline: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  skills: PublicProfileSkill[];
  projects: Array<{ title: string; description: string; url: string; tech: string[] }>;
  socialLinks: { website?: string; twitter?: string; linkedin?: string; github?: string };
  analytics: PublicProfileAnalytics;
  user: { name: string; jobTitle: string; location: string; avatar: string; githubUsername: string };
}

@Injectable({
  providedIn: 'root'
})
export class PublicProfileService {
  constructor(private readonly api: ApiService) {}

  getPublicProfile(slug: string): Observable<PublicProfilePayload> {
    return this.api.getPublicProfile(slug);
  }

  getMyPublicProfile(): Observable<PublicProfilePayload> {
    return this.api.getMyPublicProfile();
  }

  updateMyPublicProfile(payload: Partial<PublicProfilePayload>): Observable<PublicProfilePayload> {
    return this.api.updateMyPublicProfile(payload);
  }

  getAnalytics(): Observable<PublicProfileAnalytics> {
    return this.api.getPublicProfileAnalytics();
  }
}
