import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { AdminRoutingModule } from './admin-routing.module';
import { SharedLoaderComponent } from '../shared/components/loader/loader.component';
import { SharedMessageComponent } from '../shared/components/message/message.component';
import { SharedEmptyStateComponent } from '../shared/components/empty-state/empty-state.component';

import { AdminDashboardPageComponent } from './pages/admin-dashboard/admin-dashboard.component';
import { AdminRecruitersPageComponent } from './pages/admin-recruiters/admin-recruiters.component';
import { AdminDevelopersPageComponent } from './pages/admin-developers/admin-developers.component';
import { AdminJobsPageComponent } from './pages/admin-jobs/admin-jobs.component';

@NgModule({
  declarations: [
    AdminDashboardPageComponent,
    AdminRecruitersPageComponent,
    AdminDevelopersPageComponent,
    AdminJobsPageComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    AdminRoutingModule,
    SharedLoaderComponent,
    SharedMessageComponent,
    SharedEmptyStateComponent
  ]
})
export class AdminModule {}
