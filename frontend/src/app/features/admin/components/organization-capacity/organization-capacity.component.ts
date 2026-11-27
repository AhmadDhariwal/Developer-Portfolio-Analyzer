import { Component, Input } from '@angular/core';
import { organizationCapacity } from '../../utils/organization-capacity';

@Component({
  selector: 'app-organization-capacity',
  standalone: true,
  template: `<section class="card">
    <h2>{{ title }}</h2>
    <strong class="stat-value">{{ capacity.used }} / {{ capacity.limit }}</strong
    ><span class="badge">{{ capacity.label }}</span
    ><progress
      max="100"
      [value]="capacity.bar"
      [attr.aria-label]="title + ' utilization'"
    ></progress>
    <p>
      {{ capacity.remaining }} remaining ·
      {{
        capacity.percentage === null
          ? 'Percentage unavailable for a zero limit'
          : capacity.percentage + '% utilized'
      }}
    </p>
    <small
      >Limit managed at platform level. Existing resources are retained when capacity is
      exceeded.</small
    >
  </section>`,
  styleUrl: '../../styles/organization-page.scss',
})
export class OrganizationCapacityComponent {
  @Input() title = '';
  @Input() used = 0;
  @Input() limit = 0;
  get capacity() {
    return organizationCapacity(this.used, this.limit);
  }
}
