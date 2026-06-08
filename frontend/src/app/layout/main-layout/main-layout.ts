import { Component, HostListener, inject, signal } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { Navbar } from './navbar/navbar';
import { Sidebar } from './sidebar/sidebar';
import { ResumeOnboardingService, DismissMode } from '../../shared/services/resume-onboarding.service';
import { ResumePromptModalComponent } from '../../shared/components/resume-prompt-modal/resume-prompt-modal.component';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, Navbar, Sidebar, ResumePromptModalComponent, CommonModule],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss',
})
export class MainLayout {
  private readonly onboardingService = inject(ResumeOnboardingService);
  private readonly router = inject(Router);

  sidebarOpen = signal(false);
  isMobile = signal(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  onboardingStatus$ = this.onboardingService.status$;

  constructor() {
    this.syncViewportState();
  }

  toggleSidebar() {
    this.sidebarOpen.update(open => !open);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
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

    if (mobile) {
      this.sidebarOpen.set(false);
      return;
    }

    if (previous && !mobile) {
      this.sidebarOpen.set(false);
    }
  }
}
