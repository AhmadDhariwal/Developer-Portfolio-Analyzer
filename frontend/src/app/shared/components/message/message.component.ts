import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-shared-message',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './message.component.html',
  styleUrls: ['./message.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SharedMessageComponent {
  @Input() visible = false;
  @Input() text = '';
  @Input() type: 'success' | 'error' | 'warning' = 'success';
  @Output() dismiss = new EventEmitter<void>();
}
