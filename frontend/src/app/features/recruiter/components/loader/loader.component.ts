import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

type LoaderVariant = 'cards' | 'charts' | 'pills' | 'stats' | 'table' | 'timeline';

@Component({
  selector: 'app-recruiter-loader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './loader.component.html',
  styleUrl: './loader.component.scss',
})
export class LoaderComponent {
  @Input() label = 'Loading...';
  @Input() variant: LoaderVariant = 'cards';
  @Input() count = 3;

  get items(): number[] {
    return Array.from({ length: Math.max(1, this.count) }, (_, index) => index);
  }

  trackByIndex(index: number): number {
    return index;
  }
}
