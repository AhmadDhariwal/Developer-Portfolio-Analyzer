import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'sa-pager',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="sa-pager sa-pager--enhanced">
      <div class="sa-pager__meta" *ngIf="total !== null && pageSize !== null">
        Showing {{ rangeStart }}-{{ rangeEnd }} of {{ total }}
      </div>
      <div class="sa-pager__controls">
        <button [disabled]="page <= 1" (click)="change.emit(page - 1)">Previous</button>
        <span>Page {{ page }} / {{ totalPages }}</span>
        <button [disabled]="page >= totalPages" (click)="change.emit(page + 1)">Next</button>
      </div>
    </div>
  `
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
