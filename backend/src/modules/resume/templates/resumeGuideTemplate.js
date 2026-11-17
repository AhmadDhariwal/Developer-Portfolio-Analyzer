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

const renderGuideHtml = (guide, analysis, existingSkills) => {
    const safeGuide = guide && typeof guide === 'object' ? guide : {};
    const safeAnalysis = analysis && typeof analysis === 'object' ? analysis : {};
    const sections = Array.isArray(safeGuide.sections) ? safeGuide.sections : [];
    const skillsToAdd = Array.isArray(safeGuide.skillsToAdd) ? safeGuide.skillsToAdd : [];
    const quickWins = Array.isArray(safeGuide.quickWins) ? safeGuide.quickWins : [];
    const thirtyDayPlan = Array.isArray(safeGuide.thirtyDayPlan) ? safeGuide.thirtyDayPlan : [];
    const atsKeywords = Array.isArray(safeGuide.atsKeywords) ? safeGuide.atsKeywords : [];
    const powerVerbs = Array.isArray(safeGuide.powerVerbs) ? safeGuide.powerVerbs : [];
    const detectedSkills = Array.isArray(existingSkills) ? existingSkills : [];

	const kpis = [
        { label: 'ATS Score', value: safeAnalysis.atsScore, note: 'Overall screening strength', icon: 'shield', color: 'secondary' },
        { label: 'Keyword Density', value: safeAnalysis.keywordDensity, note: 'Role-term alignment', icon: 'key_visualizer', color: 'primary' },
        { label: 'Format Score', value: safeAnalysis.formatScore, note: 'Readability and parser compatibility', icon: 'grid_view', color: 'tertiary' },
        { label: 'Content Quality', value: safeAnalysis.contentQuality, note: 'Clarity and measurable impact', icon: 'rate_review', color: 'error' }
	];

	const getKpiColorClass = (color) => {
		if (color === 'secondary') return 'bg-secondary shadow-[0_0_8px_#53ddfc] text-secondary';
		if (color === 'primary') return 'bg-primary shadow-[0_0_8px_#a3a6ff] text-primary';
		if (color === 'tertiary') return 'bg-tertiary shadow-[0_0_8px_#9bffce] text-tertiary';
		return 'bg-error shadow-[0_0_8px_#ff6e84] text-error';
	};

	const kpisHtml = kpis.map((item) => {
		const value = item.value === null ? 'N/A' : `${item.value}%`;
		const meter = item.value === null ? 0 : item.value;
		const colorClass = getKpiColorClass(item.color);
		const iconColorTxt = `text-${item.color}`;
		return `
			<div class="bg-surface-container p-6 rounded-2xl border border-outline-variant/5 hover:border-primary/20 transition-all group">
				<div class="flex justify-between items-start mb-4">
					<p class="text-xs font-headline tracking-widest uppercase text-on-surface-variant">${escapeHtml(item.label)}</p>
					<span class="material-symbols-outlined ${iconColorTxt}">${item.icon}</span>
				</div>
				<div class="flex items-baseline gap-2 mb-4">
					<span class="font-headline text-4xl font-bold">${escapeHtml(value)}</span>
					<span class="text-xs text-on-surface-variant truncate">${escapeHtml(item.note)}</span>
				</div>
				<div class="w-full h-1 bg-surface-container-highest rounded-full overflow-hidden">
					<div class="h-full ${colorClass.split(' ')[0]} ${colorClass.split(' ')[1]}" style="width: ${meter}%"></div>
				</div>
			</div>
		`;
	}).join('');

	const getStatusColor = (status) => {
		const s = String(status).toLowerCase();
		if (s.includes('urgent') || s.includes('fix')) return 'bg-error-container text-on-error-container';
		if (s.includes('improve')) return 'bg-[#ffbc59]/20 text-[#ffe0af]';
		if (s.includes('excellent')) return 'bg-tertiary/20 text-tertiary';
		return 'bg-primary/20 text-primary';
	};

    const sectionsHtml = sections.map((section, index) => `
		<div class="bg-surface-container-high/40 rounded-3xl p-8 border border-outline-variant/10 hover:bg-surface-container-high transition-colors">
			<div class="flex items-start justify-between mb-8">
				<div class="flex gap-4 items-center">
					<span class="w-10 h-10 rounded-xl bg-surface-container-highest flex items-center justify-center font-headline font-bold text-secondary">0${index + 1}</span>
					<div>
						<h3 class="font-headline text-lg font-bold">${escapeHtml(section.title)}</h3>
						<p class="text-xs font-mono text-on-surface-variant">Impact: ${escapeHtml(section.impact)} • Time: ${escapeHtml(section.timeToFix)}</p>
					</div>
				</div>
				<span class="px-3 py-1 ${getStatusColor(section.status)} text-[10px] font-mono rounded-full uppercase tracking-widest">${escapeHtml(section.status)}</span>
			</div>
			<div class="space-y-6">
				<div class="p-4 bg-surface-container-lowest/50 rounded-xl border-l-4 border-error/50">
					<p class="text-xs text-on-surface-variant mb-2">Issue Identified:</p>
					<p class="text-sm font-body leading-relaxed">${escapeHtml(section.problem)}</p>
				</div>
				<div class="space-y-3">
					<p class="text-xs uppercase tracking-widest text-secondary font-headline">Action Steps</p>
                    <ul class="list-disc pl-5 mt-2 space-y-1 text-sm text-on-surface-variant">${(Array.isArray(section.actionSteps) ? section.actionSteps : []).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
					
					<p class="text-xs uppercase tracking-widest text-tertiary font-headline mt-4">Example Rewrite</p>
					<div class="p-3 bg-tertiary/5 rounded-lg border border-tertiary/20 flex items-start gap-3">
						<span class="material-symbols-outlined text-tertiary text-sm mt-0.5">check</span>
						<p class="text-xs font-mono leading-relaxed text-on-surface">${escapeHtml(section.example)}</p>
					</div>
				</div>
			</div>
		</div>
	`).join('');

    const skillsHtml = skillsToAdd.map((item) => `
		<div title="${escapeHtml(item.reason)}" class="px-3 py-1.5 bg-surface-container-highest border border-outline-variant/30 rounded-full hover:border-primary/60 transition-colors cursor-pointer group flex items-center gap-2">
			<span class="text-xs font-mono text-primary group-hover:text-primary-dim">${escapeHtml(item.skill)}</span>
		</div>
	`).join('');

    const quickWinsHtml = quickWins.map((item) => `
		<li class="flex items-center gap-3 text-sm text-on-surface-variant border-b border-outline-variant/10 pb-3 last:border-0 last:pb-0">
			<span class="material-symbols-outlined text-tertiary text-lg">check_circle</span>
			<div class="flex-1">
				<span class="block text-on-surface">${escapeHtml(item.action)}</span>
				<span class="text-xs text-primary-dim">${escapeHtml(item.timeEstimate)} • ${escapeHtml(item.impact)} impact</span>
			</div>
		</li>
	`).join('');

	const planColors = ['border-secondary text-secondary opacity-100', 'border-primary text-primary opacity-80', 'border-tertiary text-tertiary opacity-60', 'border-on-surface-variant text-on-surface-variant opacity-40'];
    const planHtml = thirtyDayPlan.map((item, index) => `
		<div class="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-6 relative transition-opacity hover:opacity-100" style="opacity: ${[1, 0.8, 0.6, 0.4][index] || 1}">
			<div class="flex items-center justify-between mb-4">
				<p class="font-headline text-xs tracking-widest font-bold ${planColors[index] ? planColors[index].split(' ')[1] : 'text-secondary'}">WEEK ${item.week < 10 ? '0' + item.week : item.week}</p>
				<span class="material-symbols-outlined text-xs opacity-40">event</span>
			</div>
			<h4 class="text-sm font-bold mb-4">${escapeHtml(item.focus)}</h4>
            <ul class="text-xs text-on-surface-variant leading-relaxed mb-4 list-disc pl-4 space-y-1">${(Array.isArray(item.tasks) ? item.tasks : []).map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
			<div class="w-full h-1 bg-surface-container-highest rounded-full mt-auto"></div>
		</div>
	`).join('');

    const keywordChips = atsKeywords.map((keyword) => `<span class="px-3 py-1 bg-primary/10 border border-primary/20 text-primary rounded-full text-xs font-mono">${escapeHtml(keyword)}</span>`).join('');
    const verbChips = powerVerbs.map((verb) => `<span class="px-3 py-1 bg-secondary/10 border border-secondary/20 text-secondary rounded-full text-xs font-mono">${escapeHtml(verb)}</span>`).join('');
    const existingSkillChips = detectedSkills.map((skill) => `<span class="px-3 py-1 bg-surface-container-highest border border-outline-variant/30 rounded-full text-xs font-mono text-on-surface">${escapeHtml(skill)}</span>`).join('');

	return `<!DOCTYPE html>
<html class="dark" lang="en">
<head>
    <meta charset="utf-8"/>
    <meta content="width=device-width, initial-scale=1.0" name="viewport"/>
    <title>Resume Improvement Guide</title>
    <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono&display=swap" rel="stylesheet"/>
    <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
    <script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "surface-container-highest": "#192540",
                        "secondary-container": "#00687a",
                        "on-error-container": "#ffb2b9",
                        "surface-container-lowest": "#000000",
                        "error-container": "#a70138",
                        "inverse-surface": "#faf8ff",
                        "outline": "#6d758c",
                        "surface-container-high": "#141f38",
                        "error": "#ff6e84",
                        "surface-dim": "#060e20",
                        "on-error": "#490013",
                        "on-background": "#dee5ff",
                        "primary-container": "#9396ff",
                        "on-surface-variant": "#a3aac4",
                        "background": "#060e20",
                        "on-primary": "#0f00a4",
                        "primary-dim": "#6063ee",
                        "surface-tint": "#a3a6ff",
                        "surface-variant": "#192540",
                        "outline-variant": "#40485d",
                        "surface": "#060e20",
                        "tertiary": "#9bffce",
                        "secondary-dim": "#40ceed",
                        "surface-container": "#0f1930",
                        "on-secondary": "#004b58",
                        "tertiary-dim": "#58e7ab",
                        "secondary": "#53ddfc",
                        "error-dim": "#d73357",
                        "surface-bright": "#1f2b49",
                        "inverse-primary": "#494bd7",
                        "surface-container-low": "#091328",
                        "on-surface": "#dee5ff",
                        "primary": "#a3a6ff"
                    },
                    fontFamily: {
                        "headline": ["Space Grotesk"],
                        "body": ["Inter"],
                        "label": ["Inter"],
                        "mono": ["JetBrains Mono"]
                    }
                }
            }
        }
    </script>
    <style>
        .material-symbols-outlined { font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24; display: inline-block; vertical-align: middle; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: #060e20; }
        ::-webkit-scrollbar-thumb { background: #192540; border-radius: 10px; }
        .shimmer-line { background: linear-gradient(90deg, transparent, #a3a6ff, transparent); background-size: 200% 100%; }
        body { min-height: max(884px, 100dvh); }
    </style>
</head>
<body class="bg-surface text-on-surface font-body selection:bg-primary/30 selection:text-primary">
    <main class="py-12 px-6 min-h-screen relative z-10">
        <div class="max-w-7xl mx-auto space-y-12">
            
            <section class="relative bg-surface-container-low p-8 rounded-2xl overflow-hidden border border-outline-variant/10">
                <div class="absolute top-0 right-0 p-8">
                    <div class="w-32 h-32 rounded-full flex items-center justify-center border-4 border-dashed border-primary/20 relative group">
                        <div class="absolute inset-2 bg-primary/10 rounded-full blur-xl transition-all"></div>
                        <span class="font-headline text-5xl font-bold text-primary relative">${escapeHtml(safeGuide.overallGrade)}</span>
                    </div>
                </div>
                <div class="space-y-4 max-w-2xl relative z-10">
                    <div class="inline-flex items-center gap-2 px-3 py-1 bg-surface-container-highest border border-outline-variant/20 rounded-full">
                        <span class="material-symbols-outlined text-xs text-secondary">description</span>
                        <span class="text-xs font-mono text-on-surface-variant">${escapeHtml(safeAnalysis.fileName || 'resume.pdf')}</span>
                    </div>
                    <h1 class="font-headline text-5xl font-bold tracking-tighter text-on-surface leading-tight">
                        Evaluation <span class="text-secondary">Summary</span>
                    </h1>
                    <div class="flex items-center gap-6 text-on-surface-variant flex-wrap pb-2">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-primary-dim">work_history</span>
                            <span class="font-mono text-sm">Experience: ${escapeHtml(safeAnalysis.experienceLevel)} ${escapeHtml(String(safeAnalysis.experienceYears || 0))} yrs</span>
                        </div>
                        <div class="flex items-center gap-2 border-l border-outline-variant/30 pl-6">
                            <span class="material-symbols-outlined text-primary-dim">history</span>
                            <span class="font-mono text-sm">Analyzed: ${escapeHtml(formatDate(safeAnalysis.analyzedAt || Date.now()))}</span>
                        </div>
                        <div class="flex items-center gap-2 border-l border-outline-variant/30 pl-6">
                            <span class="material-symbols-outlined text-primary-dim">priority_high</span>
                            <span class="font-mono text-sm">Priority: ${escapeHtml(safeGuide.priorityLevel)}</span>
                        </div>
                    </div>
                    <p class="text-on-surface-variant font-body leading-relaxed max-w-xl">${escapeHtml(safeGuide.executiveSummary)}</p>
                </div>
            </section>

            <section class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                ${kpisHtml}
            </section>

            <section class="space-y-6">
                <div class="flex items-center justify-between">
                    <h2 class="font-headline text-2xl font-bold">High-Impact <span class="text-primary">Adjustments</span></h2>
                    <div class="h-[1px] flex-1 mx-8 shimmer-line opacity-20"></div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    ${sectionsHtml}
                </div>
            </section>

            <section class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="bg-surface-container p-8 rounded-3xl border border-outline-variant/10 relative overflow-hidden group">
                    <div class="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 blur-[60px] rounded-full transition-all"></div>
                    <div class="flex items-center gap-3 mb-6 relative z-10">
                        <span class="material-symbols-outlined text-primary">extension</span>
                        <h3 class="font-headline text-xl font-bold tracking-tight">Skills To Add</h3>
                    </div>
                    <p class="text-xs text-on-surface-variant mb-4 relative z-10">Integrate these strategically to boost ATS hit rate for targeted roles.</p>
                    <div class="flex flex-wrap gap-2 relative z-10">${skillsHtml}</div>
                </div>

                <div class="bg-surface-container p-8 rounded-3xl border border-outline-variant/10 relative overflow-hidden group">
                    <div class="absolute -top-12 -right-12 w-32 h-32 bg-secondary/10 blur-[60px] rounded-full transition-all"></div>
                    <div class="flex items-center gap-3 mb-6 relative z-10">
                        <span class="material-symbols-outlined text-secondary">bolt</span>
                        <h3 class="font-headline text-xl font-bold tracking-tight">Quick Wins</h3>
                    </div>
                    <ul class="space-y-4 relative z-10">${quickWinsHtml}</ul>
                </div>
            </section>

            <section class="space-y-8">
                <div class="flex items-center gap-4">
                    <h2 class="font-headline text-2xl font-bold">30-Day Execution <span class="text-secondary">Plan</span></h2>
                    <div class="px-3 py-1 bg-surface-container-highest rounded-lg border border-outline-variant/20 text-[10px] font-mono uppercase tracking-widest text-primary">Sprint Path</div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-4 gap-4 flex-1 items-stretch">${planHtml}</div>
            </section>

            <section class="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div class="bg-surface-container-low p-6 rounded-2xl border border-outline-variant/10">
                    <h3 class="font-headline text-lg font-bold mb-4">Target Keywords</h3>
                    <div class="flex flex-wrap gap-2">${keywordChips}</div>
                </div>
                <div class="bg-surface-container-low p-6 rounded-2xl border border-outline-variant/10">
                    <h3 class="font-headline text-lg font-bold mb-4">Power Verbs</h3>
                    <div class="flex flex-wrap gap-2">${verbChips}</div>
                </div>
                <div class="bg-surface-container-low p-6 rounded-2xl border border-outline-variant/10">
                    <h3 class="font-headline text-lg font-bold mb-4">Detected Skills</h3>
                    <div class="flex flex-wrap gap-2">${existingSkillChips || '<span class="px-3 py-1 bg-surface-container-highest border border-outline-variant/30 rounded-full text-xs font-mono">No skills detected</span>'}</div>
                </div>
            </section>

            <section class="bg-surface-container-highest border border-primary/20 p-8 rounded-3xl relative overflow-hidden">
                <div class="absolute inset-0 bg-primary/5"></div>
                <div class="flex items-start gap-4 relative z-10">
                    <span class="material-symbols-outlined text-primary text-3xl">lightbulb</span>
                    <div>
                        <h3 class="font-headline text-xl font-bold mb-2">Industry Insight</h3>
                        <p class="text-on-surface-variant leading-relaxed text-sm mb-4">${escapeHtml(safeGuide.industryInsight)}</p>
                        <p class="font-medium text-primary-dim text-sm">${escapeHtml(safeGuide.finalNote)}</p>
                    </div>
                </div>
            </section>
        </div>
        
        <div class="fixed top-0 left-0 w-full h-[1px] shimmer-line opacity-30 z-0 pointer-events-none"></div>
        <div class="fixed top-1/2 -left-32 w-64 h-64 bg-primary/10 blur-[120px] pointer-events-none rounded-full z-0"></div>
        <div class="fixed bottom-1/4 -right-32 w-96 h-96 bg-secondary/5 blur-[160px] pointer-events-none rounded-full z-0"></div>
    </main>
</body>
</html>`;
};

module.exports = {
	renderGuideHtml
};
