import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProviderName } from '../../../../shared/services/integrations.service';
@Component({
  selector: 'header[appIntegrationsPageHeader]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './integrations-page-header.component.html',
  styleUrl: './integrations-page-header.component.scss',
})
export class IntegrationsPageHeaderComponent {
  @Input() searchQuery = '';
  @Input() syncAllLoading = false;
  @Input() busyProvider: ProviderName | '' = '';
  @Input() connectedCount = 0;
  @Output() readonly searchQueryChange = new EventEmitter<string>();
  @Output() readonly syncAll = new EventEmitter<void>();
}
