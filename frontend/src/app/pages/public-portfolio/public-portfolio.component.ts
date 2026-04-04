import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, HostListener, Inject, OnInit, PLATFORM_ID, QueryList, ViewChildren } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import {
  PublicProfileService,
  PublicProfilePayload,
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
  activeSection: SectionId = 'home';
  mobileMenuOpen = false;
  featuredProjects: PublicProfileProject[] = [];
  upcomingProjects: PublicProfileUpcomingProject[] = [];
  testimonials: PublicProfileTestimonial[] = [];
  readonly previewResolver = (project: LinkableProject) => this.getProjectPreview(project);
  readonly primaryLinkResolver = (project: LinkableProject) => this.getProjectPrimaryLink(project);
  readonly repoLinkResolver = (project: LinkableProject) => this.getProjectRepositoryLink(project);
  private observer: IntersectionObserver | null = null;
  private readonly sectionIds: SectionId[] = ['home', 'about', 'projects', 'upcoming', 'testimonials', 'cta', 'contact'];

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
    this.route.params.subscribe((params) => {
      const slug = params['slug'];
      if (slug) {
        this.fetchProfile(slug);
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

  private fetchProfile(slug: string): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.copyFeedback = '';
    this.profileService.getPublicProfile(slug).subscribe({
      next: (profile) => {
        const safeProfile = this.ensureProfileShape(profile);
        safeProfile.user.avatar = this.resolveAvatarUrl(safeProfile.user.avatar || '');
        this.profile = safeProfile;
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

  isSectionVisible(section: keyof PublicProfileSections['visibility']): boolean {
    return Boolean(this.profile?.sections?.visibility?.[section] ?? true);
  }

  shouldShowUpcomingNav(): boolean {
    return this.isSectionVisible('upcoming') && this.getUpcomingProjects().length > 0;
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
        this.cdr.detectChanges();
      })
      .catch(() => {
        this.copyFeedback = 'Unable to copy link';
        this.cdr.detectChanges();
      });
  }

  getProfileLabel(): string {
    if (!this.profile) return '';
    return this.profile.headline || this.profile.user.jobTitle || 'Developer Portfolio';
  }

  getSummaryText(): string {
    if (!this.profile) return '';
    return this.profile.summary || 'A self-taught Software Engineer, functioning in the industry for 3+ years now. I make meaningful and delightful digital products that create an equilibrium between user needs and business goals.';
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
    return `https://${raw.replace(/^\/+/, '')}`;
  }

  getProjectPrimaryLink(project: LinkableProject): string {
    return this.toExternalLink(project.url || project.repoUrl || '');
  }

  getProjectRepositoryLink(project: LinkableProject): string {
    return this.toExternalLink(project.repoUrl || project.url || '');
  }

  getProjectPreview(project: LinkableProject): string {
    const directImage = this.toExternalLink(project.imageUrl);
    if (directImage) return directImage;

    const target = this.getProjectPrimaryLink(project) || this.getProjectRepositoryLink(project) || 'https://github.com';
    const encodedTarget = encodeURIComponent(target);
    return `https://s-shot.ru/1280x720/PNG/1280/${encodedTarget}`;
  }

  getUserAvatar(): string {
    const avatar = this.resolveAvatarUrl(this.profile?.user?.avatar || '');
    if (!avatar) return '/avatar/profile.png';
    
    // Add cache busting for avatar URLs
    if (/^data:/i.test(avatar) || avatar.startsWith('blob:')) return avatar;
    const separator = avatar.includes('?') ? '&' : '?';
    return `${avatar}${separator}v=${Date.now()}`;
  }

  getContactEmail(): string {
    if (!this.profile) return 'hello@portfolio.dev';
    const fromSection = String(this.profile.sections?.contact?.email || '').trim().toLowerCase();
    if (fromSection) return fromSection;

    if (this.profile.user.email) {
      return this.profile.user.email;
    }

    const username = this.profile.user.githubUsername || this.profile.user.name.toLowerCase().replaceAll(/\s+/g, '');
    return `${username}@gmail.com`;
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

    if (/^data:/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;

    if (raw.startsWith('/uploads/')) {
      return `http://localhost:5000${raw}`;
    }

    if (raw.startsWith('uploads/')) {
      return `http://localhost:5000/${raw}`;
    }

    return raw;
  }
}
