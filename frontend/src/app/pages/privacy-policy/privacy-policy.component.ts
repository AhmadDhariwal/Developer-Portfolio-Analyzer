import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './privacy-policy.component.html',
  styleUrl: './privacy-policy.component.scss',
})
export class PrivacyPolicyComponent {
  readonly pageLinks = [
    { label: 'Privacy', route: '/privacy' },
    { label: 'Terms', route: '/terms' },
    { label: 'API Docs', route: '/api-docs' },
    { label: 'Blog', route: '/blog' },
    { label: 'Contact', route: '/contact' },
  ];

  readonly highlights = [
    { value: 'Scoped RBAC', label: 'Organization-safe access boundaries', accent: 'cyan' },
    { value: 'OAuth Secure', label: 'GitHub and LinkedIn credentials stay server-side', accent: 'purple' },
    { value: 'Minimal Data', label: 'We retain only what the platform needs', accent: 'green' },
  ];

  readonly sections = [
    {
      title: 'Information we collect',
      body: 'DevInsight AI collects account identity, recruiter and developer profile details, GitHub-derived signals, resume analysis inputs, and organization membership data required for collaboration and hiring workflows.',
      bullets: [
        'Name, email, account role, and profile metadata',
        'Portfolio, resume, and GitHub analysis signals',
        'Recruiter workflow preferences, jobs, and shortlist activity',
      ],
    },
    {
      title: 'How we use data',
      body: 'Your data powers analysis, recommendations, recruiter discovery, AI ranking, notifications, and admin or organization-level visibility inside the correct RBAC scope.',
      bullets: [
        'Generate career and hiring insights',
        'Support recruiter matching, comparison, and outreach workflows',
        'Improve platform performance, security, and user experience',
      ],
    },
    {
      title: 'Access and sharing',
      body: 'We do not sell personal information. Data is only surfaced to users with the correct role and organization access, and third-party services are used only where required for platform functionality.',
      bullets: [
        'Role-based and organization-scoped visibility',
        'No cross-organization data sharing by design',
        'No resale of personal information',
      ],
    },
    {
      title: 'Security and retention',
      body: 'We apply reasonable safeguards for authentication, API access, and integration secrets, and we keep data only for as long as it supports platform operations, user accounts, and organization workflows.',
      bullets: [
        'Protected authentication and session handling',
        'Server-side storage of integration credentials',
        'Retention aligned to account and organization lifecycle',
      ],
    },
  ];
}
