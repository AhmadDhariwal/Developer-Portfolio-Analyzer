import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-support-page-header',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <div class="header-left">
        <span class="eyebrow">{{ eyebrow }}</span>
        <h1 class="page-title">{{ title }}</h1>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
      <div class="header-actions">
        <a href="/app/profile" class="header-link">Career profile</a>
        <a [href]="'mailto:' + email" class="header-action-btn" title="Contact support via email">
          <span class="material-symbols-outlined action-icon">mail</span>
          <span class="action-text">{{ email }}</span>
        </a>
      </div>
    </header>
  `,
  styleUrl: './support-page-header.component.scss',
})
export class SupportPageHeaderComponent {
  @Input() title = 'Help & Support';
  @Input() subtitle = 'Evidence-based support, ticket tracking, and developer knowledge base.';
  @Input() eyebrow = 'Assistance & Support';
  @Input() email = 'support@devinsight.com';
}
