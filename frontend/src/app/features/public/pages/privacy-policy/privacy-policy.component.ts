import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicSubpageShellComponent } from '../../../../shared/components/public-subpage-shell/public-subpage-shell.component';

@Component({
  selector: 'app-privacy-policy',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicSubpageShellComponent],
  templateUrl: './privacy-policy.component.html',
  styleUrl: './privacy-policy.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacyPolicyComponent {
  readonly highlights = [
    {
      tag: 'ISOLATION',
      value: 'Scoped RBAC',
      label: 'Role-checked and organization-bounded access across views.',
    },
    {
      tag: 'SECURITY',
      value: 'OAuth Safe',
      label: 'Google and GitHub sign-in secrets and tokens stay server-side.',
    },
    {
      tag: 'RETENTION',
      value: 'Minimal Data',
      label: 'Retains only the signals needed to operate workspace workflows.',
    },
  ] as const;

  readonly sections = [
    {
      id: 'privacy-collect',
      num: '01',
      title: 'Information we collect',
      body: 'DevInsight AI collects account identity details, developer and recruiter profile inputs, GitHub-derived repository signals, resume analysis records, and organization membership metadata required for platform workflows.',
      bullets: [
        'Name, email address, account role, and authentication metadata',
        'Portfolio readiness scores, resume diagnostics, and GitHub signals',
        'Recruiter preferences, job specifications, and shortlist activity',
      ],
    },
    {
      id: 'privacy-use',
      num: '02',
      title: 'How we use data',
      body: 'Collected data powers readiness scoring, skill gap detection, career sprint planning, interview preparation, recruiter discovery, and organization-scoped analytics inside authorized RBAC boundaries.',
      bullets: [
        'Generate developer portfolio benchmarks and learning paths',
        'Support recruiter candidate matching, review, and coordination',
        'Maintain platform security, session integrity, and reliability',
      ],
    },
    {
      id: 'privacy-sharing',
      num: '03',
      title: 'Access boundaries and sharing',
      body: 'We never sell personal information. Data is visible only to authenticated accounts with matching role and organization permissions, and public profiles stay separated from private tenant operations.',
      bullets: [
        'Role-based and organization-scoped tenant isolation',
        'No cross-organization disclosure of internal recruiter notes',
        'Privacy-controlled public developer portfolio visibility',
      ],
    },
    {
      id: 'privacy-security',
      num: '04',
      title: 'Security safeguards and retention',
      body: 'We enforce protected password hashing, authenticated session validation, and server-side integration credential handling, retaining account data only as needed for active workspaces and legal obligations.',
      bullets: [
        'Encrypted transport and credential revision enforcement',
        'Server-side storage for OAuth and third-party API credentials',
        'Retention aligned with active user and organization lifecycle',
      ],
    },
  ] as const;
}
