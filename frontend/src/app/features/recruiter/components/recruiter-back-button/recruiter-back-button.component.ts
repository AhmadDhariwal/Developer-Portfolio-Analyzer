import { Location } from '@angular/common';
import { Component, Input } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-recruiter-back-button',
  standalone: true,
  templateUrl: './recruiter-back-button.component.html',
  styleUrl: './recruiter-back-button.component.scss',
})
export class RecruiterBackButtonComponent {
  @Input() fallbackRoute = '/app/recruiter/dashboard';
  @Input() label = 'Back';

  constructor(
    private readonly location: Location,
    private readonly router: Router,
  ) {}

  goBack(): void {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      this.location.back();
      return;
    }

    this.router.navigateByUrl(this.fallbackRoute);
  }
}
