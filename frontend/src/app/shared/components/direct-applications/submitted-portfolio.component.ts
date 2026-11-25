import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PortfolioSubmission } from '../../services/job-applications.service';

@Component({
  selector: 'app-submitted-portfolio',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './submitted-portfolio.component.html',
  styleUrl: './submitted-portfolio.component.scss',
})
export class SubmittedPortfolioComponent {
  @Input() portfolio: PortfolioSubmission | null = null;
}
