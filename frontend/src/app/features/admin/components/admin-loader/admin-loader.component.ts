import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

export type AdminLoaderVariant = 'cards' | 'charts' | 'panels' | 'stats' | 'table';

@Component({
  selector: 'app-admin-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-loader.component.html',
  styleUrl: './admin-loader.component.scss',
})
export class AdminLoaderComponent {
  @Input() label = 'Loading workspace data...';
  @Input() variant: AdminLoaderVariant = 'cards';
  @Input() count = 4;
  @Input() compactLabel = false;

  get items(): number[] {
    return Array.from({ length: Math.max(1, this.count) }, (_, index) => index);
  }

  trackByIndex(index: number): number {
    return index;
  }
}
