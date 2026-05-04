import { Routes } from '@angular/router';
import { SaShellComponent } from './sa-shell.component';
import { SuperAdminDashboardComponent } from './dashboard/super-admin-dashboard.component';
import { SaOrganizationsComponent } from './organizations/sa-organizations.component';
import { SaAdminsComponent } from './admins/sa-admins.component';
import { SaRecruitersComponent } from './recruiters/sa-recruiters.component';
import { SaDevelopersComponent } from './developers/sa-developers.component';
import { SaAnalyticsComponent } from './analytics/sa-analytics.component';
import { SaUserDetailsComponent } from './user-details/sa-user-details.component';

export const SUPER_ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: SaShellComponent,
    children: [
      { path: '',             redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard',    component: SuperAdminDashboardComponent },
      { path: 'organizations',component: SaOrganizationsComponent },
      { path: 'admins',       component: SaAdminsComponent },
      { path: 'recruiters',   component: SaRecruitersComponent },
      { path: 'developers',   component: SaDevelopersComponent },
      { path: 'analytics',    component: SaAnalyticsComponent },
      { path: 'users/:id',    component: SaUserDetailsComponent },
    ]
  }
];
