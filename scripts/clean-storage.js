#!/usr/bin/env node
// Wipes both Electron storage dirs. Run after any schema change
// (add/remove/rename/reorder fields in `schema.js`) — compact-encoding
// is positional, so old on-disk bytes become undecodable.
//
// Usage:
//   node scripts/clean-storage.js           # with confirmation prompt
//   node scripts/clean-storage.js --force   # no prompt
//
// Wired up as `npm run clean:storage` and `npm run clean:storage:force`.

const fs = require('fs')
const os = require('os')
const path = require('path')

const FORCE = process.argv.includes('--force') || process.env.FORCE === '1'

const repoRoot = path.resolve(__dirname, '..')
const tmpDir = os.tmpdir()

// Host's storage when launched with no --storage flag. `start` doesn't
// pass one, so the host uses <tmpdir>/pear/<productName>. We resolve the
// product name from the same package.json the host reads.
const pkg = require(path.join(repoRoot, 'package.json'))
const productName = pkg.productName || pkg.name

const targets = [
  {
    label: 'guest (./tmp-tamarind-guest)',
    path: path.join(repoRoot, 'tmp-tamarind-guest')
  },
  {
    label: `host (<tmpdir>/pear/${productName})`,
    path: path.join(tmpDir, 'pear', productName)
  }
]

function exists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function wipe(p) {
  if (!exists(p)) return false
  try {
    fs.rmSync(p, { recursive: true, force: true })
    return true
  } catch (err) {
    console.error(`  ! failed to wipe ${p}: ${err.message}`)
    return false
  }
}

console.log('Will wipe:')
for (const t of targets) {
  const present = exists(t.path)
  const size = present ? fs.statSync(t.path).size : 0
  const count = present ? fs.readdirSync(t.path, { withFileTypes: true }).length : 0
  console.log(`  - ${t.label}`)
  console.log(`      ${t.path}  (${present ? `${count} entries` : 'absent'})`)
}

if (!FORCE) {
  const readline = require('readline')
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question('\nProceed? [y/N] ', (answer) => {
    rl.close()
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted.')
      process.exit(0)
    }
    doWipe()
  })
} else {
  doWipe()
}

function doWipe() {
  console.log('')
  for (const t of targets) {
    const ok = wipe(t.path)
    console.log(`  ${ok ? '✓' : '·'} ${t.label}  ${ok ? '(wiped)' : '(absent or already gone)'}`)
  }
  console.log('\nDone. Restart `npm start` and `npm run start:guest` to mint fresh Corestores.')
}
