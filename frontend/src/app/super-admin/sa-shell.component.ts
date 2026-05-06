import { Component, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../shared/services/auth.service';

@Component({
  selector: 'app-sa-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="sa-shell" [class.sa-shell--collapsed]="collapsed">
      <nav class="sa-nav">
        <div class="sa-nav__top">
          <div class="sa-nav__brand">
            <span class="sa-nav__brand-text">Super Admin</span>
          </div>
          <button class="sa-nav__toggle" type="button" (click)="toggleNav()" [attr.aria-label]="collapsed ? 'Expand sidebar' : 'Collapse sidebar'">
            <span class="sa-chevron" [class.sa-chevron--right]="collapsed">‹</span>
          </button>
        </div>
        <a routerLink="/app/dashboard" class="sa-nav__full-details">
          <span>Full Details</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
        </a>
        <div class="sa-nav__divider"></div>
        <a routerLink="dashboard"    routerLinkActive="active" title="Dashboard"><span class="sa-nav__icon">D</span><span class="sa-nav__label">Dashboard</span></a>
        <a routerLink="organizations" routerLinkActive="active" title="Organizations"><span class="sa-nav__icon">O</span><span class="sa-nav__label">Organizations</span></a>
        <a routerLink="admins"       routerLinkActive="active" title="Admins"><span class="sa-nav__icon">A</span><span class="sa-nav__label">Admins</span></a>
        <a routerLink="recruiters"   routerLinkActive="active" title="Recruiters"><span class="sa-nav__icon">R</span><span class="sa-nav__label">Recruiters</span></a>
        <a routerLink="developers"   routerLinkActive="active" title="Developers"><span class="sa-nav__icon">Dev</span><span class="sa-nav__label">Developers</span></a>
        <a routerLink="analytics"    routerLinkActive="active" title="Analytics"><span class="sa-nav__icon">An</span><span class="sa-nav__label">Analytics</span></a>
        <button (click)="logout()" class="sa-nav__exit">Logout</button>
      </nav>
      <main class="sa-main"><router-outlet></router-outlet></main>
    </div>
  `,
  styles: [`
    .sa-shell { display: flex; min-height: 100vh; background: var(--bg-main); color: var(--text-primary); }
    .sa-nav { width: 260px; background: var(--bg-card); padding: 18px 0; display: flex; flex-direction: column; flex-shrink: 0; border-right: 1px solid var(--border-color); transition: width var(--transition-fast); }
    .sa-shell--collapsed .sa-nav { width: 78px; }
    .sa-nav__top { display: flex; align-items: center; justify-content: space-between; padding: 0 14px 10px 18px; }
    .sa-nav__brand { color: var(--color-primary-light); font-weight: 800; font-size: 18px; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; }
    .sa-shell--collapsed .sa-nav__brand-text { opacity: 0; width: 0; display: inline-block; }
    .sa-nav__toggle { width: 34px; height: 34px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: rgba(255,255,255,0.04); color: var(--text-secondary); cursor: pointer; transition: all var(--transition-fast); display: inline-flex; align-items: center; justify-content: center; }
    .sa-nav__toggle:hover { background: rgba(255,255,255,0.08); color: var(--text-primary); }
    .sa-chevron { display: inline-block; font-size: 18px; line-height: 1; transform: rotate(0deg); transition: transform var(--transition-fast); }
    .sa-chevron--right { transform: rotate(180deg); }
    .sa-nav__full-details { 
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(99, 102, 241, 0.1); color: var(--color-primary-light) !important; margin: 10px 16px; padding: 12px 16px !important; 
      border-radius: var(--radius-md); font-weight: 600; font-size: 13px; text-decoration: none; border: 1px solid rgba(99, 102, 241, 0.2);
    }
    .sa-shell--collapsed .sa-nav__full-details { margin: 10px 12px; padding: 12px !important; justify-content: center; }
    .sa-shell--collapsed .sa-nav__full-details span { display: none; }
    .sa-nav__full-details svg { width: 16px; height: 16px; }
    .sa-nav__divider { height: 1px; background: var(--border-color); margin: 16px 0; opacity: 0.5; }
    .sa-nav a { color: var(--text-secondary); text-decoration: none; padding: 12px 18px; font-size: 14px; transition: all var(--transition-fast); display: flex; align-items: center; gap: 10px; font-weight: 600; }
    .sa-nav a:hover { background: var(--bg-hover); color: var(--text-primary); }
    .sa-nav a.active { background: rgba(99, 102, 241, 0.1); color: var(--color-primary-light); border-right: 3px solid var(--color-primary); }
    .sa-nav__icon { width: 34px; height: 34px; border-radius: var(--radius-sm); border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); display: inline-flex; align-items: center; justify-content: center; font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
    .sa-nav a.active .sa-nav__icon { color: var(--color-primary-light); border-color: rgba(99, 102, 241, 0.35); background: rgba(99, 102, 241, 0.12); }
    .sa-shell--collapsed .sa-nav a { padding: 12px 12px; justify-content: center; }
    .sa-shell--collapsed .sa-nav__label { display: none; }
    .sa-nav__exit { 
      margin-top: auto; background: transparent; border: none; border-top: 1px solid var(--border-color); 
      color: var(--text-muted); padding: 20px 24px; text-align: left; cursor: pointer; font-size: 14px; font-weight: 500;
    }
    .sa-nav__exit:hover { color: var(--color-danger); background: rgba(239, 68, 68, 0.05); }
    .sa-shell--collapsed .sa-nav__exit { padding: 18px 12px; text-align: center; }
    .sa-main { flex: 1; overflow-y: auto; background: var(--bg-main); }

    @media (max-width: 1024px) {
      .sa-shell { flex-direction: column; }
      .sa-nav { width: 100%; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px; }
      .sa-nav__top { width: 100%; padding: 0; }
      .sa-nav__divider { width: 100%; margin: 8px 0; }
      .sa-nav__full-details { width: 100%; margin: 0; }
      .sa-nav a { flex: 1 1 calc(50% - 8px); justify-content: flex-start; padding: 10px 14px; }
      .sa-nav__exit { width: 100%; text-align: center; margin-top: 6px; }
      .sa-shell--collapsed .sa-nav { width: 100%; }
      .sa-shell--collapsed .sa-nav__label,
      .sa-shell--collapsed .sa-nav__brand-text { display: inline-block; opacity: 1; width: auto; }
    }

    @media (max-width: 640px) {
      .sa-nav { position: sticky; top: 0; z-index: 20; }
      .sa-nav a { flex-basis: 100%; }
      .sa-nav__top { gap: 10px; }
      .sa-nav__toggle { margin-left: auto; }
      .sa-nav__full-details { display: none; }
    }
  `]
})
export class SaShellComponent implements OnInit {
  collapsed = false;

  constructor(private readonly auth: AuthService, private readonly router: Router) {}

  ngOnInit(): void {
    this.collapsed = localStorage.getItem('sa_nav_collapsed') === 'true';
  }

  toggleNav(): void {
    this.collapsed = !this.collapsed;
    localStorage.setItem('sa_nav_collapsed', String(this.collapsed));
  }

  logout() {
    this.auth.logout();
    this.router.navigate(['/auth/login']);
  }
}
