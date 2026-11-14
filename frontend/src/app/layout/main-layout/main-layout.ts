import {
  Component,
  HostListener,
  inject,
  signal,
  ViewChild,
  ElementRef,
  OnDestroy,
} from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { Navbar } from './navbar/navbar';
import { Sidebar } from './sidebar/sidebar';
import {
  ResumeOnboardingService,
  DismissMode,
} from '../../shared/services/resume-onboarding.service';
import { ResumePromptModalComponent } from '../../shared/components/resume-prompt-modal/resume-prompt-modal.component';
import { AuthService } from '../../shared/services/auth.service';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, Navbar, Sidebar, ResumePromptModalComponent, CommonModule],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout implements OnDestroy {
  private readonly auth = inject(AuthService);
  @ViewChild('navigation', { read: ElementRef }) navigation?: ElementRef<HTMLElement>;
  @ViewChild('workspace', { read: ElementRef }) workspace?: ElementRef<HTMLElement>;
  private returnFocus?: HTMLElement;
  private previousOverflow = '';
  private drawerLocked = false;

  get developerWorkspace(): boolean {
    const role = String(this.auth.getCurrentUser()?.role || '').toLowerCase();
    return (
      ['developer', 'user', 'guest'].includes(role) &&
      !/^\/app\/(admin|recruiter|settings)(\/|$)/.test(this.router.url)
    );
  }
  private readonly onboardingService = inject(ResumeOnboardingService);
  private readonly router = inject(Router);

  sidebarOpen = signal(false);
  isMobile = signal(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  onboardingStatus$ = this.onboardingService.status$;

  constructor() {
    this.syncViewportState();
    if (!this.isMobile() && this.developerWorkspace) this.sidebarOpen.set(true);
  }

  toggleSidebar() {
    if (this.isMobile() && this.sidebarOpen()) {
      this.closeSidebar();
      return;
    }
    this.sidebarOpen.update((open) => !open);
    if (this.isMobile() && this.sidebarOpen()) {
      this.returnFocus = document.activeElement as HTMLElement;
      this.previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      this.drawerLocked = true;
      setTimeout(() => {
        if (this.isMobile() && this.sidebarOpen())
          this.navigation?.nativeElement.querySelector<HTMLElement>('.drawer-close')?.focus();
      });
    }
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
    this.releaseDrawer();
    setTimeout(() => {
      if (this.returnFocus?.isConnected) this.returnFocus.focus();
    });
  }

  private releaseDrawer(): void {
    if (this.drawerLocked) document.body.style.overflow = this.previousOverflow;
    this.drawerLocked = false;
  }

  focusWorkspace(event: Event): void {
    event.preventDefault();
    this.workspace?.nativeElement.focus({ preventScroll: true });
    this.workspace?.nativeElement.scrollIntoView({ block: 'start' });
  }

  ngOnDestroy(): void {
    this.releaseDrawer();
  }

  @HostListener('document:keydown', ['$event'])
  onDrawerKeydown(event: KeyboardEvent): void {
    if (!this.isMobile() || !this.sidebarOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeSidebar();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(
      this.navigation?.nativeElement.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex="0"]',
      ) || [],
    ).filter((el) => el.getClientRects().length && !el.closest('[inert]'));
    const first = items[0],
      last = items[items.length - 1];
    if (!first) {
      event.preventDefault();
      return;
    }
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !this.navigation?.nativeElement.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        !this.navigation?.nativeElement.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncViewportState();
  }

  handleUpload(): void {
    this.onboardingService.dismiss('later');
    this.router.navigate(['/app/resume-analyzer']);
  }

  handleSetDefault(): void {
    this.onboardingService.dismiss('later');
    this.router.navigate(['/app/resume-analyzer']);
  }

  handleDismiss(mode: DismissMode): void {
    this.onboardingService.dismiss(mode);
  }

  private syncViewportState(): void {
    const mobile = typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    const previous = this.isMobile();
    this.isMobile.set(mobile);

    if (mobile && !previous) {
      this.releaseDrawer();
      this.sidebarOpen.set(false);
      return;
    }

    if (previous && !mobile) {
      this.releaseDrawer();
      this.sidebarOpen.set(false);
    }
  }
}
