import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PublicProfileUpcomingProject } from '../../../../shared/services/public-profile.service';

@Component({
  selector: 'app-upcoming-project-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './upcoming-project-card.component.html',
  styleUrl: './upcoming-project-card.component.scss'
})
export class UpcomingProjectCardComponent {
  @Input({ required: true }) project!: PublicProfileUpcomingProject;
  @Input() previewImage = '';
  @Input() primaryLink = '';
  @Input() repositoryLink = '';

  get statusLabel(): string {
    return this.project.status === 'in-progress' ? 'In Progress' : 'Planned';
  }
}
