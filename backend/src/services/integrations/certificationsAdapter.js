const BaseIntegrationAdapter = require('./baseAdapter');

/**
 * Certifications Adapter
 * Accepts a comma-separated list of certification names (e.g. "AWS Solutions Architect, Google Cloud Professional")
 * stored in externalUsername. This is a self-reported integration — no external API call needed.
 * The value is parsed, normalized, and used to infer skills and boost the profile score.
 */
class CertificationsAdapter extends BaseIntegrationAdapter {
  constructor() {
    super('certifications');
  }

  getAuthMode() {
    return 'manual';
  }

  getManualAuthHints() {
    return {
      requiredFields: ['externalUsername'],
      helpText: 'Enter your certifications as a comma-separated list (e.g. "AWS Solutions Architect, Google Cloud Professional, Meta React Developer"). These will be used to boost your hiring score and recommendations.'
    };
  }

  async ingestData(connection = {}) {
    const raw = String(connection.externalUsername || '').trim();
    if (!raw) {
      throw new Error('At least one certification name is required.');
    }

    const certList = raw
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c.length > 2)
      .slice(0, 20);

    if (!certList.length) {
      throw new Error('No valid certification names found. Separate multiple certifications with commas.');
    }

    const inferredSkills = this.extractSkillsFromCerts(certList);
    const verifiedCount = certList.length;
    const certScore = Math.min(100, verifiedCount * 12);

    return {
      provider: this.provider,
      profile: {
        username: raw.slice(0, 80),
        totalCertifications: verifiedCount,
        certScore
      },
      activity: {
        certifications: certList,
        platforms: this.detectPlatforms(certList)
      },
      inferredSkills,
      raw: { certList }
    };
  }

  extractSkillsFromCerts(certList) {
    const skillMap = [
      [/aws|amazon web services/i, 'AWS'],
      [/azure|microsoft azure/i, 'Azure'],
      [/google cloud|gcp/i, 'Google Cloud'],
      [/kubernetes|k8s/i, 'Kubernetes'],
      [/docker/i, 'Docker'],
      [/terraform/i, 'Terraform'],
      [/react/i, 'React'],
      [/angular/i, 'Angular'],
      [/vue/i, 'Vue.js'],
      [/node\.?js/i, 'Node.js'],
      [/python/i, 'Python'],
      [/java\b/i, 'Java'],
      [/machine learning|ml\b/i, 'Machine Learning'],
      [/deep learning/i, 'Deep Learning'],
      [/data science/i, 'Data Science'],
      [/sql|database/i, 'SQL'],
      [/mongodb/i, 'MongoDB'],
      [/devops/i, 'DevOps'],
      [/security|cybersecurity/i, 'Cybersecurity'],
      [/agile|scrum/i, 'Agile'],
      [/project management|pmp/i, 'Project Management'],
      [/blockchain/i, 'Blockchain'],
      [/flutter|dart/i, 'Flutter'],
      [/swift|ios/i, 'iOS/Swift'],
      [/kotlin|android/i, 'Android/Kotlin'],
      [/graphql/i, 'GraphQL'],
      [/redis/i, 'Redis'],
      [/elasticsearch/i, 'Elasticsearch'],
      [/spark|hadoop/i, 'Big Data'],
      [/tableau|power bi/i, 'Data Visualization']
    ];

    const skills = new Set();
    for (const cert of certList) {
      for (const [pattern, skill] of skillMap) {
        if (pattern.test(cert)) skills.add(skill);
      }
    }
    return Array.from(skills).slice(0, 12);
  }

  detectPlatforms(certList) {
    const platforms = new Set();
    const platformMap = [
      [/coursera/i, 'Coursera'],
      [/udemy/i, 'Udemy'],
      [/linkedin learning/i, 'LinkedIn Learning'],
      [/pluralsight/i, 'Pluralsight'],
      [/aws|amazon/i, 'AWS'],
      [/google/i, 'Google'],
      [/microsoft|azure/i, 'Microsoft'],
      [/meta/i, 'Meta'],
      [/oracle/i, 'Oracle'],
      [/cisco/i, 'Cisco'],
      [/comptia/i, 'CompTIA'],
      [/hashicorp/i, 'HashiCorp'],
      [/cncf/i, 'CNCF'],
      [/databricks/i, 'Databricks'],
      [/snowflake/i, 'Snowflake']
    ];

    for (const cert of certList) {
      for (const [pattern, platform] of platformMap) {
        if (pattern.test(cert)) platforms.add(platform);
      }
    }
    return Array.from(platforms);
  }
}

module.exports = CertificationsAdapter;
