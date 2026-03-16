import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Job, JOB_PLATFORM_COLOR_MAP } from '../../models/job.model';

@Component({
  selector:        'app-job-card',
  standalone:      true,
  imports:         [CommonModule],
  templateUrl:     './job-card.html',
  styleUrl:        './job-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class JobCardComponent {
  @Input({ required: true }) job!: Job;

  logoError = false;

  get platformColor() {
    return this.job.platformColor ?? JOB_PLATFORM_COLOR_MAP[this.job.platform] ?? JOB_PLATFORM_COLOR_MAP['Other'];
  }

  get logoFallback(): string {
    return (this.job.company || '?').charAt(0).toUpperCase();
  }

  get logoUrl(): string {
    if (this.job.companyLogo) return this.job.companyLogo;
    const domain = this.companyDomain;
    return domain ? `https://logo.clearbit.com/${domain}` : '';
  }

  private get companyDomain(): string {
    const map: Record<string, string> = {
      'google':       'google.com',
      'meta':         'meta.com',
      'amazon':       'amazon.com',
      'microsoft':    'microsoft.com',
      'shopify':      'shopify.com',
      'automattic':   'automattic.com',
      'gitlab':       'gitlab.com',
      'turing':       'turing.com',
      'toptal':       'toptal.com',
      'arbisoft':     'arbisoft.com',
      'careem':       'careem.com',
      'netsol':       'netsol.com',
      'systems':      'systemsltd.com',
      '10pearls':     '10pearls.com',
      'devsinc':      'devsinc.com',
      'contour':      'contoursoftware.com',
      'i2c':          'i2cinc.com'
    };
    const lower = (this.job.company || '').toLowerCase();
    for (const [key, domain] of Object.entries(map)) {
      if (lower.includes(key)) return domain;
    }
    return '';
  }

  onLogoError(): void {
    this.logoError = true;
  }

  get postedLabel(): string {
    if (!this.job.postedDate) return 'Recently';
    const days = Math.floor((Date.now() - new Date(this.job.postedDate).getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return '1 day ago';
    if (days < 7)  return `${days} days ago`;
    if (days < 14) return '1 week ago';
    if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
    return '1 month ago';
  }

  get jobTypeClass(): string {
    const t = (this.job.jobType || '').toLowerCase().replace(/\s+/g, '-');
    return `type-${t}`;
  }

  viewJob(): void {
    if (this.job.url) window.open(this.job.url, '_blank', 'noopener,noreferrer');
  }

  applyNow(): void {
    if (this.job.url) window.open(this.job.url, '_blank', 'noopener,noreferrer');
  }
}
