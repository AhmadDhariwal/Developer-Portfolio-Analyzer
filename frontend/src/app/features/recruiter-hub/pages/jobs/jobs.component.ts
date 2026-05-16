import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { RecruiterJobService } from '../../services/recruiter-job.service';

@Component({
  selector: 'app-recruiter-jobs',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Jobs</h1><p>Create and manage recruiter-owned job openings.</p></div>
      <form class="glass-form" (ngSubmit)="saveJob()">
        <input [(ngModel)]="form.title" name="title" placeholder="Job title" required />
        <input [(ngModel)]="form.role" name="role" placeholder="Role label" />
        <input [(ngModel)]="form.stack" name="stack" placeholder="Stack" />
        <input [(ngModel)]="form.location" name="location" placeholder="Location" />
        <input [(ngModel)]="form.requiredSkills" name="requiredSkills" placeholder="Required skills" />
        <textarea [(ngModel)]="form.description" name="description" placeholder="Job description" required></textarea>
        <button type="submit">{{ editingJobId ? 'Update Job' : 'Create Job' }}</button>
      </form>
      <div class="card-grid">
        <app-job-card *ngFor="let job of jobs" [job]="job" (view)="openJob(job)" (edit)="editJob(job)" (archive)="archiveJob(job)" />
      </div>
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.glass-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.75rem;padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72)}input,textarea{width:100%;border-radius:10px;border:1px solid rgba(51,65,85,.8);background:rgba(15,23,42,.65);color:#f8fafc;padding:.75rem .85rem}textarea{min-height:120px;grid-column:1/-1}button{grid-column:1/-1;border:none;border-radius:10px;padding:.8rem 1rem;background:#6366f1;color:#fff;font-weight:700;cursor:pointer}.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}`]
})
export class JobsComponent implements OnInit {
  jobs: any[] = [];
  editingJobId = '';
  form: any = {
    title: '',
    role: '',
    description: '',
    stack: '',
    location: '',
    requiredSkills: '',
    preferredSkills: ''
  };

  constructor(private readonly jobService: RecruiterJobService, private readonly router: Router) {}

  ngOnInit(): void {
    this.loadJobs();
  }

  loadJobs(): void {
    this.jobService.listJobs().subscribe({
      next: (response) => {
        this.jobs = response?.jobs || [];
      }
    });
  }

  saveJob(): void {
    const payload = {
      ...this.form,
      requiredSkills: String(this.form.requiredSkills || '').split(',').map((item: string) => item.trim()).filter(Boolean),
      preferredSkills: String(this.form.preferredSkills || '').split(',').map((item: string) => item.trim()).filter(Boolean)
    };
    const stream$ = this.editingJobId
      ? this.jobService.updateJob(this.editingJobId, payload)
      : this.jobService.createJob(payload);

    stream$.subscribe({
      next: () => {
        this.form = { title: '', role: '', description: '', stack: '', location: '', requiredSkills: '', preferredSkills: '' };
        this.editingJobId = '';
        this.loadJobs();
      }
    });
  }

  editJob(job: any): void {
    this.editingJobId = job._id;
    this.form = {
      title: job.title,
      role: job.role,
      description: job.description,
      stack: job.stack,
      location: job.location,
      requiredSkills: (job.requiredSkills || []).join(', '),
      preferredSkills: (job.preferredSkills || []).join(', ')
    };
  }

  archiveJob(job: any): void {
    this.jobService.archiveJob(job._id).subscribe(() => this.loadJobs());
  }

  openJob(job: any): void {
    this.router.navigate(['/app/recruiter/jobs', job._id]);
  }
}
