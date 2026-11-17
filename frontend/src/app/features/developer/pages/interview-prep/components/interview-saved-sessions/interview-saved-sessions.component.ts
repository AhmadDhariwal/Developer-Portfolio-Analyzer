import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  InterviewQuestion,
  InterviewSession,
} from '../../../../../../shared/models/interview-prep.model';
import { SKILL_LABELS } from '../../../../../../shared/constants/interview-prep.constants';
import { InterviewQuestionCardComponent } from '../interview-question-card/interview-question-card.component';

@Component({
  selector: 'app-interview-saved-sessions',
  standalone: true,
  imports: [CommonModule, InterviewQuestionCardComponent],
  templateUrl: './interview-saved-sessions.component.html',
  styleUrl: './interview-saved-sessions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InterviewSavedSessionsComponent {
  @Input() sessions: InterviewSession[] = [];
  @Input() selectedSession: InterviewSession | null = null;
  @Output() selectSession = new EventEmitter<InterviewSession>();
  @Output() resumeSession = new EventEmitter<InterviewSession>();
  @Output() deleteSession = new EventEmitter<InterviewSession>();
  @Output() scrollToQuestion = new EventEmitter<number>();

  skillLabel(key: string): string {
    return SKILL_LABELS[key] || key;
  }

  sessionMetaLabel(session: InterviewSession): string {
    const countLabel = `${session.questions.length} ${
      session.questions.length === 1 ? 'question' : 'questions'
    } in this set`;
    return [session.careerStack, session.experienceLevel, countLabel]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join(' · ');
  }

  trackQuestion = (_index: number, question: InterviewQuestion): string =>
    `${question.topicKey || ''}:${question._id || question.question}`;
}
