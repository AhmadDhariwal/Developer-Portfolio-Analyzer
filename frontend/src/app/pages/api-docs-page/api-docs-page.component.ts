import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicSubpageShellComponent } from '../../shared/components/public-subpage-shell/public-subpage-shell.component';

interface PlatformDomainOverview {
  id: 'auth' | 'intelligence' | 'recruiter' | 'admin';
  label: string;
  tag: string;
  description: string;
  capabilities: readonly string[];
  sampleTitle: string;
  sampleSummary: string;
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
      value: 'Authenticated',
      label: 'All workspace operations require active verified session credentials.',
    },
    {
      tag: 'ISOLATION',
      value: 'Tenant Isolated',
      label: 'Organization workspaces enforce strict access and visibility boundaries.',
    },
    {
      tag: 'PRIVACY',
      value: 'Scoped Access',
      label: 'Public developer profiles stay separate from private account and hiring workflows.',
    },
  ] as const;

  readonly apiGroups: readonly PlatformDomainOverview[] = [
    {
      id: 'auth',
      label: 'Account Access & Sessions',
      tag: 'IDENTITY BOUNDARY',
      description:
        'Account registration, verification safeguards, password recovery, and Google or GitHub sign-in flows.',
      capabilities: [
        'Account Onboarding',
        'Verification Checks',
        'OAuth Sign-In',
        'Access Recovery',
      ],
      sampleTitle: 'overview://workspace/identity-boundary',
      sampleSummary: `{
  "area": "Account Access & Sessions",
  "access": "Authenticated users only",
  "providers": ["Email", "Google", "GitHub"],
  "specification": "Private implementation details are non-public."
}`,
    },
    {
      id: 'intelligence',
      label: 'Developer Intelligence',
      tag: 'DEVELOPER WORKSPACE',
      description:
        'Portfolio readiness analysis, public GitHub project review, resume insights, learning paths, and interview practice.',
      capabilities: [
        'Repository Sync',
        'Resume Review',
        'Skill Benchmarks',
        'Learning Plans',
        'Interview Practice',
      ],
      sampleTitle: 'overview://workspace/portfolio-intelligence',
      sampleSummary: `{
  "area": "Developer Portfolio Intelligence",
  "access": "Owner workspace",
  "capabilities": ["Project evaluation", "Skill growth planning"],
  "visibility": "Controlled by account privacy preferences"
}`,
    },
    {
      id: 'recruiter',
      label: 'Recruiter Hub',
      tag: 'HIRING WORKSPACE',
      description:
        'Public talent discovery, role criteria matching, team shortlist coordination, and advisory candidate evaluation.',
      capabilities: [
        'Public Profile Discovery',
        'Role Matching',
        'Shortlist Review',
        'Hiring Coordination',
      ],
      sampleTitle: 'overview://workspace/hiring-workflows',
      sampleSummary: `{
  "area": "Recruiter & Hiring Workflows",
  "access": "Authorized organization members",
  "aiGuidance": "Advisory assistance paired with human review",
  "specification": "Internal hiring workflows remain organization-scoped."
}`,
    },
    {
      id: 'admin',
      label: 'Organization Governance',
      tag: 'WORKSPACE CONTROLS',
      description:
        'Workspace team onboarding, member management, invitation controls, and organization-level access boundaries.',
      capabilities: [
        'Team Onboarding',
        'Member Access',
        'Invitation Controls',
        'Workspace Boundaries',
      ],
      sampleTitle: 'overview://workspace/organization-governance',
      sampleSummary: `{
  "area": "Organization Governance",
  "access": "Authorized workspace administrators",
  "isolation": "Strict separation across customer organizations",
  "specification": "Operational interfaces are private to the application."
}`,
    },
  ] as const;

  readonly selectedDomainId = signal<PlatformDomainOverview['id']>('auth');
  readonly copiedSample = signal(false);

  readonly activeDomain = computed<PlatformDomainOverview>(
    () => this.apiGroups.find((item) => item.id === this.selectedDomainId()) ?? this.apiGroups[0],
  );

  selectDomain(id: PlatformDomainOverview['id']): void {
    this.selectedDomainId.set(id);
    this.copiedSample.set(false);
  }

  copySampleJson(): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    navigator.clipboard.writeText(this.activeDomain().sampleSummary).then(
      () => {
        this.copiedSample.set(true);
      },
      () => {
        this.copiedSample.set(false);
      },
    );
  }
}
