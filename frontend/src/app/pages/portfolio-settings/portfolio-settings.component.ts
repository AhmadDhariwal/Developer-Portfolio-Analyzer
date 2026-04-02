import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PublicProfileService,
  PublicProfilePayload,
  PublicProfileSkill,
  PublicProfileAnalytics,
  PublicProfileSections,
  PublicProfileWorkExperience
} from '../../shared/services/public-profile.service';

@Component({
  selector: 'app-portfolio-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portfolio-settings.component.html',
  styleUrl: './portfolio-settings.component.scss'
})
export class PortfolioSettingsComponent implements OnInit {
  profile: PublicProfilePayload | null = null;
  analytics: PublicProfileAnalytics | null = null;
  isLoading = true;
  isSaving = false;
  message = '';
  copyFeedback = '';

  constructor(
    private readonly profileService: PublicProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.isLoading = true;
    this.profileService.getMyPublicProfile().subscribe({
      next: (profile) => {
        this.profile = this.ensureProfileShape(profile);
        this.isLoading = false;
        this.loadAnalytics();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadAnalytics(): void {
    this.profileService.getAnalytics().subscribe({
      next: (analytics) => {
        this.analytics = analytics;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cdr.detectChanges();
      }
    });
  }

  get shareUrl(): string {
    if (!this.profile) return '';
    const origin = globalThis.location?.origin || '';
    return `${origin}/p/${this.profile.slug}`;
  }

  private ensureProfileShape(profile: PublicProfilePayload): PublicProfilePayload {
    const defaultSections: PublicProfileSections = {
      hero: {
        greetingLabel: 'Hello! I Am',
        roleLabel: 'A Developer who',
        titleLineOne: 'Judges a book',
        titleLineTwo: 'by its',
        titleHighlight: 'cover',
        titleLineSuffix: '...',
        tagline: 'Because if the cover does not impress you what else can?'
      },
      skills: {
        headline: "I'm currently looking to join a",
        highlight: 'cross-functional',
        headlineSuffix: 'team',
        subheadline: "that values improving people's lives through accessible design"
      },
      contact: {
        heading: 'Contact',
        message: "I'm currently looking to join a cross-functional team that values improving people's lives through accessible design. Or have a project in mind? Let's connect.",
        email: String(profile.user?.email || '').trim().toLowerCase()
      }
    };

    const heroOverride = profile.sections?.hero as Partial<PublicProfileSections['hero']> | undefined;
    const skillsOverride = profile.sections?.skills as Partial<PublicProfileSections['skills']> | undefined;
    const contactOverride = profile.sections?.contact as Partial<PublicProfileSections['contact']> | undefined;

    const heroSection: PublicProfileSections['hero'] = {
      ...defaultSections.hero,
      ...heroOverride
    };
    const skillsSection: PublicProfileSections['skills'] = {
      ...defaultSections.skills,
      ...skillsOverride
    };
    const contactSection: PublicProfileSections['contact'] = {
      ...defaultSections.contact,
      ...contactOverride
    };

    return {
      ...profile,
      skills: Array.isArray(profile.skills) ? profile.skills : [],
      projects: Array.isArray(profile.projects)
        ? profile.projects.map((project) => ({
          ...project,
          repoUrl: String(project.repoUrl || ''),
          imageUrl: String(project.imageUrl || '')
        }))
        : [],
      workExperiences: Array.isArray(profile.workExperiences) ? profile.workExperiences : [],
      sections: {
        hero: heroSection,
        skills: skillsSection,
        contact: contactSection
      },
      socialLinks: {
        website: profile.socialLinks?.website || '',
        twitter: profile.socialLinks?.twitter || '',
        linkedin: profile.socialLinks?.linkedin || '',
        github: profile.socialLinks?.github || ''
      },
      analytics: profile.analytics || {
        totalViews: 0,
        uniqueViews: 0,
        lastViewedAt: null,
        last7Days: []
      }
    };
  }

  private normalizeSlugValue(value: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, 48);
  }

  normalizeSlug(): void {
    if (!this.profile) return;
    this.profile.slug = this.normalizeSlugValue(this.profile.slug);
  }

  copyShareUrl(): void {
    const url = this.shareUrl;
    if (!url || typeof navigator === 'undefined' || !navigator.clipboard) {
      this.copyFeedback = 'Copy is unavailable in this browser.';
      this.cdr.detectChanges();
      return;
    }

    navigator.clipboard.writeText(url)
      .then(() => {
        this.copyFeedback = 'Share link copied';
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.copyFeedback = 'Unable to copy link';
        this.cdr.detectChanges();
      });
  }

  openPublicPreview(): void {
    if (!this.profile) return;
    const previewUrl = `${this.shareUrl}${this.shareUrl.includes('?') ? '&' : '?'}preview=${Date.now()}`;
    globalThis.open(previewUrl, '_blank', 'noopener,noreferrer');
  }

  trackByIndex(index: number): number {
    return index;
  }

  addSkill(): void {
    if (!this.profile) return;
    this.profile.skills = [...this.profile.skills, { name: 'New Skill', score: 60 }];
  }

  removeSkill(index: number): void {
    if (!this.profile) return;
    this.profile.skills.splice(index, 1);
  }

  addProject(): void {
    if (!this.profile) return;
    this.profile.projects = [
      ...this.profile.projects,
      {
        title: 'New Project',
        description: '',
        url: '',
        repoUrl: '',
        imageUrl: '',
        tech: ['Angular']
      }
    ];
  }

  removeProject(index: number): void {
    if (!this.profile) return;
    this.profile.projects.splice(index, 1);
  }

  addProjectTech(projectIndex: number): void {
    if (!this.profile) return;
    const project = this.profile.projects[projectIndex];
    if (!project) return;
    project.tech = [...(project.tech || []), 'New Tech'];
  }

  removeProjectTech(projectIndex: number, techIndex: number): void {
    if (!this.profile) return;
    const project = this.profile.projects[projectIndex];
    if (!project) return;
    project.tech.splice(techIndex, 1);
  }

  addWorkExperience(): void {
    if (!this.profile) return;
    this.profile.workExperiences = [
      ...(this.profile.workExperiences || []),
      {
        title: 'New Experience',
        description: '',
        icon: 'mdi-rocket-launch',
        ctaLabel: 'Learn More',
        ctaUrl: ''
      }
    ];
  }

  removeWorkExperience(index: number): void {
    if (!this.profile) return;
    this.profile.workExperiences.splice(index, 1);
  }

  getStrengthTip(score: number): string {
    if (score < 40) return 'Add more project outcomes and specific skills to improve your recruiter visibility.';
    if (score < 70) return 'You have a solid foundation. Adding a professional summary and social links will push you to the top tier.';
    if (score < 90) return 'Great portfolio! A bit more measurable impact in your project descriptions will make it perfect.';
    return 'Outstanding! Your portfolio is high-signal and ready for premium recruiter engagement.';
  }

  saveProfile(): void {
    if (!this.profile) return;
    this.isSaving = true;
    this.message = '';
    this.copyFeedback = '';

    this.normalizeSlug();

    const normalizedSkills = this.profile.skills
      .map((skill) => ({
        name: String(skill?.name || '').trim(),
        score: Math.max(0, Math.min(100, Math.round(Number(skill?.score || 0))))
      }))
      .filter((skill) => skill.name);

    const normalizedProjects = this.profile.projects
      .map((project) => ({
        title: String(project?.title || '').trim(),
        description: String(project?.description || '').trim(),
        url: String(project?.url || '').trim(),
        repoUrl: String(project?.repoUrl || '').trim(),
        imageUrl: String(project?.imageUrl || '').trim(),
        tech: Array.isArray(project?.tech)
          ? project.tech.map((tech) => String(tech || '').trim()).filter(Boolean)
          : []
      }))
      .filter((project) => project.title);

    const normalizedWorkExperiences = (this.profile.workExperiences || [])
      .map((experience) => ({
        title: String(experience?.title || '').trim(),
        description: String(experience?.description || '').trim(),
        icon: String(experience?.icon || '').trim(),
        ctaLabel: String(experience?.ctaLabel || '').trim(),
        ctaUrl: String(experience?.ctaUrl || '').trim()
      }))
      .filter((experience) => experience.title);

    const normalizedSections: PublicProfileSections = {
      hero: {
        greetingLabel: String(this.profile.sections?.hero?.greetingLabel || '').trim(),
        roleLabel: String(this.profile.sections?.hero?.roleLabel || '').trim(),
        titleLineOne: String(this.profile.sections?.hero?.titleLineOne || '').trim(),
        titleLineTwo: String(this.profile.sections?.hero?.titleLineTwo || '').trim(),
        titleHighlight: String(this.profile.sections?.hero?.titleHighlight || '').trim(),
        titleLineSuffix: String(this.profile.sections?.hero?.titleLineSuffix || '').trim(),
        tagline: String(this.profile.sections?.hero?.tagline || '').trim()
      },
      skills: {
        headline: String(this.profile.sections?.skills?.headline || '').trim(),
        highlight: String(this.profile.sections?.skills?.highlight || '').trim(),
        headlineSuffix: String(this.profile.sections?.skills?.headlineSuffix || '').trim(),
        subheadline: String(this.profile.sections?.skills?.subheadline || '').trim()
      },
      contact: {
        heading: String(this.profile.sections?.contact?.heading || '').trim(),
        message: String(this.profile.sections?.contact?.message || '').trim(),
        email: String(this.profile.sections?.contact?.email || '').trim().toLowerCase()
      }
    };

    const payload = {
      slug: this.profile.slug,
      isPublic: this.profile.isPublic,
      headline: this.profile.headline,
      summary: this.profile.summary,
      seoTitle: this.profile.seoTitle,
      seoDescription: this.profile.seoDescription,
      skills: normalizedSkills as PublicProfileSkill[],
      projects: normalizedProjects,
      workExperiences: normalizedWorkExperiences as PublicProfileWorkExperience[],
      sections: normalizedSections,
      socialLinks: this.profile.socialLinks
    };

    this.profileService.updateMyPublicProfile(payload).subscribe({
      next: (profile) => {
        const savedProfile = this.ensureProfileShape(profile);
        this.profile = savedProfile;
        this.isSaving = false;

        const expectedHeadline = String(payload.headline || '').trim();
        const savedHeadline = String(savedProfile.headline || '').trim();

        if (expectedHeadline && expectedHeadline !== savedHeadline) {
          this.message = 'Saved with warning: headline response mismatch. Please click Deploy Changes once more.';
        } else {
          this.message = 'Profile updated successfully.';
        }

        this.loadAnalytics();
        if (typeof globalThis.scrollTo === 'function') {
          globalThis.scrollTo({ top: 0, behavior: 'smooth' });
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSaving = false;
        this.message = err?.error?.message || 'Failed to update profile.';
        this.cdr.detectChanges();
      }
    });
  }
}
