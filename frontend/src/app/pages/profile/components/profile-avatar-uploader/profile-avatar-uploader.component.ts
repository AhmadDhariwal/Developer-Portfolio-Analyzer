import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { UserProfile } from '../../../../shared/services/profile.service';
@Component({
  selector: 'div[appProfileAvatarUploader]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-avatar-uploader.component.html',
  styleUrl: './profile-avatar-uploader.component.scss',
})
export class ProfileAvatarUploaderComponent {
  @Input({ required: true }) profile!: UserProfile;
  @Input() uploadProgress: number | null = null;
  @Input({ required: true }) isSaving!: boolean;
  @Input({ required: true }) isUploadingAvatar!: boolean;
  @Input({ required: true }) isAvatarChangePending!: boolean;
  @Input({ required: true }) avatarSrc!: string;
  @Input({ required: true }) initials!: string;
  @Output() onAvatarFileSelectedIntent = new EventEmitter<Event>();
  @Output() onAvatarErrorIntent = new EventEmitter<Event>();
  @Output() discardAvatarChangeIntent = new EventEmitter<void>();
  @Output() openAvatarPreviewIntent = new EventEmitter<void>();
}
