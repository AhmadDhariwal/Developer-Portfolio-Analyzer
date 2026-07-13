import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  EventEmitter,
  OnInit,
  Output,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../services/auth.service';
import { ProfileService } from '../../services/profile.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NavbarComponent implements OnInit {
  @Output() toggleSidebar = new EventEmitter<void>();

  userName    = 'Developer';
  userEmail   = '';
  userInitial = 'D';
  userAvatar  = '';
  avatarSrc   = '';
  avatarVersion = Date.now();

  readonly notifications: number = 3;
  currentTime: Date = new Date();

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly cdr: ChangeDetectorRef,
    private readonly authService: AuthService,
    private readonly profileService: ProfileService
  ) {}

  ngOnInit(): void {
    // Clock tick
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.currentTime = new Date();
        this.cdr.markForCheck();
      });

    // Sync user state from auth stream
    this.syncUserState(this.authService.getCurrentUser());
    this.authService.currentUser$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        this.syncUserState(user);
      });

    // Bump avatar version after upload
    this.authService.avatarVersion$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((version) => {
        this.avatarVersion = version;
        this.updateAvatarSrc();
        this.cdr.markForCheck();
      });
  }

  onToggleSidebar(): void {
    this.toggleSidebar.emit();
  }

  onAvatarError(event: Event): void {
    const img = event.target as HTMLImageElement;
    console.error('[Navbar] Avatar failed to load:', img.src);
    this.userAvatar = '';
    this.updateAvatarSrc();
    this.cdr.markForCheck();
  }

  logout(): void {
    this.authService.logout();
  }

  private syncUserState(user: any): void {
    if (!user) {
      this.userName    = 'Developer';
      this.userEmail   = '';
      this.userInitial = 'D';
      this.userAvatar  = '';
      this.updateAvatarSrc();
      this.cdr.markForCheck();
      return;
    }

    this.userName    = user.name  || 'Developer';
    this.userEmail   = user.email || '';
    this.userInitial = this.profileService.getInitials(this.userName || 'Developer') || 'D';
    this.userAvatar  = this.profileService.resolveAvatarUrl(user.avatar || '');
    this.updateAvatarSrc();
    this.cdr.markForCheck();
  }

  private updateAvatarSrc(): void {
    const raw = String(this.userAvatar || '').trim();
    if (!raw) {
      this.avatarSrc = '';
      return;
    }
    if (/^data:/i.test(raw) || raw.startsWith('blob:')) {
      this.avatarSrc = raw;
      return;
    }
    const separator = raw.includes('?') ? '&' : '?';
    this.avatarSrc = `${raw}${separator}v=${this.avatarVersion}`;
  }
}
