import {
  IntegrationMarketplaceItem,
  ProviderName,
} from '../../../shared/services/integrations.service';
import { CategoryGroup } from '../config/marketplace.models';
import { PROVIDER_META } from '../config/provider-metadata';

export function getCategoryStats(
  integrations: IntegrationMarketplaceItem[],
  group: CategoryGroup,
): string {
  const list = integrations.filter((item) => PROVIDER_META[item.provider]?.categoryGroup === group);
  const connected = list.filter((item) => item.status === 'connected').length;
  return `${connected}/${list.length}`;
}

export function getCategoryPercent(
  integrations: IntegrationMarketplaceItem[],
  group: CategoryGroup,
): number {
  const list = integrations.filter((item) => PROVIDER_META[item.provider]?.categoryGroup === group);
  if (!list.length) return 0;
  const connected = list.filter((item) => item.status === 'connected').length;
  return Math.round((connected / list.length) * 100);
}

export function getCategoryTotal(
  integrations: IntegrationMarketplaceItem[],
  group: CategoryGroup,
): number {
  return integrations.filter((item) => PROVIDER_META[item.provider]?.categoryGroup === group)
    .length;
}

export function isProviderUnavailable(
  integrations: IntegrationMarketplaceItem[],
  provider: ProviderName,
): boolean {
  return (
    provider === 'kaggle' &&
    integrations.find((item) => item.provider === provider)?.available !== true
  );
}

export function getInputLabel(provider: ProviderName): string {
  return PROVIDER_META[provider]?.inputLabel || 'Username';
}

export function getInputPlaceholder(provider: ProviderName): string {
  return PROVIDER_META[provider]?.inputPlaceholder || 'Enter username';
}

export function getInputHint(provider: ProviderName): string {
  return PROVIDER_META[provider]?.inputHint || '';
}

export function getImpactItems(provider: ProviderName): string[] {
  return PROVIDER_META[provider]?.impact || [];
}

export function getScoreHealthLabel(score: number): string {
  if (score >= 75) return 'Optimal';
  if (score >= 50) return 'Healthy';
  if (score >= 25) return 'Developing';
  return 'Initializing';
}

export function getScoreHealthClass(score: number): string {
  if (score >= 75) return 'health--excellent';
  if (score >= 50) return 'health--good';
  if (score >= 25) return 'health--fair';
  return 'health--low';
}
