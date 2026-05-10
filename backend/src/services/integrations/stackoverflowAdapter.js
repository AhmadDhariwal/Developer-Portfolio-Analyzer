const BaseIntegrationAdapter = require('./baseAdapter');

class StackOverflowAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('stackoverflow');
  }

  getAuthMode() {
    return 'manual';
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText: 'Enter your Stack Overflow user ID (numeric) or username to fetch public reputation, badges, and top tags.'
    };
  }

  async ingestData(connection = {}) {
    const username = String(connection.externalUsername || '').trim();
    if (!username) {
      throw new Error('Stack Overflow user ID or username is required.');
    }

    // Resolve numeric user ID — if already numeric use directly, else search by display name
    const userId = await this.resolveUserId(username);
    if (!userId) {
      throw new Error(`Stack Overflow user "${username}" not found.`);
    }

    const [userInfo, badges, topTags] = await Promise.all([
      this.fetchUser(userId),
      this.fetchBadges(userId),
      this.fetchTopTags(userId)
    ]);

    const reputation = Number(userInfo?.reputation || 0);
    const goldBadges = Number(userInfo?.badge_counts?.gold || 0);
    const silverBadges = Number(userInfo?.badge_counts?.silver || 0);
    const bronzeBadges = Number(userInfo?.badge_counts?.bronze || 0);
    const totalBadges = goldBadges + silverBadges + bronzeBadges;
    const answerCount = Number(userInfo?.answer_count || 0);
    const questionCount = Number(userInfo?.question_count || 0);

    const topTagNames = Array.isArray(topTags)
      ? topTags.slice(0, 8).map((t) => String(t.tag_name || '').trim()).filter(Boolean)
      : [];

    const namedBadges = Array.isArray(badges)
      ? badges.slice(0, 10).map((b) => String(b.name || '').trim()).filter(Boolean)
      : [];

    const inferredSkills = [...new Set([...topTagNames])];

    return {
      provider: this.provider,
      profile: {
        username: userInfo?.display_name || username,
        userId: String(userId),
        reputation,
        goldBadges,
        silverBadges,
        bronzeBadges,
        totalBadges,
        answerCount,
        questionCount
      },
      activity: {
        topTags: topTagNames,
        namedBadges,
        acceptRate: Number(userInfo?.accept_rate || 0)
      },
      inferredSkills,
      raw: { userInfo, topTags: topTags?.slice(0, 10) || [] }
    };
  }

  async resolveUserId(username) {
    // If purely numeric, treat as user ID directly
    if (/^\d+$/.test(username)) return username;

    try {
      const data = await this.get(
        `https://api.stackexchange.com/2.3/users?inname=${encodeURIComponent(username)}&site=stackoverflow&pagesize=5&order=desc&sort=reputation`,
        null
      );
      const items = data?.items || [];
      if (!items.length) return null;
      // Prefer exact display_name match, else take highest reputation
      const exact = items.find(
        (u) => String(u.display_name || '').toLowerCase() === username.toLowerCase()
      );
      return String((exact || items[0]).user_id);
    } catch {
      return null;
    }
  }

  async fetchUser(userId) {
    try {
      const data = await this.get(
        `https://api.stackexchange.com/2.3/users/${userId}?site=stackoverflow`,
        null
      );
      return data?.items?.[0] || null;
    } catch {
      return null;
    }
  }

  async fetchBadges(userId) {
    try {
      const data = await this.get(
        `https://api.stackexchange.com/2.3/users/${userId}/badges?site=stackoverflow&pagesize=20&order=desc&sort=rank`,
        null
      );
      return data?.items || [];
    } catch {
      return [];
    }
  }

  async fetchTopTags(userId) {
    try {
      const data = await this.get(
        `https://api.stackexchange.com/2.3/users/${userId}/top-tags?site=stackoverflow&pagesize=10`,
        null
      );
      return data?.items || [];
    } catch {
      return [];
    }
  }
}

module.exports = StackOverflowAdapter;
