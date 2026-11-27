import { Component, Input, OnInit, inject } from '@angular/core';
import { OrganizationPolicyId } from '../../models/organization-governance.model';
import { OrganizationPolicyState } from '../../services/organization-policy-state.service';
@Component({
  selector: 'app-organization-policy-notice',
  standalone: true,
  template: `@if (!state.allowed(policy)) {
    <aside role="status">
      <div>
        <strong>{{ title }}</strong>
        <p>{{ state.explanation(policy) }} {{ detail }}</p>
      </div>
      <button type="button" [disabled]="state.loading()" (click)="refresh()">
        Refresh permissions
      </button>
    </aside>
  }`,
  styles: [
    `
      :host {
        display: block;
      }
      aside {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px;
        margin-block: 12px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        background: var(--surface-card);
        color: var(--text-primary);
      }
      p {
        margin: 6px 0 0;
        color: var(--text-secondary);
        line-height: 1.6;
      }
      button {
        min-height: 44px;
        padding: 10px 14px;
        color: var(--text-primary);
        background: var(--surface-card);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        cursor: pointer;
      }
      button:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 3px;
      }
    `,
  ],
})
export class OrganizationPolicyNoticeComponent implements OnInit {
  readonly state = inject(OrganizationPolicyState);
  @Input({ required: true }) policy!: OrganizationPolicyId;
  @Input() title = 'Organization permissions';
  @Input() detail = '';
  ngOnInit(): void {
    this.state.refresh().subscribe();
  }
  refresh(): void {
    this.state.refresh(true).subscribe();
  }
}
