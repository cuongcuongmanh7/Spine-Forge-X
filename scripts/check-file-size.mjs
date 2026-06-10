// File-size guard (no external deps). Keeps source files from growing without bound.
//
// Policy: every source file has a line ceiling. New files default to DEFAULT_MAX.
// A few files are already much larger; they're "baselined" at their current size as a
// ratchet — they may shrink but not grow. When you refactor one smaller, lower its
// baseline here (or delete the entry once it drops under DEFAULT_MAX) so the ratchet tightens.
//
// Run: `node scripts/check-file-size.mjs` (also runs as part of `npm run build`).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOTS = ['src', 'src-tauri/src'];
const EXTENSIONS = ['.ts', '.tsx', '.rs', '.css'];
const DEFAULT_MAX = 800;

// Grandfathered files: current line count is their ceiling. Lower these as they shrink.
const BASELINE = {
  // Ratcheted down in v0.2.14 (presets.rs + system.rs split out of lib.rs).
  'src-tauri/src/lib.rs': 2713,
  // styles.css and useAppController slipped past their ceilings in commits that
  // didn't run the build guard (pre-v0.2.14); re-baselined at their actual size.
  'src/styles.css': 2553,
  'src/useAppController.tsx': 1701
};

/** Recursively collect source files under a root directory. */
function collect(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'target') continue;
      collect(full, out);
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
}

const files = [];
for (const root of ROOTS) {
  try {
    if (statSync(root).isDirectory()) collect(root, files);
  } catch {
    // root missing — skip
  }
}

const violations = [];
const slack = []; // baselined files now well under their ceiling → suggest tightening

for (const file of files) {
  const rel = relative('.', file).split(sep).join('/');
  // Count newlines (matches `wc -l`) so baselines stay consistent regardless of trailing newline.
  const lines = (readFileSync(file, 'utf8').match(/\n/g) || []).length;
  const ceiling = BASELINE[rel] ?? DEFAULT_MAX;
  if (lines > ceiling) {
    violations.push({ rel, lines, ceiling });
  } else if (BASELINE[rel] && lines <= BASELINE[rel] - 100) {
    slack.push({ rel, lines, ceiling });
  }
}

if (slack.length) {
  console.log('ℹ︎ Baselined files have shrunk — consider lowering their ceiling in scripts/check-file-size.mjs:');
  for (const s of slack) console.log(`    ${s.rel}: ${s.lines} lines (baseline ${s.ceiling})`);
}

if (violations.length) {
  console.error(`\n✖ File-size guard: ${violations.length} file(s) over their line ceiling.`);
  for (const v of violations) {
    const over = v.lines - v.ceiling;
    console.error(`    ${v.rel}: ${v.lines} lines (ceiling ${v.ceiling}, +${over})`);
  }
  console.error(
    `\n  New files cap at ${DEFAULT_MAX} lines. Split a feature into its own module instead of growing a file.\n` +
      `  If a larger ceiling is genuinely justified, raise the baseline in scripts/check-file-size.mjs.`
  );
  process.exit(1);
}

console.log(`✓ File-size guard: ${files.length} files within limits (default ${DEFAULT_MAX} lines).`);
