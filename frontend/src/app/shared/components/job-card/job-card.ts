import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { Job, JobUiState } from '../../models/job.model';
import {
  jobDate,
  jobSalary,
  safeJobUrl,
  decodeHtmlEntities,
  hasJobSalary,
  cleanJobTitle,
} from '../../utils/job-presentation';

@Component({
  selector: 'app-job-card',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './job-card.html',
  styleUrl: './job-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobCardComponent {
  @Input({ required: true }) job!: Job;
  @Input() uiState: JobUiState = { saved: false, applied: false, hidden: false };
  @Input() busy = false;
  @Output() save = new EventEmitter<Job>();
  @Output() markApplied = new EventEmitter<Job>();
  @Output() hide = new EventEmitter<Job>();
  @Output() similar = new EventEmitter<Job>();

  logoError = false;
  readonly date = jobDate;
  readonly salary = jobSalary;
  readonly decode = decodeHtmlEntities;
  readonly cleanTitle = cleanJobTitle;
  readonly hasSalary = hasJobSalary;

  get logoUrl(): string {
    return safeJobUrl(this.job.companyLogo);
  }
}
