import { Component, EventEmitter, Input, Output } from '@angular/core';

import { RecruiterJob } from '../../services/recruiter.service';

@Component({
  selector: 'app-job-card',
  standalone: false,
  templateUrl: './job-card.component.html',
  styleUrls: ['./job-card.component.scss']
})
export class JobCardComponent {
  @Input() job!: RecruiterJob;
  @Input() selected = false;

  @Output() selectJob = new EventEmitter<string>();
  @Output() editJob = new EventEmitter<RecruiterJob>();
  @Output() deleteJob = new EventEmitter<string>();
}
