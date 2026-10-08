import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

export type IconButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonShape = 'circle' | 'square';

@Component({
  selector: 'app-ui-icon-button',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-icon-button.component.html',
  styleUrl: './ui-icon-button.component.scss'
})
export class UiIconButtonComponent {
  @Input({ required: true }) ariaLabel!: string;
  @Input() variant: IconButtonVariant = 'ghost';
  @Input() size: IconButtonSize = 'md';
  @Input() shape: IconButtonShape = 'circle';
  @Input() disabled: boolean = false;
  @Input() loading: boolean = false;
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() tooltip?: string;
  @Output() clicked = new EventEmitter<Event>();

  handleClick(event: Event): void {
    if (this.disabled || this.loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.clicked.emit(event);
  }
}
