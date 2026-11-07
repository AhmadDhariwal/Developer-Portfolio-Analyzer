import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { PublicProfileProject } from '../../../../shared/services/public-profile.service';
import { portfolioImage, portfolioLink } from '../../../../shared/utils/public-profile.utils';
@Component({
  selector: 'app-project-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './project-card.component.html',
  styleUrl: './project-card.component.scss',
})
export class ProjectCardComponent implements OnChanges {
  @Input({ required: true }) project!: PublicProfileProject;
  @Input() primaryLink = '';
  @Input() repositoryLink = '';
  @Input() previewImage = '';
  @Input() reverse = false;
  imageFailed = false;
  readonly link = portfolioLink;
  readonly image = portfolioImage;
  ngOnChanges(): void {
    this.imageFailed = false;
  }
}
