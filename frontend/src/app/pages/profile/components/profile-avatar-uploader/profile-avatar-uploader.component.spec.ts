import { TestBed } from '@angular/core/testing';
import { ProfileAvatarUploaderComponent } from './profile-avatar-uploader.component';
import type { UserProfile } from '../../../../shared/services/profile.service';
import { describe, it, expect, vi } from 'vitest';

describe('Profile avatar presentation', () => {
  it('emits selection without a request and disables discard during the committed save', () => {
    const fixture = TestBed.createComponent(ProfileAvatarUploaderComponent);
    const component = fixture.componentInstance;
    fixture.componentRef.setInput('profile', {
      name: 'Fixture',
      githubUsername: '',
      avatar: '/fixture.png',
    } as UserProfile);
    fixture.componentRef.setInput('isSaving', false);
    fixture.componentRef.setInput('isUploadingAvatar', false);
    fixture.componentRef.setInput('isAvatarChangePending', true);
    fixture.componentRef.setInput('avatarSrc', '');
    fixture.componentRef.setInput('initials', 'F');
    const selected = vi.fn();
    const discarded = vi.fn();
    component.onAvatarFileSelectedIntent.subscribe(selected);
    component.discardAvatarChangeIntent.subscribe(discarded);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('input[type=file]').dispatchEvent(new Event('change'));
    expect(selected).toHaveBeenCalledTimes(1);
    const discard = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.trim() === 'Discard')!;
    discard.click();
    expect(discarded).toHaveBeenCalledTimes(1);
    fixture.componentRef.setInput('isSaving', true);
    fixture.detectChanges();
    discard.click();
    expect(discard.disabled).toBe(true);
    expect(discarded).toHaveBeenCalledTimes(1);
  });
});
