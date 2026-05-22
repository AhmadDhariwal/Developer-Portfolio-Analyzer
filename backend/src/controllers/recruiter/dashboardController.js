const User = require('../../models/user');
const Job = require('../../models/Job');
const Membership = require('../../models/membership');
const { listCandidates } = require('../../services/recruiter/matchingService');

/**
 * GET /api/recruiter/dashboard
 * Returns aggregated stats, top candidates, recent jobs, and pipeline data
 * for the recruiter dashboard.
 */
const getRecruiterDashboard = async (req, res) => {
  try {
    const organizationId = req.organizationId;
    const recruiterId = req.user._id;

    // ── Parallel data fetch ────────────────────────────────────────────────
    const [candidates, jobs, orgRecruiters] = await Promise.all([
      listCandidates({ limit: 200 }),
      Job.find({ organizationId }).sort({ createdAt: -1 }).lean(),
      User.find({ role: 'recruiter', organizationId, isActive: { $ne: false } })
        .select('_id name createdAt')
        .lean()
    ]);

    // ── Candidate stats ────────────────────────────────────────────────────
    const totalCandidates = candidates.length;
    const scores = candidates.map((c) => Number(c.score || 0));
    const averageScore = totalCandidates
      ? Number((scores.reduce((a, b) => a + b, 0) / totalCandidates).toFixed(1))
      : 0;
    const topCandidates = [...candidates]
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // Score distribution buckets: 0-20, 21-40, 41-60, 61-80, 81-100
    const scoreDistribution = [
      { range: '0–20',  count: scores.filter((s) => s <= 20).length },
      { range: '21–40', count: scores.filter((s) => s > 20 && s <= 40).length },
      { range: '41–60', count: scores.filter((s) => s > 40 && s <= 60).length },
      { range: '61–80', count: scores.filter((s) => s > 60 && s <= 80).length },
      { range: '81–100',count: scores.filter((s) => s > 80).length }
    ];

    // Stack breakdown
    const stackMap = {};
    candidates.forEach((c) => {
      const stack = String(c.stack || 'Unknown').trim();
      stackMap[stack] = (stackMap[stack] || 0) + 1;
    });
    const stackBreakdown = Object.entries(stackMap)
      .map(([stack, count]) => ({ stack, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Experience distribution
    const expMap = { '0–1': 0, '2–3': 0, '4–6': 0, '7–10': 0, '10+': 0 };
    candidates.forEach((c) => {
      const yoe = Number(c.yearsOfExperience || 0);
      if (yoe <= 1) expMap['0–1']++;
      else if (yoe <= 3) expMap['2–3']++;
      else if (yoe <= 6) expMap['4–6']++;
      else if (yoe <= 10) expMap['7–10']++;
      else expMap['10+']++;
    });
    const experienceDistribution = Object.entries(expMap).map(([range, count]) => ({ range, count }));

    // ── Job stats ──────────────────────────────────────────────────────────
    const totalJobs = jobs.length;
    const openJobs = jobs.filter((j) => j.status === 'open').length;
    const draftJobs = jobs.filter((j) => j.status === 'draft').length;
    const closedJobs = jobs.filter((j) => j.status === 'closed').length;
    const recentJobs = jobs.slice(0, 5);

    // Jobs over time (last 6 months)
    const now = new Date();
    const jobsOverTime = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
      const count = jobs.filter((j) => {
        const created = new Date(j.createdAt);
        return created.getFullYear() === d.getFullYear() && created.getMonth() === d.getMonth();
      }).length;
      return { month: label, count };
    });

    // ── Recruiter team stats ───────────────────────────────────────────────
    const totalRecruiters = orgRecruiters.length;

    // ── Predictions / insights ────────────────────────────────────────────
    // Simple heuristic: top skill demand from required skills across open jobs
    const skillDemand = {};
    jobs.filter((j) => j.status === 'open').forEach((j) => {
      (j.requiredSkills || []).forEach((skill) => {
        const s = String(skill || '').trim();
        if (s) skillDemand[s] = (skillDemand[s] || 0) + 1;
      });
    });
    const topSkillsDemand = Object.entries(skillDemand)
      .map(([skill, demand]) => ({ skill, demand }))
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 8);

    // Candidate supply vs demand per stack
    const supplyDemand = stackBreakdown.map(({ stack, count: supply }) => ({
      stack,
      supply,
      demand: skillDemand[stack] || 0
    }));

    return res.status(200).json({
      stats: {
        totalCandidates,
        averageScore,
        totalJobs,
        openJobs,
        draftJobs,
        closedJobs,
        totalRecruiters
      },
      topCandidates,
      recentJobs,
      charts: {
        scoreDistribution,
        stackBreakdown,
        experienceDistribution,
        jobsOverTime,
        topSkillsDemand,
        supplyDemand
      }
    });
  } catch (error) {
    console.error('Recruiter dashboard error:', error.message);
    return res.status(500).json({ message: 'Failed to load recruiter dashboard.' });
  }
};

module.exports = { getRecruiterDashboard };
