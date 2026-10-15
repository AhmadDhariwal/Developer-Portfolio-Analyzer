import { Component, Input, Output, EventEmitter, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, FormsModule } from '@angular/forms';

export type TextareaStatus = 'default' | 'success' | 'error';
export type TextareaResize = 'none' | 'vertical' | 'both';

let nextTextareaId = 0;

@Component({
  selector: 'app-ui-textarea',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ui-textarea.component.html',
  styleUrl: './ui-textarea.component.scss',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => UiTextareaComponent),
      multi: true
    }
  ]
})
export class UiTextareaComponent implements ControlValueAccessor {
  @Input() id: string = `ui-textarea-${++nextTextareaId}`;
  @Input() name?: string;
  @Input() label?: string;
  @Input() placeholder: string = '';
  @Input() rows: number = 4;
  @Input() maxLength?: number;
  @Input() showCharCount: boolean = false;
  @Input() disabled: boolean = false;
  @Input() readonly: boolean = false;
  @Input() required: boolean = false;
  @Input() hint?: string;
  @Input() errorMessage?: string;
  @Input() status: TextareaStatus = 'default';
  @Input() resize: TextareaResize = 'vertical';

  @Output() valueChange = new EventEmitter<string>();
  @Output() inputFocus = new EventEmitter<FocusEvent>();
  @Output() inputBlur = new EventEmitter<FocusEvent>();

  value: string = '';

  get computedStatus(): TextareaStatus {
    if (this.errorMessage) return 'error';
    return this.status;
  }

  get describedById(): string | null {
    if (this.errorMessage) return `${this.id}-error`;
    if (this.hint) return `${this.id}-hint`;
    return null;
  }

  get currentLength(): number {
    return this.value ? this.value.length : 0;
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
    const target = event.target as HTMLTextAreaElement;
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
}
