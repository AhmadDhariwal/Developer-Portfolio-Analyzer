import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Output, QueryList, ViewChildren } from '@angular/core';

@Component({
  selector: 'app-otp-input',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './otp-input.component.html',
  styleUrl: './otp-input.component.scss'
})
export class OtpInputComponent {
  @ViewChildren('otpCell') private otpCells!: QueryList<ElementRef<HTMLInputElement>>;
  @Output() otpChange = new EventEmitter<string>();

  digits: string[] = ['', '', '', '', '', ''];

  onInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = input.value;

    if (val.length > 1) {
      this.handlePastedData(val, index);
      input.value = this.digits[index] || '';
      return;
    }

    const cleanVal = val.replace(/\D/g, '');
    this.digits[index] = cleanVal;

    if (input.value !== cleanVal) {
      input.value = cleanVal;
    }

    if (cleanVal) {
      if (index < 5) {
        this.focus(index + 1);
      } else {
        input.blur();
      }
    }

    this.emitOtp();
  }

  onKeyDown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace') {
      if (!this.digits[index] && index > 0) {
        this.digits[index - 1] = '';
        this.focus(index - 1);
        this.emitOtp();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      this.focus(index - 1);
    } else if (event.key === 'ArrowRight' && index < 5) {
      this.focus(index + 1);
    }
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pastedData = event.clipboardData?.getData('text/plain') || '';
    this.handlePastedData(pastedData, 0);
  }

  private handlePastedData(data: string, startIndex: number = 0): void {
    const clean = data.replace(/\D/g, '');
    let currIdx = startIndex;

    for (let char of clean) {
      if (currIdx < 6) {
        this.digits[currIdx] = char;
        currIdx++;
      }
    }

    this.focus(Math.min(currIdx, 5));
    this.emitOtp();
  }

  private focus(index: number): void {
    setTimeout(() => {
      const ref = this.otpCells.get(index);
      if (ref?.nativeElement) {
        ref.nativeElement.focus();
        ref.nativeElement.select();
      }
    });
  }

  private emitOtp(): void {
    this.otpChange.emit(this.digits.join(''));
  }

  trackByFn(index: number): number {
    return index;
  }
}
