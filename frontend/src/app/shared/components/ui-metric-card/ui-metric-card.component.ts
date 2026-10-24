import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type MetricColor = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
export type MetricTrend = 'up' | 'down' | 'neutral';
export type MetricVariant = 'default' | 'glass' | 'subtle';

@Component({
  selector: 'app-ui-metric-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-metric-card.component.html',
  styleUrl: './ui-metric-card.component.scss'
})
export class UiMetricCardComponent {
  @Input({ required: true }) title!: string;
  @Input() value: string | number = '';
  @Input() unit?: string;
  @Input() subtitle?: string;
  @Input() trend?: MetricTrend;
  @Input() trendValue?: string;
  @Input() trendLabel?: string;
  @Input() color: MetricColor = 'primary';
  @Input() variant: MetricVariant = 'default';
  @Input() loading: boolean = false;
  @Input() stale: boolean = false;
}
