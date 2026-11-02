import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UiBadgeComponent, UiCardComponent } from '../../../../shared/components';

@Component({
  selector: 'app-resume-upload',
  standalone: true,
  imports: [CommonModule, UiCardComponent, UiBadgeComponent],
  templateUrl: './resume-upload.component.html',
  styleUrl: './resume-upload.component.scss',
})
export class ResumeUploadComponent {
  @Input({ required: true }) isAnalyzing!: boolean;
  @Input({ required: true }) isUploading!: boolean;
  @Output() readonly fileSelected = new EventEmitter<Event>();
}
