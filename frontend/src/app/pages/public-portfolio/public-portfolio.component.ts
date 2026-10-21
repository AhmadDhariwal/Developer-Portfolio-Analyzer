import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  HostListener,
  Inject,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  catchError,
  combineLatest,
  distinctUntilChanged,
  map,
  merge,
  of,
  startWith,
  Subject,
  switchMap,
  tap,
} from 'rxjs';
import {
  PublicProfilePayload,
  PublicProfileProject,
  PublicProfileService,
} from '../../shared/services/public-profile.service';
import { AuthService } from '../../shared/services/auth.service';
import { ThemeService } from '../../shared/services/theme.service';
import {
  portfolioError,
  portfolioForDisplay,
  portfolioImage,
  portfolioLink,
} from '../../shared/utils/public-profile.utils';
import { ProjectCardComponent } from './components/project-card/project-card.component';

@Component({
  selector: 'app-public-portfolio',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ProjectCardComponent],
  templateUrl: './public-portfolio.component.html',
  styleUrl: './public-portfolio.component.scss',
})
export class PublicPortfolioComponent implements OnInit, OnDestroy {
  profile: PublicProfilePayload | null = null;
  isLoading = true;
  errorMessage = '';
  errorStatus = 0;
  preview = false;
  contactMessage = '';
  website = '';
  contactBusy = false;
  contactSent = false;
  contactError = '';
  downloadBusy = false;
  downloadError = '';
  copyFeedback = '';
  avatarFailed = false;
  readonly link = portfolioLink;
  readonly image = portfolioImage;
  private readonly refresh = new Subject<void>();
  private readonly oldTitle: string;
  private canonical: HTMLLinkElement | null = null;
  private contactGeneration = 0;
  private lastActivation = 0;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly service: PublicProfileService,
    readonly auth: AuthService,
    readonly theme: ThemeService,
    private readonly title: Title,
    private readonly meta: Meta,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroy: DestroyRef,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {
    this.oldTitle = title.getTitle();
  }

  ngOnInit(): void {
    combineLatest([
      this.route.paramMap,
      this.route.queryParamMap,
      this.auth.currentUser$.pipe(
        map(
          (user) =>
            `${user?._id || ''}:${user?.role || ''}:${user?.['isVerified']}:${user?.['emailVerified']}`,
        ),
        distinctUntilChanged(),
      ),
      merge(this.refresh, this.service.invalidated$).pipe(startWith(undefined)),
    ])
      .pipe(
        tap(() => this.clearView()),
        switchMap(([params, query]) => {
          this.preview = query.has('preview');
          const slug = params.get('slug') || '';
          return this.service
            .getPublicProfile(slug, this.preview ? { queryParams: { preview: '1' } } : {})
            .pipe(
              map((profile) => {
                if (!this.preview && profile.isPublic !== true) throw { status: 404 };
                return portfolioForDisplay(profile);
              }),
              catchError((error) => {
                this.errorStatus = error.status || 503;
                this.errorMessage =
                  error.status === 404
                    ? 'This portfolio is private, unpublished, or no longer at this address.'
                    : portfolioError(error, 'Unable to load this portfolio.');
                return of(null);
              }),
            );
        }),
        takeUntilDestroyed(this.destroy),
      )
      .subscribe((profile) => {
        this.profile = profile;
        this.isLoading = false;
        if (profile) {
          this.updateMetadata(profile);
          this.startTypewriter(profile);
        }
        this.cdr.markForCheck();
      });
  }

  typewriterText = '';
  private typewriterPhrases: string[] = [];
  private typewriterPhraseIdx = 0;
  private typewriterCharIdx = 0;
  private isDeleting = false;
  private typewriterTimer: ReturnType<typeof setTimeout> | null = null;

  avatarMode: '3d' | 'custom' = '3d';

  get heroTitleMain(): string {
    const hero = this.profile?.sections.hero;
    if (hero?.titleLineOne) {
      return [hero.titleLineOne, hero.titleLineTwo].filter(Boolean).join(' ');
    }
    return 'Architecting Scalable Systems &';
  }

  get heroTitleAccent(): string {
    const hero = this.profile?.sections.hero;
    if (hero?.titleHighlight) {
      return hero.titleHighlight + (hero.titleLineSuffix ? ' ' + hero.titleLineSuffix : '');
    }
    return 'Modern Interfaces';
  }

  get fallback3dAvatar(): string {
    return '/avatar/dev_3d_avatar.jpg';
  }

  get avatarSrc(): string {
    if (this.preview) {
      if (this.avatarMode === '3d') {
        return this.fallback3dAvatar;
      }
      return portfolioImage(this.profile?.user.avatar) || this.fallback3dAvatar;
    }
    if (this.avatarFailed) return this.fallback3dAvatar;
    const userAvatar = portfolioImage(this.profile?.user.avatar);
    return userAvatar || this.fallback3dAvatar;
  }

  toggleAvatarMode(): void {
    this.avatarMode = this.avatarMode === '3d' ? 'custom' : '3d';
    this.avatarFailed = false;
    this.cdr.markForCheck();
  }

  get constellationSkills(): Array<{ name: string; score: number }> {
    if (!this.profile?.skills?.length) return [];
    return this.profile.skills.slice(0, 7);
  }

  getExperienceIcon(iconName?: string, index: number = 0): string {
    const norm = (iconName || '').toLowerCase();
    if (
      norm.includes('rocket') ||
      norm.includes('launch') ||
      norm.includes('speed') ||
      norm.includes('js')
    )
      return 'rocket';
    if (
      norm.includes('bulb') ||
      norm.includes('idea') ||
      norm.includes('light') ||
      norm.includes('c++')
    )
      return 'lightbulb';
    if (
      norm.includes('code') ||
      norm.includes('tag') ||
      norm.includes('terminal') ||
      norm.includes('python')
    )
      return 'code';
    if (
      norm.includes('flask') ||
      norm.includes('api') ||
      norm.includes('server') ||
      norm.includes('backend')
    )
      return 'server';
    if (norm.includes('palette') || norm.includes('design') || norm.includes('ui'))
      return 'palette';
    if (norm.includes('globe') || norm.includes('earth') || norm.includes('web')) return 'globe';
    const fallbackList = ['rocket', 'lightbulb', 'code', 'server', 'globe', 'palette'];
    return fallbackList[index % fallbackList.length];
  }

  startTypewriter(profile: PublicProfilePayload): void {
    this.stopTypewriter();
    const phrases: string[] = [];
    if (profile.headline) phrases.push(profile.headline);
    if (profile.user.jobTitle && !phrases.includes(profile.user.jobTitle))
      phrases.push(profile.user.jobTitle);
    if (profile.skills?.length) {
      phrases.push(`${profile.skills[0].name} Specialist`);
    }
    phrases.push('Full-Stack Engineer', 'Creative Technologist', 'Systems Architect');
    this.typewriterPhrases = Array.from(new Set(phrases.filter(Boolean)));
    this.typewriterPhraseIdx = 0;
    this.typewriterCharIdx = 0;
    this.isDeleting = false;
    this.typewriterText = '';
    this.tickTypewriter();
  }

  private tickTypewriter(): void {
    if (!this.typewriterPhrases.length) return;
    const fullText =
      this.typewriterPhrases[this.typewriterPhraseIdx % this.typewriterPhrases.length];
    if (this.isDeleting) {
      this.typewriterCharIdx--;
      this.typewriterText = fullText.substring(0, this.typewriterCharIdx);
      if (this.typewriterCharIdx <= 0) {
        this.isDeleting = false;
        this.typewriterPhraseIdx++;
        this.typewriterTimer = setTimeout(() => this.tickTypewriter(), 400);
        this.cdr.markForCheck();
        return;
      }
    } else {
      this.typewriterCharIdx++;
      this.typewriterText = fullText.substring(0, this.typewriterCharIdx);
      if (this.typewriterCharIdx >= fullText.length) {
        this.isDeleting = true;
        this.typewriterTimer = setTimeout(() => this.tickTypewriter(), 2200);
        this.cdr.markForCheck();
        return;
      }
    }
    const speed = this.isDeleting ? 40 : 85;
    this.typewriterTimer = setTimeout(() => this.tickTypewriter(), speed);
    this.cdr.markForCheck();
  }

  stopTypewriter(): void {
    if (this.typewriterTimer) {
      clearTimeout(this.typewriterTimer);
      this.typewriterTimer = null;
    }
  }

  get canContact(): boolean {
    const user = this.auth.getCurrentUser();
    // Existing sign-in payloads can omit verification flags. Unknown verification
    // may attempt delivery; only the backend can authorize and acknowledge it.
    return (
      !this.preview &&
      this.auth.isLoggedIn() &&
      user?.role === 'recruiter' &&
      user['isActive'] !== false &&
      (user['isVerified'] === true ||
        user['emailVerified'] === true ||
        (user['isVerified'] === undefined && user['emailVerified'] === undefined))
    );
  }
  get socialLinks(): Array<{ label: string; url: string }> {
    return Object.entries(this.profile?.socialLinks || {})
      .map(([label, url]) => ({
        label:
          (
            {
              github: 'GitHub',
              linkedin: 'LinkedIn',
              twitter: 'X / Twitter',
              website: 'Website',
            } as Record<string, string>
          )[label] || label,
        url: portfolioLink(url),
      }))
      .filter((item) => item.url);
  }
  get upcomingCards(): PublicProfileProject[] {
    return (this.profile?.upcomingProjects || []).map((project) => ({
      ...project,
      url: project.url || '',
      tech: project.techStack,
    }));
  }
  get initials(): string {
    return (this.profile?.user.name || '')
      .split(/\s+/)
      .slice(0, 2)
      .map((name) => name.charAt(0))
      .join('');
  }
  get heroCopy(): string {
    const hero = this.profile?.sections.hero;
    return [hero?.titleLineOne, hero?.titleLineTwo, hero?.titleHighlight, hero?.titleLineSuffix]
      .filter(Boolean)
      .join(' ');
  }
  get publicUrl(): string {
    return this.profile
      ? `${this.document.location.origin}/p/${encodeURIComponent(this.profile.slug)}`
      : '';
  }
  get isDarkMode(): boolean {
    if (typeof this.theme?.isDark === 'function') {
      return this.theme.isDark();
    }
    return this.theme?.preference?.() === 'dark';
  }

  toggleThemeMode(): void {
    if (typeof this.theme?.toggleTheme === 'function') {
      this.theme.toggleTheme();
    } else if (typeof this.theme?.setTheme === 'function') {
      this.theme.setTheme(this.isDarkMode ? 'light' : 'dark');
    }
  }

  retry(): void {
    this.refresh.next();
  }

  @HostListener('window:focus') onFocus(): void {
    if (this.document.visibilityState === 'visible' && Date.now() - this.lastActivation > 250) {
      this.lastActivation = Date.now();
      this.refresh.next();
    }
  }
  @HostListener('document:visibilitychange') onVisibility(): void {
    if (this.document.visibilityState === 'visible') this.onFocus();
    else this.clearView();
  }

  sendContact(): void {
    if (!this.profile || !this.canContact || this.contactBusy || this.contactSent) return;
    const message = this.contactMessage.trim();
    if (message.length < 20 || message.length > 4000 || /[<>]/.test(message) || this.website) {
      this.contactError = 'Write a plain-text message between 20 and 4,000 characters.';
      return;
    }
    const generation = this.contactGeneration;
    this.contactBusy = true;
    this.contactError = '';
    this.service
      .contact(this.profile.slug, message, this.website)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (result) => {
          if (generation !== this.contactGeneration) return;
          this.contactBusy = false;
          this.contactSent = result.sent === true;
          if (!this.contactSent)
            this.contactError = 'Delivery was not acknowledged. Please try again later.';
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (generation !== this.contactGeneration) return;
          this.contactBusy = false;
          this.contactError =
            error.status === 503
              ? 'Message delivery is unavailable. Please try again later or use a listed professional link.'
              : portfolioError(error, 'Unable to send your message.');
          this.cdr.markForCheck();
        },
      });
  }

  downloadResume(): void {
    if (!this.profile?.defaultResumeUrl || this.downloadBusy) return;
    const generation = this.contactGeneration;
    const slug = this.profile.slug;
    this.downloadBusy = true;
    this.downloadError = '';
    this.service
      .downloadResume(slug, this.preview)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (blob) => {
          if (generation !== this.contactGeneration) return;
          const url = URL.createObjectURL(blob);
          const anchor = this.document.createElement('a');
          anchor.href = url;
          anchor.download = `${slug}-resume.pdf`;
          anchor.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          this.downloadBusy = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          if (generation !== this.contactGeneration) return;
          this.downloadBusy = false;
          this.downloadError =
            error.status === 404
              ? 'This resume is no longer available.'
              : portfolioError(error, 'Unable to download the resume.');
          this.cdr.markForCheck();
        },
      });
  }

  async copyLink(): Promise<void> {
    if (this.preview || !this.publicUrl) return;
    try {
      await navigator.clipboard.writeText(this.publicUrl);
      this.copyFeedback = 'Portfolio link copied.';
    } catch {
      this.copyFeedback = 'Copy is unavailable. You can copy the address from your browser.';
    }
    this.cdr.markForCheck();
  }

  private clearView(): void {
    this.stopTypewriter();
    this.profile = null;
    this.isLoading = true;
    this.errorMessage = '';
    this.avatarFailed = false;
    this.contactGeneration++;
    this.contactMessage = '';
    this.contactError = '';
    this.contactSent = false;
    this.contactBusy = false;
    this.downloadBusy = false;
    this.downloadError = '';
    this.copyFeedback = '';
    this.clearMetadata();
    this.title.setTitle('Developer portfolio | DevInsight AI');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
    this.cdr.markForCheck();
  }
  private updateMetadata(profile: PublicProfilePayload): void {
    if (this.preview) {
      this.title.setTitle('Private portfolio preview | DevInsight AI');
      return;
    }
    const title = profile.seoTitle || `${profile.user.name} | Developer portfolio`;
    const description = profile.seoDescription || profile.summary || profile.headline;
    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
    for (const [property, content] of Object.entries({
      'og:title': title,
      'og:description': description,
      'og:url': this.publicUrl,
      'og:type': 'profile',
    }))
      this.meta.updateTag({ property, content });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    const avatar = portfolioImage(profile.user.avatar);
    if (avatar && /^https?:/.test(avatar))
      this.meta.updateTag({ property: 'og:image', content: avatar });
    this.canonical = this.document.createElement('link');
    this.canonical.rel = 'canonical';
    this.canonical.href = this.publicUrl;
    this.document.head.appendChild(this.canonical);
  }
  private clearMetadata(): void {
    this.canonical?.remove();
    this.canonical = null;
    for (const selector of [
      'name="description"',
      'name="robots"',
      'name="twitter:card"',
      'name="twitter:title"',
      'name="twitter:description"',
      'property="og:title"',
      'property="og:description"',
      'property="og:url"',
      'property="og:type"',
      'property="og:image"',
    ])
      this.meta.removeTag(selector);
  }
  ngOnDestroy(): void {
    this.stopTypewriter();
    this.contactGeneration++;
    this.clearMetadata();
    this.title.setTitle(this.oldTitle);
    this.refresh.complete();
  }
}
