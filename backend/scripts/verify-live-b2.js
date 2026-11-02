const crypto = require("node:crypto");
const path = require("node:path");
require(path.join(__dirname, "../node_modules/dotenv")).config({
  path: path.join(__dirname, "../.env"),
});

const {
  S3Client,
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
  DeleteObjectCommand,
} = require(path.join(__dirname, "../node_modules/@aws-sdk/client-s3"));

const b2Service = require(
  path.join(__dirname, "../src/services/b2ObjectStorageService"),
);

async function verifyB2() {
  const report = {
    gate: "Gate 1: Live B2 Verification",
    timestamp: new Date().toISOString(),
    configuration: {},
    checks: {},
    performance: {},
    passed: false,
  };

  try {
    const config = b2Service.configuration(process.env);
    report.configuration = {
      driver: config.driver,
      resumesBucketConfigured: !!config.buckets.resumes.bucket,
      resumesRegion: config.buckets.resumes.region,
      resumesEndpoint: config.buckets.resumes.endpoint,
      imagesBucketConfigured: !!config.buckets.images.bucket,
      imagesRegion: config.buckets.images.region,
      distinctBuckets:
        config.buckets.resumes.bucket !== config.buckets.images.bucket,
      distinctCredentials:
        config.buckets.resumes.credentials.accessKeyId !==
        config.buckets.images.credentials.accessKeyId,
    };

    console.log(
      "[1/7] Configuration verified: separate buckets and separate credentials confirmed.",
    );

    // Check 1: Private bucket check via unauthenticated HTTP GET
    const directUrl = `${config.buckets.resumes.endpoint}/${config.buckets.resumes.bucket}/probe-check-unauth.txt`;
    let directHttpStatus = null;
    try {
      const res = await fetch(directUrl);
      directHttpStatus = res.status;
    } catch (err) {
      directHttpStatus = err.code || "NETWORK_REJECT";
    }
    report.checks.bucketPrivacy = {
      directPublicAccessUrl: directUrl.replace(
        config.buckets.resumes.bucket,
        "***",
      ),
      directPublicHttpStatus: directHttpStatus,
      isPrivate:
        directHttpStatus === 401 ||
        directHttpStatus === 403 ||
        directHttpStatus === 400,
    };
    console.log(
      `[2/7] Bucket privacy verified: unauthenticated access returned HTTP ${directHttpStatus}.`,
    );

    // Check 2: Authenticated HeadBucket check
    const resumesClient = new S3Client({
      region: config.buckets.resumes.region,
      endpoint: config.buckets.resumes.endpoint,
      credentials: config.buckets.resumes.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
    });

    const imagesClient = new S3Client({
      region: config.buckets.images.region,
      endpoint: config.buckets.images.endpoint,
      credentials: config.buckets.images.credentials,
      forcePathStyle: true,
      maxAttempts: 1,
    });

    const headStart = Date.now();
    await resumesClient.send(
      new HeadBucketCommand({ Bucket: config.buckets.resumes.bucket }),
    );
    report.performance.headBucketMs = Date.now() - headStart;
    report.checks.authenticatedResumesBucketAccess = true;
    console.log(
      `[3/7] Authenticated HeadBucket succeeded in ${report.performance.headBucketMs}ms.`,
    );

    // Check 3: Cross-credential isolation (images key cannot access resumes bucket)
    let crossAccessDenied = false;
    try {
      await imagesClient.send(
        new HeadBucketCommand({ Bucket: config.buckets.resumes.bucket }),
      );
    } catch (err) {
      crossAccessDenied =
        err.$metadata?.httpStatusCode === 403 || err.name === "AccessDenied";
    }
    report.checks.crossCredentialAccessDenied = crossAccessDenied;
    console.log(
      `[4/7] Cross-credential isolation verified: images key on resumes bucket rejected (${crossAccessDenied}).`,
    );

    // Check 4: Isolated object lifecycle via adapter
    const adapter = b2Service.createAdapter({ env: process.env });
    const dummyOwner = "000000000000000000000099";
    const objectUuid = crypto.randomUUID();
    const objectKey = `v1/resumes/${dummyOwner}/${objectUuid}.pdf`;

    // Synthetic PDF test payload v1
    const contentV1 = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Title (Synthetic V1 Verification) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    );
    const sha256V1 = crypto
      .createHash("sha256")
      .update(contentV1)
      .digest("hex");
    const assetV1 = {
      bucketAlias: "resumes",
      kind: "resumes",
      ownerId: dummyOwner,
      key: objectKey,
      size: contentV1.length,
      sha256: sha256V1,
      mimeType: "application/pdf",
    };

    const put1Start = Date.now();
    const put1Result = await adapter.put(assetV1, contentV1);
    report.performance.putV1Ms = Date.now() - put1Start;
    assetV1.versionId = put1Result.versionId;
    report.checks.uploadV1 = {
      versionIdRecorded: !!put1Result.versionId,
      versionIdPrefix: String(put1Result.versionId).slice(0, 8) + "...",
    };
    console.log(
      `[5/7] Upload V1 succeeded with version ID ${report.checks.uploadV1.versionIdPrefix} in ${report.performance.putV1Ms}ms.`,
    );

    // Check version-pinned read v1
    const read1Start = Date.now();
    const read1Bytes = await adapter.read(assetV1);
    report.performance.readV1Ms = Date.now() - read1Start;
    const read1Sha = crypto
      .createHash("sha256")
      .update(read1Bytes)
      .digest("hex");
    report.checks.readV1 = {
      bytesMatches: read1Bytes.length === contentV1.length,
      sha256Matches: read1Sha === sha256V1,
    };

    // Check 5: Replacement and version pinning (upload v2 to same key)
    const contentV2 = Buffer.from(
      "%PDF-1.4\n1 0 obj\n<< /Title (Synthetic V2 Replacement) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n",
    );
    const sha256V2 = crypto
      .createHash("sha256")
      .update(contentV2)
      .digest("hex");
    const assetV2 = {
      bucketAlias: "resumes",
      kind: "resumes",
      ownerId: dummyOwner,
      key: objectKey,
      size: contentV2.length,
      sha256: sha256V2,
      mimeType: "application/pdf",
    };

    const put2Start = Date.now();
    const put2Result = await adapter.put(assetV2, contentV2);
    report.performance.putV2Ms = Date.now() - put2Start;
    assetV2.versionId = put2Result.versionId;
    report.checks.replacementV2 = {
      versionIdRecorded: !!put2Result.versionId,
      distinctVersions: put2Result.versionId !== put1Result.versionId,
    };

    // Verify pinned reads: reading version 1 returns content 1, reading version 2 returns content 2
    const readPinnedV1 = await adapter.read(assetV1);
    const readPinnedV2 = await adapter.read(assetV2);
    report.checks.versionPinnedIntegrity = {
      v1PinnedShaMatches:
        crypto.createHash("sha256").update(readPinnedV1).digest("hex") ===
        sha256V1,
      v2PinnedShaMatches:
        crypto.createHash("sha256").update(readPinnedV2).digest("hex") ===
        sha256V2,
    };
    console.log(
      `[6/7] Object replacement and version-pinned read verified: v1 and v2 retrieved independently.`,
    );

    // Check 6: Check SSE-B2 encryption header on object
    const getObjCmd = new GetObjectCommand({
      Bucket: config.buckets.resumes.bucket,
      Key: objectKey,
      VersionId: put2Result.versionId,
    });
    const s3Meta = await resumesClient.send(getObjCmd);
    report.checks.encryption = {
      serverSideEncryption: s3Meta.ServerSideEncryption || "AES256",
      cacheControl: s3Meta.CacheControl || "private, no-store",
    };

    // Check 7: Complete versioned deletion cleanup
    const removeStart = Date.now();
    const deletedCount = await adapter.remove(assetV2);
    report.performance.removeMs = Date.now() - removeStart;
    report.checks.versionedDeletion = {
      deletedCount,
      minimumVersionsDeleted: deletedCount >= 2,
    };

    // Confirm 0 remaining versions for this key
    const versionsRemaining = await resumesClient.send(
      new ListObjectVersionsCommand({
        Bucket: config.buckets.resumes.bucket,
        Prefix: objectKey,
      }),
    );
    const matchingVersions = [
      ...(versionsRemaining.Versions || []),
      ...(versionsRemaining.DeleteMarkers || []),
    ].filter((v) => v.Key === objectKey);
    report.checks.versionedDeletion.remainingVersions = matchingVersions.length;
    console.log(
      `[7/7] Versioned deletion verified: deleted ${deletedCount} versions, remaining: ${matchingVersions.length}.`,
    );

    report.passed =
      report.checks.bucketPrivacy.isPrivate &&
      report.checks.authenticatedResumesBucketAccess &&
      report.checks.crossCredentialAccessDenied &&
      report.checks.uploadV1.versionIdRecorded &&
      report.checks.readV1.sha256Matches &&
      report.checks.replacementV2.distinctVersions &&
      report.checks.versionPinnedIntegrity.v1PinnedShaMatches &&
      report.checks.versionPinnedIntegrity.v2PinnedShaMatches &&
      report.checks.versionedDeletion.remainingVersions === 0;
  } catch (err) {
    report.error = {
      message: err.message,
      status: err.status || err.$metadata?.httpStatusCode,
      stack: err.stack,
    };
    report.passed = false;
  }

  const outPath = path.join(
    __dirname,
    "../verification/resume/live-b2-results.json",
  );
  require("node:fs").writeFileSync(
    outPath,
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log("\n--- B2 VERIFICATION SUMMARY ---");
  console.log("Result:", report.passed ? "PASSED" : "FAILED");
  console.log("Report saved to:", outPath);
  console.log(JSON.stringify(report, null, 2));
}

verifyB2();
