import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-comparison-table',
  standalone: true,
  imports: [CommonModule],
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
    if (value === undefined || value === null) return false;
    const values = this.items
      .map((item) =>
        key === 'matchScore' ? Number(item?.match?.matchScore || 0) : Number(item?.[key] || 0),
      )
      .filter((item) => Number.isFinite(item));
    if (!values.length) return false;
    return Number(value) === Math.max(...values);
  }
}
