'use strict';

const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const mongoose = require('mongoose');
const migration = require('../services/sprintReservationMigrationService');
const args = process.argv.slice(2);
const zoneAt = args.indexOf('--legacy-time-zone');
const options = {
  legacyTimeZone: zoneAt >= 0 ? args[zoneAt + 1] : undefined,
  deploymentAuthorized: args.includes('--deployment-authorized')
};
const main = async () => {
  const policyAt = args.indexOf('--legacy-policy-file');
  if (policyAt >= 0) options.legacyTimeZones = JSON.parse(fs.readFileSync(args[policyAt + 1], 'utf8'));
  if (args.includes('--apply') && !options.deploymentAuthorized)
    throw new Error('Explicit deployment authorization is required.');
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000
  });
  const result = await (args.includes('--apply') ? migration.apply(options) : migration.inspect(options));
  console.log(JSON.stringify(result, null, 2));
  if (args.includes('--apply') && result.stopped) process.exitCode = 2;
};
main()
  .catch(() => {
    console.error('Reservation migration stopped. Verify authorization, original calendar policy and database access.');
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
