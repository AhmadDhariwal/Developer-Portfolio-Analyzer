import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: false,
  templateUrl: './empty-state.component.html',
  styleUrls: ['./empty-state.component.scss']
})
export class EmptyStateComponent {
  @Input() title = 'Nothing to show';
  @Input() subtitle = '';
}
