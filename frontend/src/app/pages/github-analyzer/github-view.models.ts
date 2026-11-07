import { ProgressColor } from '../../shared/components';
export interface DisplayBreakdownItem {
  id: string;
  label: string;
  description: string;
  weightPct: number;
  value: number | null;
  contribution: number | null;
  available: boolean;
  color: ProgressColor;
}
