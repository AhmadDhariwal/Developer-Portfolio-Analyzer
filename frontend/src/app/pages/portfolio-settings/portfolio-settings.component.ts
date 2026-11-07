import { Component, OnInit, OnDestroy, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map } from 'rxjs';
import { AuthService } from '../../shared/services/auth.service';
import { ThemeService } from '../../shared/services/theme.service';
import {
  normalizePortfolio,
  portfolioError,
  portfolioImage,
  portfolioLink,
} from '../../shared/utils/public-profile.utils';
import {
  PublicProfileService,
  PublicProfilePayload,
  PublicProfileSkill,
  PublicProfileAnalytics,
  PublicProfileSections,
  PublicProfileWorkExperience,
  PublicProfileUpcomingProject,
  PublicProfileTestimonial,
  PublicProfileCompletedCourse,
} from '../../shared/services/public-profile.service';

@Component({
  selector: 'app-portfolio-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portfolio-settings.component.html',
  styleUrl: './portfolio-settings.component.scss',
})
export class PortfolioSettingsComponent implements OnInit, OnDestroy {
  profile: PublicProfilePayload | null = null;
  analytics: PublicProfileAnalytics | null = null;
  isLoading = true;
  isSaving = false;
  message = '';
  copyFeedback = '';
  errorMessage = '';
  analyticsError = '';
  analyticsLoading = false;
  activeTab = 'profile';
  published = false;
  savedSlug = '';
  needsReload = false;
  private sessionReloadRequired = false;
  messageIsError = false;
  private generation = 0;
  private account = '';
  private savedSnapshot = '';
  private readonly uploads = new Map<object, { preview: string; busy: boolean; error: string }>();
  readonly tabs = [
    { id: 'profile', label: 'Profile & copy' },
    { id: 'projects', label: 'Projects' },
    { id: 'skills', label: 'Skills' },
    { id: 'credentials', label: 'Experience & credentials' },
    { id: 'sharing', label: 'Sharing & SEO' },
  ];
  readonly image = portfolioImage;

  constructor(
    private readonly profileService: PublicProfileService,
    private readonly cdr: ChangeDetectorRef,
    readonly theme: ThemeService,
    private readonly auth: AuthService,
    private readonly destroy: DestroyRef,
  ) {}

  ngOnInit(): void {
    this.profileService.sessionChanged$.pipe(takeUntilDestroyed(this.destroy)).subscribe(() => {
      this.generation++;
      this.clearUploads();
      this.profile = null;
      this.analytics = null;
      this.published = false;
      this.savedSnapshot = '';
      this.savedSlug = '';
      this.isSaving = false;
      this.isLoading = false;
      this.sessionReloadRequired = true;
      this.errorMessage = 'Your account session changed. Reload this page to continue.';
      this.cdr.markForCheck();
    });
    this.auth.currentUser$
      .pipe(
        map((user) => String(user?._id || '')),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((account) => {
        this.sessionReloadRequired = false;
        this.account = account;
        this.generation++;
        this.clearUploads();
        this.profile = null;
        this.analytics = null;
        this.isSaving = false;
        if (account) this.loadProfile();
        else {
          this.isLoading = false;
          this.errorMessage = 'Sign in to manage your portfolio.';
        }
      });
    this.profileService.invalidated$.pipe(takeUntilDestroyed(this.destroy)).subscribe(() => {
      if (
        this.sessionReloadRequired ||
        this.isSaving ||
        this.account !== String(this.auth.getCurrentUser()?._id || '')
      )
        return;
      this.published = false;
      this.analytics = null;
      if (this.profile && JSON.stringify(this.profile) !== this.savedSnapshot) {
        this.needsReload = true;
        this.errorMessage =
          'Portfolio state changed elsewhere. Reload the saved version before saving or previewing.';
      } else this.loadProfile();
      this.cdr.markForCheck();
    });
  }

  loadProfile(): void {
    if (this.sessionReloadRequired) return;
    const generation = ++this.generation;
    this.clearUploads();
    this.savedSnapshot = '';
    this.profile = null;
    this.analytics = null;
    this.errorMessage = '';
    this.message = '';
    this.needsReload = false;
    this.isLoading = true;
    this.profileService
      .getMyPublicProfile()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (profile) => {
          if (generation !== this.generation) return;
          this.profile = this.forEditing(profile);
          this.published = profile.isPublic === true;
          this.savedSlug = profile.slug;
          this.savedSnapshot = JSON.stringify(this.profile);
          this.isLoading = false;
          this.loadAnalytics();
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (generation !== this.generation) return;
          this.isLoading = false;
          this.errorMessage = portfolioError(error, 'Unable to load portfolio settings.');
          this.cdr.markForCheck();
        },
      });
  }

  loadAnalytics(): void {
    const generation = this.generation;
    this.analytics = null;
    this.analyticsError = '';
    this.analyticsLoading = true;
    this.profileService
      .getAnalytics()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (analytics) => {
          if (generation !== this.generation) return;
          this.analytics = analytics;
          this.analyticsLoading = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (generation !== this.generation) return;
          this.analyticsLoading = false;
          this.analyticsError = portfolioError(error, 'Analytics is unavailable.');
          this.cdr.markForCheck();
        },
      });
  }

  get shareUrl(): string {
    return this.savedSlug
      ? (globalThis.location?.origin || '') + '/p/' + encodeURIComponent(this.savedSlug)
      : '';
  }
  reloadSettings(): void {
    if (this.sessionReloadRequired) globalThis.location.reload();
    else this.loadProfile();
  }
  get uploading(): boolean {
    return [...this.uploads.values()].some((item) => item.busy);
  }
  get analyticsMax(): number {
    return Math.max(1, ...(this.analytics?.last7Days || []).map((day) => day.count));
  }
  uploadState(project: object) {
    return this.uploads.get(project);
  }
  projectImage(project: { imageUrl?: string }): string {
    return this.uploads.get(project)?.preview || portfolioImage(project.imageUrl);
  }
  uploadProjectImage(event: Event, project: { imageUrl?: string }): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.isSaving) return;
    const previous = this.uploads.get(project);
    if (previous?.busy) return;
    if (previous?.preview) URL.revokeObjectURL(previous.preview);
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024 ||
      file.size === 0
    ) {
      this.uploads.set(project, {
        preview: '',
        busy: false,
        error: 'Choose a PNG, JPG or WebP image up to 2 MiB.',
      });
      return;
    }
    const generation = this.generation;
    const state = { preview: URL.createObjectURL(file), busy: true, error: '' };
    this.uploads.set(project, state);
    this.profileService
      .uploadImage(file)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          if (generation !== this.generation || this.uploads.get(project) !== state) return;
          state.busy = false;
          if (portfolioImage(result.imageUrl)) project.imageUrl = result.imageUrl;
          else state.error = 'The server returned an invalid image address.';
          URL.revokeObjectURL(state.preview);
          state.preview = '';
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (generation !== this.generation || this.uploads.get(project) !== state) return;
          state.busy = false;
          state.error = portfolioError(error, 'Image upload failed. Try another file.');
          URL.revokeObjectURL(state.preview);
          state.preview = '';
          this.cdr.markForCheck();
        },
      });
  }
  private forgetImage(project: object): void {
    const state = this.uploads.get(project);
    if (state?.preview) URL.revokeObjectURL(state.preview);
    this.uploads.delete(project);
  }
  private clearUploads(): void {
    for (const state of this.uploads.values())
      if (state.preview) URL.revokeObjectURL(state.preview);
    this.uploads.clear();
  }
  ngOnDestroy(): void {
    this.savedSnapshot = '';
    this.generation++;
    this.clearUploads();
  }

  private forEditing(value: PublicProfilePayload): PublicProfilePayload {
    const profile = normalizePortfolio(value);
    if (profile.defaultResumeUrl && profile.sections.cta.resumeUrl === profile.defaultResumeUrl)
      profile.sections.cta.resumeUrl = '';
    return profile;
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
    if (this.profile.slug !== this.savedSlug)
      this.profile.slug = this.normalizeSlugValue(this.profile.slug);
  }

  copyShareUrl(): void {
    if (!this.published) {
      this.copyFeedback = 'Publish your portfolio before sharing its public link.';
      return;
    }
    const url = this.shareUrl;
    if (!url || typeof navigator === 'undefined' || !navigator.clipboard) {
      this.copyFeedback = 'Copy is unavailable in this browser.';
      this.cdr.detectChanges();
      return;
    }

    navigator.clipboard
      .writeText(url)
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
    if (!this.savedSlug || this.needsReload || this.isSaving) return;
    const previewUrl = this.shareUrl + '?preview=1';
    globalThis.open(previewUrl, '_blank', 'noopener,noreferrer');
  }

  trackByIndex(index: number): number {
    return index;
  }

  addSkill(): void {
    if (!this.profile || (this.profile.skills?.length || 0) >= 12) return;
    this.profile.skills = [...this.profile.skills, { name: '', score: 0 }];
  }

  removeSkill(index: number): void {
    if (!this.profile) return;
    this.profile.skills.splice(index, 1);
  }

  addProject(): void {
    if (!this.profile || (this.profile.projects?.length || 0) >= 12) return;
    this.profile.projects = [
      ...this.profile.projects,
      {
        title: '',
        description: '',
        url: '',
        repoUrl: '',
        imageUrl: '',
        status: 'completed',
        expectedDate: '',
        tech: [],
      },
    ];
  }

  removeProject(index: number): void {
    if (!this.profile) return;
    this.forgetImage(this.profile.projects[index]);
    this.profile.projects.splice(index, 1);
  }

  addProjectTech(projectIndex: number): void {
    if (!this.profile) return;
    const project = this.profile.projects[projectIndex];
    if (!project) return;
    if (project.tech.length < 10) project.tech = [...project.tech, ''];
  }

  removeProjectTech(projectIndex: number, techIndex: number): void {
    if (!this.profile) return;
    const project = this.profile.projects[projectIndex];
    if (!project) return;
    project.tech.splice(techIndex, 1);
  }

  addUpcomingProject(): void {
    if (!this.profile || (this.profile.upcomingProjects?.length || 0) >= 12) return;
    this.profile.upcomingProjects = [
      ...(this.profile.upcomingProjects || []),
      {
        title: '',
        description: '',
        expectedDate: '',
        techStack: [],
        status: 'planned',
        url: '',
        repoUrl: '',
        imageUrl: '',
      },
    ];
  }

  removeUpcomingProject(index: number): void {
    if (!this.profile) return;
    this.forgetImage(this.profile.upcomingProjects[index]);
    this.profile.upcomingProjects.splice(index, 1);
  }

  addUpcomingTech(projectIndex: number): void {
    if (!this.profile) return;
    const project = this.profile.upcomingProjects[projectIndex];
    if (!project) return;
    if (project.techStack.length < 10) project.techStack = [...project.techStack, ''];
  }

  removeUpcomingTech(projectIndex: number, techIndex: number): void {
    if (!this.profile) return;
    const project = this.profile.upcomingProjects[projectIndex];
    if (!project) return;
    project.techStack.splice(techIndex, 1);
  }

  addTestimonial(): void {
    if (!this.profile || (this.profile.testimonials?.length || 0) >= 12) return;
    this.profile.testimonials = [
      ...(this.profile.testimonials || []),
      {
        quote: '',
        name: '',
        role: '',
        avatarUrl: '',
      },
    ];
  }

  removeTestimonial(index: number): void {
    if (!this.profile) return;
    this.profile.testimonials.splice(index, 1);
  }

  addWorkExperience(): void {
    if (!this.profile || (this.profile.workExperiences?.length || 0) >= 8) return;
    this.profile.workExperiences = [
      ...(this.profile.workExperiences || []),
      {
        title: '',
        description: '',
        icon: 'mdi-rocket-launch',
        ctaLabel: 'Learn More',
        ctaUrl: '',
      },
    ];
  }

  removeWorkExperience(index: number): void {
    if (!this.profile) return;
    this.profile.workExperiences.splice(index, 1);
  }

  addCourse(): void {
    if (!this.profile || (this.profile.completedCourses?.length || 0) >= 50) return;
    this.profile.completedCourses = [
      ...(this.profile.completedCourses || []),
      {
        title: '',
        provider: '',
        category: '',
        skills: [],
        completionDate: null,
        duration: '',
        certificateUrl: '',
        credentialId: '',
        description: '',
        order: (this.profile.completedCourses || []).length,
        isVisible: true,
      },
    ];
  }

  removeCourse(index: number): void {
    if (!this.profile) return;
    this.profile.completedCourses!.splice(index, 1);
  }

  addCourseSkill(courseIndex: number): void {
    if (!this.profile) return;
    const course = this.profile.completedCourses![courseIndex];
    if (!course) return;
    if ((course.skills?.length || 0) < 10) course.skills = [...(course.skills || []), ''];
  }

  removeCourseSkill(courseIndex: number, skillIndex: number): void {
    if (!this.profile) return;
    const course = this.profile.completedCourses![courseIndex];
    if (!course) return;
    course.skills!.splice(skillIndex, 1);
  }

  private validateDraft(): string {
    if (!this.profile) return 'Portfolio is unavailable.';
    if (!this.profile.slug.trim()) return 'Enter a portfolio URL slug.';
    if (this.normalizeSlugValue(this.profile.slug) === 'me')
      return 'Choose a different URL slug; “me” is reserved.';
    for (const [items, label] of [
      [this.profile.projects, 'project'],
      [this.profile.upcomingProjects, 'upcoming project'],
      [this.profile.workExperiences, 'experience'],
      [this.profile.completedCourses || [], 'course'],
    ] as const) {
      if (items.some((item) => !item.title.trim()))
        return 'Add a title to every ' + label + ', or remove the empty entry.';
    }
    if (this.profile.skills.some((skill) => !skill.name.trim()))
      return 'Name each skill or remove the empty entry.';
    if (this.profile.testimonials.some((item) => !item.name.trim() || !item.quote.trim()))
      return 'Each testimonial needs an author and a quote.';
    let error = '';
    const inspect = (value: unknown, key = ''): void => {
      if (typeof value === 'string') {
        if (/[<>]/.test(value)) error = 'Use plain text without HTML markup.';
        if (
          value &&
          [
            'url',
            'repoUrl',
            'imageUrl',
            'avatarUrl',
            'ctaUrl',
            'certificateUrl',
            'resumeUrl',
            'website',
            'twitter',
            'linkedin',
            'github',
          ].includes(key)
        ) {
          if (
            !(key === 'imageUrl' || key === 'avatarUrl'
              ? portfolioImage(value)
              : portfolioLink(value))
          )
            error = 'Check your links: use a valid HTTP or HTTPS address.';
        }
      } else if (Array.isArray(value)) value.forEach((item) => inspect(item));
      else if (value && typeof value === 'object')
        Object.entries(value).forEach(([name, item]) => inspect(item, name));
    };
    inspect({
      headline: this.profile.headline,
      summary: this.profile.summary,
      sections: {
        ...this.profile.sections,
        cta: {
          ...this.profile.sections.cta,
          resumeUrl:
            this.profile.sections.cta.resumeUrl === this.profile.defaultResumeUrl
              ? ''
              : this.profile.sections.cta.resumeUrl,
        },
      },
      projects: this.profile.projects,
      upcomingProjects: this.profile.upcomingProjects,
      testimonials: this.profile.testimonials,
      completedCourses: this.profile.completedCourses,
      workExperiences: this.profile.workExperiences,
      socialLinks: this.profile.socialLinks,
    });
    return error;
  }

  saveProfile(): void {
    if (!this.profile || this.isSaving || this.uploading || this.needsReload) return;
    const validation = this.validateDraft();
    if (validation) {
      this.message = validation;
      this.messageIsError = true;
      return;
    }
    const generation = this.generation;
    this.isSaving = true;
    this.messageIsError = false;
    this.message = '';
    this.copyFeedback = '';

    this.normalizeSlug();

    const normalizedSkills = this.profile.skills
      .map((skill) => ({
        name: String(skill?.name || '').trim(),
        score: Math.max(0, Math.min(100, Math.round(Number(skill?.score || 0)))),
      }))
      .filter((skill) => skill.name);

    const normalizedProjects = this.profile.projects
      .map((project) => ({
        title: String(project?.title || '').trim(),
        description: String(project?.description || '').trim(),
        url: String(project?.url || '').trim(),
        repoUrl: String(project?.repoUrl || '').trim(),
        imageUrl: String(project?.imageUrl || '').trim(),
        status: (String(project?.status || 'completed')
          .trim()
          .toLowerCase() || 'completed') as 'completed' | 'in-progress' | 'upcoming' | 'planned',
        expectedDate: String(project?.expectedDate || '').trim(),
        tech: Array.isArray(project?.tech)
          ? project.tech.map((tech) => String(tech || '').trim()).filter(Boolean)
          : [],
      }))
      .filter((project) => project.title);

    const normalizedUpcomingProjects = (this.profile.upcomingProjects || [])
      .map((project) => ({
        title: String(project?.title || '').trim(),
        description: String(project?.description || '').trim(),
        expectedDate: String(project?.expectedDate || '').trim(),
        status: (String(project?.status || 'planned')
          .trim()
          .toLowerCase() === 'in-progress'
          ? 'in-progress'
          : 'planned') as 'in-progress' | 'planned',
        url: String(project?.url || '').trim(),
        repoUrl: String(project?.repoUrl || '').trim(),
        imageUrl: String(project?.imageUrl || '').trim(),
        techStack: Array.isArray(project?.techStack)
          ? project.techStack.map((tech) => String(tech || '').trim()).filter(Boolean)
          : [],
      }))
      .filter((project) => project.title);

    const normalizedTestimonials = (this.profile.testimonials || [])
      .map((testimonial) => ({
        quote: String(testimonial?.quote || '').trim(),
        name: String(testimonial?.name || '').trim(),
        role: String(testimonial?.role || '').trim(),
        avatarUrl: String(testimonial?.avatarUrl || '').trim(),
      }))
      .filter((testimonial) => testimonial.quote && testimonial.name);

    const normalizedWorkExperiences = (this.profile.workExperiences || [])
      .map((experience) => ({
        title: String(experience?.title || '').trim(),
        description: String(experience?.description || '').trim(),
        icon: String(experience?.icon || '').trim(),
        ctaLabel: String(experience?.ctaLabel || '').trim(),
        ctaUrl: String(experience?.ctaUrl || '').trim(),
      }))
      .filter((experience) => experience.title);

    const normalizedCompletedCourses = (this.profile.completedCourses || [])
      .map((course) => ({
        title: String(course?.title || '').trim(),
        provider: String(course?.provider || '').trim(),
        category: String(course?.category || '').trim(),
        skills: Array.isArray(course?.skills)
          ? course.skills.map((skill) => String(skill || '').trim()).filter(Boolean)
          : [],
        completionDate: course?.completionDate || null,
        duration: String(course?.duration || '').trim(),
        certificateUrl: String(course?.certificateUrl || '').trim(),
        credentialId: String(course?.credentialId || '').trim(),
        description: String(course?.description || '').trim(),
        order: Number.isFinite(Number(course?.order)) ? Number(course.order) : 0,
        isVisible: course?.isVisible !== false,
      }))
      .filter((course) => course.title);

    const normalizedSections: PublicProfileSections = {
      hero: {
        greetingLabel: String(this.profile.sections?.hero?.greetingLabel || '').trim(),
        roleLabel: String(this.profile.sections?.hero?.roleLabel || '').trim(),
        titleLineOne: String(this.profile.sections?.hero?.titleLineOne || '').trim(),
        titleLineTwo: String(this.profile.sections?.hero?.titleLineTwo || '').trim(),
        titleHighlight: String(this.profile.sections?.hero?.titleHighlight || '').trim(),
        titleLineSuffix: String(this.profile.sections?.hero?.titleLineSuffix || '').trim(),
        tagline: String(this.profile.sections?.hero?.tagline || '').trim(),
      },
      skills: {
        headline: String(this.profile.sections?.skills?.headline || '').trim(),
        highlight: String(this.profile.sections?.skills?.highlight || '').trim(),
        headlineSuffix: String(this.profile.sections?.skills?.headlineSuffix || '').trim(),
        subheadline: String(this.profile.sections?.skills?.subheadline || '').trim(),
      },
      contact: {
        heading: String(this.profile.sections?.contact?.heading || '').trim(),
        message: String(this.profile.sections?.contact?.message || '').trim(),
        email: String(this.profile.sections?.contact?.email || '')
          .trim()
          .toLowerCase(),
      },
      upcoming: {
        heading: String(this.profile.sections?.upcoming?.heading || '').trim(),
        subheading: String(this.profile.sections?.upcoming?.subheading || '').trim(),
      },
      testimonials: {
        heading: String(this.profile.sections?.testimonials?.heading || '').trim(),
        subheading: String(this.profile.sections?.testimonials?.subheading || '').trim(),
      },
      cta: {
        heading: String(this.profile.sections?.cta?.heading || '').trim(),
        subtext: String(this.profile.sections?.cta?.subtext || '').trim(),
        primaryLabel: String(this.profile.sections?.cta?.primaryLabel || '').trim(),
        secondaryLabel: String(this.profile.sections?.cta?.secondaryLabel || '').trim(),
        resumeUrl:
          this.profile.sections.cta.resumeUrl === this.profile.defaultResumeUrl
            ? ''
            : String(this.profile.sections.cta.resumeUrl || '').trim(),
      },
      visibility: {
        projects: Boolean(this.profile.sections?.visibility?.projects ?? true),
        upcoming: Boolean(this.profile.sections?.visibility?.upcoming ?? true),
        testimonials: Boolean(this.profile.sections?.visibility?.testimonials ?? true),
        cta: Boolean(this.profile.sections?.visibility?.cta ?? true),
      },
    };

    const payload = {
      ...(this.profile.slug !== this.savedSlug ? { slug: this.profile.slug } : {}),
      isPublic: this.profile.isPublic,
      headline: this.profile.headline,
      summary: this.profile.summary,
      seoTitle: this.profile.seoTitle,
      seoDescription: this.profile.seoDescription,
      skills: normalizedSkills as PublicProfileSkill[],
      projects: normalizedProjects,
      upcomingProjects: normalizedUpcomingProjects as PublicProfileUpcomingProject[],
      testimonials: normalizedTestimonials as PublicProfileTestimonial[],
      workExperiences: normalizedWorkExperiences as PublicProfileWorkExperience[],
      completedCourses: normalizedCompletedCourses as PublicProfileCompletedCourse[],
      sections: normalizedSections,
      socialLinks: this.profile.socialLinks,
    };

    this.profileService
      .updateMyPublicProfile(payload)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (profile) => {
          if (generation !== this.generation) return;
          const savedProfile = normalizePortfolio(profile);
          this.profile = savedProfile;
          this.isSaving = false;

          this.clearUploads();
          this.savedSlug = savedProfile.slug;
          this.published = savedProfile.isPublic === true;
          this.savedSnapshot = JSON.stringify(savedProfile);
          this.message = 'Portfolio changes saved.';
          this.messageIsError = false;
          this.loadAnalytics();
          this.cdr.detectChanges();
        },
        error: (err) => {
          if (generation !== this.generation) return;
          this.isSaving = false;
          this.messageIsError = true;
          this.message = portfolioError(err, 'Failed to update portfolio.');
          this.cdr.detectChanges();
        },
      });
  }
}
