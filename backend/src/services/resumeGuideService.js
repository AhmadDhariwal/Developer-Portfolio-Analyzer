const aiService = require('./aiservice');
const { getResumeGuidePrompt } = require('../prompts/resumeGuidePrompt');
const { renderGuideHtml } = require('../templates/resumeGuideTemplate');

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
	const detectedSkills = uniqueStrings(mapSkillsToArray(analysis.skills));
	const skillsFlat = detectedSkills.join(', ');

	const prompt = getResumeGuidePrompt({
		...analysis,
		skillsFlat
	});

	const fallbackGuide = buildFallbackGuide(analysis);
	const aiResult = await aiService.runAIAnalysis(prompt, fallbackGuide);
	const guide = normalizeGuide(aiResult, fallbackGuide);

	return renderGuideHtml(guide, analysis, detectedSkills);
};

module.exports = {
	generateResumeGuide
};
