import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SaModalComponent } from '../sa-modal/sa-modal.component';

export type SaUserRole = 'admin' | 'recruiter' | 'developer';

@Component({
  selector: 'sa-user-form-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SaModalComponent],
  styleUrls: ['./sa-user-form-modal.component.scss'],
  template: `
    <sa-modal [open]="open" [title]="title" (close)="close.emit()">
      <form class="sa-form" [formGroup]="form" (ngSubmit)="submit()">
        <div class="sa-form__grid">
          <label class="sa-field">
            <span>Name</span>
            <input formControlName="name" />
          </label>

          <label class="sa-field">
            <span>Email</span>
            <input formControlName="email" />
          </label>

          <label class="sa-field" *ngIf="mode === 'create'">
            <span>Password</span>
            <input type="password" formControlName="password" placeholder="Min 6 characters" />
          </label>

          <label class="sa-field" *ngIf="mode === 'edit'">
            <span>New Password (optional)</span>
            <input type="password" formControlName="password" placeholder="Leave empty to keep current" />
          </label>

          <label class="sa-field">
            <span>Organization</span>
            <select formControlName="organizationId">
              <option value="">(None)</option>
              <option *ngFor="let o of organizations" [value]="o._id">{{ o.name }}</option>
            </select>
          </label>

          <label class="sa-field">
            <span>Status</span>
            <select formControlName="isActive">
              <option value="true">Active</option>
              <option value="false">Revoked</option>
            </select>
          </label>

          <label class="sa-field" *ngIf="role === 'developer'">
            <span>Career Stack</span>
            <select formControlName="careerStack">
              <option value="">(Default)</option>
              <option *ngFor="let s of stacks" [value]="s">{{ s }}</option>
            </select>
          </label>

          <label class="sa-field" *ngIf="role === 'developer'">
            <span>Experience Level</span>
            <select formControlName="experienceLevel">
              <option value="">(Default)</option>
              <option *ngFor="let l of levels" [value]="l">{{ l }}</option>
            </select>
          </label>
        </div>

        <div class="sa-form__actions">
          <div class="sa-form__error" *ngIf="error">{{ error }}</div>
          <div class="sa-form__spacer"></div>
          <button type="button" class="ghost" (click)="close.emit()">Cancel</button>
          <button type="submit" class="primary" [disabled]="busy || form.invalid">{{ mode === 'create' ? 'Create' : 'Save' }}</button>
        </div>
      </form>
    </sa-modal>
  `
})
export class SaUserFormModalComponent {
  private readonly fb = inject(FormBuilder);

  @Input() open = false;
  private _mode: 'create' | 'edit' = 'create';
  @Input() set mode(value: 'create' | 'edit') {
    this._mode = value || 'create';
    this.updatePasswordValidators();
  }
  get mode() { return this._mode; }
  @Input() role: SaUserRole = 'admin';
  @Input() organizations: Array<{ _id: string; name: string }> = [];
  @Input() busy = false;
  @Input() error = '';

  @Input() set user(value: any) {
    this.patchFromUser(value);
  }

  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<Record<string, any>>();

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    email: ['', [Validators.required, Validators.email]],
    password: [''],
    organizationId: [''],
    isActive: ['true'],
    careerStack: [''],
    experienceLevel: ['']
  });

  readonly stacks = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
  readonly levels = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];

  get title() {
    const label = this.role === 'admin' ? 'Admin' : this.role === 'recruiter' ? 'Recruiter' : 'Developer';
    return this.mode === 'create' ? `Add ${label}` : `Edit ${label}`;
  }

  private patchFromUser(value: any) {
    if (!value) {
      this.form.reset({
        name: '',
        email: '',
        password: '',
        organizationId: '',
        isActive: 'true',
        careerStack: '',
        experienceLevel: ''
      });
      this.updatePasswordValidators();
      return;
    }

    this.form.reset({
      name: value.name || '',
      email: value.email || '',
      password: '',
      organizationId: value.organizationId?._id || value.organizationId || '',
      isActive: value.isActive !== false ? 'true' : 'false',
      careerStack: value.careerStack || '',
      experienceLevel: value.experienceLevel || ''
    });
    this.updatePasswordValidators();
  }

  private updatePasswordValidators() {
    const ctrl = this.form.controls.password;
    if (this.mode === 'create') {
      ctrl.setValidators([Validators.required, Validators.minLength(6)]);
    } else {
      ctrl.setValidators([Validators.minLength(6)]);
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  submit() {
    this.updatePasswordValidators();
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.getRawValue();
    const payload: Record<string, any> = {
      name: v.name?.trim(),
      email: String(v.email || '').trim(),
      organizationId: v.organizationId || null,
      isActive: String(v.isActive) === 'true'
    };

    if (v.password) payload['password'] = v.password;
    if (this.role === 'developer') {
      if (v.careerStack) payload['careerStack'] = v.careerStack;
      if (v.experienceLevel) payload['experienceLevel'] = v.experienceLevel;
    }
    if (this.mode === 'create') payload['role'] = this.role;
    this.save.emit(payload);
  }
}
