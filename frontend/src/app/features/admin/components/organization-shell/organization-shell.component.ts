import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-organization-shell',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './organization-shell.component.html',
  styleUrl: '../../styles/organization-page.scss',
})
export class OrganizationShellComponent {
  @Input() title = '';
  @Input() description = '';
  @Input() loading = false;
  @Input() error = '';
  @Output() refresh = new EventEmitter<void>();
}
