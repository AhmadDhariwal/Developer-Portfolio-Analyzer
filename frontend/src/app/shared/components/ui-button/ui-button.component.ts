import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-ui-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-button.component.html',
  styleUrl: './ui-button.component.scss'
})
export class UiButtonComponent {
  @Input() variant: ButtonVariant = 'primary';
  @Input() size: ButtonSize = 'md';
  @Input() fullWidth: boolean = false;
  @Input() disabled: boolean = false;
  @Input() loading: boolean = false;
  @Output() clicked = new EventEmitter<Event>();
}
