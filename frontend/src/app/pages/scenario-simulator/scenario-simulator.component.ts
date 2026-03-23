import { ChangeDetectorRef, Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../shared/services/api.service';

interface ProjectInput {
  name: string;
  impact: number;
  complexity: 'low' | 'medium' | 'high';
  weeks: number;
}

@Component({
  selector: 'app-scenario-simulator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './scenario-simulator.component.html',
  styleUrl: './scenario-simulator.component.scss'
})
export class ScenarioSimulatorComponent {
  baselineHiringScore = 55;
  baselineJobMatch = 48;
  skillInput = '';
  skills: string[] = [];
  projects: ProjectInput[] = [
    { name: '', impact: 70, complexity: 'medium', weeks: 3 }
  ];

  isRunning = false;
  errorMessage = '';
  simulation: any = null;

  constructor(
    private readonly apiService: ApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  addSkill(): void {
    const value = String(this.skillInput || '').trim();
    if (!value) return;
    if (this.skills.some((item) => item.toLowerCase() === value.toLowerCase())) {
      this.skillInput = '';
      return;
    }
    this.skills = [...this.skills, value];
    this.skillInput = '';
  }

  removeSkill(skill: string): void {
    this.skills = this.skills.filter((item) => item !== skill);
  }

  addProject(): void {
    this.projects = [
      ...this.projects,
      { name: '', impact: 68, complexity: 'medium', weeks: 3 }
    ];
  }

  removeProject(index: number): void {
    this.projects = this.projects.filter((_, idx) => idx !== index);
  }

  get validProjects(): ProjectInput[] {
    return this.projects.filter((project) => String(project.name || '').trim());
  }

  get averageProjectImpact(): number {
    if (!this.validProjects.length) return 0;
    const total = this.validProjects.reduce((sum, project) => sum + Number(project.impact || 0), 0);
    return Math.round((total / this.validProjects.length) * 10) / 10;
  }

  get averageProjectDuration(): number {
    if (!this.validProjects.length) return 0;
    const total = this.validProjects.reduce((sum, project) => sum + Number(project.weeks || 0), 0);
    return Math.round((total / this.validProjects.length) * 10) / 10;
  }

  simulate(): void {
    this.isRunning = true;
    this.errorMessage = '';
    this.simulation = null;

    const payload = {
      baselineHiringScore: this.baselineHiringScore,
      baselineJobMatch: this.baselineJobMatch,
      skills: this.skills,
      projects: this.validProjects
    };

    this.apiService.runWhatIfSimulation(payload).subscribe({
      next: (response) => {
        this.simulation = response?.result || null;
        this.isRunning = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Simulation failed. Please try again.';
        this.isRunning = false;
        this.cdr.detectChanges();
      }
    });
  }
}
