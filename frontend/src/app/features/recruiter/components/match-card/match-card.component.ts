import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-match-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './match-card.component.html',
  styleUrl: './match-card.component.scss',
})
export class MatchCardComponent {
  @Input() match: any;
  @Input() hideActions = false;
  @Output() shortlist = new EventEmitter<any>();
  @Output() compare = new EventEmitter<any>();
  @Output() reject = new EventEmitter<any>();
  @Output() reset = new EventEmitter<any>();

  get isShortlisted(): boolean {
    return String(this.match?.status || '').toLowerCase() === 'shortlisted';
  }

  get isRejected(): boolean {
    return String(this.match?.status || '').toLowerCase() === 'rejected';
  }
}
