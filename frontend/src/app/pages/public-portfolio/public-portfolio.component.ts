import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { PublicProfileService, PublicProfilePayload } from '../../shared/services/public-profile.service';

@Component({
  selector: 'app-public-portfolio',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './public-portfolio.component.html',
  styleUrl: './public-portfolio.component.scss'
})
export class PublicPortfolioComponent implements OnInit {
  profile: PublicProfilePayload | null = null;
  isLoading = true;
  errorMessage = '';
  shareUrl = '';

  constructor(
    private readonly route: ActivatedRoute,
    private readonly profileService: PublicProfileService,
    private readonly title: Title,
    private readonly meta: Meta,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.params.subscribe((params) => {
      const slug = params['slug'];
      if (slug) {
        this.fetchProfile(slug);
      }
    });
  }

  private fetchProfile(slug: string): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.profileService.getPublicProfile(slug).subscribe({
      next: (profile) => {
        this.profile = profile;
        this.isLoading = false;
        this.shareUrl = window.location.href;
        const title = profile.seoTitle || `${profile.user.name} | Portfolio`;
        const description = profile.seoDescription || profile.summary || 'Developer portfolio highlights, skills, and projects.';
        this.title.setTitle(title);
        this.meta.updateTag({ name: 'description', content: description });
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Unable to load public portfolio.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }
}
