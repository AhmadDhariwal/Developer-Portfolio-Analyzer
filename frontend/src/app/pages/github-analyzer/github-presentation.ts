import { LanguageDistribution, Repository } from '../../shared/services/github.service';
export const LANG_COLOURS = [
  '#6366F1',
  '#06B6D4',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#3B82F6',
  '#64748B',
  '#14B8A6',
  '#F97316',
];
export class GithubPresentation {
  repositoryScore(repo: Repository): number {
    return Number(repo.qualityScore ?? repo.activityScore ?? 0);
  }

  repositoryTechnologies(repo: Repository): string[] {
    return Array.from(
      new Set((repo.technologies || []).map((tech) => String(tech || '').trim()).filter(Boolean)),
    ).slice(0, 3);
  }

  getLangColour(index: number): string {
    return LANG_COLOURS[index % LANG_COLOURS.length];
  }

  getScoreClass(score: number): string {
    if (score >= 80) return 'score-high';
    if (score >= 50) return 'score-mid';
    return 'score-low';
  }

  getScoreBarWidth(score: number): string {
    return `${Math.min(Math.max(Number(score || 0), 0), 100)}%`;
  }

  formatNumber(value: number | undefined | null): string {
    if (value === null || value === undefined) return 'Unavailable';
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Unavailable';
    if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
    return n.toString();
  }

  formatDateTime(value: string | Date | null | undefined): string {
    if (!value) return 'Not analyzed yet';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not analyzed yet';
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected sortedLanguages(languages: LanguageDistribution[]): LanguageDistribution[] {
    return [...languages]
      .filter((item) => Boolean(item?.language) && Number.isFinite(Number(item.percentage)))
      .sort(
        (a, b) =>
          Number(b.percentage) - Number(a.percentage) || a.language.localeCompare(b.language),
      );
  }
}
