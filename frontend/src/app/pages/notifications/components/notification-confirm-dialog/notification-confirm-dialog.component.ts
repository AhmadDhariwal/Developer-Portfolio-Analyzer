import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  ViewChild,
} from '@angular/core';

@Component({
  selector: 'app-notification-confirm-dialog',
  standalone: true,
  templateUrl: './notification-confirm-dialog.component.html',
  styleUrl: './notification-confirm-dialog.component.scss',
})
export class NotificationConfirmDialogComponent implements OnChanges, AfterViewInit {
  private static sequence = 0;
  readonly messageId = `notification-confirm-${++NotificationConfirmDialogComponent.sequence}`;
  @Input() open = false;
  @Input() title = 'Delete notification?';
  @Input() message = 'This action cannot be undone.';
  @Input() confirmText = 'Delete';
  @Input() cancelText = 'Cancel';
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  @ViewChild('dialog') dialog?: ElementRef<HTMLDialogElement>;

  ngAfterViewInit(): void {
    this.sync();
  }
  ngOnChanges(): void {
    this.sync();
  }
  private sync(): void {
    const dialog = this.dialog?.nativeElement;
    if (!dialog) return;
    if (this.open && !dialog.open) dialog.showModal();
    if (!this.open && dialog.open) dialog.close();
  }
  cancel(event: Event): void {
    event.preventDefault();
    this.cancelled.emit();
  }

  trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const dialog = this.dialog?.nativeElement;
    const buttons = dialog?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    if (!dialog || !buttons?.length) return;
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }
}
