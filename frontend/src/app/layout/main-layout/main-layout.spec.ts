import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../shared/services/auth.service';

import { MainLayout } from './main-layout';

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
