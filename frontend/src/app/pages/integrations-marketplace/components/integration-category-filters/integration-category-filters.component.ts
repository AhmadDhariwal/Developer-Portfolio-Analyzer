import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IntegrationMarketplaceItem } from '../../../../shared/services/integrations.service';
import { CategoryGroup, MarketplaceCategory } from '../../config/marketplace.models';
import { getCategoryTotal } from '../../utils/marketplace-presentation';
@Component({
  selector: 'nav[appIntegrationCategoryFilters]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './integration-category-filters.component.html',
  styleUrl: './integration-category-filters.component.scss',
})
export class IntegrationCategoryFiltersComponent {
  @Input() integrations: IntegrationMarketplaceItem[] = [];
  @Input() activeCategory: MarketplaceCategory = 'all';
  @Input() connectedCount = 0;
  @Input() displayedCount = 0;
  @Output() readonly activeCategoryChange = new EventEmitter<MarketplaceCategory>();
  getCategoryTotal(group: CategoryGroup): number {
    return getCategoryTotal(this.integrations, group);
  }
}
