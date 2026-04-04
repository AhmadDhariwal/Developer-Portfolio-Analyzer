import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PublicProfileUpcomingProject } from '../../../../shared/services/public-profile.service';
import { UpcomingProjectCardComponent } from '../upcoming-project-card/upcoming-project-card.component';

@Component({
  selector: 'app-upcoming-projects-section',
  standalone: true,
  imports: [CommonModule, UpcomingProjectCardComponent],
  templateUrl: './upcoming-projects-section.component.html',
  styleUrl: './upcoming-projects-section.component.scss'
})
export class UpcomingProjectsSectionComponent {
  @Input() heading = 'Upcoming Projects';
  @Input() subheading = '';
  @Input() projects: PublicProfileUpcomingProject[] = [];
  @Input({ required: true }) previewResolver!: (project: PublicProfileUpcomingProject) => string;
  @Input({ required: true }) primaryLinkResolver!: (project: PublicProfileUpcomingProject) => string;
  @Input({ required: true }) repoLinkResolver!: (project: PublicProfileUpcomingProject) => string;
}
