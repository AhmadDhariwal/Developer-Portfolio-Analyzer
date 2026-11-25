import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordComponent } from './reset-password.component';
import { AuthService } from '../../../../shared/services/auth.service';

describe('ResetPasswordComponent', () => {
  let component: ResetPasswordComponent;
  let fixture: ComponentFixture<ResetPasswordComponent>;
  let authServiceMock: { resetPassword: ReturnType<typeof vi.fn> };

  const setup = async (
    stateObj: Record<string, any> = {},
    queryParams: Record<string, string> = {},
  ) => {
    authServiceMock = { resetPassword: vi.fn() };
    window.history.replaceState(stateObj, '');

    await TestBed.configureTestingModule({
      imports: [ResetPasswordComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetPasswordComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  afterEach(() => {
    window.history.replaceState({}, '');
  });

  it('shows invalid session state when resetToken is missing', async () => {
    await setup();
    expect(component.viewState).toBe('invalid');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Reset session is invalid',
    );
  });

  it('shows expired state when status=expired query param is passed', async () => {
    await setup({}, { status: 'expired' });
    expect(component.viewState).toBe('expired');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('This link has expired');
  });

  it('transitions to success view when password reset succeeds', async () => {
    await setup({ resetToken: 'valid-token' });
    authServiceMock.resetPassword.mockReturnValue(of({ message: 'Password reset successful.' }));

    expect(component.viewState).toBe('form');
    component.newPassword = 'NewPassword1';
    component.confirmPassword = 'NewPassword1';
    component.submit();

    expect(authServiceMock.resetPassword).toHaveBeenCalledWith({
      resetToken: 'valid-token',
      newPassword: 'NewPassword1',
    });
    expect(component.viewState).toBe('success');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Password updated!');
  });

  it('switches to expired view when backend returns expired token error', async () => {
    await setup({ resetToken: 'stale-token' });
    authServiceMock.resetPassword.mockReturnValue(
      throwError(() => ({ error: { message: 'Reset token expired or invalid.' } })),
    );

    component.newPassword = 'NewPassword1';
    component.confirmPassword = 'NewPassword1';
    component.submit();

    expect(component.viewState).toBe('expired');
  });
});
