import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

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
  
  @Output() upload = new EventEmitter<void>();
  @Output() setDefault = new EventEmitter<void>();
  @Output() dismiss = new EventEmitter<boolean>(); // true for permanent

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

  onClose(permanent: boolean = false): void {
    this.dismiss.emit(permanent);
  }
}
