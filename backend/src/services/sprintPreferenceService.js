'use strict';

const Preference = require('../models/sprintPreference');
const { validateTimeZone, preferenceTimeZone } = require('../utils/sprintCalendar');

const getPreference = async (userId) => {
  const stored = await Preference.findById(userId).lean();
  return { timeZone: preferenceTimeZone(stored?.timeZone), appliesTo: 'new-sprint-windows' };
};
const setPreference = async (userId, payload) => {
  if (!payload || Object.keys(payload).some((key) => key !== 'timeZone')) {
    const error = new Error('Only timeZone is accepted.');
    error.statusCode = 400;
    throw error;
  }
  const timeZone = validateTimeZone(payload.timeZone);
  await Preference.findOneAndUpdate({ _id: userId }, { $set: { timeZone } }, { upsert: true, runValidators: true });
  return { timeZone, appliesTo: 'new-sprint-windows' };
};
module.exports = { getPreference, setPreference };
