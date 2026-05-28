import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-cta-section',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './cta-section.component.html',
  styleUrl: './cta-section.component.scss'
})
export class CtaSectionComponent {
  @Input() heading = "Let's Work Together";
  @Input() subtext = '';
  @Input() primaryLabel = 'Contact Me';
  @Input() secondaryLabel = 'Download Resume';
  @Input() resumeUrl = '';
  @Input() resumeAvailable = false;
  @Output() primaryAction = new EventEmitter<void>();

  onPrimaryClick(event: Event): void {
    event.preventDefault();
    this.primaryAction.emit();
  }
}
