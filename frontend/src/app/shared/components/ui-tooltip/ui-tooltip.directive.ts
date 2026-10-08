import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnDestroy,
  Renderer2
} from '@angular/core';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

let nextTooltipId = 0;

@Directive({
  selector: '[appUiTooltip]',
  standalone: true
})
export class UiTooltipDirective implements OnDestroy {
  @Input() appUiTooltip: string = '';
  @Input() tooltipPosition: TooltipPosition = 'top';
  @Input() tooltipDisabled: boolean = false;

  private tooltipElement: HTMLElement | null = null;
  private readonly tooltipId = `ui-tooltip-${++nextTooltipId}`;

  constructor(
    private el: ElementRef,
    private renderer: Renderer2
  ) {}

  @HostListener('mouseenter')
  @HostListener('focusin')
  show(): void {
    if (this.tooltipDisabled || !this.appUiTooltip || this.tooltipElement) return;

    this.tooltipElement = this.renderer.createElement('div');
    this.renderer.addClass(this.tooltipElement, 'ui-tooltip-bubble');
    this.renderer.addClass(this.tooltipElement, `pos-${this.tooltipPosition}`);
    this.renderer.setAttribute(this.tooltipElement, 'id', this.tooltipId);
    this.renderer.setAttribute(this.tooltipElement, 'role', 'tooltip');

    const text = this.renderer.createText(this.appUiTooltip);
    this.renderer.appendChild(this.tooltipElement, text);
    this.renderer.appendChild(document.body, this.tooltipElement);

    this.renderer.setAttribute(this.el.nativeElement, 'aria-describedby', this.tooltipId);
    this.positionTooltip();
  }

  @HostListener('mouseleave')
  @HostListener('focusout')
  hide(): void {
    if (!this.tooltipElement) return;

    this.renderer.removeAttribute(this.el.nativeElement, 'aria-describedby');
    if (this.tooltipElement.parentNode) {
      this.renderer.removeChild(document.body, this.tooltipElement);
    }
    this.tooltipElement = null;
  }

  @HostListener('keydown.escape')
  onEscape(): void {
    this.hide();
  }

  private positionTooltip(): void {
    if (!this.tooltipElement) return;

    const hostRect = this.el.nativeElement.getBoundingClientRect();
    const tooltipRect = this.tooltipElement.getBoundingClientRect();
    const gap = 8;

    let top = 0;
    let left = 0;

    switch (this.tooltipPosition) {
      case 'top':
        top = hostRect.top - tooltipRect.height - gap + window.scrollY;
        left = hostRect.left + (hostRect.width - tooltipRect.width) / 2 + window.scrollX;
        break;
      case 'bottom':
        top = hostRect.bottom + gap + window.scrollY;
        left = hostRect.left + (hostRect.width - tooltipRect.width) / 2 + window.scrollX;
        break;
      case 'left':
        top = hostRect.top + (hostRect.height - tooltipRect.height) / 2 + window.scrollY;
        left = hostRect.left - tooltipRect.width - gap + window.scrollX;
        break;
      case 'right':
        top = hostRect.top + (hostRect.height - tooltipRect.height) / 2 + window.scrollY;
        left = hostRect.right + gap + window.scrollX;
        break;
    }

    // Keep within viewport boundaries
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipRect.width - 8));
    top = Math.max(8, top);

    this.renderer.setStyle(this.tooltipElement, 'top', `${top}px`);
    this.renderer.setStyle(this.tooltipElement, 'left', `${left}px`);
  }

  ngOnDestroy(): void {
    this.hide();
  }
}
