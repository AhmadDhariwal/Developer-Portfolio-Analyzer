const aiService = require('./aiservice');
const { getResumeGuidePrompt } = require('../prompts/resumeGuidePrompt');

const clampScore = (value) => {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return null;
	return Math.max(0, Math.min(100, Math.round(numeric)));
};

const toStringArray = (value) => {
	if (!Array.isArray(value)) return [];
	return value.map((item) => String(item || '').trim()).filter(Boolean);
};

const uniqueStrings = (list) => {
	const seen = new Set();
	const out = [];
	for (const item of list) {
		const text = String(item || '').trim();
		const key = text.toLowerCase();
		if (!text || seen.has(key)) continue;
		seen.add(key);
		out.push(text);
	}
	return out;
};

const mapSkillsToArray = (skills) => {
	if (!skills) return [];

	if (skills instanceof Map) {
		return Array.from(skills.values())
			.flat()
			.map((skill) => String(skill || '').trim())
			.filter(Boolean);
	}

	if (typeof skills === 'object') {
		return Object.values(skills)
			.flat()
			.map((skill) => String(skill || '').trim())
			.filter(Boolean);
	}

	return [];
};

const statusFromScore = (score) => {
	if (score === null) return 'Needs Improvement';
	if (score >= 85) return 'Excellent';
	if (score >= 70) return 'Solid';
	if (score >= 50) return 'Needs Improvement';
	return 'Needs Urgent Work';
};

const priorityFromAts = (atsScore) => {
	const score = clampScore(atsScore);
	if (score === null) return 'Moderate';
	if (score < 50) return 'Critical';
	if (score < 70) return 'High';
	if (score < 85) return 'Moderate';
	return 'Strong';
};

const overallGradeFromAts = (atsScore) => {
	const score = clampScore(atsScore);
	if (score === null) return 'C';
	if (score >= 90) return 'A';
	if (score >= 75) return 'B';
	if (score >= 60) return 'C';
	return 'D';
};

const buildFallbackGuide = (analysis) => {
	const atsScore = clampScore(analysis.atsScore) || 0;
	const keywordDensity = clampScore(analysis.keywordDensity) || 0;
	const formatScore = clampScore(analysis.formatScore) || 0;
	const contentQuality = clampScore(analysis.contentQuality) || 0;
	const experienceLevel = String(analysis.experienceLevel || 'Junior');
	const suggestions = Array.isArray(analysis.suggestions) ? analysis.suggestions : [];
	const achievements = toStringArray(analysis.keyAchievements);

	const quickSuggestionSteps = suggestions.slice(0, 3).map((item) => {
		const title = String(item?.title || 'Improve this section').trim();
		const detail = String(item?.description || 'Apply focused edits for stronger outcomes.').trim();
		return `${title}: ${detail}`;
	});

	const skillsInResume = mapSkillsToArray(analysis.skills);
	const baselineSkillsToAdd = [
		'System Design',
		'CI/CD',
		'Cloud Deployment',
		'Testing Strategy',
		'API Security',
		'Performance Optimization',
		'Observability',
		'Data Modeling'
	];

	const roleSkills = experienceLevel === 'Senior'
		? ['Architecture Leadership', 'Mentoring']
		: ['Debugging', 'Git Collaboration'];

	const skillsToAdd = uniqueStrings([...baselineSkillsToAdd, ...roleSkills])
		.slice(0, 10)
		.map((skill, index) => ({
			skill,
			reason: `Strengthens interview readiness and day-to-day performance for ${experienceLevel.toLowerCase()} engineers.`,
			priority: index < 5 ? 'Must Have' : 'Nice to Have'
		}));

	const atsKeywords = uniqueStrings([
		...skillsInResume,
		'REST API',
		'Microservices',
		'Agile',
		'Scalable Systems',
		'Code Review',
		'Unit Testing',
		'Integration Testing',
		'Problem Solving',
		'Cross Functional Collaboration',
		'Docker',
		'Kubernetes',
		'Node.js',
		'TypeScript',
		'Angular',
		'MongoDB',
		'SQL',
		'AWS',
		'Azure'
	]).slice(0, 18);

	const sections = [
		{
			title: 'ATS and Keyword Optimization',
			score: keywordDensity,
			status: statusFromScore(keywordDensity),
			problem: 'Your keyword targeting determines whether recruiters and ATS systems discover your resume. Missing intent-aligned terms can suppress visibility even when your experience is strong.',
			actionSteps: [
				'Mirror exact role vocabulary from three target job postings.',
				'Add missing skills to project bullets with context and outcomes.',
				'Use consistent naming for tools and technologies across sections.'
			],
			example: 'Before: Built backend APIs. After: Built and documented Node.js REST APIs with JWT auth, reducing response latency by 28%.',
			impact: 'High',
			timeToFix: '1-2 hrs'
		},
		{
			title: 'Professional Summary',
			score: contentQuality,
			status: statusFromScore(contentQuality),
			problem: 'A weak summary does not communicate your level, specialization, and outcomes quickly enough for first-pass screening.',
			actionSteps: [
				'Start with years of experience and primary stack.',
				'Include one quantified business impact in the first two lines.',
				'Align summary language to the exact role family you are targeting.'
			],
			example: `Results-driven ${experienceLevel.toLowerCase()} engineer with ${analysis.experienceYears || 0}+ years building scalable web applications in Node.js and Angular, delivering features that improved user retention by 18%.`,
			impact: 'High',
			timeToFix: '30 min'
		},
		{
			title: 'Work Experience and Achievements',
			score: atsScore,
			status: statusFromScore(atsScore),
			problem: 'Experience bullets should prove ownership and measurable outcomes. Generic responsibilities weaken competitiveness.',
			actionSteps: [
				'Rewrite each bullet with action, context, and measurable outcome.',
				'Prioritize results tied to performance, revenue, reliability, or time savings.',
				'Keep each bullet concise and avoid repeating weak verbs.'
			],
			example: 'Before: Worked on dashboard features. After: Delivered analytics modules that reduced report generation time from 45s to 12s for 5k weekly users.',
			impact: 'High',
			timeToFix: '1-2 hrs'
		},
		{
			title: 'Formatting and Readability',
			score: formatScore,
			status: statusFromScore(formatScore),
			problem: 'Formatting consistency affects ATS parsing and recruiter scan speed. Dense layouts and inconsistent structure reduce clarity.',
			actionSteps: [
				'Use standard section order and clear headings.',
				'Maintain uniform bullet style, tense, and punctuation.',
				'Remove low-impact lines to improve scanability.'
			],
			example: 'Use section headers: Summary, Skills, Experience, Projects, Education, Certifications.',
			impact: 'Medium',
			timeToFix: '30 min'
		},
		{
			title: 'Skills Positioning',
			score: keywordDensity,
			status: statusFromScore(keywordDensity),
			problem: 'Skills should be grouped by relevance and validated with project evidence to improve trust and ranking.',
			actionSteps: [
				'Split skills into core, supporting, and tooling categories.',
				'Show one project bullet proving each core skill.',
				'Remove outdated or low-confidence skills to reduce noise.'
			],
			example: 'Core: Node.js, Angular, MongoDB, Docker. Supporting: Redis, Nginx, Prometheus, Grafana.',
			impact: 'Medium',
			timeToFix: '30 min'
		}
	];

	if (quickSuggestionSteps.length) {
		sections[2].actionSteps = uniqueStrings([...sections[2].actionSteps, ...quickSuggestionSteps]).slice(0, 4);
	}

	return {
		executiveSummary: `Your resume currently scores ${atsScore}/100 on ATS readiness. The biggest gains will come from clearer quantified achievements, tighter keyword alignment, and cleaner section structure. This guide gives you a practical month-long plan to reach interview-ready quality.`,
		overallGrade: overallGradeFromAts(atsScore),
		priorityLevel: priorityFromAts(atsScore),
		headline: atsScore < 70
			? 'High-impact edits this week can significantly increase your interview callbacks.'
			: 'You are close to a strong resume; focused optimization will improve conversion.',
		sections,
		skillsToAdd,
		quickWins: [
			{ action: 'Rewrite top three experience bullets using measurable outcomes.', timeEstimate: '15 min', impact: 'High' },
			{ action: 'Add twelve role-specific ATS keywords across summary and projects.', timeEstimate: '15 min', impact: 'High' },
			{ action: 'Normalize section headers and bullet formatting.', timeEstimate: '10 min', impact: 'Medium' },
			{ action: 'Replace weak verbs with high-impact action verbs.', timeEstimate: '10 min', impact: 'Medium' },
			{ action: 'Remove redundant lines to improve readability.', timeEstimate: '15 min', impact: 'Medium' }
		],
		thirtyDayPlan: [
			{ week: 1, focus: 'Foundation and targeting', tasks: ['Define target roles and collect five job descriptions', 'Rewrite summary for role alignment', 'Create ATS keyword bank'] },
			{ week: 2, focus: 'Experience rewrite', tasks: ['Refactor bullets with quantified impact', 'Highlight ownership and architecture decisions', 'Add context for technical tradeoffs'] },
			{ week: 3, focus: 'Skills and project proof', tasks: ['Reorganize skills by priority', 'Add evidence bullets for core tools', 'Trim outdated technologies'] },
			{ week: 4, focus: 'Final polish and validation', tasks: ['Run final ATS check', 'Peer review for readability', 'Publish tailored versions for target job families'] }
		],
		atsKeywords,
		powerVerbs: [
			'Achieved', 'Optimized', 'Delivered', 'Engineered', 'Led',
			'Scaled', 'Automated', 'Designed', 'Implemented', 'Improved',
			'Reduced', 'Accelerated', 'Refactored', 'Spearheaded', 'Orchestrated'
		],
		industryInsight: 'Hiring teams increasingly prioritize outcomes, ownership, and production-grade engineering practices over long skill lists. Resumes that combine clear metrics with stack-specific keywords consistently outperform generic profiles.',
		finalNote: achievements.length
			? 'You already have meaningful achievements. Frame them with stronger metrics and role alignment, and your resume can become significantly more competitive.'
			: 'Once your achievements are quantified and keyword alignment is improved, your resume will present a much stronger interview case.'
	};
};

const normalizeSection = (section, index, fallbackSection) => {
	const safe = section && typeof section === 'object' ? section : {};
	const fallback = fallbackSection || {};

	let actionSteps = toStringArray(safe.actionSteps).slice(0, 5);
	if (!actionSteps.length) {
		actionSteps = toStringArray(fallback.actionSteps).slice(0, 5);
	}

	const impactCandidate = String(safe.impact || '').trim();
	const fallbackImpact = String(fallback.impact || 'Medium').trim();
	let impact = 'Medium';
	if (['High', 'Medium', 'Low'].includes(impactCandidate)) {
		impact = impactCandidate;
	} else if (['High', 'Medium', 'Low'].includes(fallbackImpact)) {
		impact = fallbackImpact;
	}

	return {
		title: String(safe.title || fallback.title || `Section ${index + 1}`).trim(),
		score: clampScore(safe.score),
		status: String(safe.status || fallback.status || 'Needs Improvement').trim(),
		problem: String(safe.problem || fallback.problem || '').trim(),
		actionSteps,
		example: String(safe.example || fallback.example || '').trim(),
		impact,
		timeToFix: String(safe.timeToFix || fallback.timeToFix || '30 min').trim()
	};
};

const normalizeSections = (safe, fallback) => {
	const fallbackSections = Array.isArray(fallback.sections) ? fallback.sections : [];
	const incomingSections = Array.isArray(safe.sections) ? safe.sections : [];
	let sections = incomingSections.map((item, index) => normalizeSection(item, index, fallbackSections[index] || fallbackSections[0]));
	if (sections.length < 5) {
		sections = sections.concat(fallbackSections.slice(0, 5 - sections.length));
	}
	return sections.slice(0, 7);
};

const normalizeSkillsToAdd = (safe, fallback) => {
	const fallbackSkills = Array.isArray(fallback.skillsToAdd) ? fallback.skillsToAdd : [];
	const incomingSkills = Array.isArray(safe.skillsToAdd) ? safe.skillsToAdd : [];

	let skills = incomingSkills.map((item, index) => {
		const fallbackItem = fallbackSkills[index] || fallbackSkills[0] || {};
		const priority = String(item?.priority || fallbackItem.priority || 'Must Have').trim();
		return {
			skill: String(item?.skill || fallbackItem.skill || '').trim(),
			reason: String(item?.reason || fallbackItem.reason || '').trim(),
			priority: priority === 'Nice to Have' ? 'Nice to Have' : 'Must Have'
		};
	}).filter((item) => item.skill);

	if (skills.length < 6) {
		skills = skills.concat(fallbackSkills.slice(0, 6 - skills.length));
	}

	const skillMap = new Map();
	for (const item of skills) {
		const key = item.skill.toLowerCase();
		if (!skillMap.has(key)) skillMap.set(key, item);
	}

	return Array.from(skillMap.values()).slice(0, 10);
};

const normalizeQuickWins = (safe, fallback) => {
	const fallbackQuickWins = Array.isArray(fallback.quickWins) ? fallback.quickWins : [];
	const incomingQuickWins = Array.isArray(safe.quickWins) ? safe.quickWins : [];

	let quickWins = incomingQuickWins.map((item, index) => {
		const fallbackItem = fallbackQuickWins[index] || fallbackQuickWins[0] || {};
		const impact = String(item?.impact || fallbackItem.impact || 'Medium').trim();
		return {
			action: String(item?.action || fallbackItem.action || '').trim(),
			timeEstimate: String(item?.timeEstimate || fallbackItem.timeEstimate || '15 min').trim(),
			impact: impact === 'High' ? 'High' : 'Medium'
		};
	}).filter((item) => item.action);

	if (quickWins.length < 4) {
		quickWins = quickWins.concat(fallbackQuickWins.slice(0, 4 - quickWins.length));
	}

	return quickWins.slice(0, 6);
};

const normalizeThirtyDayPlan = (safe, fallback) => {
	const fallbackPlan = Array.isArray(fallback.thirtyDayPlan) ? fallback.thirtyDayPlan : [];
	const incomingPlan = Array.isArray(safe.thirtyDayPlan) ? safe.thirtyDayPlan : [];

	let plan = incomingPlan.map((item, index) => {
		const fallbackItem = fallbackPlan[index] || fallbackPlan[index % Math.max(fallbackPlan.length, 1)] || { week: index + 1, focus: 'Focus area', tasks: ['Task 1', 'Task 2', 'Task 3'] };
		let tasks = toStringArray(item?.tasks).slice(0, 4);
		if (!tasks.length) tasks = toStringArray(fallbackItem.tasks).slice(0, 4);
		return {
			week: Number(item?.week) || fallbackItem.week || index + 1,
			focus: String(item?.focus || fallbackItem.focus || 'Focus area').trim(),
			tasks
		};
	});

	if (plan.length < 4) {
		plan = plan.concat(fallbackPlan.slice(0, 4 - plan.length));
	}

	return plan.slice(0, 4).map((item, index) => ({ ...item, week: index + 1 }));
};

const normalizeChipCollection = (safeValues, fallbackValues, min, max) => {
	const collection = uniqueStrings([...toStringArray(safeValues), ...toStringArray(fallbackValues)]).slice(0, max);
	const fallbackList = toStringArray(fallbackValues);
	while (collection.length < min && fallbackList.length) {
		collection.push(fallbackList[collection.length % fallbackList.length]);
	}
	return collection;
};

const normalizeGuide = (candidate, fallback) => {
	const safe = candidate && typeof candidate === 'object' ? candidate : {};
	const sections = normalizeSections(safe, fallback);
	const skillsToAdd = normalizeSkillsToAdd(safe, fallback);
	const quickWins = normalizeQuickWins(safe, fallback);
	const thirtyDayPlan = normalizeThirtyDayPlan(safe, fallback);
	const atsKeywords = normalizeChipCollection(safe.atsKeywords, fallback.atsKeywords, 12, 18);
	const powerVerbs = normalizeChipCollection(safe.powerVerbs, fallback.powerVerbs, 10, 15);

	const gradeCandidate = String(safe.overallGrade || '').trim();
	const priorityCandidate = String(safe.priorityLevel || '').trim();

	return {
		executiveSummary: String(safe.executiveSummary || fallback.executiveSummary || '').trim(),
		overallGrade: ['A', 'B', 'C', 'D'].includes(gradeCandidate) ? gradeCandidate : fallback.overallGrade,
		priorityLevel: ['Critical', 'High', 'Moderate', 'Strong'].includes(priorityCandidate) ? priorityCandidate : fallback.priorityLevel,
		headline: String(safe.headline || fallback.headline || '').trim(),
		sections,
		skillsToAdd,
		quickWins,
		thirtyDayPlan,
		atsKeywords,
		powerVerbs,
		industryInsight: String(safe.industryInsight || fallback.industryInsight || '').trim(),
		finalNote: String(safe.finalNote || fallback.finalNote || '').trim()
	};
};

const escapeHtml = (value) => String(value || '')
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll("'", '&#39;');

const formatDate = (value) => {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return 'N/A';
	return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const sectionStatusClass = (status) => {
	const value = String(status || '').toLowerCase();
	if (value.includes('urgent')) return 'status-urgent';
	if (value.includes('improvement')) return 'status-improve';
	if (value.includes('excellent')) return 'status-excellent';
	return 'status-solid';
};

const scoreBadgeClass = (score) => {
	if (score === null) return 'score-badge score-mid';
	if (score >= 85) return 'score-badge score-high';
	if (score >= 65) return 'score-badge score-mid';
	return 'score-badge score-low';
};

const gradeClass = (grade) => {
	if (grade === 'A' || grade === 'B') return 'grade-strong';
	if (grade === 'C') return 'grade-mid';
	return 'grade-low';
};

const priorityClass = (priority) => {
	const safe = String(priority || '').toLowerCase();
	if (safe === 'critical') return 'priority-critical';
	if (safe === 'high') return 'priority-high';
	if (safe === 'strong') return 'priority-strong';
	return 'priority-moderate';
};

const renderList = (items) => items.map((item) => `<li>${escapeHtml(item)}</li>`).join('');

const renderGuideHtml = (guide, analysis) => {
	const existingSkills = mapSkillsToArray(analysis.skills).slice(0, 20);

	const kpis = [
		{ label: 'ATS Score', value: clampScore(analysis.atsScore), note: 'Overall screening strength' },
		{ label: 'Keyword Density', value: clampScore(analysis.keywordDensity), note: 'Role-term alignment' },
		{ label: 'Format Score', value: clampScore(analysis.formatScore), note: 'Readability and parser compatibility' },
		{ label: 'Content Quality', value: clampScore(analysis.contentQuality), note: 'Clarity and measurable impact' }
	];

	const kpisHtml = kpis.map((item) => {
		const value = item.value === null ? 'N/A' : `${item.value}%`;
		const meter = item.value === null ? 0 : item.value;
		return `
			<article class="kpi-card">
				<div class="kpi-top">
					<p class="kpi-label">${escapeHtml(item.label)}</p>
					<p class="kpi-value">${escapeHtml(value)}</p>
				</div>
				<div class="kpi-meter" role="img" aria-label="${escapeHtml(item.label)} ${escapeHtml(value)}">
					<span style="--value:${meter}%"></span>
				</div>
				<p class="kpi-note">${escapeHtml(item.note)}</p>
			</article>
		`;
	}).join('');

	const sectionsHtml = guide.sections.map((section, index) => `
		<article class="section-card">
			<div class="section-head">
				<div>
					<p class="section-number">0${index + 1}</p>
					<h3>${escapeHtml(section.title)}</h3>
				</div>
				<div class="section-badges">
					<span class="${scoreBadgeClass(section.score)}">${section.score === null ? 'N/A' : `${section.score}/100`}</span>
					<span class="status-pill ${sectionStatusClass(section.status)}">${escapeHtml(section.status)}</span>
				</div>
			</div>
			<p class="meta-line"><strong>Impact:</strong> ${escapeHtml(section.impact)} <span>•</span> <strong>Time:</strong> ${escapeHtml(section.timeToFix)}</p>
			<p class="problem">${escapeHtml(section.problem)}</p>
			<h4>Action Steps</h4>
			<ul>${renderList(section.actionSteps)}</ul>
			<div class="example-box">
				<strong>Example Rewrite</strong>
				<p>${escapeHtml(section.example)}</p>
			</div>
		</article>
	`).join('');

	const skillsHtml = guide.skillsToAdd.map((item) => `
		<li class="detail-item">
			<div class="detail-head">
				<strong>${escapeHtml(item.skill)}</strong>
				<span class="priority-tag">${escapeHtml(item.priority)}</span>
			</div>
			<p>${escapeHtml(item.reason)}</p>
		</li>
	`).join('');

	const quickWinsHtml = guide.quickWins.map((item) => `
		<li class="detail-item quick-win-item">
			<strong>${escapeHtml(item.action)}</strong>
			<span>${escapeHtml(item.timeEstimate)} • ${escapeHtml(item.impact)} impact</span>
		</li>
	`).join('');

	const planHtml = guide.thirtyDayPlan.map((item) => `
		<article class="plan-card">
			<div class="plan-head">
				<span class="week-pill">Week ${item.week}</span>
				<h4>${escapeHtml(item.focus)}</h4>
			</div>
			<ul>${renderList(item.tasks)}</ul>
		</article>
	`).join('');

	const keywordChips = guide.atsKeywords.map((keyword) => `<span class="chip">${escapeHtml(keyword)}</span>`).join('');
	const verbChips = guide.powerVerbs.map((verb) => `<span class="chip chip-verb">${escapeHtml(verb)}</span>`).join('');
	const existingSkillChips = existingSkills.map((skill) => `<span class="chip chip-skill">${escapeHtml(skill)}</span>`).join('');

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>Resume Improvement Guide</title>
	<style>
		:root {
			--bg: #061225;
			--bg-deep: #030a16;
			--panel: rgba(10, 25, 49, 0.84);
			--panel-soft: rgba(15, 35, 68, 0.75);
			--text: #eef4ff;
			--muted: #afbedf;
			--line: rgba(151, 186, 255, 0.26);
			--accent: #38c4ff;
			--accent-2: #3f7dff;
			--ok: #2fd591;
			--warn: #ffbc59;
			--bad: #ff738c;
			--radius-lg: 18px;
			--radius-md: 12px;
			--shadow: 0 16px 36px rgba(0, 0, 0, 0.34);
		}

		* { box-sizing: border-box; }

		body {
			margin: 0;
			font-family: Manrope, 'Segoe UI', Tahoma, sans-serif;
			color: var(--text);
			line-height: 1.6;
			background:
				radial-gradient(1000px circle at 8% -14%, rgba(63, 125, 255, 0.34), transparent 47%),
				radial-gradient(900px circle at 92% -18%, rgba(56, 196, 255, 0.24), transparent 46%),
				linear-gradient(180deg, var(--bg), var(--bg-deep));
		}

		.page {
			width: min(1160px, 94vw);
			margin: 28px auto 56px;
			display: grid;
			gap: 18px;
		}

		.panel {
			background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent), var(--panel);
			border: 1px solid var(--line);
			border-radius: var(--radius-lg);
			padding: 20px;
			box-shadow: var(--shadow);
			backdrop-filter: blur(8px);
		}

		h1, h2, h3, h4 {
			margin: 0 0 9px;
			line-height: 1.3;
			font-family: 'Space Grotesk', Manrope, 'Segoe UI', Tahoma, sans-serif;
		}

		h1 { font-size: clamp(1.55rem, 2.1vw, 2.3rem); }
		h2 { font-size: clamp(1.18rem, 1.6vw, 1.45rem); }

		p { margin: 0 0 10px; color: var(--muted); }

		.hero {
			display: grid;
			grid-template-columns: 1.52fr 1fr;
			gap: 20px;
			position: relative;
			overflow: hidden;
		}

		.hero::after {
			content: '';
			position: absolute;
			right: -126px;
			bottom: -132px;
			width: 340px;
			height: 340px;
			border-radius: 50%;
			background: radial-gradient(circle, rgba(56, 196, 255, 0.2), transparent 68%);
			pointer-events: none;
		}

		.hero-content,
		.kpi-grid {
			position: relative;
			z-index: 1;
		}

		.header-badges {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-bottom: 10px;
		}

		.badge {
			display: inline-flex;
			align-items: center;
			padding: 5px 11px;
			border-radius: 999px;
			font-size: 0.82rem;
			font-weight: 700;
			letter-spacing: 0.01em;
			border: 1px solid transparent;
		}

		.grade-strong {
			background: rgba(47, 213, 145, 0.2);
			border-color: rgba(47, 213, 145, 0.44);
			color: #d6ffe8;
		}

		.grade-mid {
			background: rgba(255, 188, 89, 0.2);
			border-color: rgba(255, 188, 89, 0.44);
			color: #ffe8c2;
		}

		.grade-low {
			background: rgba(255, 115, 140, 0.2);
			border-color: rgba(255, 115, 140, 0.46);
			color: #ffd7e0;
		}

		.priority-critical,
		.priority-high {
			background: rgba(255, 115, 140, 0.2);
			border-color: rgba(255, 115, 140, 0.44);
			color: #ffd7e0;
		}

		.priority-moderate {
			background: rgba(255, 188, 89, 0.2);
			border-color: rgba(255, 188, 89, 0.44);
			color: #ffe6bc;
		}

		.priority-strong {
			background: rgba(47, 213, 145, 0.2);
			border-color: rgba(47, 213, 145, 0.44);
			color: #d8ffe9;
		}

		.hero-meta {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin: 10px 0 13px;
		}

		.hero-meta span {
			padding: 5px 10px;
			border-radius: 999px;
			border: 1px solid var(--line);
			font-size: 0.81rem;
			background: rgba(255, 255, 255, 0.06);
			color: #dce8ff;
		}

		.kpi-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 12px;
		}

		.kpi-card {
			padding: 12px;
			border-radius: var(--radius-md);
			border: 1px solid var(--line);
			background: linear-gradient(180deg, rgba(255, 255, 255, 0.09), transparent), var(--panel-soft);
		}

		.kpi-top {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 8px;
		}

		.kpi-label {
			margin: 0;
			font-size: 0.8rem;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: #c7d8fb;
		}

		.kpi-value {
			margin: 0;
			font-size: 1.36rem;
			font-weight: 800;
			color: #ffffff;
		}

		.kpi-meter {
			height: 8px;
			margin: 10px 0 8px;
			background: rgba(255, 255, 255, 0.12);
			border-radius: 999px;
			overflow: hidden;
		}

		.kpi-meter span {
			display: block;
			height: 100%;
			width: var(--value);
			background: linear-gradient(90deg, var(--accent), var(--accent-2));
			border-radius: 999px;
		}

		.kpi-note {
			margin: 0;
			font-size: 0.79rem;
			color: #bfd0f7;
		}

		.section-headline {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			margin-bottom: 10px;
		}

		.section-subtitle {
			margin: 0;
			font-size: 0.92rem;
			color: #bfd0f7;
		}

		.section-grid {
			display: grid;
			gap: 14px;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.section-card {
			border: 1px solid var(--line);
			border-radius: 14px;
			padding: 15px;
			background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
			transition: transform 200ms ease, border-color 200ms ease;
		}

		.section-card:hover {
			transform: translateY(-2px);
			border-color: rgba(149, 194, 255, 0.48);
		}

		.section-head {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			gap: 10px;
			margin-bottom: 8px;
		}

		.section-number {
			margin: 0 0 6px;
			font-size: 0.73rem;
			letter-spacing: 0.09em;
			font-weight: 700;
			color: #9dc5ff;
		}

		.section-badges {
			display: flex;
			gap: 6px;
			flex-wrap: wrap;
			justify-content: flex-end;
		}

		.score-badge,
		.status-pill {
			padding: 5px 10px;
			border-radius: 999px;
			font-size: 0.78rem;
			font-weight: 700;
			border: 1px solid transparent;
			white-space: nowrap;
		}

		.score-high {
			background: rgba(47, 213, 145, 0.2);
			border-color: rgba(47, 213, 145, 0.42);
			color: #99ffd2;
		}

		.score-mid {
			background: rgba(255, 188, 89, 0.2);
			border-color: rgba(255, 188, 89, 0.42);
			color: #ffd8a0;
		}

		.score-low {
			background: rgba(255, 115, 140, 0.2);
			border-color: rgba(255, 115, 140, 0.42);
			color: #ffbdcb;
		}

		.status-urgent {
			background: rgba(255, 115, 140, 0.2);
			border-color: rgba(255, 115, 140, 0.42);
			color: #ffd0da;
		}

		.status-improve {
			background: rgba(255, 188, 89, 0.2);
			border-color: rgba(255, 188, 89, 0.42);
			color: #ffe0af;
		}

		.status-solid {
			background: rgba(63, 125, 255, 0.2);
			border-color: rgba(63, 125, 255, 0.42);
			color: #d5e3ff;
		}

		.status-excellent {
			background: rgba(47, 213, 145, 0.2);
			border-color: rgba(47, 213, 145, 0.42);
			color: #c8ffdf;
		}

		.meta-line {
			font-size: 0.9rem;
			color: #c2d4f9;
		}

		.meta-line span {
			opacity: 0.72;
			margin: 0 6px;
		}

		.problem {
			margin-bottom: 8px;
		}

		ul {
			margin: 8px 0 0;
			padding-left: 18px;
			color: var(--text);
		}

		li {
			margin-bottom: 7px;
		}

		.example-box {
			margin-top: 10px;
			padding: 11px 12px;
			border-left: 3px solid var(--accent);
			background: rgba(56, 196, 255, 0.12);
			border-radius: 9px;
		}

		.example-box p {
			margin: 4px 0 0;
			color: #d9ebff;
		}

		.two-col {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 14px;
		}

		.split-card {
			background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(255, 255, 255, 0.02));
			border: 1px solid var(--line);
			border-radius: 14px;
			padding: 14px;
		}

		.detail-list {
			list-style: none;
			padding: 0;
			margin: 0;
			display: grid;
			gap: 10px;
		}

		.detail-item {
			padding: 11px;
			border: 1px solid rgba(151, 186, 255, 0.22);
			border-radius: 10px;
			background: rgba(255, 255, 255, 0.03);
		}

		.detail-head {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			margin-bottom: 6px;
		}

		.detail-item p {
			margin: 0;
			font-size: 0.92rem;
		}

		.priority-tag {
			display: inline-block;
			padding: 3px 9px;
			border-radius: 999px;
			background: rgba(63, 125, 255, 0.23);
			border: 1px solid rgba(63, 125, 255, 0.38);
			font-size: 0.75rem;
			color: #dce8ff;
		}

		.quick-win-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
		}

		.quick-win-item span {
			font-size: 0.8rem;
			padding: 3px 8px;
			border-radius: 999px;
			background: rgba(56, 196, 255, 0.16);
			border: 1px solid rgba(56, 196, 255, 0.34);
			color: #d8eeff;
			white-space: nowrap;
		}

		.chips {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 8px;
		}

		.chip {
			border: 1px solid var(--line);
			background: rgba(63, 125, 255, 0.2);
			color: #e8f0ff;
			padding: 4px 10px;
			border-radius: 999px;
			font-size: 0.84rem;
		}

		.chip-verb { background: rgba(47, 213, 145, 0.16); }
		.chip-skill { background: rgba(255, 188, 89, 0.18); }

		.plan-grid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 12px;
		}

		.plan-card {
			border: 1px dashed rgba(151, 186, 255, 0.4);
			border-radius: 12px;
			padding: 13px;
			background: rgba(255, 255, 255, 0.03);
		}

		.plan-head {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 8px;
		}

		.week-pill {
			display: inline-flex;
			align-items: center;
			padding: 3px 8px;
			border-radius: 999px;
			font-size: 0.75rem;
			font-weight: 700;
			color: #e4f4ff;
			background: rgba(56, 196, 255, 0.19);
			border: 1px solid rgba(56, 196, 255, 0.36);
		}

		.final-note {
			font-size: 1.02rem;
			color: #f1f6ff;
			font-weight: 700;
		}

		@media (max-width: 980px) {
			.hero,
			.section-grid,
			.two-col,
			.plan-grid {
				grid-template-columns: 1fr;
			}
		}

		@media (max-width: 640px) {
			.page {
				width: min(1160px, 95vw);
				margin-top: 16px;
			}

			.panel {
				padding: 14px;
				border-radius: 14px;
			}

			.kpi-grid {
				grid-template-columns: 1fr;
			}

			.quick-win-item {
				flex-direction: column;
				align-items: flex-start;
			}
		}

		@media print {
			body {
				background: #ffffff;
				color: #141414;
			}

			.panel,
			.kpi-card,
			.section-card,
			.split-card,
			.plan-card {
				box-shadow: none;
				background: #ffffff;
				border-color: #d9d9d9;
			}

			p,
			.meta-line,
			.kpi-note {
				color: #444444;
			}
		}
	</style>
</head>
<body>
	<main class="page">
		<section class="panel hero">
			<div class="hero-content">
				<div class="header-badges">
					<span class="badge ${escapeHtml(gradeClass(guide.overallGrade))}">Grade ${escapeHtml(guide.overallGrade)}</span>
					<span class="badge ${escapeHtml(priorityClass(guide.priorityLevel))}">Priority ${escapeHtml(guide.priorityLevel)}</span>
				</div>
				<h1>Personalized Resume Improvement Guide</h1>
				<div class="hero-meta">
					<span>File: ${escapeHtml(analysis.fileName || 'resume.pdf')}</span>
					<span>Analyzed: ${escapeHtml(formatDate(analysis.analyzedAt || Date.now()))}</span>
					<span>Experience: ${escapeHtml(analysis.experienceLevel)} ${escapeHtml(String(analysis.experienceYears || 0))} yrs</span>
				</div>
				<h3>${escapeHtml(guide.headline)}</h3>
				<p>${escapeHtml(guide.executiveSummary)}</p>
			</div>
			<div class="kpi-grid">${kpisHtml}</div>
		</section>

		<section class="panel">
			<div class="section-headline">
				<h2>High-Impact Improvement Sections</h2>
				<p class="section-subtitle">Prioritize these first for faster interview conversion gains.</p>
			</div>
			<div class="section-grid">${sectionsHtml}</div>
		</section>

		<section class="panel two-col">
			<article class="split-card">
				<h2>Skills To Add</h2>
				<ul class="detail-list">${skillsHtml}</ul>
			</article>
			<article class="split-card">
				<h2>Quick Wins</h2>
				<ul class="detail-list">${quickWinsHtml}</ul>
			</article>
		</section>

		<section class="panel">
			<h2>30-Day Execution Plan</h2>
			<div class="plan-grid">${planHtml}</div>
		</section>

		<section class="panel two-col">
			<article class="split-card">
				<h2>Recommended ATS Keywords</h2>
				<div class="chips">${keywordChips}</div>
			</article>
			<article class="split-card">
				<h2>Power Verbs</h2>
				<div class="chips">${verbChips}</div>
			</article>
		</section>

		<section class="panel two-col">
			<article class="split-card">
				<h2>Detected Skills In Current Resume</h2>
				<div class="chips">${existingSkillChips || '<span class="chip">No skills detected</span>'}</div>
			</article>
			<article class="split-card">
				<h2>Industry Insight</h2>
				<p>${escapeHtml(guide.industryInsight)}</p>
				<p class="final-note">${escapeHtml(guide.finalNote)}</p>
			</article>
		</section>
	</main>
</body>
</html>`;
};

const normalizeAnalysis = (analysisInput) => {
	const base = analysisInput && typeof analysisInput.toObject === 'function'
		? analysisInput.toObject()
		: (analysisInput || {});

	return {
		...base,
		fileName: String(base.fileName || 'resume.pdf'),
		atsScore: clampScore(base.atsScore),
		keywordDensity: clampScore(base.keywordDensity),
		formatScore: clampScore(base.formatScore),
		contentQuality: clampScore(base.contentQuality),
		experienceLevel: String(base.experienceLevel || 'Junior'),
		experienceYears: Number(base.experienceYears || 0),
		certifications: toStringArray(base.certifications),
		keyAchievements: toStringArray(base.keyAchievements),
		suggestions: Array.isArray(base.suggestions) ? base.suggestions : [],
		skills: base.skills || {}
	};
};

const generateResumeGuide = async (analysisInput) => {
	const analysis = normalizeAnalysis(analysisInput);
	const skillsFlat = uniqueStrings(mapSkillsToArray(analysis.skills)).join(', ');

	const prompt = getResumeGuidePrompt({
		...analysis,
		skillsFlat
	});

	const fallbackGuide = buildFallbackGuide(analysis);
	const aiResult = await aiService.runAIAnalysis(prompt, fallbackGuide);
	const guide = normalizeGuide(aiResult, fallbackGuide);

	return renderGuideHtml(guide, analysis);
};

module.exports = {
	generateResumeGuide
};
