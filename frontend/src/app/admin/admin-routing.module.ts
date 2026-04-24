import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { AdminDashboardPageComponent } from './pages/admin-dashboard/admin-dashboard.component';
import { AdminRecruitersPageComponent } from './pages/admin-recruiters/admin-recruiters.component';
import { AdminDevelopersPageComponent } from './pages/admin-developers/admin-developers.component';
import { AdminJobsPageComponent } from './pages/admin-jobs/admin-jobs.component';

const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: AdminDashboardPageComponent },
  { path: 'recruiters', component: AdminRecruitersPageComponent },
  { path: 'developers', component: AdminDevelopersPageComponent },
  { path: 'jobs', component: AdminJobsPageComponent }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule]
})
export class AdminRoutingModule {}
