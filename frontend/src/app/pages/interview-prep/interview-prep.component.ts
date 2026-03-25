import { Component, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InterviewPrepService, InterviewPrepSession, InterviewQuestion } from '../../shared/services/interview-prep.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';

@Component({
  selector: 'app-interview-prep',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './interview-prep.component.html',
  styleUrl: './interview-prep.component.scss'
})
export class InterviewPrepComponent {
  skillGapsInput = '';
  session: InterviewPrepSession | null = null;
  isLoading = false;
  openAnswers = new Set<number>();

  constructor(
    private readonly prepService: InterviewPrepService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  generatePrep(): void {
    const skillGaps = this.skillGapsInput
      .split(',')
      .map((gap) => gap.trim())
      .filter(Boolean);

    this.isLoading = true;
    const { careerStack, experienceLevel } = this.careerProfileService.snapshot;

    this.prepService.generateSession({ skillGaps, careerStack, experienceLevel }).subscribe({
      next: (session) => {
        this.session = session;
        this.isLoading = false;
        this.openAnswers.clear();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  toggleAnswer(index: number): void {
    if (this.openAnswers.has(index)) {
      this.openAnswers.delete(index);
    } else {
      this.openAnswers.add(index);
    }
  }

  isAnswerOpen(index: number): boolean {
    return this.openAnswers.has(index);
  }

  trackByQuestion(_index: number, item: InterviewQuestion): string {
    return item.question;
  }
}
