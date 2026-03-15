import { Component, OnInit, Input, Output, EventEmitter, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../../shared/services/auth.service';
import { Observable, Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface SearchSuggestion {
  type: 'page' | 'repo' | 'skill';
  label: string;
  sublabel?: string;
  route?: string;
  url?: string;
}

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class Navbar implements OnInit {
  @Input() sidebarOpen: boolean = true;
  @Output() sidebarToggle = new EventEmitter<void>();

  isLoggedIn$: Observable<boolean>;
  userName = 'Developer';
  userHandle = 'developer';
  userInitial = 'D';
  showUserMenu = false;

  searchQuery = '';
  suggestions: SearchSuggestion[] = [];
  showSuggestions = false;

  private cachedRepos: any[] = [];
  private cachedSkills: SearchSuggestion[] = [];
  private readonly searchSubject = new Subject<string>();
  private readonly destroyRef = inject(DestroyRef);

  private readonly navPages: SearchSuggestion[] = [
    { type: 'page', label: 'Dashboard', sublabel: 'Portfolio overview', route: '/app/dashboard' },
    { type: 'page', label: 'GitHub Analyzer', sublabel: 'Analyze GitHub repositories', route: '/app/github-analyzer' },
    { type: 'page', label: 'Resume Analyzer', sublabel: 'Analyze your resume', route: '/app/resume-analyzer' },
    { type: 'page', label: 'Skill Gap Analysis', sublabel: 'Find skills to learn', route: '/app/skill-gap' },
    { type: 'page', label: 'Recommendations', sublabel: 'Personalized career advice', route: '/app/recommendations' },
    { type: 'page', label: 'Profile', sublabel: 'Account settings', route: '/app/profile' },
  ];

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly http: HttpClient
  ) {
    this.isLoggedIn$ = this.authService.isLoggedIn$;

    this.searchSubject.pipe(
      debounceTime(250),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(query => this.runSearch(query));
  }

  ngOnInit() {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        this.userName = user.name || 'Developer';
        this.userHandle = user.githubUsername || 'developer';
        this.userInitial = this.userName.charAt(0).toUpperCase();
        if (user.githubUsername) {
          this.loadGithubRepos(user.githubUsername);
        }
      } catch { /* fallback */ }
    }
  }

  private loadGithubRepos(username: string): void {
    this.http.get<any[]>(
      `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: repos => {
        this.cachedRepos = repos;
        // Extract unique languages as skill suggestions
        const langs = new Set<string>();
        repos.forEach(r => { if (r.language) langs.add(r.language); });
        this.cachedSkills = Array.from(langs).map(lang => ({
          type: 'skill' as const,
          label: lang,
          sublabel: `Used in ${repos.filter(r => r.language === lang).length} repo(s)`,
          route: '/app/skill-gap',
        }));
      },
      error: () => { /* ignore rate limit / network errors */ }
    });
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery = value;
    this.searchSubject.next(value);
  }

  runSearch(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.suggestions = [];
      this.showSuggestions = false;
      return;
    }

    const results: SearchSuggestion[] = [];

    // Pages
    this.navPages
      .filter(p => p.label.toLowerCase().includes(q) || p.sublabel?.toLowerCase().includes(q))
      .forEach(p => results.push(p));

    // Repositories
    this.cachedRepos
      .filter(r => r.name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
      .slice(0, 5)
      .forEach(r => results.push({
        type: 'repo',
        label: r.name,
        sublabel: r.description || r.language || '',
        url: r.html_url,
      }));

    // Skills (languages from repos)
    this.cachedSkills
      .filter(s => s.label.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach(s => results.push(s));

    this.suggestions = results;
    this.showSuggestions = results.length > 0;
  }

  selectSuggestion(suggestion: SearchSuggestion): void {
    if (suggestion.route) {
      this.router.navigate([suggestion.route]);
    } else if (suggestion.url) {
      window.open(suggestion.url, '_blank', 'noopener,noreferrer');
    }
    this.searchQuery = '';
    this.suggestions = [];
    this.showSuggestions = false;
  }

  closeSearch(): void {
    setTimeout(() => { this.showSuggestions = false; }, 150);
  }

  toggleSidebar() {
    this.sidebarToggle.emit();
  }

  toggleUserMenu() {
    this.showUserMenu = !this.showUserMenu;
  }

  closeUserMenu() {
    this.showUserMenu = false;
  }

  logout() {
    this.authService.logout();
    this.showUserMenu = false;
    this.router.navigate(['/']);
  }
}
