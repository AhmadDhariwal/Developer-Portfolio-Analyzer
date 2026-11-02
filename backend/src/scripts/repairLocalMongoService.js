'use strict';

// Explicit Windows development repair. Default mode only prints the proposed changes.
// --apply requires an elevated terminal and preserves the original database and config.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const destinationRoot = 'D:\\DevInsightLocal\\MongoDB';
const quotePS = (value) => `'${String(value).replaceAll("'", "''")}'`;
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const powershell = (command) =>
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; ${command}`],
    {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  ).trim();

function storageConfiguration(original, dataDirectory, logFile) {
  const data = original.match(/^(\s*dbPath:\s*)(.+)$/m);
  const log = original.match(/^(\s*path:\s*)(.+)$/m);
  if (!data || !log) throw new Error('Expected a single dbPath and systemLog path in mongod.cfg.');
  if (
    (original.match(/^\s*dbPath:/gm) || []).length !== 1 ||
    (original.match(/^\s*path:/gm) || []).length !== 1
  )
    throw new Error('Ambiguous MongoDB configuration; no automatic edit performed.');
  return original
    .replace(data[0], `${data[1]}${JSON.stringify(dataDirectory)}`)
    .replace(log[0], `${log[1]}${JSON.stringify(logFile)}`);
}

function filesUnder(directory) {
  const root = fs.realpathSync(directory),
    files = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Database copy refuses symbolic links.');
      if (!path.resolve(file).startsWith(root + path.sep))
        throw new Error('Database copy escaped its source root.');
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile())
        files.push({
          relative: path.relative(root, file),
          bytes: fs.statSync(file).size,
          sha256: hash(file)
        });
      else throw new Error('Unsupported database filesystem entry.');
    }
  }
  visit(root);
  return files;
}

function copyDatabase(source, destination) {
  const sourceRoot = fs.realpathSync(source),
    targetRoot = path.resolve(destination);
  if (
    targetRoot === sourceRoot ||
    targetRoot.startsWith(sourceRoot + path.sep) ||
    sourceRoot.startsWith(targetRoot + path.sep)
  )
    throw new Error('Source and destination must be separate directories.');
  const manifest = filesUnder(sourceRoot);
  fs.mkdirSync(targetRoot, { recursive: true });
  for (const file of manifest) {
    const target = path.join(targetRoot, file.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || hash(target) !== file.sha256)
        throw new Error(`Destination already contains different data: ${file.relative}`);
    } else
      fs.copyFileSync(path.join(sourceRoot, file.relative), target, fs.constants.COPYFILE_EXCL);
    if (hash(target) !== file.sha256 || hash(path.join(sourceRoot, file.relative)) !== file.sha256)
      throw new Error(`Database copy verification failed: ${file.relative}`);
  }
  return manifest;
}

function service() {
  return JSON.parse(
    powershell(
      'Get-CimInstance Win32_Service -Filter "Name=\'MongoDB\'" | Select-Object State,StartName,PathName | ConvertTo-Json -Compress'
    )
  );
}

async function verifyConnection() {
  const { MongoClient } = require('mongodb');
  const client = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true', {
    serverSelectionTimeoutMS: 20000
  });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    let hello;
    const deadline = Date.now() + 20000;
    do {
      hello = await client.db('admin').command({ hello: 1 });
      if (hello.isWritablePrimary) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    if (!hello.isWritablePrimary || hello.setName !== 'rs0')
      throw new Error('MongoDB did not recover as the existing rs0 primary.');
    return { ping: 'passed', replicaSet: hello.setName, writablePrimary: true };
  } finally {
    await client.close();
  }
}

async function main(apply) {
  if (process.platform !== 'win32')
    throw new Error('This repair is for the inspected Windows development service only.');
  const envFile = path.resolve(__dirname, '../../.env');
  const env = require('dotenv').parse(fs.readFileSync(envFile));
  const uri = new URL(
    process.env.MONGODB_URI || process.env.MONGO_URI || env.MONGODB_URI || env.MONGO_URI || ''
  );
  if (
    (process.env.NODE_ENV || env.NODE_ENV) === 'production' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname) ||
    (uri.port && uri.port !== '27017')
  )
    throw new Error('Repair refuses non-local or production application configuration.');
  const current = service();
  if (!current || current.StartName !== 'NT AUTHORITY\\NetworkService')
    throw new Error('Unexpected MongoDB service account; review the service manually.');
  const configPath = current.PathName.match(/--config\s+"([^"]+)"/)?.[1];
  if (!configPath) throw new Error('Cannot resolve the existing service configuration.');
  const original = fs.readFileSync(configPath, 'utf8');
  const yaml = require('yaml');
  const configuration = yaml.parse(original);
  if (
    configuration.net?.port !== 27017 ||
    configuration.net?.bindIp !== '127.0.0.1' ||
    configuration.replication?.replSetName !== 'rs0'
  )
    throw new Error('Unexpected bind, port or replica set; refusing automatic edits.');
  const source = configuration.storage?.dbPath;
  const data = path.join(destinationRoot, 'data'),
    log = path.join(destinationRoot, 'log', 'mongod.log');
  const markerFile = path.join(destinationRoot, 'repair-state.json');
  const alreadyConfigured = path.resolve(source).toLowerCase() === path.resolve(data).toLowerCase();
  const plan = {
    service: 'MongoDB',
    source,
    destination: data,
    log,
    configPath,
    preserveOriginal: true,
    port: 27017,
    bindIp: '127.0.0.1',
    replicaSet: 'rs0',
    failureRecovery: 'Restart after 60 seconds; automatic startup',
    administratorRequired: true
  };
  if (!apply) {
    console.log(JSON.stringify({ mode: 'read-only plan', ...plan }, null, 2));
    return;
  }
  const admin = powershell(
    '([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  );
  if (admin !== 'True')
    throw new Error(
      'Windows Administrator approval is required. Run this script with --apply from an elevated terminal.'
    );
  const marker = fs.existsSync(markerFile) ? JSON.parse(fs.readFileSync(markerFile, 'utf8')) : null;
  if (
    fs.existsSync(destinationRoot) &&
    fs.readdirSync(destinationRoot).length &&
    marker?.operation !== 'devinsight-local-mongodb-recovery-v1'
  )
    throw new Error('Destination is not owned by this repair; no files overwritten.');
  let manifest = [];
  if (!alreadyConfigured) {
    if (current.State !== 'Stopped')
      throw new Error(
        'MongoDB must be stopped before copying its existing data. No running database was stopped.'
      );
    const sourceFiles = filesUnder(source);
    const available = fs.statfsSync(path.parse(destinationRoot).root);
    if (
      available.bavail * available.bsize <
      sourceFiles.reduce((sum, file) => sum + file.bytes, 0) + 1024 ** 3
    )
      throw new Error('Insufficient destination free space.');
    if (marker && (marker.source !== source || marker.configSha256 !== hash(configPath)))
      throw new Error('Existing repair state does not match the original configuration.');
    fs.mkdirSync(destinationRoot, { recursive: true });
    const state = {
      operation: 'devinsight-local-mongodb-recovery-v1',
      source,
      configSha256: hash(configPath),
      startedAt: new Date().toISOString()
    };
    fs.writeFileSync(markerFile, JSON.stringify(state, null, 2));
    const backup = path.join(destinationRoot, 'mongod.cfg.before');
    if (!fs.existsSync(backup)) fs.copyFileSync(configPath, backup, fs.constants.COPYFILE_EXCL);
    if (hash(backup) !== state.configSha256)
      throw new Error('Configuration backup does not match.');
    manifest = copyDatabase(source, data);
    fs.writeFileSync(
      path.join(destinationRoot, 'copy-manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
    if (service().State !== 'Stopped' || hash(configPath) !== state.configSha256)
      throw new Error(
        'Service/configuration changed during copying; original configuration preserved.'
      );
  } else if (!marker) throw new Error('Destination has no verified repair state.');
  fs.mkdirSync(path.dirname(log), { recursive: true });
  execFileSync('icacls.exe', [destinationRoot, '/grant', '*S-1-5-20:(OI)(CI)M', '/T', '/Q'], {
    windowsHide: true,
    stdio: 'pipe'
  });
  const updated = storageConfiguration(original, data, log);
  if (!alreadyConfigured) fs.writeFileSync(configPath, updated);
  powershell(
    "Set-Service -Name MongoDB -StartupType Automatic; Start-Service -Name MongoDB; (Get-Service MongoDB).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))"
  );
  const health = await verifyConnection();
  execFileSync(
    'sc.exe',
    [
      'failure',
      'MongoDB',
      'reset=',
      '86400',
      'actions=',
      'restart/60000/restart/60000/restart/60000'
    ],
    { windowsHide: true, stdio: 'pipe' }
  );
  execFileSync('sc.exe', ['failureflag', 'MongoDB', '1'], { windowsHide: true, stdio: 'pipe' });
  const result = {
    ...plan,
    source: alreadyConfigured ? marker.source : source,
    ...health,
    filesVerified: manifest.length || marker.filesVerified,
    completedAt: new Date().toISOString(),
    originalDataDeleted: false
  };
  fs.writeFileSync(
    markerFile,
    JSON.stringify({ ...JSON.parse(fs.readFileSync(markerFile, 'utf8')), ...result }, null, 2)
  );
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { storageConfiguration, filesUnder, copyDatabase };
if (require.main === module)
  main(process.argv.includes('--apply')).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
