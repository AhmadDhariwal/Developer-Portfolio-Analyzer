import {
  Component,
  Input,
  Output,
  EventEmitter,
  HostListener,
  ElementRef,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  Renderer2
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiIconButtonComponent } from '../ui-icon-button/ui-icon-button.component';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

let nextModalId = 0;

@Component({
  selector: 'app-ui-modal',
  standalone: true,
  imports: [CommonModule, UiIconButtonComponent],
  templateUrl: './ui-modal.component.html',
  styleUrl: './ui-modal.component.scss'
})
export class UiModalComponent implements OnChanges, OnDestroy {
  @Input() isOpen: boolean = false;
  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() size: ModalSize = 'md';
  @Input() closeOnBackdrop: boolean = true;
  @Input() closeOnEscape: boolean = true;
  @Input() showCloseButton: boolean = true;

  @Output() close = new EventEmitter<void>();

  readonly titleId = `ui-modal-title-${++nextModalId}`;
  private previouslyFocusedElement: HTMLElement | null = null;

  constructor(
    private el: ElementRef,
    private renderer: Renderer2
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        this.onOpen();
      } else {
        this.onClose();
      }
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event?: Event): void {
    if (this.isOpen && this.closeOnEscape) {
      if (event) {
        event.preventDefault();
      }
      this.closeModal();
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (this.closeOnBackdrop && event.target === event.currentTarget) {
      this.closeModal();
    }
  }

  closeModal(): void {
    this.close.emit();
  }

  private onOpen(): void {
    this.previouslyFocusedElement = document.activeElement as HTMLElement;
    this.renderer.setStyle(document.body, 'overflow', 'hidden');

    setTimeout(() => {
      const modalEl = this.el.nativeElement.querySelector('.ui-modal-dialog');
      if (modalEl) {
        modalEl.focus();
      }
    }, 0);
  }

  private onClose(): void {
    this.renderer.removeStyle(document.body, 'overflow');
    if (this.previouslyFocusedElement && typeof this.previouslyFocusedElement.focus === 'function') {
      this.previouslyFocusedElement.focus();
    }
  }

  ngOnDestroy(): void {
    this.renderer.removeStyle(document.body, 'overflow');
  }
}
