import { TestBed } from '@angular/core/testing';
import { NotificationItemComponent } from './notification-item/notification-item.component';
import { NotificationFiltersComponent } from './notification-filters/notification-filters.component';
import { NotificationHeaderComponent } from './notification-header/notification-header.component';
import { AppNotification } from '../../../shared/services/notification.service';

describe('Notification presentation boundaries', () => {
  const notification: AppNotification = {
    _id: 'one',
    userId: 'fixture',
    type: 'github_update',
    title: 'GitHub synchronized',
    message: 'Public evidence updated',
    isRead: false,
    createdAt: '2026-11-01T08:00:00Z',
    updatedAt: '2026-11-01T08:00:00Z',
  };
  it('forwards item intent once for keyboard, selection, mark-read and delete', () => {
    const fixture = TestBed.createComponent(NotificationItemComponent);
    fixture.componentRef.setInput('notification', notification);
    fixture.componentRef.setInput('selected', true);
    const open = vi.fn(),
      selection = vi.fn(),
      read = vi.fn(),
      remove = vi.fn();
    fixture.componentInstance.openRequested.subscribe(open);
    fixture.componentInstance.selectionToggled.subscribe(selection);
    fixture.componentInstance.markReadRequested.subscribe(read);
    fixture.componentInstance.deleteRequested.subscribe(remove);
    fixture.detectChanges();
    fixture.nativeElement
      .querySelector('[role="button"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.nativeElement.querySelector('input').dispatchEvent(new Event('change'));
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.trim() === 'Mark Read')!.click();
    buttons.find((button) => button.textContent?.trim() === 'Delete')!.click();
    for (const spy of [open, selection, read, remove])
      expect(spy).toHaveBeenCalledExactlyOnceWith(notification);
    expect(notification.isRead).toBe(false);
  });

  it('emits filter edits and quick-filter intent without owning subscriptions', async () => {
    const fixture = TestBed.createComponent(NotificationFiltersComponent);
    for (const [name, value] of Object.entries({
      clearingAll: false,
      search: '',
      from: '',
      to: '',
      typeFilter: '',
      typeOptions: [],
      selectedOrganizationId: '',
      organizations: [],
      teams: [],
      selectedTeamId: '',
      unreadOnly: false,
    }))
      fixture.componentRef.setInput(name, value);
    const changed = vi.fn(),
      quick = vi.fn();
    fixture.componentInstance.searchChange.subscribe(changed);
    fixture.componentInstance.quickFilterRequested.subscribe(quick);
    fixture.detectChanges();
    await fixture.whenStable();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input');
    input.value = 'github';
    input.dispatchEvent(new Event('input'));
    const buttons = [
      ...fixture.nativeElement.querySelectorAll('.quick-pill'),
    ] as HTMLButtonElement[];
    buttons.find((button) => button.textContent?.trim() === 'GitHub')!.click();
    expect(changed).toHaveBeenCalledExactlyOnceWith('github');
    expect(quick).toHaveBeenCalledExactlyOnceWith('github_update');
  });

  it('keeps the header actions disabled during Clear All', () => {
    const fixture = TestBed.createComponent(NotificationHeaderComponent);
    for (const [name, value] of Object.entries({
      clearingAll: true,
      deletingSelected: false,
      total: 3,
      activeFiltersCount: 0,
      loading: false,
      markingAllRead: false,
      unreadCount: 2,
      readRate: 33,
    }))
      fixture.componentRef.setInput(name, value);
    const clear = vi.fn();
    fixture.componentInstance.clearRequested.subscribe(clear);
    fixture.detectChanges();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.every((button) => button.disabled)).toBe(true);
    buttons[0].click();
    expect(clear).not.toHaveBeenCalled();
  });
});
