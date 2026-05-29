import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';

type StatTone = 'indigo' | 'blue' | 'cyan' | 'green' | 'orange' | 'purple';

@Component({
  selector: 'app-recruiter-stat-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recruiter-stat-card.component.html',
  styleUrl: './recruiter-stat-card.component.scss',
})
export class RecruiterStatCardComponent implements OnChanges {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() hint = '';
  @Input() tone: StatTone = 'indigo';
  @Input() animate = true;

  displayValue: string | number = '';

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.displayValue = this.value;
    }
  }
}
