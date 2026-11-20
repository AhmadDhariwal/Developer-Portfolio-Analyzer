import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-comparison-table',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './comparison-table.component.html',
  styleUrl: './comparison-table.component.scss',
})
export class ComparisonTableComponent {
  @Input() items: any[] = [];

  get hasMatchRow(): boolean {
    return this.items.some(
      (item) => item?.match?.matchScore !== undefined && item?.match?.matchScore !== null,
    );
  }

  isBest(key: string, value: number | null | undefined): boolean {
    if (value === undefined || value === null || !Number.isFinite(Number(value))) return false;
    const values = this.items
      .map((item) => this.extractMetric(item, key))
      .filter((item): item is number => item !== null && item !== undefined && Number.isFinite(item));
    if (!values.length) return false;
    const max = Math.max(...values);
    if (max <= 0) return false;
    return Number(value) === max;
  }

  initialFor(name: string): string {
    return String(name || 'C').trim().charAt(0).toUpperCase() || 'C';
  }

  private extractMetric(item: any, key: string): number | null {
    if (key === 'matchScore') return item?.match?.matchScore ?? null;
    if (key === 'skillMatchPercent') return item?.match?.skillMatchPercent ?? null;
    if (key === 'confidenceScore') return item?.match?.confidenceScore ?? null;
    return item?.[key] ?? null;
  }
}
