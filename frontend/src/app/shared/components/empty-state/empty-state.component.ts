import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type EmptyStateIcon = 'search' | 'folder' | 'inbox' | 'filter' | 'chart' | 'alert' | 'custom';

@Component({
  selector: 'app-ui-empty-state, app-shared-empty-state',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './empty-state.component.html',
  styleUrls: ['./empty-state.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UiEmptyStateComponent {
  @Input() title: string = 'No data found';
  @Input() subtitle: string = 'Try changing filters or adding new records.';
  @Input() description?: string;
  @Input() icon: EmptyStateIcon = 'inbox';
  @Input() compact: boolean = false;

  get resolvedDescription(): string {
    return this.description || this.subtitle;
  }
}

// Backwards compatibility alias
export { UiEmptyStateComponent as SharedEmptyStateComponent };
