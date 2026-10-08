import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type CardVariant = 'default' | 'glass' | 'bordered' | 'elevated';
export type CardPadding = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-ui-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: `./ui-card.component.html`,
  styleUrl: './ui-card.component.scss'
})
export class UiCardComponent {
  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() variant: CardVariant = 'default';
  @Input() noPadding: boolean = false;
  @Input() paddingSize: CardPadding = 'md';
  @Input() hoverEffect: boolean = true;
  @Input() hasFooter: boolean = false;
  @Input() noHeader: boolean = false;
}
