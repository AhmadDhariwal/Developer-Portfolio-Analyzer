import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'sa-pager',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sa-pager sa-pager--enhanced">
      <div class="sa-pager__meta" *ngIf="total !== null && pageSize !== null">
        <span class="sa-pager__label">Showing</span>
        <strong>{{ rangeStart }}-{{ rangeEnd }}</strong>
        <span class="sa-pager__label">of {{ total }}</span>
      </div>
      <div class="sa-pager__controls">
        <button class="sa-pager__button" [disabled]="page <= 1" (click)="change.emit(page - 1)">Previous</button>
        <span class="sa-pager__page">Page {{ page }} / {{ totalPages }}</span>
        <button class="sa-pager__button" [disabled]="page >= totalPages" (click)="change.emit(page + 1)">Next</button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
    }

    .sa-pager {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .sa-pager__meta,
    .sa-pager__controls {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .sa-pager__meta {
      padding: 8px 12px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      color: var(--text-secondary);
      white-space: nowrap;
    }

    .sa-pager__label,
    .sa-pager__page {
      color: var(--text-muted);
      font-size: 0.78rem;
      white-space: nowrap;
    }

    .sa-pager__controls {
      gap: 10px;
      justify-content: center;
      flex-wrap: wrap;
    }

    .sa-pager__button {
      min-width: 88px;
      padding: 8px 14px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-primary);
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
    }

    .sa-pager__button:hover:not(:disabled) {
      transform: translateY(-1px);
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(99, 102, 241, 0.34);
    }

    .sa-pager__button:disabled {
      opacity: 0.4;
      cursor: default;
    }

    @media (max-width: 640px) {
      .sa-pager {
        justify-content: center;
        text-align: center;
      }

      .sa-pager__meta,
      .sa-pager__controls {
        width: 100%;
        justify-content: center;
      }

      .sa-pager__button {
        min-width: 104px;
      }
    }
  `]
})
export class SaPagerComponent {
  @Input() page = 1;
  @Input() totalPages = 1;
  @Input() total: number | null = null;
  @Input() pageSize: number | null = null;
  @Output() change = new EventEmitter<number>();

  get rangeStart() {
    if (this.total === null || this.pageSize === null) return 0;
    return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get rangeEnd() {
    if (this.total === null || this.pageSize === null) return 0;
    return Math.min(this.page * this.pageSize, this.total);
  }
}
