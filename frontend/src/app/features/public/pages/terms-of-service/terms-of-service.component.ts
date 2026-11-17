import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicSubpageShellComponent } from '../../../../shared/components/public-subpage-shell/public-subpage-shell.component';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicSubpageShellComponent],
  templateUrl: './terms-of-service.component.html',
  styleUrl: './terms-of-service.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsOfServiceComponent {
  readonly highlights = [
    {
      tag: 'MEMBERSHIP',
      value: 'Account Scoped',
      label: 'Platform access follows authenticated identity and verified session state.',
    },
    {
      tag: 'GOVERNANCE',
      value: 'RBAC Aware',
      label: 'Admins, recruiters, and developers operate within role-bounded workflows.',
    },
    {
      tag: 'ASSISTIVE AI',
      value: 'Human Review',
      label: 'AI scores inform career and hiring decisions rather than automating them.',
    },
  ] as const;

  readonly sections = [
    {
      id: 'terms-usage',
      num: '01',
      title: 'Using DevInsight AI',
      body: 'You may use the platform to evaluate developer portfolios, track career sprints, practice interviews, and coordinate recruiter workflows inside permissions granted to your verified role.',
      bullets: [
        'Provide accurate account registration and profile metadata',
        'Operate solely within lawful and authorized organizational workflows',
        'Respect teammate, candidate, and tenant confidentiality boundaries',
      ],
    },
    {
      id: 'terms-account',
      num: '02',
      title: 'Account responsibilities',
      body: 'Users remain responsible for safeguarding credentials, connected OAuth providers, and actions initiated within developer, recruiter, or organization admin sessions.',
      bullets: [
        'Protect account passwords and OAuth-linked credentials',
        'Verify analytical results before taking hiring or career actions',
        'Notify support immediately if unauthorized account access is suspected',
      ],
    },
    {
      id: 'terms-ai',
      num: '03',
      title: 'AI-assisted outputs',
      body: 'Readiness benchmarks, match scores, skill gap priorities, and interview prompts are advisory signals designed to assist evaluation alongside independent human judgment.',
      bullets: [
        'AI models surface observable patterns rather than hiring guarantees',
        'Recruiter rankings require human review before shortlist actions',
        'Career recommendations should be weighted with real role goals',
      ],
    },
    {
      id: 'terms-restrictions',
      num: '04',
      title: 'Restrictions and suspension',
      body: 'DevInsight AI may throttle, restrict, or suspend accounts involved in abusive automation, unauthorized scraping, tenant boundary bypass attempts, or policy violations.',
      bullets: [
        'No unauthorized access to cross-organization records or private routes',
        'No automated scraping or excessive load against platform APIs',
        'Immediate mitigation for credential compromise or fraud concerns',
      ],
    },
  ] as const;
}
