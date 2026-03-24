import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss'
})
export class SettingsPageComponent {
  sections = [
    {
      title: 'AI Versions',
      description: 'Manage model output snapshots, compare versions, and rollback when needed.',
      route: '/app/settings/ai-versions'
    },
    {
      title: 'User Management',
      description: 'Manage organizations, teams, members, roles, and invitation lifecycle.',
      route: '/app/settings/user-management'
    },
    {
      title: 'Activity Logs',
      description: 'Review and manage audit activity for your organization.',
      route: '/app/settings/activity-logs'
    }
  ];
}
