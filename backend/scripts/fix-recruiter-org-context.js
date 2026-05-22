/**
 * fix-recruiter-org-context.js
 *
 * Backfill script: fixes all recruiter accounts that are missing a valid
 * organizationId or active Membership record.
 *
 * Strategy:
 *  1. Find all recruiters with null / missing / invalid organizationId
 *  2. Find the correct org by looking at existing memberships, or fall back
 *     to the most recently created org owned by an admin
 *  3. Set organizationId on the User record
 *  4. Upsert an active org-level Membership (teamId: null)
 *
 * Run: node scripts/fix-recruiter-org-context.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/aianalyzer';

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('[fix] Connected to', MONGO_URI);

  const db = mongoose.connection.db;
  const usersCol       = db.collection('users');
  const membershipsCol = db.collection('memberships');
  const orgsCol        = db.collection('organizations');

  // ── 1. Load all orgs ──────────────────────────────────────────────────────
  const orgs = await orgsCol.find({}).toArray();
  const validOrgIds = new Set(orgs.map(o => String(o._id)));
  console.log(`[fix] Found ${orgs.length} organizations:`, orgs.map(o => `${o.name} (${o._id})`).join(', '));

  if (orgs.length === 0) {
    console.error('[fix] No organizations found. Create an org first.');
    process.exit(1);
  }

  // Default org: prefer "icommunix" or the first one
  const defaultOrg = orgs.find(o => o.name === 'icommunix') || orgs[0];
  console.log(`[fix] Default org: ${defaultOrg.name} (${defaultOrg._id})`);

  // ── 2. Find all recruiters ────────────────────────────────────────────────
  const recruiters = await usersCol.find({ role: 'recruiter' }).toArray();
  console.log(`[fix] Found ${recruiters.length} recruiter(s)`);

  let fixed = 0;

  for (const recruiter of recruiters) {
    const userId    = recruiter._id;
    const rawOrgId  = String(recruiter.organizationId || '').trim();
    const hasValidOrg = rawOrgId && rawOrgId !== 'null' && /^[0-9a-fA-F]{24}$/.test(rawOrgId) && validOrgIds.has(rawOrgId);

    // Check for active membership
    const activeMembership = await membershipsCol.findOne({
      userId,
      status: 'active',
      teamId: null
    });

    if (hasValidOrg && activeMembership) {
      console.log(`[fix] ✓ ${recruiter.email} — already OK (orgId: ${rawOrgId})`);
      continue;
    }

    // Determine the correct org
    let targetOrgId = hasValidOrg ? rawOrgId : null;

    if (!targetOrgId) {
      // Try to find from any existing membership (even non-active)
      const anyMembership = await membershipsCol.findOne({ userId });
      if (anyMembership) {
        const mOrgId = String(anyMembership.organizationId);
        if (validOrgIds.has(mOrgId)) {
          targetOrgId = mOrgId;
          console.log(`[fix] Found org from existing membership for ${recruiter.email}: ${targetOrgId}`);
        }
      }
    }

    if (!targetOrgId) {
      targetOrgId = String(defaultOrg._id);
      console.log(`[fix] Using default org for ${recruiter.email}: ${targetOrgId}`);
    }

    const targetOrgObjectId = new mongoose.Types.ObjectId(targetOrgId);

    // ── 3. Set organizationId on User ──────────────────────────────────────
    await usersCol.updateOne(
      { _id: userId },
      { $set: { organizationId: targetOrgObjectId } }
    );
    console.log(`[fix] Set organizationId=${targetOrgId} on user ${recruiter.email}`);

    // ── 4. Upsert active org-level Membership ──────────────────────────────
    const now = new Date();
    await membershipsCol.updateOne(
      {
        organizationId: targetOrgObjectId,
        userId,
        teamId: null
      },
      {
        $set: {
          role: 'member',
          status: 'active',
          joinedAt: activeMembership?.joinedAt || now,
          updatedAt: now
        },
        $setOnInsert: {
          createdAt: now
        }
      },
      { upsert: true }
    );
    console.log(`[fix] Upserted active membership for ${recruiter.email} in org ${targetOrgId}`);

    fixed++;
  }

  console.log(`\n[fix] Done. Fixed ${fixed} / ${recruiters.length} recruiter(s).`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('[fix] Fatal error:', err);
  process.exit(1);
});
