import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

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
  @Input() noPadding: boolean = false;
  @Input() hoverEffect: boolean = true;
  @Input() hasFooter: boolean = false;
  @Input() noHeader: boolean = false;
}
