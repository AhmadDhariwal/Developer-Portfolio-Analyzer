import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'section[appProfileSecuritySettings]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-security-settings.component.html',
  styleUrl: './profile-security-settings.component.scss',
})
export class ProfileSecuritySettingsComponent {
  @Input({ required: true }) isChangingPwd!: boolean;
  @Input({ required: true }) passwordForm!: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  };
  @Input({ required: true }) pwdError!: string;
  @Input({ required: true }) pwdSuccess!: string;
  @Input({ required: true }) isSavingPassword!: boolean;
  @Output() toggleChangePasswordIntent = new EventEmitter<void>();
  toggleChangePassword(): void {
    this.toggleChangePasswordIntent.emit();
  }
  @Output() submitPasswordChangeIntent = new EventEmitter<void>();
  submitPasswordChange(): void {
    this.submitPasswordChangeIntent.emit();
  }
  @Output() openDeleteConfirmIntent = new EventEmitter<void>();
  openDeleteConfirm(): void {
    this.openDeleteConfirmIntent.emit();
  }
}
