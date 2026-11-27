import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-dialog.component.html',
  styleUrls: ['./confirm-dialog.component.scss'],
})
export class ConfirmDialogComponent implements OnChanges, OnDestroy {
  private card?: HTMLElement;
  private previousFocus?: HTMLElement;
  @ViewChild('dialogCard') set dialogCard(value: ElementRef<HTMLElement> | undefined) {
    this.card = value?.nativeElement;
    this.card?.querySelector<HTMLButtonElement>('button')?.focus();
  }
  @Input() open = false;
  @Input() title = 'Confirm action';
  @Input() message = 'Are you sure you want to continue?';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['open']) return;
    if (this.open)
      this.previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    else this.restoreFocus();
  }
  ngOnDestroy(): void {
    this.restoreFocus();
  }
  private restoreFocus(): void {
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.previousFocus = undefined;
  }
  @HostListener('document:keydown', ['$event']) onKeydown(event: KeyboardEvent): void {
    if (!this.open || !this.card) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelled.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const buttons = [...this.card.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const first = buttons[0];
    const last = buttons.at(-1);
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first || !this.card.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !this.card.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
}
