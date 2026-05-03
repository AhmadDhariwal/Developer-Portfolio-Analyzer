import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../shared/services/auth.service';

@Component({
  selector: 'app-sa-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="sa-shell">
      <nav class="sa-nav">
        <div class="sa-nav__brand">Super Admin</div>
        <a routerLink="/app/dashboard" class="sa-nav__full-details">
          <span>Full Details</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        </a>
        <div class="sa-nav__divider"></div>
        <a routerLink="dashboard"    routerLinkActive="active">Dashboard</a>
        <a routerLink="organizations" routerLinkActive="active">Organizations</a>
        <a routerLink="admins"       routerLinkActive="active">Admins</a>
        <a routerLink="recruiters"   routerLinkActive="active">Recruiters</a>
        <a routerLink="developers"   routerLinkActive="active">Developers</a>
        <a routerLink="analytics"    routerLinkActive="active">Analytics</a>
        <button (click)="logout()" class="sa-nav__exit">Logout</button>
      </nav>
      <main class="sa-main"><router-outlet /></main>
    </div>
  `,
  styles: [`
    .sa-shell { display: flex; min-height: 100vh; background: var(--bg-main); color: var(--text-primary); }
    .sa-nav { width: 260px; background: var(--bg-card); padding: 24px 0; display: flex; flex-direction: column; flex-shrink: 0; border-right: 1px solid var(--border-color); }
    .sa-nav__brand { color: var(--color-primary-light); font-weight: 800; font-size: 18px; padding: 0 24px 16px; letter-spacing: -0.02em; }
    .sa-nav__full-details { 
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(99, 102, 241, 0.1); color: var(--color-primary-light) !important; margin: 10px 16px; padding: 12px 16px !important; 
      border-radius: var(--radius-md); font-weight: 600; font-size: 13px; text-decoration: none; border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .sa-nav__full-details svg { width: 16px; height: 16px; }
    .sa-nav__divider { height: 1px; background: var(--border-color); margin: 16px 0; opacity: 0.5; }
    .sa-nav a { color: var(--text-secondary); text-decoration: none; padding: 12px 24px; font-size: 14px; transition: all var(--transition-fast); display: block; font-weight: 500; }
    .sa-nav a:hover { background: var(--bg-hover); color: var(--text-primary); }
    .sa-nav a.active { background: rgba(99, 102, 241, 0.1); color: var(--color-primary-light); border-right: 3px solid var(--color-primary); }
    .sa-nav__exit { 
      margin-top: auto; background: transparent; border: none; border-top: 1px solid var(--border-color); 
      color: var(--text-muted); padding: 20px 24px; text-align: left; cursor: pointer; font-size: 14px; font-weight: 500;
    }
    .sa-nav__exit:hover { color: var(--color-danger); background: rgba(239, 68, 68, 0.05); }
    .sa-main { flex: 1; overflow-y: auto; background: var(--bg-main); }
  `]
})
export class SaShellComponent {
  constructor(private readonly auth: AuthService, private readonly router: Router) {}
  logout() {
    this.auth.logout();
    this.router.navigate(['/auth/login']);
  }
}
