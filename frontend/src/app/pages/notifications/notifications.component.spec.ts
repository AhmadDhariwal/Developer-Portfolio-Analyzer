import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsComponent } from './notifications.component';
import { NotificationService } from '../../shared/services/notification.service';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../shared/services/auth.service';

describe('Notifications feed filtering and mutation reconciliation', () => {
  let fixture: ComponentFixture<NotificationsComponent>;
  let component: NotificationsComponent;
  let service: any;
  let api: any;
  const notice = {
    _id: 'notice',
    isRead: false,
    type: 'info',
    title: 'Ready',
    message: 'Saved',
    createdAt: new Date().toISOString(),
  };
  beforeEach(async () => {
    service = {
      streamEvents$: new Subject(),
      streamConnected: () => false,
      setInboxScope: vi.fn(),
      getNotifications: vi.fn(() =>
        of({
          notifications: [{ ...notice }],
          unreadCount: 1,
          filteredUnreadCount: 1,
          total: 1,
          totalPages: 1,
        }),
      ),
      markAllAsRead: vi.fn(() =>
        of({ message: 'More unread notifications remain.', remaining: 2 }),
      ),
      deleteNotification: vi.fn(() => of({ message: 'Deleted' })),
      markAsRead: vi.fn(() => throwError(() => new Error('Unavailable'))),
    };
    api = { getOrganizations: vi.fn(() => of({ organizations: [] })) };
    await TestBed.configureTestingModule({
      imports: [NotificationsComponent],
      providers: [
        provideRouter([]),
        { provide: NotificationService, useValue: service },
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { getCurrentUser: () => ({ _id: 'owner' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(NotificationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('resets organization and team filters with all other filters', () => {
    component.selectedOrganizationId = 'organization';
    component.selectedTeamId = 'team';
    component.search = 'saved';
    component.resetFilters();
    expect(component.getActiveFiltersCount()).toBe(0);
    expect(service.getNotifications.mock.calls.at(-1)[0]).toEqual(
      expect.objectContaining({ organizationId: undefined, teamId: undefined, search: undefined }),
    );
  });

  it('does not refetch in a mutation callback and preserves the bounded mark-all message during background reconciliation', () => {
    service.getNotifications.mockClear();
    component.markAllAsRead();
    expect(service.getNotifications).not.toHaveBeenCalled();
    service.streamEvents$.next({ eventType: 'read_all' });
    expect(service.getNotifications).toHaveBeenCalledTimes(1);
    expect(component.statusMessage).toBe('More unread notifications remain.');
  });

  it('restores item and filtered/global unread counts after a failed optimistic mark-read', () => {
    component.markAsRead(component.notifications[0]);
    expect(component.notifications[0].isRead).toBe(false);
    expect(component.unreadCount).toBe(1);
    expect(component.filteredUnreadCount).toBe(1);
  });

  it('returns to an existing page after deleting the last records on the current page', () => {
    service.getNotifications.mockReturnValueOnce(
      of({ notifications: [], unreadCount: 0, filteredUnreadCount: 0, total: 1, totalPages: 1 }),
    );
    component.fetchNotifications(2, true);
    expect(component.page).toBe(1);
    expect(component.notifications).toHaveLength(1);
  });
  it('cancels an obsolete fallback request when the user changes the query', () => {
    const pending = new Subject<any>();
    service.getNotifications
      .mockReturnValueOnce(of({ notifications: [], unreadCount: 0, totalPages: 1 }))
      .mockReturnValueOnce(pending);
    component.fetchNotifications(2, true);
    expect(pending.observed).toBe(true);
    component.search = 'new query';
    component.fetchNotifications(1, true);
    expect(pending.observed).toBe(false);
  });
  it('loads the inbox once without waiting for organizations or refetching when they arrive', () => {
    fixture.destroy();
    const organizations = new Subject<any>();
    api.getOrganizations.mockReturnValue(organizations);
    service.getNotifications.mockClear();
    fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    expect(service.getNotifications).toHaveBeenCalledTimes(1);
    organizations.next({ organizations: [] });
    organizations.complete();
    expect(service.getNotifications).toHaveBeenCalledTimes(1);
  });
  it('rolls back concurrent failed mark-read operations without overwriting another operation', () => {
    const first = new Subject<any>();
    const second = new Subject<any>();
    service.markAsRead.mockReturnValueOnce(first).mockReturnValueOnce(second);
    component.notifications = [
      { ...notice, _id: 'first' },
      { ...notice, _id: 'second' },
    ] as any;
    component.unreadCount = component.filteredUnreadCount = 2;
    component.markAsRead(component.notifications[0]);
    component.markAsRead(component.notifications[1]);
    first.error(new Error('Unavailable'));
    second.error(new Error('Unavailable'));
    expect(component.unreadCount).toBe(2);
    expect(component.filteredUnreadCount).toBe(2);
    expect(component.notifications.every((item) => !item.isRead)).toBe(true);
  });

  it('does not let an old mutation failure overwrite the latest query snapshot', () => {
    const pending = new Subject<any>();
    service.markAsRead.mockReturnValueOnce(pending);
    component.markAsRead(component.notifications[0]);
    component.search = 'different query';
    component.fetchNotifications(1, true);
    pending.error(new Error('Unavailable'));
    expect(component.unreadCount).toBe(1);
    expect(component.filteredUnreadCount).toBe(1);
    expect(component.notifications[0].isRead).toBe(false);
  });
  it('restores only each failed deletion without losing another restored row or its counts', () => {
    const first = new Subject<any>();
    const second = new Subject<any>();
    service.deleteNotification.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const one = { ...notice, _id: 'first' } as any;
    const two = { ...notice, _id: 'second' } as any;
    component.notifications = [one, two];
    component.total = component.unreadCount = component.filteredUnreadCount = 2;
    component.pendingDeleteNotification = one;
    component.confirmDelete();
    component.pendingDeleteNotification = two;
    component.confirmDelete();
    first.error(new Error('Unavailable'));
    second.error(new Error('Unavailable'));
    expect(component.notifications.map((item) => item._id).sort()).toEqual(['first', 'second']);
    expect(component.total).toBe(2);
    expect(component.unreadCount).toBe(2);
    expect(component.filteredUnreadCount).toBe(2);
  });

  it('does not restore a failed deletion into a newer filtered snapshot', () => {
    const pending = new Subject<any>();
    service.deleteNotification.mockReturnValueOnce(pending);
    component.pendingDeleteNotification = component.notifications[0];
    component.confirmDelete();
    service.getNotifications.mockReturnValueOnce(
      of({ notifications: [], unreadCount: 1, filteredUnreadCount: 0, total: 0, totalPages: 1 }),
    );
    component.search = 'another query';
    component.fetchNotifications(1, true);
    pending.error(new Error('Unavailable'));
    expect(component.notifications).toHaveLength(0);
    expect(component.total).toBe(0);
    expect(component.filteredUnreadCount).toBe(0);
  });
});
