import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { LoaderComponent } from './components/loader/loader.component';
import { MessageComponent } from './components/message/message.component';
import { EmptyStateComponent } from './components/empty-state/empty-state.component';
import { ConfirmDialogComponent } from './components/confirm-dialog/confirm-dialog.component';

@NgModule({
  declarations: [
    LoaderComponent,
    MessageComponent,
    EmptyStateComponent,
    ConfirmDialogComponent
  ],
  imports: [CommonModule],
  exports: [
    LoaderComponent,
    MessageComponent,
    EmptyStateComponent,
    ConfirmDialogComponent
  ]
})
export class RecruiterSharedModule {}
