import { Component, Input } from '@angular/core';

import { RecruiterInsight } from '../../services/recruiter.service';

@Component({
  selector: 'app-insights-panel',
  standalone: false,
  templateUrl: './insights-panel.component.html',
  styleUrls: ['./insights-panel.component.scss']
})
export class InsightsPanelComponent {
  @Input() insight: RecruiterInsight = {
    summary: '',
    strengths: [],
    weaknesses: [],
    recommendation: ''
  };
}
