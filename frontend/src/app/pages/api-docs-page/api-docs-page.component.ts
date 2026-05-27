import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-api-docs-page',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './api-docs-page.component.html',
  styleUrl: './api-docs-page.component.scss',
})
export class ApiDocsPageComponent {
  readonly pageLinks = [
    { label: 'Privacy', route: '/privacy' },
    { label: 'Terms', route: '/terms' },
    { label: 'API Docs', route: '/api-docs' },
    { label: 'Blog', route: '/blog' },
    { label: 'Contact', route: '/contact' },
  ];

  readonly featureCards = [
    { value: 'JWT Auth', label: 'Authenticated session-based access', accent: 'purple' },
    { value: 'JSON APIs', label: 'Frontend-friendly named payloads', accent: 'cyan' },
    { value: 'RBAC Safe', label: 'Role and organization scoped responses', accent: 'green' },
  ];

  readonly apiGroups = [
    {
      title: 'Authentication',
      description: 'Session bootstrap, OTP verification, password recovery, and account access flows.',
    },
    {
      title: 'Developer Intelligence',
      description: 'Portfolio analysis, GitHub insights, resume scoring, and recommendation workflows.',
    },
    {
      title: 'Recruiter Hub',
      description: 'Dashboard metrics, candidate views, jobs, AI matching, analytics, and recruiter profile operations.',
    },
    {
      title: 'Admin & Organization',
      description: 'Recruiter management, organization teams, invitations, and admin-side visibility into scoped members.',
    },
  ];
}
