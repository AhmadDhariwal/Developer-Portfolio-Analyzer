import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { LayoutService } from '../../../shared/services/layout.service';
import { AuthService } from '../../../shared/services/auth.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './navbar.html',
  styleUrl: './navbar.scss',
})
export class Navbar implements OnInit {
  isLoggedIn$: Observable<boolean>;
  userName = 'Developer';
  userHandle = 'developer';
  userInitial = 'D';
  showUserMenu = false;

  constructor(
    private readonly layoutService: LayoutService,
    private readonly authService: AuthService,
    private readonly router: Router
  ) {
    this.isLoggedIn$ = this.authService.isLoggedIn$;
  }

  ngOnInit() {
    const stored = localStorage.getItem('user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        this.userName = user.name || 'Developer';
        this.userHandle = user.githubUsername || 'developer';
        this.userInitial = this.userName.charAt(0).toUpperCase();
      } catch { /* fallback */ }
    }
  }

  toggleSidebar() {
    this.layoutService.toggleSidebar();
  }

  toggleUserMenu() {
    this.showUserMenu = !this.showUserMenu;
  }

  closeUserMenu() {
    this.showUserMenu = false;
  }

  logout() {
    this.authService.logout();
    this.showUserMenu = false;
    this.router.navigate(['/']);
  }
}
