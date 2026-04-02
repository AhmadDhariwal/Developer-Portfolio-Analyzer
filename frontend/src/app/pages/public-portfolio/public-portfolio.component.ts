import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, Inject, AfterViewInit, ElementRef, QueryList, ViewChildren } from '@angular/core';
import {
  PublicProfileService,
  PublicProfilePayload,
  PublicProfileProject,
  PublicProfileSections,
  PublicProfileWorkExperience
} from '../../shared/services/public-profile.service';
import { SkillIconService, SkillIcon } from '../../shared/services/skill-icon.service';

@Component({
  selector: 'app-public-portfolio',
  standalone: true,
  imports: [CommonModule, RouterLink],
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
  private observer: IntersectionObserver | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly profileService: PublicProfileService,
    private readonly title: Title,
    private readonly meta: Meta,
    private readonly cdr: ChangeDetectorRef,
    private readonly skillIconService: SkillIconService,
    @Inject(PLATFORM_ID) private platformId: Object
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

    return {
      ...profile,
      projects: Array.isArray(profile.projects) ? profile.projects : [],
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
        this.profile = safeProfile;
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

  getProjectPrimaryLink(project: PublicProfileProject): string {
    return this.toExternalLink(project.url || project.repoUrl || '');
  }

  getProjectRepositoryLink(project: PublicProfileProject): string {
    return this.toExternalLink(project.repoUrl || project.url || '');
  }

  getProjectPreview(project: PublicProfileProject): string {
    const directImage = this.toExternalLink(project.imageUrl);
    if (directImage) return directImage;

    const target = this.getProjectPrimaryLink(project) || this.getProjectRepositoryLink(project) || 'https://github.com';
    const encodedTarget = encodeURIComponent(target);
    return `https://s-shot.ru/1280x720/PNG/1280/${encodedTarget}`;
  }

  getUserAvatar(): string {
    // Automatically load the picture from the new local folder you requested.
    // Make sure to name your uploaded file 'profile.png' and place it in 'frontend/public/avatar/'.
    return '/avatar/profile.png';
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

  getLineAngle(index: number, total: number): string {
    if (total <= 1) return '0deg';
    // Calculate angle for connecting lines from icons to central orb
    const startAngle = -60; // Start from left side
    const endAngle = 60; // End at right side
    const angleRange = endAngle - startAngle;
    const angle = startAngle + (angleRange / (total - 1)) * index;
    return `${angle}deg`;
  }
}
