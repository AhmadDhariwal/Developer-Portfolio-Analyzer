import { Component } from '@angular/core';
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
export class LandingPageComponent {
  stats = [
    { value: '50K+', label: 'Developers Analyzed', icon: 'users' },
    { value: '2M+', label: 'Skills Extracted', icon: 'database' },
    { value: '18K+', label: 'Career Surprises', icon: 'trending-up' },
    { value: '+34%', label: 'Avg Salary Bump', icon: 'briefcase' }
  ];

  features = [
    {
      icon: 'github',
      title: 'GitHub Analysis',
      description: 'Deep dive into your repositories, contribution patterns, language distribution, and code quality metrics.'
    },
    {
      icon: 'file',
      title: 'Resume Intelligence',
      description: 'AI-powered resume parsing extracts skills, experience, and projects to give you actionable feedback.'
    },
    {
      icon: 'target',
      title: 'Skill Gap Detection',
      description: 'Compare your current skills against industry standards and quickly identify what you need to learn.'
    },
    {
      icon: 'lightbulb',
      title: 'AI Career Recommendations',
      description: 'Personalized career roadmaps, project suggestions, and salary range recommendations powered by AI.'
    }
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
      description: 'Drop and drop your resume for instant AI-powered skill extraction and analysis.'
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
}
