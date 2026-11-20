const cron = require('node-cron');
const logger = require('../../../core/observability/logger');
const { runInterviewJob } = require('./interviewJobService');
const {
  maintainInterviewQuestionPools,
  MIN_TOPIC_QUESTION_POOL
} = require('./interviewPrepService');

const MAINTENANCE_CRON_EXPR = process.env.INTERVIEW_QUESTION_MAINTENANCE_CRON || '30 */4 * * *';

let schedulerTask;
let activeTick;

const startInterviewQuestionMaintenanceScheduler = () => {
  if (schedulerTask) return schedulerTask;
  schedulerTask = cron.schedule(MAINTENANCE_CRON_EXPR, () => {
    if (activeTick) return activeTick;
    activeTick = (async () => {
      try {
        const minimumPerTopic = Number(
          process.env.INTERVIEW_QUESTION_MIN_PER_TOPIC || MIN_TOPIC_QUESTION_POOL
        );
        const result = await runInterviewJob(async ({ shouldContinue }) => {
          if (!shouldContinue()) return { skipped: true };
          return maintainInterviewQuestionPools({ minimumPerTopic });
        });
        logger.info('interview-maintenance completed', result);
      } catch (error) {
        logger.error('interview-maintenance cron error', { message: error.message });
      }
    })().finally(() => {
      activeTick = null;
    });
    return activeTick;
  });

  logger.info('interview-maintenance scheduler started', { cron: MAINTENANCE_CRON_EXPR });
};

const stopInterviewQuestionMaintenanceScheduler = () => {
  schedulerTask?.stop();
  schedulerTask?.destroy?.();
  cron.getTasks?.()?.delete?.(schedulerTask?.options?.name);
  schedulerTask = null;
  return activeTick;
};

module.exports = {
  stopInterviewQuestionMaintenanceScheduler,
  startInterviewQuestionMaintenanceScheduler
};
