import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Signup } from './signup';
import { AuthService } from '../../shared/services/auth.service';

describe('Signup', () => {
  let component: Signup;
  let fixture: ComponentFixture<Signup>;
  let authServiceMock: {
    register: ReturnType<typeof vi.fn>;
    startExternalLogin: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    authServiceMock = {
      register: vi.fn(),
      startExternalLogin: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [Signup],
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(Signup);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates and sets all per-field validation errors when submitted empty', () => {
    component.onSubmit();
    expect(component.fieldErrors['name']).toBeTruthy();
    expect(component.fieldErrors['email']).toBeTruthy();
    expect(component.fieldErrors['githubUsername']).toBeTruthy();
    expect(component.fieldErrors['password']).toBeTruthy();
    expect(component.fieldErrors['confirmPassword']).toBeTruthy();
    expect(component.fieldErrors['agreeToTerms']).toBeTruthy();
    expect(authServiceMock.register).not.toHaveBeenCalled();
  });

  it('tracks password strength and toggles password visibility', () => {
    component.password = 'Str0ngPass';
    expect(component.passwordScore).toBe(4);
    expect(component.hasMinBackendLength).toBe(true);
    expect(component.hasUppercase).toBe(true);
    expect(component.hasNumber).toBe(true);

    component.togglePasswordVisibility();
    component.toggleConfirmPasswordVisibility();
    expect(component.showPassword).toBe(true);
    expect(component.showConfirmPassword).toBe(true);
  });

  it('submits registration payload and navigates to otp-verification', () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    authServiceMock.register.mockReturnValue(
      of({ pendingId: 'pend-1', expiresAt: '2026-11-15T12:00:00Z' }),
    );

    component.name = 'Ahmad Developer';
    component.email = 'ahmad@example.com';
    component.githubUsername = 'ahmaddev';
    component.password = 'Passw0rd!';
    component.confirmPassword = 'Passw0rd!';
    component.agreeToTerms = true;
    component.isPublic = true;
    component.onSubmit();

    expect(authServiceMock.register).toHaveBeenCalledWith({
      name: 'Ahmad Developer',
      email: 'ahmad@example.com',
      password: 'Passw0rd!',
      githubUsername: 'ahmaddev',
      isPublic: true,
    });
    expect(navSpy).toHaveBeenCalledWith(
      ['/auth/otp-verification'],
      expect.objectContaining({
        state: expect.objectContaining({
          pendingId: 'pend-1',
          purpose: 'signup',
          email: 'ahmad@example.com',
        }),
      }),
    );
  });

  it('handles server registration failure without clearing form inputs', () => {
    authServiceMock.register.mockReturnValue(
      throwError(() => ({ error: { message: 'Email already exists' } })),
    );

    component.name = 'Ahmad Developer';
    component.email = 'ahmad@example.com';
    component.githubUsername = 'ahmaddev';
    component.password = 'Passw0rd!';
    component.confirmPassword = 'Passw0rd!';
    component.agreeToTerms = true;
    component.onSubmit();

    expect(component.isLoading).toBe(false);
    expect(component.error).toBe('Email already exists');
    expect(component.email).toBe('ahmad@example.com');
  });
});
