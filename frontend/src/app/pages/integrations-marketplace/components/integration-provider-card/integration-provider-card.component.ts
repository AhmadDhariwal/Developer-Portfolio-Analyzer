import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SafeHtml } from '@angular/platform-browser';
import {
  IntegrationMarketplaceItem,
  ProviderName,
} from '../../../../shared/services/integrations.service';
import { BusyAction } from '../../config/marketplace.models';
import { KaggleLinkedProfileComponent } from '../kaggle-linked-profile/kaggle-linked-profile.component';
import {
  getInputLabel,
  getInputPlaceholder,
  getInputHint,
  getImpactItems,
} from '../../utils/marketplace-presentation';
@Component({
  selector: 'article[appIntegrationProviderCard]',
  standalone: true,
  imports: [CommonModule, FormsModule, KaggleLinkedProfileComponent],
  templateUrl: './integration-provider-card.component.html',
  styleUrl: './integration-provider-card.component.scss',
})
export class IntegrationProviderCardComponent {
  @Input({ required: true }) item!: IntegrationMarketplaceItem;
  @Input() busyProvider: ProviderName | '' = '';
  @Input() busyAction: BusyAction = '';
  @Input() unavailable = false;
  @Input() icon: SafeHtml | undefined;
  @Input() color: string | undefined;
  @Input() username: string | undefined;
  @Output() readonly usernameChange = new EventEmitter<string>();
  @Output() readonly connect = new EventEmitter<IntegrationMarketplaceItem>();
  @Output() readonly sync = new EventEmitter<ProviderName>();
  @Output() readonly disconnect = new EventEmitter<IntegrationMarketplaceItem>();
  readonly getInputLabel = getInputLabel;
  readonly getInputPlaceholder = getInputPlaceholder;
  readonly getInputHint = getInputHint;
  readonly getImpactItems = getImpactItems;
}
