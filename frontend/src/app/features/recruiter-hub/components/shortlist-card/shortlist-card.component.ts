import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-shortlist-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './shortlist-card.component.html',
  styleUrl: './shortlist-card.component.scss',
})
export class ShortlistCardComponent {
  @Input() item: any;
  @Input() hideActions = false;
  @Output() edit = new EventEmitter<any>();
  @Output() remove = new EventEmitter<any>();
}
