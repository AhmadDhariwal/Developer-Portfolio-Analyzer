import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

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
  @Input() contactEmail = '';
  @Input() resumeUrl = '';
}
