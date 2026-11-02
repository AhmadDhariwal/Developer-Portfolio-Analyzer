import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-support-page-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1 class="page-title">
        <span class="material-symbols-outlined" style="color: #6366f1; font-size: 36px;"
          >forum</span
        >
        {{ title }}
      </h1>
      <p class="page-subtitle">{{ subtitle }}</p>
    </header>
  `,
  styleUrl: './support-page-header.component.scss',
})
export class SupportPageHeaderComponent {
  @Input() title = 'Help & Support';
  @Input() subtitle = "We're here to help. Get support, report issues, or share your feedback.";
}
