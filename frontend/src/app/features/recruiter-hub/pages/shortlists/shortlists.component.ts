import { Component, OnInit, signal } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
};

@Component({
  selector: 'app-recruiter-shortlists',
  standalone: false,
  templateUrl: './shortlists.component.html',
  styleUrl: './shortlists.component.scss',
})
export class ShortlistsComponent implements OnInit {
  loading = true;
  error = '';
  notice = '';
  shortlists: any[] = [];
  readonly confirmState = signal<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
  });
  private pendingConfirmAction: (() => void) | null = null;

  constructor(
    private readonly hubService: RecruiterHubService,
    private readonly matchService: RecruiterMatchService,
  ) {}

  ngOnInit(): void {
    this.loadShortlists();
  }

  loadShortlists(): void {
    this.loading = true;
    this.error = '';
    this.matchService.getShortlists().subscribe({
      next: (response) => {
        this.shortlists = response?.shortlists || [];
        this.loading = false;
      },
      error: (err) => {
        this.shortlists = [];
        this.error = err?.error?.message || 'Unable to load shortlist entries.';
        this.loading = false;
      },
    });
  }

  advance(item: any): void {
    const nextStatus = this.nextStatus(String(item?.status || 'shortlisted'));
    this.openConfirm(
      'Advance shortlist',
      `Move ${item?.candidate?.name || 'this candidate'} to ${nextStatus}?`,
      'Advance',
      () => {
        this.matchService.updateShortlist(item._id, { status: nextStatus }).subscribe({
          next: () => {
            this.notice = `${item?.candidate?.name || 'Candidate'} moved to ${nextStatus}.`;
            this.loadShortlists();
            this.hubService.clearCache();
          },
          error: (err) => {
            this.error = err?.error?.message || 'Unable to update this shortlist entry.';
          },
        });
      },
    );
  }

  remove(item: any): void {
    this.openConfirm(
      'Remove shortlist entry',
      `Remove ${item?.candidate?.name || 'this candidate'} from shortlist?`,
      'Remove',
      () => {
        this.matchService.removeShortlist(item._id).subscribe({
          next: () => {
            this.notice = `${item?.candidate?.name || 'Candidate'} removed from shortlist.`;
            this.loadShortlists();
            this.hubService.clearCache();
          },
          error: (err) => {
            this.error = err?.error?.message || 'Unable to remove this shortlist entry.';
          },
        });
      },
    );
  }

  onConfirmAccepted(): void {
    const action = this.pendingConfirmAction;
    this.closeConfirm();
    action?.();
  }

  onConfirmCancelled(): void {
    this.closeConfirm();
  }

  private nextStatus(status: string): string {
    const order = ['shortlisted', 'reviewing', 'contacted', 'interview'];
    const currentIndex = order.indexOf(status);
    if (currentIndex < 0 || currentIndex === order.length - 1) return 'interview';
    return order[currentIndex + 1];
  }

  private openConfirm(
    title: string,
    message: string,
    confirmText: string,
    action: () => void,
  ): void {
    this.pendingConfirmAction = action;
    this.confirmState.set({ open: true, title, message, confirmText });
  }

  private closeConfirm(): void {
    this.pendingConfirmAction = null;
    this.confirmState.set({
      open: false,
      title: '',
      message: '',
      confirmText: 'Confirm',
    });
  }
}
