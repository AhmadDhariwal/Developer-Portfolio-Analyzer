// Allow `node index.js` from workspace root by delegating to backend entrypoint.
const path = require('node:path');
const fs = require('node:fs');

const backendDir = path.join(__dirname, 'backend');
const backendEntry = path.join(backendDir, 'index.js');

if (!fs.existsSync(backendEntry)) {
  console.error(`Backend entry not found at ${backendEntry}`);
  process.exit(1);
}

process.chdir(backendDir);
require(backendEntry);
