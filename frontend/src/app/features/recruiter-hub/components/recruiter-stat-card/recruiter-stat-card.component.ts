import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';

type StatTone = 'indigo' | 'blue' | 'cyan' | 'green' | 'orange' | 'purple';

@Component({
  selector: 'app-recruiter-stat-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './recruiter-stat-card.component.html',
  styleUrl: './recruiter-stat-card.component.css'
})
export class RecruiterStatCardComponent implements OnChanges, OnDestroy {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() hint = '';
  @Input() tone: StatTone = 'indigo';
  @Input() animate = true;

  displayValue: string | number = '';
  private frame = 0;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.syncDisplayValue();
    }
  }

  ngOnDestroy(): void {
    this.stopAnimation();
  }

  private syncDisplayValue(): void {
    const parsed = this.parseDisplayValue(this.value);
    if (!this.animate || !parsed) {
      this.displayValue = this.value;
      return;
    }

    this.stopAnimation();

    const durationMs = 720;
    const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const animateFrame = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = parsed.target * eased;
      const rounded = parsed.decimals > 0 ? current.toFixed(parsed.decimals) : Math.round(current).toString();
      this.displayValue = `${parsed.prefix}${rounded}${parsed.suffix}`;

      if (progress < 1) {
        this.frame = requestAnimationFrame(animateFrame);
      }
    };

    this.frame = requestAnimationFrame(animateFrame);
  }

  private stopAnimation(): void {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
  }

  private parseDisplayValue(value: string | number): { prefix: string; target: number; suffix: string; decimals: number } | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return {
        prefix: '',
        target: value,
        suffix: '',
        decimals: Number.isInteger(value) ? 0 : 1
      };
    }

    const raw = String(value ?? '').trim();
    if (!raw) return null;

    const matched = raw.match(/^([^0-9-]*)(-?\d+(?:\.\d+)?)([^0-9]*)$/);
    if (!matched) return null;

    const target = Number(matched[2]);
    if (!Number.isFinite(target)) return null;

    return {
      prefix: matched[1] || '',
      target,
      suffix: matched[3] || '',
      decimals: matched[2].includes('.') ? 1 : 0
    };
  }
}
