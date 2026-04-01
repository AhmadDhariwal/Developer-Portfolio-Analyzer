const cron = require('node-cron');
const logger = require('../utils/logger');
const { maintainInterviewQuestionPools, MIN_TOPIC_QUESTION_POOL } = require('./interviewPrepService');

const MAINTENANCE_CRON_EXPR = process.env.INTERVIEW_QUESTION_MAINTENANCE_CRON || '30 */4 * * *';

const startInterviewQuestionMaintenanceScheduler = () => {
  cron.schedule(MAINTENANCE_CRON_EXPR, async () => {
    try {
      const minimumPerTopic = Number(process.env.INTERVIEW_QUESTION_MIN_PER_TOPIC || MIN_TOPIC_QUESTION_POOL);
      const result = await maintainInterviewQuestionPools({ minimumPerTopic });
      logger.info('interview-maintenance completed', result);
    } catch (error) {
      logger.error('interview-maintenance cron error', { message: error.message });
    }
  });

  logger.info('interview-maintenance scheduler started', { cron: MAINTENANCE_CRON_EXPR });
};

module.exports = {
  startInterviewQuestionMaintenanceScheduler
};
