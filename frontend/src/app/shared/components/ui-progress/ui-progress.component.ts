import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ProgressVariant = 'bar' | 'circle';
export type ProgressSize = 'sm' | 'md' | 'lg';
export type ProgressColor = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';

@Component({
  selector: 'app-ui-progress',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-progress.component.html',
  styleUrl: './ui-progress.component.scss'
})
export class UiProgressComponent {
  @Input() value: number = 0;
  @Input() max: number = 100;
  @Input() variant: ProgressVariant = 'bar';
  @Input() size: ProgressSize = 'md';
  @Input() color: ProgressColor = 'primary';
  @Input() showLabel: boolean = false;
  @Input() label?: string;
  @Input() indeterminate: boolean = false;
  @Input() striped: boolean = false;

  get percentage(): number {
    if (!this.max || this.max <= 0) return 0;
    return Math.min(100, Math.max(0, (this.value / this.max) * 100));
  }

  // Circular calculations
  readonly circleRadius = 40;
  get circleCircumference(): number {
    return 2 * Math.PI * this.circleRadius;
  }
  get circleDashOffset(): number {
    return this.circleCircumference - (this.percentage / 100) * this.circleCircumference;
  }
}
