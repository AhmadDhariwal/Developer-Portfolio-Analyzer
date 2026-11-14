import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import {
  KaggleLinkedProfile,
  IntegrationsService,
} from '../../../../shared/services/integrations.service';

@Component({
  selector: 'app-kaggle-linked-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './kaggle-linked-profile.component.html',
  styleUrl: './kaggle-linked-profile.component.scss',
})
export class KaggleLinkedProfileComponent implements OnInit {
  profile: KaggleLinkedProfile | null = null;
  input = '';
  busy = true;
  error = '';

  constructor(
    private readonly service: IntegrationsService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.service
      .getKaggleLinkedProfile()
      .pipe(finalize(() => this.finish()))
      .subscribe({
        next: ({ linkedProfile }) => {
          this.profile = linkedProfile;
          this.input = linkedProfile?.username || '';
        },
        error: () => {
          this.error = 'Unable to load the saved profile link. You can retry by saving a link.';
        },
      });
  }

  save(): void {
    if (this.busy) return;
    if (!this.input.trim()) {
      this.error = 'Enter a Kaggle username or profile URL.';
      return;
    }
    this.busy = true;
    this.error = '';
    this.service
      .saveKaggleLinkedProfile(this.input.trim())
      .pipe(finalize(() => this.finish()))
      .subscribe({
        next: ({ linkedProfile }) => {
          this.profile = linkedProfile;
          this.input = linkedProfile.username;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to save the profile link.';
        },
      });
  }

  remove(): void {
    if (this.busy || !this.profile) return;
    this.busy = true;
    this.error = '';
    this.service
      .removeKaggleLinkedProfile()
      .pipe(finalize(() => this.finish()))
      .subscribe({
        next: () => {
          this.profile = null;
          this.input = '';
        },
        error: () => {
          this.error = 'Unable to remove the profile link.';
        },
      });
  }

  private finish(): void {
    this.busy = false;
    this.cdr.detectChanges();
  }
}
