export type CategoryGroup = 'code' | 'algo' | 'community' | 'knowledge';
export type MarketplaceCategory = 'all' | 'connected' | CategoryGroup;
export type BusyAction = 'connect' | 'sync' | 'disconnect' | '';
export interface ProviderMetadata {
  icon: string;
  color: string;
  categoryGroup: CategoryGroup;
  inputLabel: string;
  inputPlaceholder: string;
  inputHint: string;
  impact: string[];
}
export interface IngestionLogEntry {
  time: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}
