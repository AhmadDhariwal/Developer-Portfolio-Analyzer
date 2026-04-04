import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface PublicProfileSkill {
  name: string;
  score: number;
}

export interface PublicProfileProject {
  title: string;
  description: string;
  url: string;
  repoUrl?: string;
  imageUrl?: string;
  tech: string[];
  status?: 'completed' | 'in-progress' | 'upcoming' | 'planned';
  expectedDate?: string;
}

export interface PublicProfileUpcomingProject {
  title: string;
  description: string;
  expectedDate: string;
  techStack: string[];
  status?: 'in-progress' | 'planned';
  url?: string;
  repoUrl?: string;
  imageUrl?: string;
}

export interface PublicProfileTestimonial {
  quote: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

export interface PublicProfileWorkExperience {
  title: string;
  description: string;
  icon: string;
  ctaLabel: string;
  ctaUrl: string;
}

export interface PublicProfileSections {
  hero: {
    greetingLabel: string;
    roleLabel: string;
    titleLineOne: string;
    titleLineTwo: string;
    titleHighlight: string;
    titleLineSuffix: string;
    tagline: string;
  };
  skills: {
    headline: string;
    highlight: string;
    headlineSuffix: string;
    subheadline: string;
  };
  contact: {
    heading: string;
    message: string;
    email: string;
  };
  upcoming: {
    heading: string;
    subheading: string;
  };
  testimonials: {
    heading: string;
    subheading: string;
  };
  cta: {
    heading: string;
    subtext: string;
    primaryLabel: string;
    secondaryLabel: string;
    resumeUrl: string;
  };
  visibility: {
    projects: boolean;
    upcoming: boolean;
    testimonials: boolean;
    cta: boolean;
  };
}

export interface PublicProfileAnalytics {
  totalViews: number;
  uniqueViews: number;
  uniqueViewRate?: number;
  lastViewedAt: string | null;
  last7Days?: Array<{ date: string; count: number }>;
}

export interface PublicProfileMomentum {
  weekEndDate: string;
  score: number;
  summary: string;
  topAchievements: string[];
  biggestRiskArea: string;
}

export interface PublicProfilePayload {
  slug: string;
  isPublic: boolean;
  headline: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  skills: PublicProfileSkill[];
  projects: PublicProfileProject[];
  upcomingProjects: PublicProfileUpcomingProject[];
  testimonials: PublicProfileTestimonial[];
  workExperiences: PublicProfileWorkExperience[];
  sections: PublicProfileSections;
  socialLinks: { website?: string; twitter?: string; linkedin?: string; github?: string };
  analytics: PublicProfileAnalytics;
  profileStrengthScore?: number;
  momentum?: PublicProfileMomentum | null;
  user: { name: string; jobTitle: string; location: string; avatar: string; githubUsername: string; email?: string };
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
