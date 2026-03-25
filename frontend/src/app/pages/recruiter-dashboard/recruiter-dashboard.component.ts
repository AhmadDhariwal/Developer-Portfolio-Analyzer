import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RecruiterDashboardService, RecruiterCandidate } from '../../shared/services/recruiter-dashboard.service';

@Component({
  selector: 'app-recruiter-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recruiter-dashboard.component.html',
  styleUrl: './recruiter-dashboard.component.scss'
})
export class RecruiterDashboardComponent implements OnInit {
  searchTerm = '';
  minScore = 0;
  skillFilter = '';
  isLoading = false;
  candidates: RecruiterCandidate[] = [];
  shortlisted = new Set<string>();

  constructor(
    private readonly recruiterService: RecruiterDashboardService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadCandidates();
  }

  loadCandidates(): void {
    this.isLoading = true;
    const skills = this.skillFilter
      .split(',')
      .map((skill) => skill.trim())
      .filter(Boolean);

    this.recruiterService.fetchCandidates({
      search: this.searchTerm,
      minScore: this.minScore,
      skills
    }).subscribe({
      next: (res) => {
        this.candidates = res.candidates || [];
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.candidates = [];
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  toggleShortlist(candidate: RecruiterCandidate): void {
    if (this.shortlisted.has(candidate.id)) {
      this.shortlisted.delete(candidate.id);
    } else {
      this.shortlisted.add(candidate.id);
    }
  }

  isShortlisted(candidate: RecruiterCandidate): boolean {
    return this.shortlisted.has(candidate.id);
  }
}
