import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SearchableSelectComponent, SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';

@Component({
  selector: 'app-candidate-filter-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="filter-bar">
      <input [(ngModel)]="model.search" placeholder="Search candidates" />
      <app-searchable-select [options]="stackOptions" [value]="model.stack" [emptyOptionLabel]="'All stacks'" (valueChange)="setValue('stack',$event)" />
      <app-searchable-select [options]="locationOptions" [value]="model.location" [emptyOptionLabel]="'All locations'" (valueChange)="setValue('location',$event)" />
      <input [(ngModel)]="model.skills" placeholder="Skills (comma separated)" />
      <input [(ngModel)]="model.minReadiness" type="number" min="0" max="100" placeholder="Readiness" />
      <button type="button" (click)="apply.emit(model)">Apply</button>
    </div>
  `,
  styles: [`
    .filter-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;padding:1rem;border-radius:16px;background:rgba(15,23,42,.78);border:1px solid rgba(51,65,85,.7)}
    input{width:100%;min-height:42px;border-radius:10px;border:1px solid rgba(51,65,85,.8);background:rgba(15,23,42,.65);color:#f8fafc;padding:.7rem .85rem}
    button{border:none;border-radius:10px;background:#6366f1;color:#fff;font-weight:700;cursor:pointer;padding:.75rem 1rem}
  `]
})
export class CandidateFilterBarComponent {
  @Input() model: any = {};
  @Input() stackOptions: SearchableSelectOption[] = [];
  @Input() locationOptions: SearchableSelectOption[] = [];
  @Output() apply = new EventEmitter<any>();

  setValue(key: string, value: string): void {
    this.model = { ...this.model, [key]: value };
  }
}
