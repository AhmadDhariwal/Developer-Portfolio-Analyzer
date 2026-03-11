import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../shared/services/auth.service';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, UiButtonComponent, UiCardComponent],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  email: string = '';
  password: string = '';
  isLoading: boolean = false;
  error: string = '';

  constructor(private readonly authService: AuthService, private readonly router: Router) {}

  onSubmit() {
    if (!this.email || !this.password) {
      this.error = 'Please fill in all fields';
      return;
    }

    this.isLoading = true;
    this.error = '';

    this.authService.login({ email: this.email, password: this.password }).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigate(['/app/dashboard']);
      },
      error: (err) => {
        this.isLoading = false;
        this.error = err.error?.message || 'Invalid email or password';
      }
    });
  }

  loginWithGithub() {
    // GitHub OAuth implementation would go here
    console.log('GitHub login clicked');
  }
}

