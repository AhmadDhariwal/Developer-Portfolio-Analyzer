import { ChangeDetectionStrategy, Component, HostListener, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ThemeMenuComponent } from '../../shared/components/theme-menu/theme-menu.component';
import { LandingThemeId, LandingThemeService } from '../../shared/services/landing-theme.service';

interface FeatureCapability {
  id: string;
  tag: string;
  title: string;
  description: string;
  highlights: string[];
  icon: 'github' | 'resume' | 'skills' | 'sprint' | 'interview' | 'portfolio';
}

interface WorkflowStep {
  step: string;
  title: string;
  description: string;
}

interface ReadinessAxis {
  label: string;
  score: number;
  detail: string;
}

interface SignalTabItem {
  id: 'github' | 'resume';
  label: string;
  uri: string;
  heading: string;
  summary: string;
  metrics: { label: string; value: string }[];
  snippetLines: { prefix: string; text: string; tone: 'muted' | 'primary' | 'success' | 'warn' }[];
  checks: string[];
}

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterLink, ThemeMenuComponent],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPageComponent {
  readonly mobileMenuOpenSignal = signal(false);
  readonly activeSignalTabSignal = signal<'github' | 'resume'>('github');

  get mobileMenuOpen(): boolean {
    return this.mobileMenuOpenSignal();
  }

  get activeSignalTab(): 'github' | 'resume' {
    return this.activeSignalTabSignal();
  }

  readonly currentYear = new Date().getFullYear();

  readonly navLinks = [
    { href: '#features', label: 'Features' },
    { href: '#analysis', label: 'GitHub & Resume' },
    { href: '#growth', label: 'Growth & Prep' },
    { href: '#workflow', label: 'How It Works' },
  ] as const;

  readonly readinessAxes: readonly ReadinessAxis[] = [
    {
      label: 'Code Quality',
      score: 86,
      detail: 'Repository structure, commit cadence & maintainability',
    },
    {
      label: 'Skill Coverage',
      score: 79,
      detail: 'Alignment against target stack expectations',
    },
    {
      label: 'Industry Readiness',
      score: 82,
      detail: 'Role-calibrated portfolio & resume signals',
    },
    {
      label: 'Project Impact',
      score: 74,
      detail: 'Documentation depth & real-world scope',
    },
  ] as const;

  readonly capabilities: readonly FeatureCapability[] = [
    {
      id: 'github',
      tag: 'Code Intelligence',
      title: 'GitHub Repository Analysis',
      description:
        'Evaluate public repositories, language balance, engineering consistency, and project quality without manual spreadsheets.',
      highlights: [
        'Repository quality & stack signals',
        'Commit activity & engineering patterns',
        'Verified language proficiency',
      ],
      icon: 'github',
    },
    {
      id: 'resume',
      tag: 'Document Audit',
      title: 'Resume Intelligence',
      description:
        'Upload your PDF or DOCX resume to uncover skill coverage, structure gaps, and role alignment insights.',
      highlights: [
        'Automated skill extraction & role check',
        'Clear gap diagnostics against target roles',
        'Actionable improvement recommendations',
      ],
      icon: 'resume',
    },
    {
      id: 'skills',
      tag: 'Benchmarking',
      title: 'Skill Gap Detection',
      description:
        'Combine GitHub evidence and resume data to identify high-priority skills missing for your next role.',
      highlights: [
        'Side-by-side target stack comparison',
        'Priority ranking for high-impact gaps',
        'Direct links to curated learning resources',
      ],
      icon: 'skills',
    },
    {
      id: 'sprint',
      tag: 'Execution',
      title: 'Career Sprint Planner',
      description:
        'Turn recommendations into structured career sprints with measurable milestones and progress tracking.',
      highlights: [
        'Focused milestone breakdown',
        'Track weekly completion status',
        'Aligned to readiness score improvements',
      ],
      icon: 'sprint',
    },
    {
      id: 'interview',
      tag: 'Readiness',
      title: 'Interview Preparation',
      description:
        'Practice curated and AI-generated interview questions calibrated to your target stack, level, and readiness gaps.',
      highlights: [
        'Role-specific technical & behavioral prompts',
        'Structured practice sessions & hints',
        'Focus on areas that lift readiness fastest',
      ],
      icon: 'interview',
    },
    {
      id: 'portfolio',
      tag: 'Visibility',
      title: 'Public Profile & Recruiter Hub',
      description:
        'Control a shareable developer portfolio page and opt into recruiter discovery whenever you are ready.',
      highlights: [
        'Dedicated public portfolio URL (/p/slug)',
        'Explicit privacy & visibility toggle',
        'Clear verified skill & project snapshot',
      ],
      icon: 'portfolio',
    },
  ] as const;

  readonly signalTabs: readonly SignalTabItem[] = [
    {
      id: 'github',
      label: 'GitHub Analysis',
      uri: 'dpa://telemetry/github-audit',
      heading: 'Evidence-backed signals directly from your repositories',
      summary:
        'DPA inspects public repository metadata, tech stack depth, documentation clarity, and consistency so your score reflects real engineering output.',
      metrics: [
        { label: 'Analyzed Stack', value: 'TypeScript · Angular · Node.js' },
        { label: 'Repository Focus', value: 'Full-Stack Architecture & Testing' },
        { label: 'Priority Opportunity', value: 'Expand automated CI & integration tests' },
      ],
      snippetLines: [
        { prefix: '//', text: 'Repository Audit · Public Profile Signal', tone: 'muted' },
        { prefix: 'OK', text: 'code_quality: 86/100 · consistent commits', tone: 'success' },
        {
          prefix: 'IN',
          text: 'stack_coverage: ["TypeScript", "Node.js", "REST"]',
          tone: 'primary',
        },
        { prefix: '!!', text: 'gap_flag: integration test coverage below rubric', tone: 'warn' },
      ],
      checks: [
        'Evaluates primary languages and framework distribution across repositories',
        'Highlights flagship projects with strong README and architectural clarity',
        'Maps observed repository work directly to target role benchmarks',
      ],
    },
    {
      id: 'resume',
      label: 'Resume Intelligence',
      uri: 'dpa://telemetry/resume-parser',
      heading: 'Clear alignment between what you built and what you present',
      summary:
        'Upload your resume alongside your GitHub username to surface omitted technical strengths, clarify impact bullets, and spot missing role requirements.',
      metrics: [
        { label: 'Parsed Experience', value: 'Projects · Stack · Delivery Outcomes' },
        { label: 'Cross-Check Mode', value: 'GitHub vs. Resume Skill Parity' },
        { label: 'Next Sprint Action', value: 'Quantify API latency & test coverage impact' },
      ],
      snippetLines: [
        { prefix: '//', text: 'Resume Cross-Check · Role Parity Check', tone: 'muted' },
        { prefix: 'OK', text: 'parsed_format: PDF / DOCX verified extraction', tone: 'success' },
        { prefix: 'IN', text: 'matched_skills: 11/14 target stack competencies', tone: 'primary' },
        { prefix: '!!', text: 'sprint_next: surface Docker & CI metrics in bullets', tone: 'warn' },
      ],
      checks: [
        'Extracts listed technical skills and compares them against GitHub evidence',
        'Identifies underrepresented competencies for your target career stack',
        'Generates prioritized recommendations ready to push into your Career Sprint',
      ],
    },
  ] as const;

  readonly workflowSteps: readonly WorkflowStep[] = [
    {
      step: '01',
      title: 'Create your account & connect profiles',
      description:
        'Sign up with email, Google, or GitHub OAuth, enter your GitHub username, and choose your visibility preference.',
    },
    {
      step: '02',
      title: 'Analyze repositories & upload your resume',
      description:
        'Run portfolio and resume diagnostics to see your Developer Readiness Score across Code Quality, Skill Coverage, and Project Impact.',
    },
    {
      step: '03',
      title: 'Close skill gaps & practice interviews',
      description:
        'Follow personalized learning recommendations inside your Career Sprint and sharpen answers in Interview Prep.',
    },
  ] as const;

  constructor(readonly themeService: LandingThemeService) {}

  get themes() {
    return this.themeService.themes;
  }

  get selectedTheme(): LandingThemeId {
    return this.themeService.selectedTheme;
  }

  get themeClass(): string {
    return this.themeService.themeClass();
  }

  readonly currentSignalSignal = computed<SignalTabItem>(() => {
    const active = this.activeSignalTabSignal();
    return this.signalTabs.find((tab) => tab.id === active) ?? this.signalTabs[0];
  });

  get currentSignal(): SignalTabItem {
    return this.currentSignalSignal();
  }

  selectTheme(theme: LandingThemeId): void {
    this.themeService.setTheme(theme);
  }

  selectSignalTab(tab: 'github' | 'resume'): void {
    this.activeSignalTabSignal.set(tab);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpenSignal.update((open) => !open);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpenSignal.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mobileMenuOpenSignal()) {
      this.mobileMenuOpenSignal.set(false);
    }
  }
}
