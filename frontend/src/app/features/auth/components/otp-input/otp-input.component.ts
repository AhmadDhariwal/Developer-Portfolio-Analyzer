import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Output, QueryList, ViewChildren } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-otp-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './otp-input.component.html',
  styleUrl: './otp-input.component.scss'
})
export class OtpInputComponent {
  @ViewChildren('otpCell') private otpCells!: QueryList<ElementRef<HTMLInputElement>>;
  @Output() otpChange = new EventEmitter<string>();

  digits = ['', '', '', '', '', ''];

  onInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = String(input.value || '').replace(/\D/g, '').slice(-1);
    this.digits[index] = value;
    input.value = value;

    if (value && index < this.digits.length - 1) {
      this.focus(index + 1);
    }

    this.emitOtp();
  }

  onKeyDown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits[index] && index > 0) {
      this.focus(index - 1);
    }
  }

  setOtp(value: string): void {
    const normalized = String(value || '').replace(/\D/g, '').slice(0, 6).padEnd(6, ' ');
    this.digits = normalized.split('').map((char) => (char === ' ' ? '' : char));
    this.emitOtp();
  }

  private focus(index: number): void {
    const ref = this.otpCells.get(index);
    ref?.nativeElement.focus();
    ref?.nativeElement.select();
  }

  private emitOtp(): void {
    this.otpChange.emit(this.digits.join(''));
  }
}
