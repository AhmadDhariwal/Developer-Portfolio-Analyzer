import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, Inject, OnInit, PLATFORM_ID, QueryList, ViewChildren } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import {
  PublicProfileService,
  PublicProfilePayload,
  PublicProfileCompletedCourse,
  PublicProfileProject,
  PublicProfileSections,
  PublicProfileUpcomingProject,
  PublicProfileTestimonial,
  PublicProfileWorkExperience
} from '../../shared/services/public-profile.service';
import { SkillIconService, SkillIcon } from '../../shared/services/skill-icon.service';
import { ProjectCardComponent } from './components/project-card/project-card.component';
import { UpcomingProjectsSectionComponent } from './components/upcoming-projects-section/upcoming-projects-section.component';
import { TestimonialsSectionComponent } from './components/testimonials-section/testimonials-section.component';
import { CtaSectionComponent } from './components/cta-section/cta-section.component';
import { environment } from '../../../environments/environment';
import { combineLatest } from 'rxjs';

type SectionId = 'home' | 'about' | 'projects' | 'upcoming' | 'testimonials' | 'cta' | 'contact';
type LinkableProject = { url?: string; repoUrl?: string; imageUrl?: string };

@Component({
  selector: 'app-public-portfolio',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ProjectCardComponent,
    UpcomingProjectsSectionComponent,
    TestimonialsSectionComponent,
    CtaSectionComponent
  ],
  templateUrl: './public-portfolio.component.html',
  styleUrl: './public-portfolio.component.scss'
})
export class PublicPortfolioComponent implements OnInit, AfterViewInit {
  @ViewChildren('revealSection') revealSections!: QueryList<ElementRef>;
  profile: PublicProfilePayload | null = null;
  isLoading = true;
  errorMessage = '';
  shareUrl = '';
  copyFeedback = '';
  shareMenuOpen = false;
  userAvatarSrc = '/avatar/profile.png';
  activeSection: SectionId = 'home';
  mobileMenuOpen = false;
  featuredProjects: PublicProfileProject[] = [];
  upcomingProjects: PublicProfileUpcomingProject[] = [];
  testimonials: PublicProfileTestimonial[] = [];
  completedCourses: PublicProfileCompletedCourse[] = [];
  cacheState: PublicProfilePayload['frontendCacheState'] = 'network';
  readonly previewResolver = (project: LinkableProject) => this.getProjectPreview(project);
  readonly primaryLinkResolver = (project: LinkableProject) => this.getProjectPrimaryLink(project);
  readonly repoLinkResolver = (project: LinkableProject) => this.getProjectRepositoryLink(project);
  private observer: IntersectionObserver | null = null;
  private readonly sectionIds: SectionId[] = ['home', 'about', 'projects', 'upcoming', 'testimonials', 'cta', 'contact'];
  private avatarVersion = Date.now();
  private readonly backendOrigin = environment.apiOrigin;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly profileService: PublicProfileService,
    private readonly title: Title,
    private readonly meta: Meta,
    private readonly cdr: ChangeDetectorRef,
    private readonly skillIconService: SkillIconService,
    @Inject(PLATFORM_ID) private readonly platformId: object
  ) {}

  ngOnInit(): void {
    combineLatest([this.route.params, this.route.queryParams]).subscribe(([params, queryParams]) => {
      const slug = params['slug'];
      if (slug) {
        const preview = queryParams['preview'] ? String(queryParams['preview']) : undefined;
        this.fetchProfile(slug, preview);
      }
    });
  }

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.setupScrollObserver();
      this.updateActiveSection();
    }
  }

  private setupScrollObserver(): void {
    // We observe any elements with the 'reveal-on-scroll' class (we'll add this to HTML or select native elements)
    const options = {
      root: null,
      rootMargin: '0px',
      threshold: 0.15
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          // Optional: stop observing once revealed
          // this.observer?.unobserve(entry.target);
        }
      });
    }, options);

    // Initial check in case elements are quickly loaded
    setTimeout(() => {
      document.querySelectorAll('.reveal-on-scroll').forEach((el) => {
        this.observer?.observe(el);
      });
    }, 500);
  }

  private ensureProfileShape(profile: PublicProfilePayload): PublicProfilePayload {
    const defaultRole = (profile.user.jobTitle || '').toLowerCase().includes('design') ? 'A Designer who' : 'A Developer who';
    const heroOverride = profile.sections?.hero as Partial<PublicProfileSections['hero']> | undefined;
    const skillsOverride = profile.sections?.skills as Partial<PublicProfileSections['skills']> | undefined;
    const contactOverride = profile.sections?.contact as Partial<PublicProfileSections['contact']> | undefined;
    const upcomingOverride = profile.sections?.upcoming as Partial<PublicProfileSections['upcoming']> | undefined;
    const testimonialsOverride = profile.sections?.testimonials as Partial<PublicProfileSections['testimonials']> | undefined;
    const ctaOverride = profile.sections?.cta as Partial<PublicProfileSections['cta']> | undefined;
    const visibilityOverride = profile.sections?.visibility as Partial<PublicProfileSections['visibility']> | undefined;

    const heroSection: PublicProfileSections['hero'] = {
      greetingLabel: 'Hello! I Am',
      roleLabel: defaultRole,
      titleLineOne: 'Judges a book',
      titleLineTwo: 'by its',
      titleHighlight: 'cover',
      titleLineSuffix: '...',
      tagline: 'Because if the cover does not impress you what else can?',
      ...heroOverride
    };
    const skillsSection: PublicProfileSections['skills'] = {
      headline: "I'm currently looking to join a",
      highlight: 'cross-functional',
      headlineSuffix: 'team',
      subheadline: "that values improving people's lives through accessible design",
      ...skillsOverride
    };
    const contactSection: PublicProfileSections['contact'] = {
      heading: 'Contact',
      message: "I'm currently looking to join a cross-functional team that values improving people's lives through accessible design. Or have a project in mind? Let's connect.",
      email: '',
      ...contactOverride
    };
    const upcomingSection: PublicProfileSections['upcoming'] = {
      heading: 'Upcoming Projects',
      subheading: 'Currently in development and planned next milestones.',
      ...upcomingOverride
    };
    const testimonialsSection: PublicProfileSections['testimonials'] = {
      heading: 'Testimonials',
      subheading: 'What collaborators and clients say about working together.',
      ...testimonialsOverride
    };
    const ctaSection: PublicProfileSections['cta'] = {
      heading: "Let's Work Together",
      subtext: 'Open to impactful product, platform, and AI-focused opportunities.',
      primaryLabel: 'Contact Me',
      secondaryLabel: 'Download Resume',
      resumeUrl: '',
      ...ctaOverride
    };
    const visibilitySection: PublicProfileSections['visibility'] = {
      projects: true,
      upcoming: true,
      testimonials: true,
      cta: true,
      ...visibilityOverride
    };

    return {
      ...profile,
      projects: Array.isArray(profile.projects)
        ? profile.projects.map((project) => ({
          ...project,
          title: String(project.title || ''),
          description: String(project.description || ''),
          url: String(project.url || ''),
          repoUrl: String(project.repoUrl || ''),
          imageUrl: String(project.imageUrl || ''),
          tech: Array.isArray(project.tech) ? project.tech : [],
          expectedDate: String(project.expectedDate || ''),
          status: project.status || 'completed'
        }))
        : [],
      upcomingProjects: Array.isArray(profile.upcomingProjects)
        ? profile.upcomingProjects.map((project) => ({
          ...project,
          title: String(project.title || ''),
          description: String(project.description || ''),
          expectedDate: String(project.expectedDate || ''),
          techStack: Array.isArray(project.techStack) ? project.techStack : [],
          status: project.status || 'planned',
          url: String(project.url || ''),
          repoUrl: String(project.repoUrl || ''),
          imageUrl: String(project.imageUrl || '')
        }))
        : [],
      testimonials: Array.isArray(profile.testimonials)
        ? profile.testimonials.map((item) => ({
          quote: String(item.quote || ''),
          name: String(item.name || ''),
          role: String(item.role || ''),
          avatarUrl: String(item.avatarUrl || '')
        }))
        : [],
      workExperiences: Array.isArray(profile.workExperiences) ? profile.workExperiences : [],
      completedCourses: this.sortCompletedCourses(profile.completedCourses || []),
      sections: {
        hero: heroSection,
        skills: skillsSection,
        contact: contactSection,
        upcoming: upcomingSection,
        testimonials: testimonialsSection,
        cta: ctaSection,
        visibility: visibilitySection
      },
      socialLinks: {
        website: profile.socialLinks?.website || '',
        twitter: profile.socialLinks?.twitter || '',
        linkedin: profile.socialLinks?.linkedin || '',
        github: profile.socialLinks?.github || ''
      }
    };
  }

  private fetchProfile(slug: string, preview?: string): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.copyFeedback = '';
    const options = preview ? { queryParams: { preview } } : undefined;
    this.profileService.getPublicProfile(slug, options).subscribe({
      next: (profile) => {
        const safeProfile = this.ensureProfileShape(profile);
        safeProfile.user.avatar = this.resolveAvatarUrl(safeProfile.user.avatar || '');
        this.profile = safeProfile;
        this.cacheState = safeProfile.frontendCacheState || 'network';
        this.completedCourses = this.sortCompletedCourses(safeProfile.completedCourses || []);
        this.avatarVersion = Date.now();
        this.refreshUserAvatarSrc();
        this.prepareRenderableData();
        this.isLoading = false;
        this.shareUrl = globalThis.location?.href || '';
        const title = safeProfile.seoTitle || `${safeProfile.user.name} | Portfolio`;
        const description = safeProfile.seoDescription || safeProfile.summary || 'Developer portfolio highlights, skills, and projects.';
        this.title.setTitle(title);
        this.meta.updateTag({ name: 'description', content: description });
        this.meta.updateTag({ property: 'og:title', content: title });
        this.meta.updateTag({ property: 'og:description', content: description });
        this.meta.updateTag({ property: 'og:type', content: 'profile' });
        this.meta.updateTag({ property: 'og:url', content: this.shareUrl });
        this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
        this.meta.updateTag({ name: 'twitter:title', content: title });
        this.meta.updateTag({ name: 'twitter:description', content: description });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Unable to load public portfolio.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  // Get top 7 skills for the arc display
  getTopSkillIcons(): SkillIcon[] {
    if (!this.profile?.skills) return [];
    const topSkills = this.profile.skills.slice(0, 7);
    return this.skillIconService.getAllIconsForSkills(topSkills);
  }

  // Get remaining skills for bottom orbit
  getBottomSkillIcons(): SkillIcon[] {
    if (!this.profile?.skills) return [];
    const remainingSkills = this.profile.skills.slice(7);
    return this.skillIconService.getAllIconsForSkills(remainingSkills);
  }

  // Create 4 work experience cards from projects or skills
  getWorkExperiences(): PublicProfileWorkExperience[] {
    return (this.profile?.workExperiences || []).slice(0, 4);
  }

  // Get completed/featured projects
  getFeaturedProjects(): PublicProfileProject[] {
    return this.featuredProjects;
  }

  // Get upcoming/in-progress projects
  getUpcomingProjects(): PublicProfileUpcomingProject[] {
    return this.upcomingProjects;
  }

  getTestimonials(): PublicProfileTestimonial[] {
    return this.testimonials;
  }

  private sortCompletedCourses(courses: PublicProfileCompletedCourse[]): PublicProfileCompletedCourse[] {
    return courses
      .filter((course) => Boolean(String(course?.title || '').trim()) && course.isVisible !== false)
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0)
        || this.courseDateValue(right.completionDate) - this.courseDateValue(left.completionDate));
  }

  private courseDateValue(value?: string | null): number {
    const timestamp = value ? new Date(value).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  isSectionVisible(section: keyof PublicProfileSections['visibility']): boolean {
    return Boolean(this.profile?.sections?.visibility?.[section] ?? true);
  }

  shouldShowUpcomingNav(): boolean {
    return this.isSectionVisible('upcoming') && this.getUpcomingProjects().length > 0;
  }

  toggleShareMenu(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.copyFeedback = '';
    this.shareMenuOpen = !this.shareMenuOpen;
  }

  closeShareMenu(): void {
    this.shareMenuOpen = false;
  }

  async useNativeShare(event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    if (!this.canUseNativeShare()) return;

    try {
      await navigator.share({
        title: this.getShareTitle(),
        text: this.getShareText(),
        url: this.shareUrl
      });
      this.shareMenuOpen = false;
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      if (!aborted) {
        this.copyFeedback = 'Unable to open share dialog.';
        this.cdr.detectChanges();
      }
    }
  }

  copyShareLink(): void {
    if (!this.shareUrl || typeof navigator === 'undefined' || !navigator.clipboard) {
      this.copyFeedback = 'Copy is unavailable in this browser.';
      this.cdr.detectChanges();
      return;
    }

    navigator.clipboard.writeText(this.shareUrl)
      .then(() => {
        this.copyFeedback = 'Link copied';
        this.shareMenuOpen = false;
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.copyFeedback = 'Unable to copy link';
        this.cdr.detectChanges();
      });
  }

  shareTo(platform: 'linkedin' | 'twitter' | 'whatsapp' | 'facebook' | 'email', event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const url = this.getShareOptionHref(platform);
    if (!url || !isPlatformBrowser(this.platformId)) {
      this.copyFeedback = 'Share is unavailable right now.';
      this.cdr.detectChanges();
      return;
    }

    const isMail = platform === 'email';
    const features = isMail ? undefined : 'noopener,noreferrer,width=720,height=720';
    globalThis.open(url, isMail ? '_self' : '_blank', features);
    this.shareMenuOpen = false;
  }

  canUseNativeShare(): boolean {
    return isPlatformBrowser(this.platformId) && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && Boolean(this.shareUrl);
  }

  getShareOptionHref(platform: 'linkedin' | 'twitter' | 'whatsapp' | 'facebook' | 'email'): string {
    if (!this.shareUrl) return '';

    const encodedUrl = encodeURIComponent(this.shareUrl);
    const encodedTitle = encodeURIComponent(this.getShareTitle());
    const encodedText = encodeURIComponent(this.getShareText());

    switch (platform) {
      case 'linkedin':
        return `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`;
      case 'twitter':
        return `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`;
      case 'whatsapp':
        return `https://wa.me/?text=${encodedText}%20${encodedUrl}`;
      case 'facebook':
        return `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
      case 'email':
        return `mailto:?subject=${encodedTitle}&body=${encodedText}%0A%0A${encodedUrl}`;
      default:
        return '';
    }
  }

  getShareTitle(): string {
    if (!this.profile) return 'Developer Portfolio';
    return `${this.profile.user.name} | Public Portfolio`;
  }

  getShareText(): string {
    if (!this.profile) return 'Check out this public portfolio.';
    return `Check out ${this.profile.user.name}'s public portfolio.`;
  }

  getProfileLabel(): string {
    if (!this.profile) return '';
    return this.profile.headline || this.profile.user.jobTitle || 'Developer Portfolio';
  }

  getSummaryText(): string {
    if (!this.profile) return '';
    return this.profile.summary || 'A self-taught Software Engineer, functioning in the industry for 3+ years now. I make meaningful and delightful digital products that create an equilibrium between user needs and business goals.';
  }

  getTopSkillsText(): string {
    if (!this.profile?.skills?.length) return 'Not provided';
    return this.profile.skills.slice(0, 8).map((skill) => skill.name).join(', ');
  }

  getCurrentCompany(): string {
    if (!this.profile) return 'a tech company';
    // Extract company from job title or location
    const jobTitle = this.profile.user.jobTitle || '';
    if (jobTitle.includes(' at ')) {
      return jobTitle.split(' at ')[1];
    }
    return this.profile.user.location || 'a tech company';
  }

  toExternalLink(url: string | undefined): string {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('/uploads/')) return `${this.backendOrigin}${raw}`;
    if (raw.startsWith('uploads/')) return `${this.backendOrigin}/${raw}`;
    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;
    return `https://${raw.replace(/^\/+/, '')}`;
  }

  getProjectPrimaryLink(project: LinkableProject): string {
    return this.toExternalLink(project.url || project.repoUrl || '');
  }

  getProjectRepositoryLink(project: LinkableProject): string {
    return this.toExternalLink(project.repoUrl || project.url || '');
  }

  getProjectPreview(project: LinkableProject): string {
    const directImage = this.resolveMediaImageUrl(project.imageUrl);
    if (directImage) return directImage;

    const target = this.getProjectPrimaryLink(project) || this.getProjectRepositoryLink(project) || 'https://github.com';
    const encodedTarget = encodeURIComponent(target);
    return `https://s-shot.ru/1280x720/PNG/1280/${encodedTarget}`;
  }

  private resolveMediaImageUrl(url: string | undefined): string {
    const raw = String(url || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;
    if (raw.startsWith('/uploads/')) return `${this.backendOrigin}${raw}`;
    if (raw.startsWith('uploads/')) return `${this.backendOrigin}/${raw}`;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(raw)) return `https://${raw}`;
    return '';
  }

  getUserAvatar(): string {
    return this.userAvatarSrc;
  }

  getContactEmail(): string {
    if (!this.profile) return '';
    return String(this.profile.sections?.contact?.email || this.profile.email || this.profile.user.email || '')
      .trim()
      .toLowerCase();
  }

  hasContactEmail(): boolean {
    return Boolean(this.getContactEmail());
  }

  getEmailHref(): string {
    const email = this.getContactEmail();
    return email
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`
      : '';
  }

  getPhoneNumber(): string {
    if (!this.profile) return '';
    return String(this.profile.phoneNumber || this.profile.user.phoneNumber || '').trim();
  }

  hasPhoneNumber(): boolean {
    return Boolean(this.getPhoneNumber());
  }

  getPhoneHref(): string {
    const normalized = this.getPhoneNumber().replace(/[^\d+]/g, '');
    return normalized ? `tel:${normalized}` : '';
  }

  getResumeDownloadUrl(): string {
    const raw = String(this.profile?.defaultResumeUrl || this.profile?.resumeUrl || this.profile?.sections?.cta?.resumeUrl || '').trim();
    return raw ? this.toExternalLink(raw) : '';
  }

  hasResumeDownload(): boolean {
    return Boolean(this.getResumeDownloadUrl());
  }

  getCurrentYear(): number {
    return new Date().getFullYear();
  }

  getLineAngle(index: number, total: number): string {
    if (total <= 1) return '0deg';
    // Calculate angle for connecting lines from icons to central orb
    const startAngle = -60; // Start from left side
    const endAngle = 60; // End at right side
    const angleRange = endAngle - startAngle;
    const angle = startAngle + (angleRange / (total - 1)) * index;
    return `${angle}deg`;
  }

  scrollToSection(sectionId: SectionId, event?: Event): void {
    event?.preventDefault();
    this.activeSection = sectionId;
    this.mobileMenuOpen = false;

    if (!isPlatformBrowser(this.platformId)) return;
    const target = document.getElementById(sectionId);
    if (!target) return;

    const navbarOffset = 108;
    const top = target.getBoundingClientRect().top + globalThis.scrollY - navbarOffset;
    globalThis.scrollTo({ top, behavior: 'smooth' });

    if (globalThis.history?.replaceState) {
      globalThis.history.replaceState(null, '', `#${sectionId}`);
    }
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen = !this.mobileMenuOpen;
  }

  private prepareRenderableData(): void {
    if (!this.profile) {
      this.featuredProjects = [];
      this.upcomingProjects = [];
      this.testimonials = [];
      return;
    }

    this.featuredProjects = (this.profile.projects || []).filter((project) => !project.status || project.status === 'completed');

    this.upcomingProjects = (this.profile.upcomingProjects || []).length
      ? this.profile.upcomingProjects
      : (this.profile.projects || [])
        .filter((project) => ['in-progress', 'upcoming', 'planned'].includes(project.status || ''))
        .map((project) => ({
          title: project.title,
          description: project.description,
          expectedDate: project.expectedDate || '',
          techStack: project.tech || [],
          status: project.status === 'in-progress' ? 'in-progress' : 'planned',
          url: project.url,
          repoUrl: project.repoUrl,
          imageUrl: project.imageUrl
        }));

    this.testimonials = (this.profile.testimonials || []).length
      ? this.profile.testimonials
      : [
        {
          quote: 'They consistently delivered clean architecture decisions and strong execution under tight deadlines.',
          name: 'Ayesha Karim',
          role: 'Engineering Manager',
          avatarUrl: ''
        },
        {
          quote: 'Communication was excellent, and the end result was exactly what we needed for launch.',
          name: 'Rahul Mehta',
          role: 'Product Lead',
          avatarUrl: ''
        },
        {
          quote: 'A reliable developer who balances speed, quality, and product thinking in every sprint.',
          name: 'Sana Ali',
          role: 'Client Partner',
          avatarUrl: ''
        }
      ];
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.updateActiveSection();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (!this.shareMenuOpen) return;
    this.shareMenuOpen = false;
  }

  private updateActiveSection(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const marker = 140;
    let selected: SectionId = 'home';

    this.sectionIds.forEach((id) => {
      const section = document.getElementById(id);
      if (!section) return;

      const top = section.getBoundingClientRect().top;
      if (top - marker <= 0) {
        selected = id;
      }
    });

    this.activeSection = selected;
  }

  private resolveAvatarUrl(avatar: string): string {
    const raw = String(avatar || '').trim();
    if (!raw) return '';

    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        if (parsed.pathname.startsWith('/uploads/')) {
          return `${this.backendOrigin}${parsed.pathname}${parsed.search || ''}`;
        }
      } catch {
        return raw;
      }
      return raw;
    }

    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;

    if (raw.startsWith('/uploads/')) {
      return `${this.backendOrigin}${raw}`;
    }

    if (raw.startsWith('uploads/')) {
      return `${this.backendOrigin}/${raw}`;
    }

    return raw;
  }

  private refreshUserAvatarSrc(): void {
    const avatar = this.resolveAvatarUrl(this.profile?.user?.avatar || '');
    if (!avatar) {
      this.userAvatarSrc = '/avatar/profile.png';
      return;
    }

    if (/^data:/i.test(avatar) || avatar.startsWith('blob:')) {
      this.userAvatarSrc = avatar;
      return;
    }

    const separator = avatar.includes('?') ? '&' : '?';
    this.userAvatarSrc = `${avatar}${separator}v=${this.avatarVersion}`;
  }
}
