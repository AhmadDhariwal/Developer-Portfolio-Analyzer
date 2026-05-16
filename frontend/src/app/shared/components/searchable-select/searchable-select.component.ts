import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface SearchableSelectOption {
  value: string;
  label: string;
  meta?: string;
}

@Component({
  selector: 'app-searchable-select',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './searchable-select.component.html',
  styleUrl: './searchable-select.component.scss'
})
export class SearchableSelectComponent {
  @Input() options: SearchableSelectOption[] = [];
  @Input() value = '';
  @Input() placeholder = 'Select';
  @Input() searchPlaceholder = 'Search';
  @Input() emptyStateLabel = 'No options found';
  @Input() emptyOptionLabel = '';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  isOpen = false;
  searchTerm = '';

  constructor(private readonly elementRef: ElementRef<HTMLElement>) {}

  get selectedLabel(): string {
    if (!this.value && this.emptyOptionLabel) return this.emptyOptionLabel;
    return this.options.find((option) => option.value === this.value)?.label || this.placeholder;
  }

  get filteredOptions(): SearchableSelectOption[] {
    const needle = this.searchTerm.trim().toLowerCase();
    if (!needle) return this.options;

    return this.options.filter((option) => {
      const haystack = `${option.label} ${option.meta || ''}`.toLowerCase();
      return haystack.includes(needle);
    });
  }

  toggle(): void {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (!this.isOpen) this.searchTerm = '';
  }

  select(value: string): void {
    this.value = value;
    this.valueChange.emit(value);
    this.isOpen = false;
    this.searchTerm = '';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen) return;
    if (!this.elementRef.nativeElement.contains(event.target as Node)) {
      this.isOpen = false;
      this.searchTerm = '';
    }
  }
}
