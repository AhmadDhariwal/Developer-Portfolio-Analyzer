import { CanDeactivateFn } from '@angular/router';
export interface OrganizationEditor {
  readonly dirty: boolean;
}
export const organizationUnsavedGuard: CanDeactivateFn<OrganizationEditor> = (editor) =>
  !editor.dirty || window.confirm('Discard unsaved organization changes?');
