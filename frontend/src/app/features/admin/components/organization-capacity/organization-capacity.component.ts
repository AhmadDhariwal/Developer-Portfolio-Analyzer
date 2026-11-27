import { Component, Input } from '@angular/core';

import { organizationCapacity } from '../../utils/organization-capacity';

@Component({
  selector: 'app-organization-capacity',
  standalone: true,
  templateUrl: './organization-capacity.component.html',
  styleUrl: './organization-capacity.component.scss',
})
export class OrganizationCapacityComponent {
  @Input() title = '';
  @Input() used = 0;
  @Input() limit = 0;

  get capacity() {
    return organizationCapacity(this.used, this.limit);
  }
}
