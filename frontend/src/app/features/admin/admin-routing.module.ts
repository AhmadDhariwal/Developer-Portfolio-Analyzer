import { NgModule } from '@angular/core';
import { RouterModule, Routes, RedirectFunction, Router } from '@angular/router';
import { inject } from '@angular/core';

import { AdminDashboardPageComponent } from './pages/admin-dashboard/admin-dashboard.component';
import { AdminRecruitersPageComponent } from './pages/admin-recruiters/admin-recruiters.component';
import { AdminDevelopersPageComponent } from './pages/admin-developers/admin-developers.component';
import { AdminJobsPageComponent } from './pages/admin-jobs/admin-jobs.component';
import { AdminPerformanceComponent } from './pages/admin-performance/admin-performance.component';
import { AdminActivityLogsComponent } from './pages/activity-logs/admin-activity-logs.component';
import { AdminTeamsPageComponent } from './pages/admin-teams/admin-teams.component';
import { OrganizationOverviewComponent } from './pages/organization-overview/organization-overview.component';
import { OrganizationSettingsComponent } from './pages/organization-settings/organization-settings.component';
import { OrganizationPoliciesComponent } from './pages/organization-policies/organization-policies.component';
import { OrganizationMembersComponent } from './pages/organization-members/organization-members.component';
import { OrganizationInvitationsComponent } from './pages/organization-invitations/organization-invitations.component';
import { OrganizationUsageComponent } from './pages/organization-usage/organization-usage.component';
import { organizationUnsavedGuard } from './guards/organization-unsaved.guard';
import { organizationAdminGuard } from './guards/organization-admin.guard';

export const CONSOLE_DESTINATIONS: Record<string, string> = {
  overview: 'organization',
  teams: 'teams',
  recruiters: 'recruiters',
  invitations: 'organization/invitations',
  preferences: 'organization/settings',
  activity: 'activity-logs',
  performance: 'performance',
};
export const consoleRedirect: RedirectFunction = ({ queryParams, params }) => {
  const { tab, ...remaining } = queryParams;
  return inject(Router).createUrlTree(
    ['/app/admin/' + (CONSOLE_DESTINATIONS[params['tab'] || tab] || 'organization')],
    { queryParams: remaining },
  );
};

export const ADMIN_WORKSPACE_ROUTES: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: AdminDashboardPageComponent },
  { path: 'recruiters', component: AdminRecruitersPageComponent },
  { path: 'teams', component: AdminTeamsPageComponent },
  { path: 'developers', component: AdminDevelopersPageComponent },
  { path: 'jobs', component: AdminJobsPageComponent },
  {
    path: 'organization',
    component: OrganizationOverviewComponent,
    title: 'Organization overview',
  },
  {
    path: 'organization/settings',
    component: OrganizationSettingsComponent,
    title: 'General settings',
    canDeactivate: [organizationUnsavedGuard],
  },
  {
    path: 'organization/policies',
    component: OrganizationPoliciesComponent,
    title: 'Policies & permissions',
    canDeactivate: [organizationUnsavedGuard],
  },
  {
    path: 'organization/members',
    component: OrganizationMembersComponent,
    title: 'Members & access',
  },
  {
    path: 'organization/invitations',
    component: OrganizationInvitationsComponent,
    title: 'Invitations',
  },
  { path: 'organization/usage', component: OrganizationUsageComponent, title: 'Resource usage' },
  { path: 'console', redirectTo: consoleRedirect, pathMatch: 'full' },
  { path: 'console/performance-statistics', redirectTo: 'performance', pathMatch: 'full' },
  { path: 'console/:tab', redirectTo: consoleRedirect, pathMatch: 'full' },
  { path: 'activity-logs', component: AdminActivityLogsComponent },
  { path: 'performance', component: AdminPerformanceComponent, title: 'Performance & statistics' },
];

@NgModule({
  imports: [
    RouterModule.forChild([
      { path: '', canActivateChild: [organizationAdminGuard], children: ADMIN_WORKSPACE_ROUTES },
    ]),
  ],
  exports: [RouterModule],
})
export class AdminRoutingModule {}
