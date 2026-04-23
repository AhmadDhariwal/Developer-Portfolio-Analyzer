import { Component, OnInit } from '@angular/core';

import { AdminDeveloper, AdminHiringService } from '../../services/admin-hiring.service';

@Component({
  selector: 'app-admin-developers-page',
  standalone: false,
  templateUrl: './admin-developers.component.html',
  styleUrls: ['./admin-developers.component.scss']
})
export class AdminDevelopersPageComponent implements OnInit {
  loading = false;
  message = '';
  developers: AdminDeveloper[] = [];
  search = '';

  constructor(private readonly adminService: AdminHiringService) {}

  ngOnInit(): void {
    this.loadDevelopers();
  }

  get filteredDevelopers(): AdminDeveloper[] {
    const needle = this.search.trim().toLowerCase();
    if (!needle) return this.developers;

    return this.developers.filter((developer) => {
      const haystack = `${developer.name} ${developer.email} ${developer.githubUsername} ${developer.jobTitle}`.toLowerCase();
      return haystack.includes(needle);
    });
  }

  loadDevelopers(): void {
    this.loading = true;
    this.adminService.getDevelopers().subscribe({
      next: (developers) => {
        this.developers = developers;
        this.loading = false;
      },
      error: () => {
        this.message = 'Failed to load public developers.';
        this.loading = false;
      }
    });
  }
}
