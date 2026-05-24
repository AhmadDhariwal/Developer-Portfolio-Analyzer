import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './terms-of-service.component.html',
  styleUrl: './terms-of-service.component.scss',
})
export class TermsOfServiceComponent {
  readonly pageLinks = [
    { label: 'Privacy', route: '/privacy' },
    { label: 'Terms', route: '/terms' },
    { label: 'API Docs', route: '/api-docs' },
    { label: 'Blog', route: '/blog' },
    { label: 'Contact', route: '/contact' },
  ];

  readonly highlights = [
    { value: 'Account Based', label: 'Access depends on authenticated membership', accent: 'purple' },
    { value: 'RBAC Aware', label: 'Admins, recruiters, and developers have scoped permissions', accent: 'blue' },
    { value: 'Human Review', label: 'AI output supports decisions, not replaces them', accent: 'amber' },
  ];

  readonly sections = [
    {
      title: 'Using DevInsight AI',
      body: 'You may use the platform to analyze portfolios, manage recruiter workflows, collaborate inside organizations, and operate within the permissions tied to your account role.',
      bullets: [
        'Provide accurate signup and account information',
        'Use the platform only for lawful and authorized workflows',
        'Respect organization, candidate, and teammate boundaries',
      ],
    },
    {
      title: 'Account responsibilities',
      body: 'Users are responsible for maintaining credential security and for actions taken through their account, including recruiter, admin, and organization-scoped activity.',
      bullets: [
        'Keep passwords and connected accounts secure',
        'Review results before making hiring or profile decisions',
        'Notify the platform if you suspect unauthorized access',
      ],
    },
    {
      title: 'AI-assisted outputs',
      body: 'Scores, match results, and recommendations are decision-support outputs. Hiring decisions, professional evaluations, and organizational actions should still include human judgment.',
      bullets: [
        'AI may highlight patterns, not guarantees',
        'Recruiter rankings should be reviewed before acting',
        'Career recommendations should be interpreted in context',
      ],
    },
    {
      title: 'Restrictions and suspension',
      body: 'We may limit or suspend access for misuse, abuse, fraud concerns, or behavior that violates organizational trust, platform policy, or security expectations.',
      bullets: [
        'Misuse of shared or organization data',
        'Automation abuse or scraping beyond intended use',
        'Security violations or fraudulent activity',
      ],
    },
  ];
}
