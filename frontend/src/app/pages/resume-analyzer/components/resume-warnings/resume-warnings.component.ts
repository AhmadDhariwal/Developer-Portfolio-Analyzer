import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { UiBadgeComponent, UiCardComponent } from '../../../../shared/components';
import { ResumeWarning } from '../../../../shared/models/resume.model';

@Component({
  selector: 'app-resume-warnings',
  standalone: true,
  imports: [CommonModule, UiCardComponent, UiBadgeComponent],
  templateUrl: './resume-warnings.component.html',
  styleUrl: './resume-warnings.component.scss',
})
export class ResumeWarningsComponent {
  @Input({ required: true }) warningsList!: ResumeWarning[];
}
