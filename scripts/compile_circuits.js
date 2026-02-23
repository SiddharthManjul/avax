#!/usr/bin/env node
/**
 * compile_circuits.js
 *
 * Compiles all ZkToken Circom circuits in one shot.
 *
 * Outputs per circuit (inside circuits/build/<name>/):
 *   <name>.r1cs   — constraint system
 *   <name>.sym    — symbol table (for debugging)
 *   <name>_js/    — WASM witness generator + HTML test harness
 *
 * Usage:
 *   node scripts/compile_circuits.js
 *
 * Flags:
 *   --verbose     Show full circom output
 *   --O2          Use O2 constraint simplification (slower, fewer constraints)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT         = path.resolve(__dirname, '..');
const CIRCUITS_DIR = path.join(ROOT, 'circuits');
const BUILD_DIR    = path.join(CIRCUITS_DIR, 'build');
const LIB_DIR      = path.join(CIRCUITS_DIR, 'node_modules'); // circomlib lives here

const VERBOSE = process.argv.includes('--verbose');
const OPT     = process.argv.includes('--O2') ? '--O2' : '--O1';

const CIRCUITS = [
    { name: 'transfer', file: 'transfer.circom' },
    { name: 'withdraw', file: 'withdraw.circom' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkCircom() {
    const r = spawnSync('circom', ['--version'], { encoding: 'utf8' });
    if (r.status !== 0 || r.error) {
        console.error('ERROR: circom not found in PATH.');
        console.error('Install from: https://github.com/iden3/circom');
        process.exit(1);
    }
    return r.stdout.trim();
}

function parseConstraints(output) {
    // circom prints: "non-linear constraints: 12345"
    const m = output.match(/non-linear constraints:\s*(\d+)/);
    return m ? Number(m[1]).toLocaleString() : null;
}

function formatDuration(ms) {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const version = checkCircom();
console.log(`${version}`);
console.log(`Optimization: ${OPT}`);
console.log(`Output:       circuits/build/\n`);
console.log('─'.repeat(52));

fs.mkdirSync(BUILD_DIR, { recursive: true });

let passed = 0;
let failed = 0;

for (const { name, file } of CIRCUITS) {
    const outDir = path.join(BUILD_DIR, name);
    fs.mkdirSync(outDir, { recursive: true });

    process.stdout.write(`Compiling ${name}.circom ... `);

    const t0 = Date.now();

    const result = spawnSync(
        'circom',
        [
            file,
            '--r1cs',
            '--wasm',
            '--sym',
            '--output', outDir,
            '--prime', 'bn128',
            '-l', LIB_DIR,
            OPT,
        ],
        {
            encoding: 'utf8',
            cwd: CIRCUITS_DIR,
        }
    );

    const elapsed = Date.now() - t0;
    const output  = (result.stdout || '') + (result.stderr || '');

    if (result.status !== 0 || result.error) {
        console.log(`FAIL (${formatDuration(elapsed)})`);
        console.error('\n' + (result.stderr || result.error?.message || 'unknown error'));
        failed++;
    } else {
        const constraints = parseConstraints(output);
        const cStr = constraints ? ` — ${constraints} constraints` : '';
        console.log(`OK (${formatDuration(elapsed)})${cStr}`);

        if (VERBOSE) {
            console.log(output.trim().split('\n').map(l => '  ' + l).join('\n'));
        }
        passed++;
    }
}

console.log('─'.repeat(52));
console.log(`${passed} passed, ${failed} failed\n`);

if (failed > 0) {
    console.error('Fix the errors above and re-run.');
    process.exit(1);
}

console.log('Next steps:');
console.log('  1. Trusted setup  →  node scripts/setup_ceremony.js');
console.log('  2. Export verifier →  bash scripts/generate_verifier.sh');
