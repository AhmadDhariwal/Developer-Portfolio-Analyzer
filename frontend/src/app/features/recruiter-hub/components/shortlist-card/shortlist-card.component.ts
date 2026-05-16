import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-shortlist-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="shortlist-card">
      <h3>{{ item?.candidate?.name || item?.candidate?.fullName }}</h3>
      <p>{{ item?.job?.title || 'General shortlist' }}</p>
      <small>Status: {{ item?.status }}</small>
      <pre>{{ item?.notes || 'No notes yet.' }}</pre>
      <div class="shortlist-card__actions">
        <button type="button" (click)="edit.emit(item)">Update</button>
        <button type="button" (click)="remove.emit(item)">Remove</button>
      </div>
    </div>
  `,
  styles: [`
    .shortlist-card{padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72);display:flex;flex-direction:column;gap:.6rem}
    h3,p,small,pre{margin:0}.shortlist-card h3{color:#f8fafc}.shortlist-card p,small{color:#94a3b8} pre{white-space:pre-wrap;color:#cbd5e1;font-family:inherit}
    .shortlist-card__actions{display:flex;gap:.5rem;flex-wrap:wrap}
    button{border:none;border-radius:10px;padding:.65rem .85rem;background:#334155;color:#fff;font-weight:700;cursor:pointer}
  `]
})
export class ShortlistCardComponent {
  @Input() item: any;
  @Output() edit = new EventEmitter<any>();
  @Output() remove = new EventEmitter<any>();
}
