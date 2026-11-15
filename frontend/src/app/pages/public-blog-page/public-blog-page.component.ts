import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicSubpageShellComponent } from '../../shared/components/public-subpage-shell/public-subpage-shell.component';

interface BlogArticle {
  id: string;
  category: 'Recruiting' | 'Developer Growth' | 'Product Engineering';
  title: string;
  excerpt: string;
  readTime: string;
  takeaways: readonly string[];
}

@Component({
  selector: 'app-public-blog-page',
  standalone: true,
  imports: [CommonModule, RouterLink, PublicSubpageShellComponent],
  templateUrl: './public-blog-page.component.html',
  styleUrl: './public-blog-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicBlogPageComponent {
  readonly categories = ['All', 'Recruiting', 'Developer Growth', 'Product Engineering'] as const;

  readonly selectedCategory = signal<(typeof this.categories)[number]>('All');
  readonly expandedPostId = signal<string | null>('ai-ranking-recruiters');

  readonly featuredPosts: readonly BlogArticle[] = [
    {
      id: 'ai-ranking-recruiters',
      category: 'Recruiting',
      title: 'How AI Ranking Should Support Recruiters, Not Replace Them',
      excerpt:
        'A practical look at combining recruiter judgment with transparent candidate readiness scoring and structured review workflows.',
      readTime: '6 min read',
      takeaways: [
        'Use match scores as a prioritization signal alongside verifiable repository depth.',
        'Expose scoring dimensions transparently so hiring teams audit why candidates rank.',
        'Keep shortlist approvals and outreach decisions explicitly human-driven.',
      ],
    },
    {
      id: 'portfolio-evidence-signals',
      category: 'Developer Growth',
      title: 'What Makes a Portfolio Actually Useful to Hiring Teams',
      excerpt:
        'How engineers can align real repository architecture, commit cadence, and resume claims into verifiable readiness proof.',
      readTime: '7 min read',
      takeaways: [
        'Document problem statements, architecture trade-offs, and test coverage per flagship repo.',
        'Cross-check resume bullet claims against live repository languages and commit history.',
        'Turn identified stack gaps into focused weekly career sprints with measurable output.',
      ],
    },
    {
      id: 'rbac-hiring-analytics',
      category: 'Product Engineering',
      title: 'Why RBAC Matters in Hiring Analytics Platforms',
      excerpt:
        'Why strict organization-scoped authorization boundaries are essential for multi-tenant recruiter and admin workflows.',
      readTime: '5 min read',
      takeaways: [
        'Keep public developer portfolio slugs strictly decoupled from tenant hiring notes.',
        'Verify role and organization membership server-side on every analytics or candidate lookup.',
        'Store OAuth tokens and integration secrets exclusively on trusted backend services.',
      ],
    },
  ] as const;

  readonly editorialNotes = [
    'Recruiter workflow patterns and structured candidate sourcing systems',
    'Developer portfolio verification, resume diagnostics, and interview readiness',
    'Analytics UX, AI safety guardrails, and tenant-isolated product architecture',
  ] as const;

  readonly filteredPosts = computed(() => {
    const category = this.selectedCategory();
    if (category === 'All') {
      return this.featuredPosts;
    }
    return this.featuredPosts.filter((post) => post.category === category);
  });

  selectCategory(category: (typeof this.categories)[number]): void {
    this.selectedCategory.set(category);
  }

  togglePostTakeaways(id: string): void {
    this.expandedPostId.update((current) => (current === id ? null : id));
  }
}
