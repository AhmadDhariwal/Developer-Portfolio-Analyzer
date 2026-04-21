import { Component, signal, inject } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { Navbar } from './navbar/navbar';
import { Sidebar } from './sidebar/sidebar';
import { ResumeOnboardingService } from '../../shared/services/resume-onboarding.service';
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

  sidebarOpen = signal(true);
  onboardingStatus$ = this.onboardingService.status$;

  toggleSidebar() {
    this.sidebarOpen.update(open => !open);
  }

  handleUpload(): void {
    this.router.navigate(['/app/resume-analyzer']);
    this.onboardingService.dismiss(); // Manual dismiss for now until they upload
  }

  handleSetDefault(): void {
    this.router.navigate(['/app/resume-analyzer']);
    this.onboardingService.dismiss();
  }

  handleDismiss(permanent: boolean): void {
    this.onboardingService.dismiss(permanent);
  }
}
