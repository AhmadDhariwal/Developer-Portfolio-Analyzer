import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';

@Component({
  selector: 'app-signup',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, UiButtonComponent, UiCardComponent],
  templateUrl: './signup.html',
  styleUrl: './signup.scss',
})
export class Signup {
  name: string = '';
  email: string = '';
  githubUsername: string = '';
  password: string = '';
  confirmPassword: string = '';
  agreeToTerms: boolean = false;
  isLoading: boolean = false;
  error: string = '';

  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  onSubmit() {
    if (!this.name || !this.email || !this.password || !this.confirmPassword) {
      this.error = 'Please fill in all fields';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.error = 'Passwords do not match';
      return;
    }

    if (!this.agreeToTerms) {
      this.error = 'Please agree to the terms and conditions';
      return;
    }

    this.isLoading = true;
    this.error = '';

    this.authService.register({
      name: this.name,
      email: this.email,
      password: this.password,
      githubUsername: this.githubUsername || 'not-provided'
    }).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigate(['/app/dashboard']);
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err.error?.message || 'Signup failed. Please try again.';
      }
    });
  }

  signupWithGithub() {
    // GitHub OAuth implementation would go here
    console.log('GitHub signup clicked');
  }
}

