import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

export type InputType = 'text' | 'email' | 'password' | 'search' | 'number' | 'tel' | 'url';
export type InputSize = 'sm' | 'md' | 'lg';
export type InputStatus = 'default' | 'success' | 'error';

let nextUniqueId = 0;

@Component({
  selector: 'app-ui-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ui-input.component.html',
  styleUrl: './ui-input.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UiInputComponent),
      multi: true
    }
  ]
})
export class UiInputComponent implements ControlValueAccessor {
  @Input() id: string = `ui-input-${++nextUniqueId}`;
  @Input() name?: string;
  @Input() type: InputType = 'text';
  @Input() label?: string;
  @Input() placeholder: string = '';
  @Input() hint?: string;
  @Input() errorMessage?: string;
  @Input() status: InputStatus = 'default';
  @Input() size: InputSize = 'md';
  @Input() disabled: boolean = false;
  @Input() readonly: boolean = false;
  @Input() required: boolean = false;
  @Input() clearable: boolean = false;
  @Input() autocomplete: string = 'off';

  @Output() valueChange = new EventEmitter<string>();
  @Output() inputFocus = new EventEmitter<FocusEvent>();
  @Output() inputBlur = new EventEmitter<FocusEvent>();
  @Output() cleared = new EventEmitter<void>();

  value: string = '';
  showPassword: boolean = false;

  get currentType(): string {
    if (this.type === 'password') {
      return this.showPassword ? 'text' : 'password';
    }
    return this.type;
  }

  get computedStatus(): InputStatus {
    if (this.errorMessage) return 'error';
    return this.status;
  }

  get describedById(): string | null {
    if (this.errorMessage) return `${this.id}-error`;
    if (this.hint) return `${this.id}-hint`;
    return null;
  }

  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  writeValue(value: unknown): void {
    this.value = value != null ? String(value) : '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  handleInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.value = target.value;
    this.onChange(this.value);
    this.valueChange.emit(this.value);
  }

  handleFocus(event: FocusEvent): void {
    this.inputFocus.emit(event);
  }

  handleBlur(event: FocusEvent): void {
    this.onTouched();
    this.inputBlur.emit(event);
  }

  clear(): void {
    if (this.disabled || this.readonly) return;
    this.value = '';
    this.onChange('');
    this.valueChange.emit('');
    this.cleared.emit();
  }

  togglePasswordVisibility(): void {
    if (this.disabled) return;
    this.showPassword = !this.showPassword;
  }
}
