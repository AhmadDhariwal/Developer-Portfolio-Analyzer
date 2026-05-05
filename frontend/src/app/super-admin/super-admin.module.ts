import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SUPER_ADMIN_ROUTES } from './super-admin.routes';

@NgModule({
  imports: [CommonModule, RouterModule.forChild(SUPER_ADMIN_ROUTES)],
  exports: [RouterModule]
})
export class SuperAdminModule {}
