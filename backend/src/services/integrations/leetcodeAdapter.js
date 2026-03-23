const BaseIntegrationAdapter = require('./baseAdapter');

class LeetCodeAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('leetcode');
  }

  getAuthMode() {
    return 'manual';
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText: 'Provide your LeetCode username to fetch public contest and solved-problem data in real time.'
    };
  }

  async ingestData(connection = {}) {
    const username = connection.externalUsername;
    if (!username) {
      throw new Error('LeetCode username is required for ingestion.');
    }

    const user = await this.fetchUserProfile(username);
    if (!user) {
      throw new Error('LeetCode user not found or data unavailable.');
    }

    const submissions = Array.isArray(user?.submitStats?.acSubmissionNum)
      ? user.submitStats.acSubmissionNum
      : [];
    const easy = Number(submissions.find((s) => s.difficulty === 'Easy')?.count || 0);
    const medium = Number(submissions.find((s) => s.difficulty === 'Medium')?.count || 0);
    const hard = Number(submissions.find((s) => s.difficulty === 'Hard')?.count || 0);

    return {
      provider: this.provider,
      profile: {
        username,
        ranking: Number(user?.profile?.ranking || 0),
        reputation: Number(user?.profile?.reputation || 0),
        solvedProblems: easy + medium + hard
      },
      activity: {
        easy,
        medium,
        hard
      },
      inferredSkills: ['Data Structures', 'Algorithms', 'Problem Solving'],
      raw: user
    };
  }

  async fetchUserProfile(username) {
    const queries = [
      `query userPublicProfile($username: String!) {
        matchedUser(username: $username) {
          username
          profile {
            ranking
            reputation
            starRating
          }
          submitStats {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }`,
      `query userProfilePublic($username: String!) {
        matchedUser(username: $username) {
          username
          profile {
            ranking
            reputation
          }
          submitStatsGlobal {
            acSubmissionNum {
              difficulty
              count
            }
          }
        }
      }`
    ];

    for (const query of queries) {
      try {
        const data = await this.post('https://leetcode.com/graphql', {
          query,
          variables: { username }
        });

        const matchedUser = data?.data?.matchedUser;
        if (!matchedUser) continue;

        if (!matchedUser.submitStats && matchedUser.submitStatsGlobal) {
          matchedUser.submitStats = matchedUser.submitStatsGlobal;
        }

        return matchedUser;
      } catch {
        // Try next query variant when schema/rate rules differ.
      }
    }

    return null;
  }
}

module.exports = LeetCodeAdapter;
