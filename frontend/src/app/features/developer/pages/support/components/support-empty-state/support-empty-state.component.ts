import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-support-empty-state',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty-state">
      <span class="material-symbols-outlined">{{ icon }}</span>
      <p>{{ message }}</p>
    </div>
  `,
  styleUrl: './support-empty-state.component.scss',
})
export class SupportEmptyStateComponent {
  @Input() message = 'You have no active support requests.';
  @Input() icon = 'inbox';
}
