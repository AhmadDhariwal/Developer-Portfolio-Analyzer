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

export type DrawerPosition = 'left' | 'right';
export type DrawerSize = 'sm' | 'md' | 'lg' | 'full';

let nextDrawerId = 0;

@Component({
  selector: 'app-ui-drawer',
  standalone: true,
  imports: [CommonModule, UiIconButtonComponent],
  templateUrl: './ui-drawer.component.html',
  styleUrl: './ui-drawer.component.scss'
})
export class UiDrawerComponent implements OnChanges, OnDestroy {
  @Input() isOpen: boolean = false;
  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() position: DrawerPosition = 'right';
  @Input() size: DrawerSize = 'md';
  @Input() closeOnBackdrop: boolean = true;
  @Input() closeOnEscape: boolean = true;
  @Input() showCloseButton: boolean = true;

  @Output() close = new EventEmitter<void>();

  readonly titleId = `ui-drawer-title-${++nextDrawerId}`;
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
      this.closeDrawer();
    }
  }

  onBackdropClick(event: MouseEvent): void {
    if (this.closeOnBackdrop && event.target === event.currentTarget) {
      this.closeDrawer();
    }
  }

  closeDrawer(): void {
    this.close.emit();
  }

  private onOpen(): void {
    this.previouslyFocusedElement = document.activeElement as HTMLElement;
    this.renderer.setStyle(document.body, 'overflow', 'hidden');

    setTimeout(() => {
      const panel = this.el.nativeElement.querySelector('.ui-drawer-panel');
      if (panel) {
        panel.focus();
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
