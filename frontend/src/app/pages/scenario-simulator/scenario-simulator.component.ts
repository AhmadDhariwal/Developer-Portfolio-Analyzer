import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../shared/services/api.service';
import { ProfileService } from '../../shared/services/profile.service';

interface ProjectInput {
  name: string;
  impact: number;
  complexity: 'low' | 'medium' | 'high';
  weeks: number;
}

interface SkillDetail {
  skill: string;
  pts: number;
  relevance: number;
  tier: 'core' | 'valuable' | 'transferable' | 'low';
  demand: number;
  difficulty: number;
}

interface SimResult {
  baseline:     { hiringScore: number; jobMatch: number };
  predicted:    { hiringScore: number; jobMatch: number };
  improvements: { hiringScore: number; jobMatch: number };
  breakdown:    { skills: number; projects: number; synergy: number; penalty: number; total: number };
  skillDetails: SkillDetail[];
  insights:     string[];
  warnings:     string[];
  suggestions:  string[];
  meta:         { role: string; level: string; durationWeeks: number; overloaded: boolean; skillsEffort: number; projectsEffort: number };
}

@Component({
  selector: 'app-scenario-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scenario-simulator.component.html',
  styleUrl: './scenario-simulator.component.scss'
})
export class ScenarioSimulatorComponent implements OnInit {
  // ── Inputs ──────────────────────────────────────────────────────────
  baselineHiringScore = 55;
  baselineJobMatch    = 48;
  role                = 'full stack';
  experienceLevel     = 'mid';
  durationWeeks       = 6;

  skillInput = '';
  skills: string[] = [];

  projects: ProjectInput[] = [
    { name: '', impact: 70, complexity: 'medium', weeks: 3 }
  ];

  // ── State ────────────────────────────────────────────────────────────
  isRunning    = false;
  errorMessage = '';
  result: SimResult | null = null;
  hasSimulated = false;
  showInfoPanel = false;

  readonly roleOptions = [
    { value: 'frontend',   label: 'Frontend Developer' },
    { value: 'backend',    label: 'Backend Developer' },
    { value: 'full stack', label: 'Full Stack Developer' },
    { value: 'ai/ml',      label: 'AI / ML Engineer' },
    { value: 'devops',     label: 'DevOps / Cloud Engineer' },
  ];

  readonly levelOptions = [
    { value: 'junior', label: 'Junior (0–2 years)' },
    { value: 'mid',    label: 'Mid-level (2–5 years)' },
    { value: 'senior', label: 'Senior (5+ years)' },
  ];

  readonly durationOptions = [2, 4, 6, 8, 12, 16];

  constructor(
    private readonly apiService:     ApiService,
    private readonly profileService: ProfileService,
    private readonly cdr:            ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Pre-fill from user profile
    this.profileService.getProfile().subscribe({
      next: (profile) => {
        if (profile.careerStack) {
          const s = profile.careerStack.toLowerCase();
          if (s.includes('front'))       this.role = 'frontend';
          else if (s.includes('back'))   this.role = 'backend';
          else if (s.includes('full'))   this.role = 'full stack';
          else if (s.includes('ai') || s.includes('ml')) this.role = 'ai/ml';
          else if (s.includes('devops')) this.role = 'devops';
        }
        if (profile.experienceLevel) {
          const l = profile.experienceLevel.toLowerCase();
          if (l.includes('student') || l.includes('intern') || l.includes('0-1')) this.experienceLevel = 'junior';
          else if (l.includes('5+') || l.includes('senior')) this.experienceLevel = 'senior';
          else this.experienceLevel = 'mid';
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  // ── Skills ───────────────────────────────────────────────────────────

  addSkill(): void {
    const v = this.skillInput.trim();
    if (!v) return;
    if (this.skills.some(s => s.toLowerCase() === v.toLowerCase())) {
      this.skillInput = '';
      return;
    }
    this.skills = [...this.skills, v];
    this.skillInput = '';
  }

  removeSkill(skill: string): void {
    this.skills = this.skills.filter(s => s !== skill);
  }

  // ── Projects ─────────────────────────────────────────────────────────

  addProject(): void {
    this.projects = [...this.projects, { name: '', impact: 70, complexity: 'medium', weeks: 3 }];
  }

  removeProject(i: number): void {
    this.projects = this.projects.filter((_, idx) => idx !== i);
  }

  get validProjects(): ProjectInput[] {
    return this.projects.filter(p => p.name.trim());
  }

  // ── Validation ───────────────────────────────────────────────────────

  get validationError(): string | null {
    if (this.baselineHiringScore < 0 || this.baselineHiringScore > 100) return 'Hiring score must be 0–100.';
    if (this.baselineJobMatch < 0 || this.baselineJobMatch > 100)       return 'Job match must be 0–100.';
    if (this.skills.length === 0 && this.validProjects.length === 0)    return 'Add at least one skill or project.';
    return null;
  }

  // ── Simulation ───────────────────────────────────────────────────────

  simulate(): void {
    const err = this.validationError;
    if (err) { this.errorMessage = err; return; }

    this.isRunning    = true;
    this.errorMessage = '';
    this.result       = null;

    this.apiService.runWhatIfSimulation({
      baselineHiringScore: this.baselineHiringScore,
      baselineJobMatch:    this.baselineJobMatch,
      role:                this.role,
      experienceLevel:     this.experienceLevel,
      durationWeeks:       this.durationWeeks,
      skills:              this.skills,
      projects:            this.validProjects
    }).subscribe({
      next: (res) => {
        this.result       = res?.result || null;
        this.hasSimulated = true;
        this.isRunning    = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Simulation failed. Please try again.';
        this.isRunning    = false;
        this.cdr.detectChanges();
      }
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  get hiringDelta(): number  { return this.result?.improvements.hiringScore ?? 0; }
  get jobMatchDelta(): number { return this.result?.improvements.jobMatch    ?? 0; }

  get breakdownRows(): { label: string; value: number; color: string }[] {
    if (!this.result) return [];
    const b = this.result.breakdown;
    return [
      { label: 'Skills',    value: b.skills,   color: '#6366f1' },
      { label: 'Projects',  value: b.projects, color: '#22c55e' },
      { label: 'Synergy',   value: b.synergy,  color: '#f59e0b' },
      { label: 'Penalty',   value: b.penalty,  color: '#ef4444' },
    ];
  }

  barWidth(value: number): number {
    return Math.min(100, Math.abs(value) * 2.5);
  }

  tierColor(tier: string): string {
    return { core: '#22c55e', valuable: '#6366f1', transferable: '#f59e0b', low: '#ef4444' }[tier] || '#64748b';
  }

  tierLabel(tier: string): string {
    return { core: 'Core', valuable: 'Valuable', transferable: 'Transferable', low: 'Low Relevance' }[tier] || tier;
  }

  scoreColor(score: number): string {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
  }

  deltaLabel(v: number): string {
    return v >= 0 ? `+${v}` : `${v}`;
  }
}
