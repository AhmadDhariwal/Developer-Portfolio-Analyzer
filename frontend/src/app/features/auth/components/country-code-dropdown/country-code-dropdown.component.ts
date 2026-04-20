import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface CountryCodeOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-country-code-dropdown',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './country-code-dropdown.component.html',
  styleUrl: './country-code-dropdown.component.scss'
})
export class CountryCodeDropdownComponent {
  @Input() value = '+92';
  @Output() valueChange = new EventEmitter<string>();

  readonly options: CountryCodeOption[] = [
    { label: '+92 Pakistan', value: '+92' },
    { label: '+1 USA', value: '+1' },
    { label: '+44 UK', value: '+44' },
    { label: '+91 India', value: '+91' }
  ];

  onChange(next: string): void {
    this.valueChange.emit(next);
  }
}
