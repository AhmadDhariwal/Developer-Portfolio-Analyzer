const { transaction, fence, changed } = require('./notificationTransactionService');

async function commit(userId, mutation, notification, sessionRevision) {
  return transaction(async (session) => {
    await fence(userId, session, sessionRevision);
    const result = await mutation(session);
    const input = typeof notification === 'function' ? notification(result) : notification;
    if (input)
      await require('./notificationService').createNotification({ ...input, userId, session });
    return result;
  });
}
module.exports = { transaction, fence, changed, commit };
