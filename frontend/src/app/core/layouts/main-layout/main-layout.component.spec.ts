import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../shared/services/auth.service';

import { MainLayout } from './main-layout.component';

describe('MainLayout', () => {
  let component: MainLayout;
  let fixture: ComponentFixture<MainLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MainLayout],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(MainLayout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
  it('scopes the approved visual standard to Developer sessions', () => {
    const auth = TestBed.inject(AuthService);
    const user = vi.spyOn(auth, 'getCurrentUser');
    user.mockReturnValue({ role: 'developer' });
    expect(component.developerWorkspace).toBe(true);
    user.mockReturnValue({ role: 'recruiter' });
    expect(component.developerWorkspace).toBe(false);
    user.mockReturnValue({ role: 'admin' });
    expect(component.developerWorkspace).toBe(false);
    user.mockRestore();
  });

  it('scopes recruiterWorkspace exclusively to recruiter sessions on /app/recruiter routes', () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const user = vi.spyOn(auth, 'getCurrentUser');
    const urlSpy = vi.spyOn(router, 'url', 'get');

    user.mockReturnValue({ role: 'recruiter' });
    urlSpy.mockReturnValue('/app/recruiter/dashboard');
    expect(component.recruiterWorkspace).toBe(true);
    expect(component.developerWorkspace).toBe(false);

    urlSpy.mockReturnValue('/app/profile');
    expect(component.recruiterWorkspace).toBe(false);

    user.mockReturnValue({ role: 'developer' });
    urlSpy.mockReturnValue('/app/recruiter/dashboard');
    expect(component.recruiterWorkspace).toBe(false);

    urlSpy.mockRestore();
    user.mockRestore();
  });

  it('scopes adminWorkspace exclusively to admin sessions on /app/admin routes', () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const user = vi.spyOn(auth, 'getCurrentUser');
    const urlSpy = vi.spyOn(router, 'url', 'get');

    user.mockReturnValue({ role: 'admin' });
    urlSpy.mockReturnValue('/app/admin/dashboard');
    expect(component.adminWorkspace).toBe(true);
    expect(component.developerWorkspace).toBe(false);
    expect(component.recruiterWorkspace).toBe(false);

    urlSpy.mockReturnValue('/app/admin-console/performance-statistics');
    expect(component.adminWorkspace).toBe(true);

    user.mockReturnValue({ role: 'recruiter' });
    urlSpy.mockReturnValue('/app/admin/dashboard');
    expect(component.adminWorkspace).toBe(false);

    urlSpy.mockRestore();
    user.mockRestore();
  });

  it('locks the background only while the mobile drawer is open and restores focus', async () => {
    component.isMobile.set(true);
    component.sidebarOpen.set(false);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('.menu-toggle') as HTMLElement;
    trigger.focus();
    const previous = document.body.style.overflow;
    component.toggleSidebar();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.style.overflow).toBe('hidden');
    expect(fixture.nativeElement.querySelector('.shell-body').hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('.drawer-close'));
    component.closeSidebar();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.style.overflow).toBe(previous);
    expect(document.activeElement).toBe(trigger);
    expect(fixture.nativeElement.querySelector('.shell-body').hasAttribute('inert')).toBe(false);
  });

  it('wraps Tab in the mobile navigation and dismisses it with Escape', () => {
    component.isMobile.set(true);
    component.sidebarOpen.set(true);
    fixture.detectChanges();
    const first = fixture.nativeElement.querySelector('.drawer-close') as HTMLElement;
    const last = fixture.nativeElement.querySelector('.logout-btn') as HTMLElement;
    Object.defineProperty(first, 'getClientRects', { value: () => [{}] });
    Object.defineProperty(last, 'getClientRects', { value: () => [{}] });
    last.focus();
    component.onDrawerKeydown(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(first);
    component.onDrawerKeydown(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(document.activeElement).toBe(last);
    component.onDrawerKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(component.sidebarOpen()).toBe(false);
  });
});
