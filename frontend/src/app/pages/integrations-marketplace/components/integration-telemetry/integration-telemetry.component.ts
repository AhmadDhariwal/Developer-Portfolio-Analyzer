import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IntegrationMarketplaceItem } from '../../../../shared/services/integrations.service';
import { CategoryGroup } from '../../config/marketplace.models';
import {
  getScoreHealthClass,
  getScoreHealthLabel,
  getCategoryStats,
  getCategoryPercent,
} from '../../utils/marketplace-presentation';
@Component({
  selector: 'section[appIntegrationTelemetry]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './integration-telemetry.component.html',
  styleUrl: './integration-telemetry.component.scss',
})
export class IntegrationTelemetryComponent {
  @Input() integrations: IntegrationMarketplaceItem[] = [];
  @Input() integrationScore = 0;
  @Input() connectedCount = 0;
  @Input() disconnectedCount = 0;
  @Input() oauthCount = 0;
  @Input() manualCount = 0;
  @Input() isTerminalOpen = false;
  @Output() readonly toggleTerminal = new EventEmitter<void>();
  readonly getScoreHealthClass = getScoreHealthClass;
  readonly getScoreHealthLabel = getScoreHealthLabel;
  getCategoryStats(group: CategoryGroup): string {
    return getCategoryStats(this.integrations, group);
  }
  getCategoryPercent(group: CategoryGroup): number {
    return getCategoryPercent(this.integrations, group);
  }
}
