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
  @Input({ required: true }) project!: PublicProfileProject;
  @Input() primaryLink = '';
  @Input() repositoryLink = '';
  @Input() previewImage = '';
  @Input() reverse = false;
}
