import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-public-blog-page',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './public-blog-page.component.html',
  styleUrl: './public-blog-page.component.scss',
})
export class PublicBlogPageComponent {
  readonly pageLinks = [
    { label: 'Privacy', route: '/privacy' },
    { label: 'Terms', route: '/terms' },
    { label: 'API Docs', route: '/api-docs' },
    { label: 'Blog', route: '/blog' },
    { label: 'Contact', route: '/contact' },
  ];

  readonly featuredPosts = [
    {
      category: 'Recruiting',
      title: 'How AI Ranking Should Support Recruiters, Not Replace Them',
      excerpt: 'A practical look at combining recruiter judgment with score-based candidate ordering and structured review.',
      readTime: '6 min read',
    },
    {
      category: 'Developer Growth',
      title: 'What Makes a Portfolio Actually Useful to Hiring Teams',
      excerpt: 'How developers can present projects, skill evidence, and consistency signals that recruiters can evaluate quickly.',
      readTime: '7 min read',
    },
    {
      category: 'Product Engineering',
      title: 'Why RBAC Matters in Hiring Analytics Platforms',
      excerpt: 'The product and security reasons organization-scoped access is essential for recruiter and admin workflows.',
      readTime: '5 min read',
    },
  ];

  readonly editorialNotes = [
    'Recruiter workflow patterns and sourcing systems',
    'Developer portfolio, resume, and interview growth',
    'Analytics UX, AI operations, and organization-safe product design',
  ];
}
