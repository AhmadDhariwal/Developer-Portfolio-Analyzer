import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'sa-modal',
  standalone: true,
  imports: [CommonModule],
  styleUrls: ['./sa-modal.component.scss'],
  template: `
    <div *ngIf="open" class="sa-modal" (mousedown)="onBackdrop($event)">
      <div class="sa-modal__panel" role="dialog" aria-modal="true">
        <div class="sa-modal__head">
          <div class="sa-modal__title">{{ title }}</div>
          <button class="sa-icon-btn" type="button" (click)="close.emit()" aria-label="Close">×</button>
        </div>
        <div class="sa-modal__body">
          <ng-content />
        </div>
      </div>
    </div>
  `
})
export class SaModalComponent {
  @Input() open = false;
  @Input() title = '';
  @Output() close = new EventEmitter<void>();

  onBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) this.close.emit();
  }
}
