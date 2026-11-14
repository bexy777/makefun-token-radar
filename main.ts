// Token Radar — a make.fun token-radar-01 entry on Node 22, standard library only.
//
// What this file does, in order:
//   1. reads the sealed DefiLlama snapshot (snapshot.json under --input, or /input),
//   2. scores every pre-token protocol with the comparable-multiple model in lib/model.ts,
//   3. writes the ranked board (board.json) and the dashboard's data feed (data.js),
//   4. copies this repo's dashboard/ and screenshots/ into the output directory,
//   5. writes dossier.json last, rebuilt by the vendored make.fun library from the output itself.
//
// The dashboard is a static page with no framework and no network calls: it reads data.js,
// which is written from the same board object as board.json, so the page can never disagree
// with the ranked rows. The screenshots are captures of that page at 1440x900.
//
// Local run:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boardIssue,
  buildRadar,
  dataScript,
  parseSnapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Caps the scorer enforces on this entry's own outputs (see reference/gate.json).
const DOSSIER_TEXT_LIMIT = 65_536;
const SHOT_LIMITS = { max: 4, maxBytes: 524_288 };
const DASH_LIMITS = { maxFiles: 400, maxBytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print a message to stderr and stop with the given exit code. */
function die(message: string, code: number): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

/** Read `--flag value` or `--flag=value` from the process arguments. */
function flagValue(flag: string, fallback: string): string {
  const needle = `--${flag}`;
  for (let i = 2; i < process.argv.length; i++) {
    const token = process.argv[i]!;
    if (token === needle && i + 1 < process.argv.length) return process.argv[i + 1]!;
    if (token.startsWith(`${needle}=`)) return token.slice(needle.length + 1);
  }
  return fallback;
}

const inputArg = flagValue('input', '/input');
const snapshotPath = inputArg.endsWith('.json')
  ? inputArg
  : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const boardProblem = boardIssue(board, snapshot);
if (boardProblem !== null) {
  die(`the model wrote a board the gate refuses: ${boardProblem}`, 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `dest`, skipping dotfiles; returns the copied names. */
function copyDirectory(source: string, dest: string): string[] {
  if (!existsSync(source)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const entry of readdirSync(source)) {
    if (entry.startsWith('.')) continue;
    const from = join(source, entry);
    if (!statSync(from).isFile()) continue;
    copyFileSync(from, join(dest, entry));
    names.push(entry);
  }
  return names;
}

copyDirectory(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDirectory(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`, 1);
}
for (const shot of shots) {
  if (!SHOT_NAME.test(shot)) {
    die(`screenshots/${shot}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
const dossierOptions = {
  text_max_bytes: DOSSIER_TEXT_LIMIT,
  screenshots: { max: SHOT_LIMITS.max, max_bytes: SHOT_LIMITS.maxBytes },
  dashboard: { max_files: DASH_LIMITS.maxFiles, max_bytes: DASH_LIMITS.maxBytes },
};
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, dossierOptions));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
