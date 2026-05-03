import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-sa-shell',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="sa-shell">
      <nav class="sa-nav">
        <div class="sa-nav__brand">Super Admin</div>
        <a routerLink="dashboard"    routerLinkActive="active">Dashboard</a>
        <a routerLink="organizations" routerLinkActive="active">Organizations</a>
        <a routerLink="admins"       routerLinkActive="active">Admins</a>
        <a routerLink="recruiters"   routerLinkActive="active">Recruiters</a>
        <a routerLink="developers"   routerLinkActive="active">Developers</a>
        <a routerLink="analytics"    routerLinkActive="active">Analytics</a>
        <a routerLink="/app/dashboard" class="sa-nav__exit">← Back to App</a>
      </nav>
      <main class="sa-main"><router-outlet /></main>
    </div>
  `,
  styles: [`
    .sa-shell { display: flex; min-height: 100vh; background: #f8fafc; }
    .sa-nav { width: 200px; background: #0f172a; padding: 20px 0; display: flex; flex-direction: column; flex-shrink: 0; }
    .sa-nav__brand { color: #fff; font-weight: 700; font-size: 14px; padding: 0 20px 20px; border-bottom: 1px solid #1e293b; margin-bottom: 8px; }
    .sa-nav a { color: #94a3b8; text-decoration: none; padding: 10px 20px; font-size: 13px; transition: background .15s, color .15s; }
    .sa-nav a:hover, .sa-nav a.active { background: #1e293b; color: #fff; }
    .sa-nav__exit { margin-top: auto; border-top: 1px solid #1e293b; padding-top: 12px !important; color: #64748b !important; }
    .sa-main { flex: 1; overflow-y: auto; }
  `]
})
export class SaShellComponent {}
