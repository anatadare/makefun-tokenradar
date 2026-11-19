// Token Radar: read the frozen snapshot, build the ranked board, and write the
// entry's outputs. Run with no arguments in the grader (`/input/snapshot.json`
// in, `/output` out), or locally as:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>
//
// The run is deterministic: the same snapshot always writes the same bytes,
// so the grader's two runs agree. dossier.json is written last, from the
// dashboard/ and screenshots/ the run just copied, so it is byte for byte
// what buildDossier writes from them.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, boardIssue, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = dirname(fileURLToPath(import.meta.url));
const DOSSIER_GATE_BYTES = 1572864; // 1.5 MiB: the gate's dossier cap
const DASHBOARD_READ_BYTES = 64000; // past this the judge reads partial source

function fail(message: string): never {
  console.error(`token-radar: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = '/input/snapshot.json';
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--input' && i + 1 < argv.length) input = argv[++i]!;
    else if (argv[i] === '--output' && i + 1 < argv.length) output = argv[++i]!;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: node main.ts [--input <snapshot.json|dir>] [--output <dir>]');
      console.log('  input defaults to /input/snapshot.json; output to $MAKEFUN_OUTPUT_DIR or /output');
      process.exit(0);
    } else {
      fail(`unknown argument ${argv[i]} (see --help)`);
    }
  }
  return { input, output };
}

/** Copy a directory tree of regular files, refusing links and dot-directories. */
function copyTree(src: string, dst: string): { files: number; bytes: number } {
  if (!existsSync(src) || !statSync(src).isDirectory()) fail(`missing directory ${src}`);
  mkdirSync(dst, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) fail(`${from} is a dot-directory`);
      const sub = copyTree(from, to);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      copyFileSync(from, to);
      files++;
      bytes += statSync(from).size;
    } else {
      fail(`${from} is neither a file nor a directory`);
    }
  }
  return { files, bytes };
}

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));

  let snapshotPath = input;
  if (existsSync(snapshotPath) && statSync(snapshotPath).isDirectory()) {
    snapshotPath = join(snapshotPath, 'snapshot.json');
  }
  if (!existsSync(snapshotPath)) {
    fail(`snapshot not found at ${snapshotPath} (pass --input <snapshot.json|dir>)`);
  }
  let snapshot;
  try {
    snapshot = parseSnapshot(JSON.parse(readFileSync(snapshotPath, 'utf8')));
  } catch (err) {
    fail(`cannot read the snapshot at ${snapshotPath}: ${(err as Error).message}`);
  }

  const board = buildBoard(snapshot);
  const issue = boardIssue(board.rows, snapshot);
  if (issue !== null) fail(`board failed validation: ${issue}`);

  const outDir = resolve(output);
  if (outDir === '/' || outDir === resolve(REPO_ROOT)) {
    fail(`refusing to use ${outDir} as the output directory`);
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board.rows }, null, 2)}\n`, 'utf8');
  const data = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    watchlist_count: snapshot.watchlist.length,
    rows: board.rows,
  };
  writeFileSync(join(outDir, 'data.js'), `const BOARD_DATA = ${JSON.stringify(data)};\n`, 'utf8');

  const dash = copyTree(join(REPO_ROOT, 'dashboard'), join(outDir, 'dashboard'));
  copyTree(join(REPO_ROOT, 'screenshots'), join(outDir, 'screenshots'));
  if (dash.bytes >= DASHBOARD_READ_BYTES) {
    console.error(
      `token-radar: warning: dashboard source is ${dash.bytes} bytes, past ${DASHBOARD_READ_BYTES}; the judge reads partial source`,
    );
  }

  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  if (dossier.length > DOSSIER_GATE_BYTES) {
    fail(`dossier is ${dossier.length} bytes, past the gate's ${DOSSIER_GATE_BYTES} (shrink the screenshots)`);
  }
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const s = board.stats;
  console.log(
    `token-radar: wrote ${outDir}: ${s.rows} rows (${s.watchlist_rows} watchlist, ${s.candidate_rows} candidates, ${s.comparable_rows} token comparables), ` +
      `implied value $${s.min_value.toLocaleString('en-US')} to $${s.max_value.toLocaleString('en-US')}, ` +
      `dashboard ${dash.files} files / ${dash.bytes} bytes, dossier ${dossier.length} bytes`,
  );
}

main();
