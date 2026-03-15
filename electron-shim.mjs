// This file is a shim to test electron API access in ESM mode
// It tries to dynamically load the real electron module
const moduleName = 'electron';
let electronAPI;

try {
  // Try to require electron as a built-in
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  electronAPI = require(moduleName);
  console.log('require electron type:', typeof electronAPI);
} catch(e) {
  console.log('require failed:', e.message);
}

console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);
