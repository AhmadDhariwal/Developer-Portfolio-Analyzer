import { ElementRef } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationConfirmDialogComponent } from './notification-confirm-dialog.component';

describe('notification confirmation keyboard containment', () => {
  let component: NotificationConfirmDialogComponent;
  let dialog: HTMLDialogElement;
  beforeEach(() => {
    component = new NotificationConfirmDialogComponent();
    dialog = document.createElement('dialog');
    dialog.open = true;
    dialog.innerHTML = '<button>Cancel</button><button>Delete</button>';
    document.body.appendChild(dialog);
    component.dialog = new ElementRef(dialog);
  });
  afterEach(() => dialog.remove());
  it('wraps forward Tab from Delete to Cancel', () => {
    const buttons = dialog.querySelectorAll('button');
    buttons[1].focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    component.trapFocus(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });
  it('wraps reverse Tab from Cancel to Delete', () => {
    const buttons = dialog.querySelectorAll('button');
    buttons[0].focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true });
    component.trapFocus(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[1]);
  });
  it('turns native Escape cancellation into a controlled cancellation event', () => {
    const cancelled = vi.fn();
    component.cancelled.subscribe(cancelled);
    const event = new Event('cancel', { cancelable: true });
    component.cancel(event);
    expect(event.defaultPrevented).toBe(true);
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
