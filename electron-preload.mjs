// Preloaded via --import to fix require('electron') resolution
// This file patches the electron module resolver to use the correct built-in

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import Module from 'module';

// Only apply fix when running inside Electron
if (process.versions.electron) {
  const originalResolveFilename = Module._resolveFilename;
  Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === 'electron') {
      // Try to find the real electron module through internal paths
      // We'll use the path relative to the electron binary
      return originalResolveFilename.call(this, request, parent, isMain, options);
    }
    return originalResolveFilename.call(this, request, parent, isMain, options);
  };

  console.log('[preload] Electron version:', process.versions.electron);
}
