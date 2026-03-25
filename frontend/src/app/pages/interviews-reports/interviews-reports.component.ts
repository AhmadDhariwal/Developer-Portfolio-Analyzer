import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-interviews-reports',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './interviews-reports.component.html',
  styleUrl: './interviews-reports.component.scss'
})
export class InterviewsReportsComponent {}
