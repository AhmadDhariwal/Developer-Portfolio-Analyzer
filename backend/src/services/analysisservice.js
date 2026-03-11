const generateRecommendations = (missingSkills, readinessScore) => {
    // missingSkills may be objects { name, category, priority, jobDemand } or plain strings
    const names = missingSkills.map(s => (typeof s === 'string' ? s : s.name));
    const recommendations = names.map(skill => `Learn and build a project using ${skill}`);

    if (readinessScore < 50) {
        recommendations.push('Focus on building foundational projects and committing regularly to GitHub.');
    } else if (readinessScore < 80) {
        recommendations.push('Try contributing to open source projects to gain real-world experience.');
    } else {
        recommendations.push('You are well prepared! Start applying for roles and practicing system design.');
    }

    return recommendations;
};

module.exports = { generateRecommendations };
