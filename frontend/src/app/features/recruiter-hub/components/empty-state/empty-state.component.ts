import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-recruiter-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="empty-state"><h3>{{ title }}</h3><p>{{ message }}</p></div>`,
  styles: [`.empty-state{padding:2rem;border-radius:16px;border:1px dashed rgba(71,85,105,.8);background:rgba(15,23,42,.6);text-align:center}h3{margin:0 0 .4rem;color:#f8fafc}p{margin:0;color:#94a3b8}`]
})
export class EmptyStateComponent {
  @Input() title = 'Nothing here yet';
  @Input() message = 'No data available.';
}
