import { Component, Input } from '@angular/core';

import { RankedCandidate } from '../../services/recruiter.service';

@Component({
  selector: 'app-match-card',
  standalone: false,
  templateUrl: './match-card.component.html',
  styleUrls: ['./match-card.component.scss']
})
export class MatchCardComponent {
  @Input() result!: RankedCandidate;
}
