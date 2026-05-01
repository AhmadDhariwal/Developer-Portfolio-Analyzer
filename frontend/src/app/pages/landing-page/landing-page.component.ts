import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { CommonModule, NgStyle } from '@angular/common';
import { RouterLink } from '@angular/router';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, NgStyle, RouterLink, UiButtonComponent],
  templateUrl: './landing-page.component.html',
  styleUrl: './landing-page.component.scss'
})
export class LandingPageComponent implements AfterViewInit, OnDestroy {
  private revealObserver?: IntersectionObserver;
  private counterObserver?: IntersectionObserver;

  trustedLogos = ['Google', 'Microsoft', 'Spotify', 'Airbnb', 'Amazon', 'Netflix'];

  stats: { value: string; label: string; icon: string; target: number; suffix: string; prefix?: string; decimals?: number; duration?: number }[] = [
    { value: '50K+', label: 'Developers Analyzed', icon: 'users', target: 50, suffix: 'K+' },
    { value: '2M+', label: 'Skills Extracted', icon: 'database', target: 2, suffix: 'M+' },
    { value: '18K+', label: 'Career Surprises', icon: 'sparkles', target: 18, suffix: 'K+' },
    { value: '+34%', label: 'Avg Salary Bump', icon: 'briefcase', target: 34, prefix: '+', suffix: '%' },
    { value: '97%', label: 'Satisfaction Rate', icon: 'award', target: 97, suffix: '%' }
  ];

  insightBullets = [
    'Code quality and best practices',
    'Skill assessment and gap detection',
    'Industry benchmark comparison',
    'Personalized learning roadmap'
  ];

  recruiterHighlights = [
    {
      icon: 'rank',
      title: 'AI-Ranked Developers',
      description: 'Prioritize top candidates with AI-scored readiness and impact signals.'
    },
    {
      icon: 'shield-check',
      title: 'GitHub Verification',
      description: 'Validate contributions, repos, and code consistency with verified data.'
    },
    {
      icon: 'file-check',
      title: 'Resume Intelligence',
      description: 'Extract key experience and outcomes so hiring teams see the full story.'
    },
    {
      icon: 'target',
      title: 'Candidate Matching',
      description: 'Match roles with real skills, not just keyword-heavy resumes.'
    },
    {
      icon: 'chart',
      title: 'Hiring Insights',
      description: 'Get signal-rich analytics that make screening faster and fairer.'
    }
  ];

  growthMetrics = [
    { label: 'Hiring Score', value: '92', detail: '+18 pts this quarter' },
    { label: 'Salary Lift', value: '+34%', detail: 'Projected impact' },
    { label: 'Skill Progression', value: '6/8', detail: 'Target skills mastered' }
  ];

  analysisSteps = [
    {
      status: 'done',
      title: 'GitHub scanned',
      detail: '128 repos, 6 languages detected'
    },
    {
      status: 'done',
      title: 'Skills extracted',
      detail: '34 skills mapped, 6 strengths highlighted'
    },
    {
      status: 'processing',
      title: 'Missing skills detected',
      detail: 'System design, Kubernetes, distributed systems'
    },
    {
      status: 'queued',
      title: 'Roadmap generated',
      detail: '12-week growth plan preparing'
    }
  ];

  features = [
    {
      icon: 'github',
      title: 'GitHub Analysis',
      description: 'Analyze repositories, contribution patterns, and code quality signals.'
    },
    {
      icon: 'file',
      title: 'Resume Intelligence',
      description: 'AI parsing extracts skills, experience, and project impact fast.'
    },
    {
      icon: 'target',
      title: 'Skill Gap Detection',
      description: 'Compare your skills against industry standards and role benchmarks.'
    },
    {
      icon: 'lightbulb',
      title: 'AI Career Recommendations',
      description: 'Personalized roadmaps, project ideas, and role-fit guidance.'
    },
    {
      icon: 'book',
      title: 'Learning Resources',
      description: 'Curated resources and courses aligned to your growth plan.'
    },
    {
      icon: 'activity',
      title: 'Progress Tracking',
      description: 'Track milestones, measure progress, and celebrate wins.'
    }
  ];

  careerStacks = [
    { icon: 'frontend', title: 'Frontend', description: 'React, Angular, Vue' },
    { icon: 'backend', title: 'Backend', description: 'Node, Java, Go' },
    { icon: 'ai', title: 'AI/ML', description: 'LLMs, Python, MLOps' },
    { icon: 'fullstack', title: 'Full Stack', description: 'Product and platform skills' },
    { icon: 'devops', title: 'DevOps', description: 'CI/CD, cloud, IaC' },
    { icon: 'mobile', title: 'Mobile', description: 'iOS, Android, Flutter' }
  ];

  steps = [
    {
      number: '01',
      title: 'Connect GitHub',
      description: 'Link your GitHub profile to analyze repositories, commits, and contribution history.'
    },
    {
      number: '02',
      title: 'Upload Resume',
      description: 'Drop your resume for instant AI-powered skill extraction and analysis.'
    },
    {
      number: '03',
      title: 'Get Career Insights',
      description: 'Receive your Developer Readiness Score and personalized growth recommendations.'
    }
  ];

  testimonials = [
    {
      quote: "DevInsight AI helped me identify critical skill gaps before my job hunt. I landed my dream role at Stripe within 3 months of using the platform.",
      author: "Sarah Chen",
      role: "Senior Frontend Engineer @ Stripe",
      initials: "SC",
      color: "#8B5CF6"
    },
    {
      quote: "The GitHub analysis is incredibly detailed. It showed me patterns in my code that I never realized, and the AI recommendations were spot on.",
      author: "Marcus Rodriguez",
      role: "Full Stack Developer @ Vercel",
      initials: "MR",
      color: "#6366F1"
    },
    {
      quote: "The resume intelligence feature is a game-changer. It parsed my resume better than any recruiter tool I've used and gave actionable suggestions.",
      author: "Priya Patel",
      role: "Backend Engineer @ Uber",
      initials: "PP",
      color: "#22C55E"
    }
  ];

  getIcon(name: string): string {
    const icons: { [key: string]: string } = {
      github: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
      </svg>`,
      file: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
      </svg>`,
      target: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="6"></circle>
        <circle cx="12" cy="12" r="2"></circle>
      </svg>`,
      lightbulb: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>`,
      sparkles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z"></path>
      </svg>`,
      award: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="8" r="5"></circle>
        <path d="M8.5 13.5L7 22l5-3 5 3-1.5-8.5"></path>
      </svg>`,
      rank: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 4h8v3a4 4 0 0 1-8 0V4z"></path>
        <path d="M6 4H4v2a4 4 0 0 0 4 4"></path>
        <path d="M18 4h2v2a4 4 0 0 1-4 4"></path>
        <path d="M12 14v6"></path>
        <path d="M8 20h8"></path>
      </svg>`,
      'shield-check': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"></path>
        <polyline points="9 12 11 14 15 10"></polyline>
      </svg>`,
      'file-check': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <polyline points="9 14 11 16 15 12"></polyline>
      </svg>`,
      users: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>`,
      database: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
      </svg>`,
      'trending-up': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline>
        <polyline points="17 6 23 6 23 12"></polyline>
      </svg>`,
      briefcase: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
      </svg>`,
      chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 3v18h18"></path>
        <rect x="7" y="10" width="3" height="7"></rect>
        <rect x="12" y="6" width="3" height="11"></rect>
        <rect x="17" y="13" width="3" height="4"></rect>
      </svg>`,
      book: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 0-4 4z"></path>
        <path d="M4 4v16"></path>
      </svg>`,
      activity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 12 7 12 10 5 14 19 17 12 21 12"></polyline>
      </svg>`,
      frontend: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="4" width="18" height="12" rx="2"></rect>
        <line x1="8" y1="20" x2="16" y2="20"></line>
        <line x1="12" y1="16" x2="12" y2="20"></line>
      </svg>`,
      backend: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="4" y="3" width="16" height="6" rx="2"></rect>
        <rect x="4" y="11" width="16" height="6" rx="2"></rect>
        <line x1="8" y1="6" x2="8.01" y2="6"></line>
        <line x1="8" y1="14" x2="8.01" y2="14"></line>
      </svg>`,
      ai: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="8" y="8" width="8" height="8" rx="2"></rect>
        <path d="M12 2v4"></path>
        <path d="M12 18v4"></path>
        <path d="M2 12h4"></path>
        <path d="M18 12h4"></path>
        <path d="M5 5l3 3"></path>
        <path d="M16 16l3 3"></path>
        <path d="M5 19l3-3"></path>
        <path d="M16 8l3-3"></path>
      </svg>`,
      fullstack: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2l9 4.5-9 4.5-9-4.5L12 2z"></path>
        <path d="M3 12l9 4.5 9-4.5"></path>
        <path d="M3 17l9 4.5 9-4.5"></path>
      </svg>`,
      devops: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.5 9a9 9 0 0 1 14-3.5L23 10"></path>
        <path d="M20.5 15a9 9 0 0 1-14 3.5L1 14"></path>
      </svg>`,
      mobile: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="7" y="2" width="10" height="20" rx="2"></rect>
        <line x1="11" y1="18" x2="13" y2="18"></line>
      </svg>`
    };
    return icons[name] || '';
  }

  codeSnippet = `<span class="keyword">public</span> <span class="keyword">abstract</span> <span class="keyword">class</span> <span class="type">VisualTemperature</span>
{
    <span class="keyword">private</span> <span class="keyword">void</span> <span class="function">Start</span>() {

        gameObject.<span class="function">GetComponent&lt;Renderer&gt;</span>().material.color = VisualTemperature.<span class="function">Evaluate</span>(0f);

        <span class="keyword">var</span> baseControlVar = GameObject.<span class="function">FindWithTag</span>(<span class="string">"GameController"</span>);
        temperature = baseControlVar.<span class="function">GetComponent&lt;GameController&gt;</span>().StartingTemperature;
        sunroundingsTemperature = baseControlVar.<span class="function">GetComponent&lt;GameController&gt;</span>().SunroudingTemperature;

        <span class="comment">// getting the amount of rays needed to calculate the heating factor</span>
        rayAmount = GameObject.<span class="function">Find</span>(<span class="string">"PhysicsFiles"</span>).<span class="function">GetComponent&lt;Physics&gt;</span>().RayAmount;
        <span class="function">print</span>(<span class="string">"RayAmount: "</span> + rayAmount);
    }
    <span class="keyword">private</span> <span class="keyword">void</span> <span class="function">Update</span>() {

        <span class="function">SetArray</span>();
        <span class="function">AdaptTemperature</span>();
    }
    <span class="keyword">private</span> <span class="keyword">void</span> <span class="function">ColorUp</span>() {

        gameObject.<span class="function">GetComponent&lt;Renderer&gt;</span>().material.color = VisualTemperature.<span class="function">Evaluate</span>(temperature / maxTemperature);
    }
}`;

  quoted(text: string): string {
    return `\u201C${text}\u201D`;
  }

  getAvatarStyle(color: string): { [key: string]: string } {
    return { backgroundColor: color + '20', color: color };
  }

  ngAfterViewInit(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.initRevealObserver();
    this.initCounterObserver();
  }

  ngOnDestroy(): void {
    this.revealObserver?.disconnect();
    this.counterObserver?.disconnect();
  }

  private initRevealObserver(): void {
    const elements = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
    if (!elements.length) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      elements.forEach((el) => el.classList.add('in-view'));
      return;
    }

    this.revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
            this.revealObserver?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' }
    );

    elements.forEach((el) => this.revealObserver?.observe(el));
  }

  private initCounterObserver(): void {
    const counters = Array.from(document.querySelectorAll<HTMLElement>('[data-count]'));
    if (!counters.length) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      counters.forEach((el) => this.animateCount(el));
      return;
    }

    this.counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.animateCount(entry.target as HTMLElement);
            this.counterObserver?.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );

    counters.forEach((el) => this.counterObserver?.observe(el));
  }

  private animateCount(element: HTMLElement): void {
    const target = Number(element.dataset['count'] || '0');
    const duration = Number(element.dataset['duration'] || '1400');
    const prefix = element.dataset['prefix'] || '';
    const suffix = element.dataset['suffix'] || '';
    const decimals = Number(element.dataset['decimals'] || '0');
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = target * eased;
      element.textContent = `${prefix}${value.toFixed(decimals)}${suffix}`;

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    };

    requestAnimationFrame(tick);
  }
}
