import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicSubpageShellComponent } from '../../shared/components/public-subpage-shell/public-subpage-shell.component';

interface ApiDomainSpec {
  id: 'auth' | 'intelligence' | 'recruiter' | 'admin';
  label: string;
  tag: string;
  description: string;
  keyFields: readonly string[];
  sampleTitle: string;
  sampleJson: string;
}

@Component({
  selector: 'app-api-docs-page',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicSubpageShellComponent],
  templateUrl: './api-docs-page.component.html',
  styleUrl: './api-docs-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiDocsPageComponent {
  readonly featureCards = [
    {
      tag: 'SECURITY',
      value: 'JWT Auth',
      label: 'Authenticated session-based access across developer, recruiter, and admin views.',
    },
    {
      tag: 'FORMAT',
      value: 'JSON APIs',
      label: 'Predictable named payload envelopes built for the Angular web workspace.',
    },
    {
      tag: 'ISOLATION',
      value: 'RBAC Safe',
      label: 'Role-checked and organization-scoped boundaries enforced on every response.',
    },
  ] as const;

  readonly apiGroups: readonly ApiDomainSpec[] = [
    {
      id: 'auth',
      label: 'Authentication',
      tag: 'SESSION / OAUTH',
      description:
        'Session bootstrap, OTP verification, password recovery, and Google / GitHub OAuth sign-in handshakes.',
      keyFields: ['user', 'token', 'requiresVerification', 'recoveryHandle', 'message'],
      sampleTitle: 'dpa://conventions/auth-session',
      sampleJson: `{
  "user": {
    "id": "usr_active_session",
    "role": "developer",
    "isVerified": true
  },
  "message": "Authenticated session active"
}`,
    },
    {
      id: 'intelligence',
      label: 'Developer Intelligence',
      tag: 'ANALYSIS',
      description:
        'Portfolio readiness scoring, GitHub repository diagnostics, resume parsing, skill gaps, and interview prep.',
      keyFields: ['profile', 'dashboard', 'analytics', 'skillGap', 'careerSprint'],
      sampleTitle: 'dpa://conventions/developer-intelligence',
      sampleJson: `{
  "dashboard": {
    "readinessScore": 81,
    "codeQuality": 86,
    "skillCoverage": 79
  },
  "analytics": {
    "primaryStack": ["TypeScript", "Angular", "Node.js"]
  }
}`,
    },
    {
      id: 'recruiter',
      label: 'Recruiter Hub',
      tag: 'HIRING WORKFLOWS',
      description:
        'Dashboard metrics, public developer discovery, job requirements, AI candidate ranking, and recruiter shortlists.',
      keyFields: ['jobs', 'candidates', 'rankings', 'analytics', 'shortlist'],
      sampleTitle: 'dpa://conventions/recruiter-matching',
      sampleJson: `{
  "jobs": [{ "id": "job_role_spec", "title": "Full-Stack Engineer" }],
  "analytics": {
    "scopedVisibility": "organization",
    "aiAdvisoryOnly": true
  }
}`,
    },
    {
      id: 'admin',
      label: 'Admin & Organization',
      tag: 'TENANT RBAC',
      description:
        'Recruiter provisioning, organization teams, invitation workflows, and tenant-scoped governance visibility.',
      keyFields: ['recruiters', 'organization', 'teams', 'invitations', 'auditSummary'],
      sampleTitle: 'dpa://conventions/organization-rbac',
      sampleJson: `{
  "organization": {
    "scope": "tenant-isolated",
    "roles": ["admin", "recruiter", "developer"]
  },
  "recruiters": [],
  "message": "Organization scope verified"
}`,
    },
  ] as const;

  readonly selectedDomainId = signal<ApiDomainSpec['id']>('auth');
  readonly copiedSample = signal(false);

  readonly activeDomain = computed<ApiDomainSpec>(
    () => this.apiGroups.find((item) => item.id === this.selectedDomainId()) ?? this.apiGroups[0],
  );

  selectDomain(id: ApiDomainSpec['id']): void {
    this.selectedDomainId.set(id);
    this.copiedSample.set(false);
  }

  copySampleJson(): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    navigator.clipboard.writeText(this.activeDomain().sampleJson).then(
      () => {
        this.copiedSample.set(true);
      },
      () => {
        this.copiedSample.set(false);
      },
    );
  }
}
