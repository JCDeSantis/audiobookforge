#!/usr/bin/env node
// electron-builder 26.8.1 has two bugs when signing on macOS 15 Sequoia:
//   1. set-key-partition-list uses "apple-tool:,apple:" — missing "codesign:"
//      which Sequoia requires for codesign to access the private key.
//   2. importCerts() is passed the p12 cert password for -k, but
//      set-key-partition-list -k needs the KEYCHAIN password (random base64
//      generated in createKeychain). Wrong password = partition list not set.
//
// Even with those fixes, Sequoia blocks codesign from accessing private keys
// in file-based temp keychains during non-GUI/CI sessions. The root fix:
//   3. Intercept sign() in macCodeSign.js to use rcodesign (Rust-based codesign
//      that reads the p12 directly, bypassing the keychain entirely).
//   4. Intercept signDmg() in dmg-builder to also use rcodesign for DMG signing.
//
// Set CSC_LINK (p12 path) and CSC_KEY_PASSWORD env vars to activate rcodesign path.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function patch(relPath, patches) {
  const file = resolve(root, relPath)
  let code = readFileSync(file, 'utf8')

  let alreadyPatched = true
  for (const { after } of patches) {
    if (!code.includes(after)) {
      alreadyPatched = false
      break
    }
  }

  if (alreadyPatched) {
    console.log(`${relPath} already patched — skipping`)
    return
  }

  for (const { before, after } of patches) {
    if (!code.includes(before)) {
      console.error(`ERROR: patch target not found in ${relPath}:`)
      console.error(`  ${before.slice(0, 80)}`)
      console.error('electron-builder version may have changed — review scripts/patch-electron-builder-codesign.mjs')
      process.exit(1)
    }
    code = code.replace(before, after)
  }

  writeFileSync(file, code, 'utf8')
  console.log(`patched ${relPath}`)
}

// ── macCodeSign.js ────────────────────────────────────────────────────────────

patch('node_modules/app-builder-lib/out/codeSign/macCodeSign.js', [
  // Fix 1+2: add codesign: to partition list AND use keychainPassword not cert password
  {
    before: '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
    after:  '["set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", keychainPassword || password, keychainFile]',
  },
  // Fix 3: pass keychainPassword to importCerts at the call site
  {
    before: 'return await importCerts(keychainFile, certPaths, cscPasswords);',
    after:  'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);',
  },
  // Fix 4: add keychainPassword parameter to the function signature
  {
    before: 'async function importCerts(keychainFile, paths, keyPasswords) {',
    after:  'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword = "") {',
  },
  // Fix 5: intercept sign() — when CSC_LINK is set, bypass codesign entirely
  // and sign the .app directly from the p12 using rcodesign. This avoids the macOS 15
  // Sequoia regression where temp-keychain private-key access fails in CI sessions.
  //
  // Scope notes (rcodesign SettingsScope):
  //   @main — the root entity being signed (the .app's main executable)
  //   <relative-path> — filesystem path relative to the root entity being signed
  // Entitlements do NOT propagate to nested bundles automatically; each nested
  // .app helper in Contents/Frameworks needs its own -e scope:path flag.
  {
    before: `async function sign(opts) {
    return (0, builder_util_1.retry)(() => (0, osx_sign_1.signAsync)(opts), {
        retries: 3,
        interval: 5000,
        backoff: 5000,
    });
}`,
    after: `async function sign(opts) {
    if (process.env.CSC_LINK) {
        const { execFileSync } = require("child_process");
        const path = require("path");
        const fs = require("fs");
        const rcodesign = process.env.ABF_RCODESIGN_BIN || path.join(process.env.HOME || "", ".local/bin/rcodesign");
        const appPath = opts.app;
        const fileOpts = opts.optionsForFile ? opts.optionsForFile(appPath) : {};
        const rawEntitlements = fileOpts.entitlements || "build/entitlements.mac.plist";
        const entitlements = path.resolve(process.cwd(), rawEntitlements);
        process.stderr.write("[rcodesign] signing " + appPath + "\\n");
        process.stderr.write("[rcodesign] entitlements: " + entitlements + "\\n");
        const args = ["--config-file", "/dev/null", "sign", "--for-notarization",
            "--p12-file", process.env.CSC_LINK, "--p12-password", process.env.CSC_KEY_PASSWORD || "",
            "-e", "@main:" + entitlements];
        // Apply entitlements to each nested Helper .app bundle explicitly.
        // SettingsScope::Path uses filesystem-relative paths from the root entity.
        const frameworksDir = path.join(appPath, "Contents/Frameworks");
        if (fs.existsSync(frameworksDir)) {
            for (const entry of fs.readdirSync(frameworksDir)) {
                if (entry.endsWith(".app")) {
                    const scope = "Contents/Frameworks/" + entry;
                    args.push("-e", scope + ":" + entitlements);
                    process.stderr.write("[rcodesign] helper scope: " + scope + "\\n");
                }
            }
        }
        args.push(appPath);
        execFileSync(rcodesign, args, { stdio: "inherit" });
        return;
    }
    return (0, builder_util_1.retry)(() => (0, osx_sign_1.signAsync)(opts), {
        retries: 3,
        interval: 5000,
        backoff: 5000,
    });
}`,
  },
])

// ── dmg-builder/dmg.js ───────────────────────────────────────────────────────

patch('node_modules/dmg-builder/out/dmg.js', [
  // Fix 6: intercept signDmg() to use rcodesign when CSC_LINK is set
  {
    before: `    async signDmg(artifactPath) {
        if (!(0, macCodeSign_1.isSignAllowed)(false)) {
            return;
        }`,
    after: `    async signDmg(artifactPath) {
        if (process.env.CSC_LINK) {
            const { execFileSync } = require("child_process");
            const rcodesign = process.env.ABF_RCODESIGN_BIN || require("path").join(process.env.HOME || "", ".local/bin/rcodesign");
            execFileSync(rcodesign, ["--config-file", "/dev/null", "sign", "--for-notarization", "--p12-file", process.env.CSC_LINK, "--p12-password", process.env.CSC_KEY_PASSWORD || "", artifactPath], { stdio: "inherit" });
            return;
        }
        if (!(0, macCodeSign_1.isSignAllowed)(false)) {
            return;
        }`,
  },
])
