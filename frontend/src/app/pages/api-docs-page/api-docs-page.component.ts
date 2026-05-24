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
      endpoints: ['POST /api/auth/login', 'POST /api/auth/register', 'POST /api/auth/send-otp', 'POST /api/auth/verify-otp'],
    },
    {
      title: 'Developer Intelligence',
      description: 'Portfolio analysis, GitHub insights, resume scoring, and recommendation workflows.',
      endpoints: ['GET /api/profile', 'POST /api/github/analyze', 'POST /api/resume/analyze', 'GET /api/recommendations'],
    },
    {
      title: 'Recruiter Hub',
      description: 'Dashboard metrics, candidate views, jobs, AI matching, analytics, and recruiter profile operations.',
      endpoints: ['GET /api/recruiter-hub/dashboard', 'GET /api/recruiter-hub/analytics', 'GET /api/recruiter-hub/profile', 'PATCH /api/recruiter-hub/profile'],
    },
    {
      title: 'Admin & Organization',
      description: 'Recruiter management, organization teams, invitations, and admin-side visibility into scoped members.',
      endpoints: ['GET /api/admin/recruiters', 'POST /api/admin/recruiters/direct', 'GET /api/tenant/organizations/:id/teams', 'GET /api/admin/overview'],
    },
  ];
}
