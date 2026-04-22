import { Component, EventEmitter, Input, Output } from '@angular/core';

import { RecruiterCandidate } from '../../services/recruiter.service';

@Component({
  selector: 'app-candidate-card',
  standalone: false,
  templateUrl: './candidate-card.component.html',
  styleUrls: ['./candidate-card.component.scss']
})
export class CandidateCardComponent {
  @Input() candidate!: RecruiterCandidate;
  @Input() selectable = false;
  @Input() selected = false;

  @Output() view = new EventEmitter<string>();
  @Output() selectionChange = new EventEmitter<{ id: string; selected: boolean }>();

  onSelectChange(): void {
    this.selectionChange.emit({
      id: this.candidate.id,
      selected: !this.selected
    });
  }
}
