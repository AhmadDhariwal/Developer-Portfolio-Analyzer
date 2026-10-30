import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiButtonComponent } from '../ui-button/ui-button.component';

@Component({
  selector: 'app-ui-error-state',
  standalone: true,
  imports: [CommonModule, UiButtonComponent],
  templateUrl: './ui-error-state.component.html',
  styleUrl: './ui-error-state.component.scss'
})
export class UiErrorStateComponent {
  @Input() title: string = 'Something went wrong';
  @Input() message: string = 'An error occurred while loading this section. Please try again.';
  @Input() code?: string | number;
  @Input() retryable: boolean = true;
  @Input() retryLabel: string = 'Try Again';
  @Input() compact: boolean = false;

  @Output() retry = new EventEmitter<void>();

  onRetry(): void {
    this.retry.emit();
  }
}
