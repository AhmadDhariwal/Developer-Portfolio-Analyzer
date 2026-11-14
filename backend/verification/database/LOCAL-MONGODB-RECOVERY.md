# Local MongoDB recovery

Date: 1 November 2026 (Asia/Karachi). Branch: `fix/github`. Initial working tree/index: clean. PR target: not applicable.

## Diagnosis

The supplied `connect ECONNREFUSED 127.0.0.1:27017` at 13:00:30 UTC (6:00:30 PM Pakistan time) is caused by the local database service being stopped. No process is listening on port 27017.

The installed MongoDB 8.2 service's last fatal log entry, at 1:47 PM Pakistan time, reports failure to write `data/diagnostic.data/metrics.interim.temp`, followed by a fatal assertion and process termination. C: was exhausted during the preceding development session and has approximately 0.98 GiB free at this inspection; D: has approximately 105.7 GiB free. The service stores both data and its approximately 769 MB log on C:. This matches the documented behavior that [FTDC thread failures terminate MongoDB](https://www.mongodb.com/docs/manual/administration/full-time-diagnostic-data-capture/).

The service is set to Automatic startup, but `sc.exe qfailure MongoDB` shows no recovery actions. Automatic startup applies at boot; it did not recover the crashed service. Repeated application startup therefore repeats the connection-refused error.

## Concrete repair prepared

`backend/src/scripts/repairLocalMongoService.js` defaults to a read-only plan. Its explicit `--apply` mode:

1. Requires Windows Administrator rights and a local, non-production application connection.
2. Requires the existing service/account, loopback binding, port 27017 and replica set `rs0`.
3. Copies the stopped database to `D:/DevInsightLocal/MongoDB/data`. It verifies each source and destination file using SHA-256 and refuses conflicting destination files, nested copy targets or source symbolic links.
4. Preserves the original C: database and a copy of the original service configuration. No database files, collections or historical logs are deleted; no repair/reinitialization or schema migration is run.
5. Changes only the storage and log paths in the existing configuration, keeping the same binary, address, port and replica-set identity. The existing NetworkService account receives access to the new storage directory.
6. Starts the service and verifies a real ping and writable `rs0` primary before configuring 60-second failure recovery and automatic startup.

The active data would then be on D:. The original C: copy is a preserved offline copy, not an ongoing backup of later writes.

## Applied repair and live verification

**APPLIED AND VERIFIED.** After the first elevation request was canceled, the user explicitly authorized another Windows administrator prompt. The elevated repair completed at 6:38 PM Pakistan time. All **2,685 files** were copied and SHA-256 verified. The original C: data was not deleted.

Verified results:

- MongoDB Windows service: Running; startup: Automatic.
- Active data: `D:/DevInsightLocal/MongoDB/data`.
- Active log: `D:/DevInsightLocal/MongoDB/log/mongod.log`.
- Listener: `127.0.0.1:27017`.
- Real MongoDB ping: passed; existing replica set `rs0`: writable primary.
- The backend's actual `.env` and `src/config/db.js` connect successfully to `localhost` and pass ping/primary checks.
- Crash recovery: three configured 60-second restart actions; recovery reset: 86,400 seconds.
- Development API restored with the existing `node backend/index.js --api-only` mode. PID at verification: 18764; listener: `localhost:5000` (`::1`). The protected route responds with the expected HTTP 401 without credentials; the frontend's proxy targets that same localhost address. Background scheduled workers are disabled by this existing mode.

Preserved operational evidence:

- `D:/DevInsightLocal/MongoDB/repair-state.json`: completed repair and health results.
- `D:/DevInsightLocal/MongoDB/copy-manifest.json`: exact copied paths, sizes and hashes.
- `D:/DevInsightLocal/MongoDB/mongod.cfg.before`: original service configuration.
- `backend/verification/database/local-mongo-repair-apply.log`: successful elevated repair output.

For a future explicit recheck/apply from **PowerShell opened as Administrator**:

```powershell
Set-Location D:\Developer-Portfolio-Analyzer
node .\backend\src\scripts\repairLocalMongoService.js --apply
```

The utility recognizes the configured destination on subsequent runs and does not recopy over the active database. No further elevation or repair run is required for this completed operation.

## Validation and finalization

- Two Node tests passed: configuration preservation/ambiguous-config rejection, and byte-verified resumable copying/conflicting-file rejection/source preservation.
- Read-only repair plan passed against the actual service configuration.
- Both added JavaScript files passed explicit-path Prettier write/check and syntax checks.
- Git staged/unstaged whitespace checks passed. No frontend or application API implementation changed.
- Test-created fixture files and obsolete launcher PID records were removed by exact path. Original database files and logs remain preserved, and the original configuration was backed up before its two path values changed.

Exact repository files added:

- `D:/Developer-Portfolio-Analyzer/backend/src/scripts/repairLocalMongoService.js`
- `D:/Developer-Portfolio-Analyzer/backend/src/tests/localMongoRepair.test.js`
- `D:/Developer-Portfolio-Analyzer/backend/verification/database/LOCAL-MONGODB-RECOVERY.md`
- `D:/Developer-Portfolio-Analyzer/backend/verification/database/local-mongo-repair-apply.log` (retained live verification evidence)

No source files were moved or deleted. No commit, push, merge or deployment was performed.

External changes are limited to the copied local database/log directories, their service-account ACL, the two paths in `C:/Program Files/MongoDB/Server/8.2/bin/mongod.cfg`, and local MongoDB service startup/recovery settings. Bind address, port, replica-set identity, application connection configuration, schemas and credentials were preserved.
