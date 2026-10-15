import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

export interface SelectOption<T = string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

export type SelectSize = 'sm' | 'md' | 'lg';
export type SelectStatus = 'default' | 'success' | 'error';

let nextSelectId = 0;

@Component({
  selector: 'app-ui-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ui-select.component.html',
  styleUrl: './ui-select.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UiSelectComponent),
      multi: true
    }
  ]
})
export class UiSelectComponent implements ControlValueAccessor {
  @Input() id: string = `ui-select-${++nextSelectId}`;
  @Input() name?: string;
  @Input() label?: string;
  @Input() placeholder?: string;
  @Input() options: SelectOption[] = [];
  @Input() disabled: boolean = false;
  @Input() required: boolean = false;
  @Input() size: SelectSize = 'md';
  @Input() hint?: string;
  @Input() errorMessage?: string;
  @Input() status: SelectStatus = 'default';

  @Output() valueChange = new EventEmitter<string | number>();

  value: string | number = '';

  get computedStatus(): SelectStatus {
    if (this.errorMessage) return 'error';
    return this.status;
  }

  get describedById(): string | null {
    if (this.errorMessage) return `${this.id}-error`;
    if (this.hint) return `${this.id}-hint`;
    return null;
  }

  private onChange: (value: string | number) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: unknown): void {
    this.value = value != null ? (value as string | number) : '';
  }

  registerOnChange(fn: (value: string | number) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  handleChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    this.value = target.value;
    this.onChange(this.value);
    this.valueChange.emit(this.value);
  }

  handleBlur(): void {
    this.onTouched();
  }
}
