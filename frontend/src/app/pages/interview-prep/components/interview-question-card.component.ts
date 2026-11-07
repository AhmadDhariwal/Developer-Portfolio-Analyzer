import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { InterviewQuestion } from '../../../shared/models/interview-prep.model';
import { SKILL_LABELS } from '../../../shared/constants/interview-prep.constants';

interface AnswerSection {
  title: string;
  text?: string;
  items?: string[];
  code?: boolean;
}

@Component({
  selector: 'app-interview-question-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './interview-question-card.component.html',
  styleUrl: './interview-question-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InterviewQuestionCardComponent implements OnChanges {
  @Input({ required: true }) question!: InterviewQuestion;
  @Input() showRank = false;
  expanded = false;
  copyStatus = '';
  sections: AnswerSection[] = [];
  sourceUrl = '';
  constructor(private readonly cdr: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.expanded = false;
    this.copyStatus = '';
    const answer = this.question.answerSections || {};
    this.sections = [
      { title: 'Short answer', text: answer.shortAnswer || answer.summary },
      { title: 'Key points', items: answer.keyPoints || answer.bulletPoints },
      { title: 'Explanation', text: answer.explanation },
      { title: 'Code & example', text: answer.example || answer.codeExample, code: true },
      { title: 'In practice', text: answer.realWorldUseCase || answer.realWorldContext },
      { title: 'Common mistakes', items: answer.commonMistakes },
      { title: 'Interview tip', text: answer.interviewTip },
    ].filter((section) => Boolean(section.text || section.items?.length));
    if (!this.sections.length && this.question.answer)
      this.sections = [{ title: 'Answer', text: this.question.answer }];
    this.sourceUrl = '';
    try {
      const url = new URL(this.question.sourceMeta?.url || '');
      if (url.protocol === 'https:' && !url.username && !url.password) this.sourceUrl = url.href;
    } catch {
      /* Older questions may have no source URL. */
    }
  }
  get verified(): boolean {
    if (this.question.verificationStatus) return this.question.verificationStatus === 'verified';
    return ['verified_seed', 'prebuilt', 'seed'].includes(
      this.question.originalSourceType || this.question.sourceType || this.question.source || '',
    );
  }
  get source(): string {
    if (this.question.sourceType === 'no_verified_answer') return 'No verified answer';
    const source =
      this.question.originalSourceType || this.question.sourceType || this.question.source || '';
    if (['ai', 'ai_generated', 'user_asked'].includes(source))
      return this.verified ? 'AI generated · reviewed' : 'AI generated · unverified';
    if (['scraped', 'scrape'].includes(source))
      return this.verified ? 'Reviewed external source' : 'External source · unverified';
    return this.verified ? 'Verified library' : 'Unverified content';
  }
  get topic(): string {
    return (
      SKILL_LABELS[this.question.topicKey || this.question.skill || ''] ||
      this.question.topicKey ||
      ''
    );
  }
  get category(): string {
    return (this.question.category || '').replaceAll(/[-_]/g, ' ');
  }
  async copyAnswer(): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${this.question.question}\n\n${this.question.answer}`);
      this.copyStatus = 'Copied';
    } catch {
      this.copyStatus = 'Copy unavailable';
    }
    this.cdr.markForCheck();
  }
}
