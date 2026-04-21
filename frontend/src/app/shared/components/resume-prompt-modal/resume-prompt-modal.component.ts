import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DismissMode } from '../../../shared/services/resume-onboarding.service';

@Component({
  selector: 'app-resume-prompt-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './resume-prompt-modal.component.html',
  styleUrl: './resume-prompt-modal.component.scss'
})
export class ResumePromptModalComponent {
  @Input() state: 'UPLOAD' | 'SET_DEFAULT' | null = null;
  @Input() isLoading: boolean = false;

  @Output() upload     = new EventEmitter<void>();
  @Output() setDefault = new EventEmitter<void>();
  /** Emits the dismiss mode chosen by the user */
  @Output() dismiss    = new EventEmitter<DismissMode>();

  isProcessing = false;

  onPrimaryAction(): void {
    if (this.isProcessing) return;
    this.isProcessing = true;
    if (this.state === 'UPLOAD') {
      this.upload.emit();
    } else {
      this.setDefault.emit();
    }
  }

  /** ✕ button and "Remind me later" — session-only, no cooldown */
  onCloseLater(): void {
    this.dismiss.emit('later');
  }

  /** "Remind me tomorrow" — 24-hour cooldown */
  onRemindTomorrow(): void {
    this.dismiss.emit('tomorrow');
  }

  /** "Don't show again" — permanent */
  onNeverShow(): void {
    this.dismiss.emit('never');
  }
}
