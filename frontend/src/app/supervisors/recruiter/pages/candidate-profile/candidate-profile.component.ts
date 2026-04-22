import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { RecruiterCandidate, RecruiterService } from '../../services/recruiter.service';
import { RecruiterMessageService } from '../../../recruiter-shared/services/recruiter-message.service';

@Component({
  selector: 'app-candidate-profile-page',
  standalone: false,
  templateUrl: './candidate-profile.component.html',
  styleUrls: ['./candidate-profile.component.scss']
})
export class CandidateProfilePageComponent implements OnInit {
  candidate: RecruiterCandidate | null = null;

  constructor(
    public readonly recruiterService: RecruiterService,
    private readonly recruiterMessage: RecruiterMessageService,
    private readonly route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    const candidateId = this.route.snapshot.paramMap.get('id') || '';
    if (!candidateId) {
      this.recruiterMessage.error('Candidate id is missing.');
      return;
    }

    this.recruiterService.getCandidateById(candidateId).subscribe({
      next: (candidate) => {
        this.candidate = candidate;
      },
      error: () => {
        this.candidate = null;
        this.recruiterMessage.error('Failed to load candidate profile.');
      }
    });
  }
}
