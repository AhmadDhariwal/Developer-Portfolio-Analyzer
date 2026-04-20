import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PublicProfileProject } from '../../../../shared/services/public-profile.service';

@Component({
  selector: 'app-project-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './project-card.component.html',
  styleUrl: './project-card.component.scss'
})
export class ProjectCardComponent {
  private readonly fallbackPreview =
    'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1400&q=80';

  @Input({ required: true }) project!: PublicProfileProject;
  @Input() primaryLink = '';
  @Input() repositoryLink = '';
  @Input() previewImage = '';
  @Input() reverse = false;

  onPreviewError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = this.fallbackPreview;
  }
}
