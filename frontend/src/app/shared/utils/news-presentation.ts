import { NewsSkillEvidence, NewsSkillEvidenceStatus } from '../models/news.model';

export const NEWS_SKILL_EVIDENCE_LABELS: Record<NewsSkillEvidenceStatus, string> = {
  DEMONSTRATED: 'Demonstrated implementation',
  PARTIAL: 'Partial evidence · technical metadata only',
  CLAIMED_ONLY: 'Claimed only · not demonstrated',
  NOT_EVIDENCED: 'Not evidenced · does not imply inability',
  UNKNOWN: 'Unknown · insufficient evidence',
};

/** Never infer evidence from skill names, ranking or learning recommendations. */
export function normalizeSkillEvidence(value: unknown): NewsSkillEvidence[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((skill) => skill && typeof skill.name === 'string' && skill.name.trim())
    .slice(0, 100)
    .map((skill) => ({
      ...skill,
      status: Object.hasOwn(NEWS_SKILL_EVIDENCE_LABELS, skill.status) ? skill.status : 'UNKNOWN',
    }));
}

/** News metadata is displayed only when supplied by the API. */
export function safeNewsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      host.endsWith('.') ||
      /\.(local|localhost|internal)$/.test(host) ||
      /^[\d.]+$/.test(host) ||
      host.includes(':') ||
      host.startsWith('[')
    )
      return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function reportedNumber(value: unknown, maximum = Infinity): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

export function newsDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

export function retryDeadline(
  value: string | null,
  now = Date.now(),
  fallbackSeconds = 60,
): number {
  if (value !== null && value.trim()) {
    const seconds = Number(value);
    const deadline = Number.isFinite(seconds)
      ? now + Math.max(0, seconds) * 1000
      : Date.parse(value);
    if (Number.isFinite(deadline)) return Math.max(now, deadline);
  }
  return now + fallbackSeconds * 1000;
}
