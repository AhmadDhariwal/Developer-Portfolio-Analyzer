import { Subject, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { vi } from 'vitest';
import { Router } from '@angular/router';
import { NotificationService } from '../../../shared/services/notification.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Navbar } from './navbar';

describe('Navbar', () => {
  let component: Navbar;
  let fixture: ComponentFixture<Navbar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Navbar],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Navbar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('supports arrow navigation and Escape in workspace search', () => {
    component.suggestions = [
      { type: 'page', label: 'Skill Gap', route: '/app/skill-gap' },
      { type: 'page', label: 'Profile', route: '/app/profile' },
    ];
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(component.activeSuggestion).toBe(1);
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(component.activeSuggestion).toBe(0);
    expect(component.showSuggestions).toBe(true);
    component.onSearchKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.showSuggestions).toBe(false);
  });
  it('restores concurrent failed optimistic reads without losing unread counts', () => {
    const first = new Subject<any>();
    const second = new Subject<any>();
    vi.spyOn(TestBed.inject(NotificationService), 'markAsRead')
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    component.notifications = [
      { _id: 'first', isRead: false, type: 'info' },
      { _id: 'second', isRead: false, type: 'info' },
    ] as any;
    component.unreadNotifications = 2;
    component.markNotificationRead(component.notifications[0]);
    component.markNotificationRead(component.notifications[1]);
    first.error(new Error('Unavailable'));
    second.error(new Error('Unavailable'));
    expect(component.unreadNotifications).toBe(2);
    expect(component.notifications.every((item) => !item.isRead)).toBe(true);
  });
  it('does not restore an old mark-all snapshot after newer shared server state arrives', async () => {
    const pending = new Subject<any>();
    vi.spyOn(TestBed.inject(NotificationService), 'markAllAsRead').mockReturnValueOnce(pending);
    component.notifications = [{ _id: 'notice', isRead: false, type: 'info' }] as any;
    component.unreadNotifications = 1;
    component.markAllNotificationsRead();
    vi.spyOn(TestBed.inject(HttpClient), 'get').mockReturnValueOnce(
      of({ notifications: [], unreadCount: 2, total: 2 }) as any,
    );
    component.loadNotifications(true);
    await fixture.whenStable();
    pending.error(new Error('Unavailable'));
    expect(component.unreadNotifications).toBe(2);
  });
});
