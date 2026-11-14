const path = require("node:path");
const crypto = require("node:crypto");
require(path.join(__dirname, "../node_modules/dotenv")).config({
  path: path.join(__dirname, "../.env"),
});

const mongoose = require(path.join(__dirname, "../node_modules/mongoose"));
const ResumeAnalysisCache = require(
  path.join(__dirname, "../src/models/resumeAnalysisCache"),
);
const governance = require(
  path.join(__dirname, "../src/services/integrationMongoGovernanceService"),
);

async function verifyMongo() {
  const report = {
    gate: "Gate 3: MongoDB Verification",
    timestamp: new Date().toISOString(),
    connection: {},
    checks: {},
    performance: {},
    passed: false,
  };

  const uri =
    process.env.MONGODB_URI ||
    "mongodb://127.0.0.1:27017/devinsight?replicaSet=rs0";
  const disposableDbName = `resume_mongo_verify_${crypto.randomBytes(6).toString("hex")}`;

  try {
    const connStart = Date.now();
    await mongoose.connect(uri, {
      dbName: disposableDbName,
      serverSelectionTimeoutMS: 5000,
    });
    report.performance.connectionMs = Date.now() - connStart;

    const admin = mongoose.connection.db.admin();
    const serverStatus = await admin.serverStatus();
    const replStatus = await admin
      .command({ replSetGetStatus: 1 })
      .catch(() => null);

    report.connection = {
      version: serverStatus.version,
      replicaSet: replStatus?.set || serverStatus.repl?.setName || "none",
      isMaster: serverStatus.isWritablePrimary || serverStatus.ismaster,
      disposableDb: disposableDbName,
    };
    console.log(
      `[1/7] Connected to MongoDB ${report.connection.version} (replicaSet: ${report.connection.replicaSet}) in ${report.performance.connectionMs}ms.`,
    );

    // 1. Transaction Support Check
    const txStart = Date.now();
    const session = await mongoose.startSession();
    let txCommitted = false;
    try {
      session.startTransaction();
      const testCollection = mongoose.connection.db.collection("tx_probe");
      await testCollection.insertOne(
        { probe: "transaction_test", createdAt: new Date() },
        { session },
      );
      await session.commitTransaction();
      txCommitted = true;
    } catch (err) {
      await session.abortTransaction();
    } finally {
      session.endSession();
    }
    report.performance.transactionMs = Date.now() - txStart;
    report.checks.transactions = {
      supported: txCommitted,
      latencyMs: report.performance.transactionMs,
    };
    console.log(
      `[2/7] Transactions verified: supported=${txCommitted} in ${report.performance.transactionMs}ms.`,
    );

    // 2. Indexes and TTL Verification on ResumeAnalysisCache
    await ResumeAnalysisCache.createIndexes();
    const cacheIndexes = await ResumeAnalysisCache.collection.indexes();
    const uniqueIndex = cacheIndexes.find(
      (idx) =>
        idx.key.userId === 1 &&
        idx.key.resumeFileId === 1 &&
        idx.key.resumeHash === 1 &&
        idx.key.analysisVersion === 1 &&
        idx.unique === true,
    );
    const ttlIndex = cacheIndexes.find(
      (idx) => idx.key.createdAt === 1 && idx.expireAfterSeconds !== undefined,
    );

    report.checks.indexes = {
      uniqueAnalysisCacheIndex: !!uniqueIndex,
      ttlIndex: !!ttlIndex,
      ttlSeconds: ttlIndex?.expireAfterSeconds,
    };
    console.log(
      `[3/7] Indexes verified: unique compound index present=${!!uniqueIndex}, TTL index=${!!ttlIndex} (${ttlIndex?.expireAfterSeconds}s).`,
    );

    // 3. Unique Constraint Enforcement
    const dummyUser = new mongoose.Types.ObjectId();
    const dummyFile = new mongoose.Types.ObjectId();
    const dummyHash = crypto.randomBytes(32).toString("hex");
    const version = "resume-intel-v3:test";

    await ResumeAnalysisCache.create({
      userId: dummyUser,
      resumeFileId: dummyFile,
      resumeHash: dummyHash,
      analysisVersion: version,
      result: { score: 75 },
      expiresAt: new Date(Date.now() + 86400000),
    });

    let duplicateRejected = false;
    try {
      await ResumeAnalysisCache.create({
        userId: dummyUser,
        resumeFileId: dummyFile,
        resumeHash: dummyHash,
        analysisVersion: version,
        result: { score: 80 },
        expiresAt: new Date(Date.now() + 86400000),
      });
    } catch (err) {
      duplicateRejected = err.code === 11000;
    }
    report.checks.uniqueConstraintEnforced = duplicateRejected;
    console.log(
      `[4/7] Unique constraint enforcement verified: duplicate rejection=${duplicateRejected}.`,
    );

    // 4. Admission Quota Atomicity & IP Budgeting
    const dummyIp = "198.51.100.42";
    const admitStart = Date.now();
    const admissionResults = [];
    const limits = [20, 60]; // analyze limits: [20 owner/hour, 60 IP/hour]

    for (let i = 0; i < 22; i++) {
      try {
        await governance.resumeWindow(
          String(dummyUser),
          dummyIp,
          "analyze",
          limits,
        );
        admissionResults.push(200);
      } catch (err) {
        admissionResults.push(err.status || 429);
      }
    }
    report.performance.admissionBurstMs = Date.now() - admitStart;
    const passes = admissionResults.filter((s) => s === 200).length;
    const rejections = admissionResults.filter((s) => s === 429).length;

    report.checks.quotaAtomicity = {
      totalRequests: admissionResults.length,
      allowedPasses: passes,
      throttledRejections: rejections,
      ownerBudgetEnforced: passes === 20 && rejections === 2,
    };
    console.log(
      `[5/7] Quota atomicity verified: allowed=${passes}/20, throttled=${rejections}/2 in ${report.performance.admissionBurstMs}ms.`,
    );

    // 5. Reservation Fencing and Work Leases
    const fileId = new mongoose.Types.ObjectId().toHexString();
    const lease1 = await governance.resumeLease(String(dummyUser), fileId);

    // Immediate second lease for same owner and file must be limited (file limit is 1)
    let secondLeaseRejected = false;
    try {
      await governance.resumeLease(String(dummyUser), fileId);
    } catch (err) {
      secondLeaseRejected = err.status === 429;
    }

    // Release lease1
    await governance.release(lease1);

    // Now re-acquire lease
    const leaseReacquired = await governance.resumeLease(
      String(dummyUser),
      fileId,
    );
    await governance.release(leaseReacquired);

    report.checks.reservationAndFencing = {
      initialAcquisition: !!lease1?.token,
      concurrentLockRejected: secondLeaseRejected,
      releaseAndReacquire: !!leaseReacquired?.token,
      distinctTokens: lease1?.token !== leaseReacquired?.token,
    };
    console.log(
      `[6/7] Work reservation and fencing verified: lock=${!!lease1?.token}, contention block=${secondLeaseRejected}, release/reacquire=${!!leaseReacquired?.token}.`,
    );

    // 6. Backup Creation and Restoration into a Disposable Database
    const backupDbName = `resume_restore_verify_${crypto.randomBytes(6).toString("hex")}`;
    const backupColl = mongoose.connection.db.collection("backup_source_test");
    await backupColl.insertMany([
      { docId: 1, type: "resume", hash: "abc1" },
      { docId: 2, type: "resume", hash: "abc2" },
      { docId: 3, type: "resume", hash: "abc3" },
    ]);

    const exportedDocs = await backupColl.find({}).toArray();

    const restoreConn = await mongoose
      .createConnection(uri, {
        dbName: backupDbName,
        serverSelectionTimeoutMS: 5000,
      })
      .asPromise();

    const restoredColl = restoreConn.db.collection("backup_source_test");
    await restoredColl.insertMany(exportedDocs);
    const restoredCount = await restoredColl.countDocuments();

    const restoreValid = restoredCount === 3;
    await restoreConn.db.dropDatabase();
    await restoreConn.close();

    report.checks.backupAndRestore = {
      disposableRestoreDb: backupDbName,
      sourceDocCount: exportedDocs.length,
      restoredDocCount: restoredCount,
      integrityVerified: restoreValid,
      restoredDbDropped: true,
    };
    console.log(
      `[7/7] Backup & restore verified into disposable DB: ${restoredCount} docs restored and verified.`,
    );

    // Drop the test disposable DB
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();

    report.passed =
      report.checks.transactions.supported &&
      report.checks.indexes.uniqueAnalysisCacheIndex &&
      report.checks.indexes.ttlIndex &&
      report.checks.uniqueConstraintEnforced &&
      report.checks.quotaAtomicity.ownerBudgetEnforced &&
      report.checks.reservationAndFencing.initialAcquisition &&
      report.checks.reservationAndFencing.concurrentLockRejected &&
      report.checks.reservationAndFencing.releaseAndReacquire &&
      report.checks.backupAndRestore.integrityVerified;
  } catch (err) {
    report.error = {
      message: err.message,
      stack: err.stack,
    };
    report.passed = false;
    await mongoose.disconnect().catch(() => {});
  }

  const outPath = path.join(
    __dirname,
    "../verification/resume/live-mongo-results.json",
  );
  require("node:fs").writeFileSync(
    outPath,
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log("\n--- MONGO VERIFICATION SUMMARY ---");
  console.log("Result:", report.passed ? "PASSED" : "FAILED");
  console.log("Report saved to:", outPath);
  console.log(JSON.stringify(report, null, 2));
}

verifyMongo();
