import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize, timeout } from 'rxjs/operators';
import { Subscription } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';

interface AIVersionItem {
  _id: string;
  source: string;
  version: number;
  outputJson?: Record<string, unknown>;
  createdAt: string;
}

interface DiffLine {
  line: number;
  left: string;
  right: string;
}

@Component({
  selector: 'app-ai-versions',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-versions.component.html',
  styleUrl: './ai-versions.component.scss'
})
export class AiVersionsComponent implements OnInit {
  versions: AIVersionItem[] = [];
  loading = false;
  source = '';
  appliedSource = '';
  selectedBaseId = '';
  selectedTargetId = '';
  diff: DiffLine[] = [];
  statusMessage = '';
  private activeRequest: Subscription | null = null;
  private loadFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly apiService: ApiService) {}

  ngOnInit(): void {
    this.searchVersions();
  }

  searchVersions(): void {
    this.appliedSource = this.source.trim();
    this.diff = [];
    this.statusMessage = this.appliedSource
      ? `Searching versions for "${this.appliedSource}"...`
      : 'Loading recent versions...';
    this.fetchVersions();
  }

  clearSearch(): void {
    this.source = '';
    this.searchVersions();
  }

  fetchVersions(): void {
    this.activeRequest?.unsubscribe();
    if (this.loadFallbackTimer) {
      clearTimeout(this.loadFallbackTimer);
      this.loadFallbackTimer = null;
    }

    this.loading = true;
    this.statusMessage = '';
    this.loadFallbackTimer = setTimeout(() => {
      this.loading = false;
      this.statusMessage = 'Loading versions took too long. Please retry.';
    }, 12000);

    this.activeRequest = this.apiService.getAiVersions({ source: this.appliedSource || undefined, includeOutput: false, limit: 100 })
      .pipe(
        timeout(12000),
        finalize(() => {
          if (this.loadFallbackTimer) {
            clearTimeout(this.loadFallbackTimer);
            this.loadFallbackTimer = null;
          }
          this.loading = false;
        })
      )
      .subscribe({
      next: (res: any) => {
        let list: AIVersionItem[] = [];
        if (Array.isArray(res?.versions)) {
          list = res.versions;
        } else if (Array.isArray(res?.data?.versions)) {
          list = res.data.versions;
        }
        this.versions = list;
        if (this.versions.length === 0) {
          this.statusMessage = this.appliedSource
            ? `No versions found for "${this.appliedSource}".`
            : 'No versions found yet.';
        } else {
          this.statusMessage = this.appliedSource
            ? `Found ${this.versions.length} version(s) for "${this.appliedSource}".`
            : `Loaded ${this.versions.length} versions.`;
        }
        if (this.versions.length >= 2 && (!this.selectedBaseId || !this.selectedTargetId)) {
          this.selectedBaseId = this.versions[0]._id;
          this.selectedTargetId = this.versions[1]._id;
        }
      },
      error: (error) => {
        this.versions = [];
        this.statusMessage = error?.name === 'TimeoutError'
          ? 'Loading versions timed out. Please retry.'
          : (error?.error?.message || 'Failed to load versions.');
      }
    });
  }

  compare(): void {
    if (!this.selectedBaseId || !this.selectedTargetId || this.selectedBaseId === this.selectedTargetId) {
      this.statusMessage = 'Select two different versions to compare.';
      return;
    }

    this.apiService.compareAiVersions(this.selectedBaseId, this.selectedTargetId).subscribe({
      next: (res: any) => {
        let parsed: DiffLine[] = [];
        if (Array.isArray(res?.diff)) {
          parsed = res.diff;
        } else if (Array.isArray(res?.data?.diff)) {
          parsed = res.data.diff;
        }
        this.diff = parsed;
        this.statusMessage = `Diff loaded (${this.diff.length} changed lines).`;
      },
      error: () => {
        this.diff = [];
        this.statusMessage = 'Failed to compare versions.';
      }
    });
  }

  rollback(versionId: string, source: string): void {
    this.apiService.rollbackAiVersion(versionId, source).subscribe({
      next: () => {
        this.statusMessage = 'Rollback snapshot created as a new version.';
        this.fetchVersions();
      },
      error: () => {
        this.statusMessage = 'Rollback failed.';
      }
    });
  }

}
