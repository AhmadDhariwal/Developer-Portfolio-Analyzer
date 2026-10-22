import { HttpErrorResponse } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { PublicProfilePayload, PublicProfileSections } from '../services/public-profile.service';

export const emptyPortfolioSections = (): PublicProfileSections => ({
  hero: {
    greetingLabel: '',
    roleLabel: '',
    titleLineOne: '',
    titleLineTwo: '',
    titleHighlight: '',
    titleLineSuffix: '',
    tagline: '',
  },
  skills: { headline: '', highlight: '', headlineSuffix: '', subheadline: '' },
  contact: { heading: '', message: '', email: '' },
  upcoming: { heading: '', subheading: '' },
  testimonials: { heading: '', subheading: '' },
  cta: { heading: '', subtext: '', primaryLabel: '', secondaryLabel: '', resumeUrl: '' },
  visibility: { projects: true, upcoming: true, testimonials: true, cta: true },
});

export function normalizePortfolio(value: PublicProfilePayload): PublicProfilePayload {
  const profile = structuredClone(value);
  const defaults = emptyPortfolioSections();
  profile.sections = Object.fromEntries(
    Object.entries(defaults).map(([key, section]) => [
      key,
      { ...section, ...profile.sections?.[key as keyof PublicProfileSections] },
    ]),
  ) as unknown as PublicProfileSections;
  profile.skills = (profile.skills || []).slice(0, 12);
  profile.projects = (profile.projects || [])
    .slice(0, 12)
    .map((project) => ({ ...project, tech: project.tech || [] }));
  profile.upcomingProjects = (profile.upcomingProjects || [])
    .slice(0, 12)
    .map((project) => ({ ...project, techStack: project.techStack || [] }));
  profile.testimonials = (profile.testimonials || []).slice(0, 12);
  profile.workExperiences = (profile.workExperiences || []).slice(0, 8);
  profile.completedCourses = (profile.completedCourses || [])
    .slice(0, 50)
    .map((course) => ({ ...course, skills: course.skills || [] }));
  profile.socialLinks = { ...profile.socialLinks };
  return profile;
}

// A preview can contain private owner fields. Render it with the same field and
// section exclusions as a public view, without retaining the source object.
export function portfolioForDisplay(value: PublicProfilePayload): PublicProfilePayload {
  const profile = normalizePortfolio(value);
  delete profile.analytics;
  delete profile.email;
  delete profile.phoneNumber;
  delete (profile as PublicProfilePayload & { id?: string }).id;
  profile.momentum = null;
  profile.sections.contact.email = '';
  profile.user = {
    name: profile.user.name,
    jobTitle: profile.user.jobTitle,
    location: profile.user.location,
    avatar: profile.user.avatar,
    githubUsername: profile.user.githubUsername,
  };
  for (const section of ['projects', 'upcoming', 'testimonials', 'cta'] as const) {
    if (profile.sections.visibility[section] === false) {
      if (section === 'projects') profile.projects = [];
      if (section === 'upcoming') profile.upcomingProjects = [];
      if (section === 'testimonials') profile.testimonials = [];
      if (section === 'cta') {
        profile.resumeUrl = '';
        profile.defaultResumeUrl = '';
      }
    }
  }
  profile.completedCourses = profile.completedCourses
    ?.filter((course) => course.isVisible !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  return profile;
}

export function portfolioLink(value?: string): string {
  const raw = String(value || '').trim();
  if (!raw || /[\u0000-\u0020<>"']/.test(raw) || raw.startsWith('/')) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}

export function portfolioImage(value?: string): string {
  const raw = String(value || '').trim();
  if (/^\/uploads\/(avatars|portfolio-images)\/[a-z0-9._-]+\.(png|jpe?g|webp)$/i.test(raw))
    return `${environment.apiOrigin}${raw}`;
  return portfolioLink(raw);
}

export function portfolioError(error: unknown, fallback: string): string {
  const response = error as HttpErrorResponse;
  if (response.status === 429) {
    const seconds = Number(response.headers?.get('Retry-After'));
    return `Too many requests. ${seconds > 0 ? `Try again in ${Math.ceil(seconds)} seconds.` : 'Please try again later.'}`;
  }
  if (response.status === 503 || response.status === 0)
    return 'Temporarily unavailable. Please try again shortly.';
  if (response.status === 401) return 'Sign in again to continue.';
  if (response.status === 403) return 'Your account does not have access to this action.';
  return typeof response.error?.message === 'string' ? response.error.message : fallback;
}
