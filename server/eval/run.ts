// CLI entrypoint for the Waypoint eval harness.
//
//   npm run eval                          → grades every server/examples/*.md
//   npm run eval -- path/to/packet.md     → grades only the supplied paths
//
// Prints a per-packet breakdown plus an aggregate summary, writes a JSON
// report to eval/last-report.json, and exits 1 if any packet fails so CI
// can gate on it.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { grade, type RubricResult } from "./rubric.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve repo paths relative to this compiled file:
//   dist/eval/run.js  →  ../../  is the server root.
const SERVER_ROOT = resolve(__dirname, "..", "..");
const EXAMPLES_DIR = join(SERVER_ROOT, "examples");
const SOURCE_EVAL_DIR = resolve(SERVER_ROOT, "eval");

function discoverDefaultPackets(): string[] {
  try {
    return readdirSync(EXAMPLES_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(EXAMPLES_DIR, f))
      .sort();
  } catch {
    return [];
  }
}

function loadPacket(path: string): { label: string; body: string } {
  const body = readFileSync(path, "utf8");
  return { label: basename(path), body };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function formatResult(r: RubricResult): string {
  const lines: string[] = [];
  const verdict = r.passed ? "PASS" : "FAIL";
  lines.push(`── ${r.packet_label} ── ${verdict} (${r.total_score}/100)`);
  for (const it of r.items) {
    const mark = it.passed ? "✓" : "✗";
    const w = `[${it.weight}%]`;
    const detail = it.detail ? `  (${it.detail})` : "";
    lines.push(
      `  ${mark} ${pad(it.id, 32)} ${pad(w, 6)} ${pad(it.score.toFixed(2), 5)} ${it.description}${detail}`
    );
  }
  const errs = r.lint.findings.filter((f) => f.severity === "error").length;
  const warns = r.lint.findings.filter((f) => f.severity === "warn").length;
  lines.push(`  lint: score=${r.lint.score}  errors=${errs}  warns=${warns}`);
  return lines.join("\n");
}

function main(): number {
  const args = process.argv.slice(2);
  const paths = args.length > 0 ? args.map((a) => resolve(a)) : discoverDefaultPackets();

  if (paths.length === 0) {
    console.error(
      "No packets to grade. Pass markdown paths as args or populate server/examples/*.md."
    );
    return 1;
  }

  const results: RubricResult[] = [];
  for (const p of paths) {
    let packet;
    try {
      packet = loadPacket(p);
    } catch (err) {
      console.error(`✗ Could not read ${p}: ${(err as Error).message}`);
      results.push({
        packet_label: basename(p),
        total_score: 0,
        passed: false,
        lint: {
          ok: false,
          score: 0,
          findings: [
            { rule: "io-error", severity: "error", message: String(err) },
          ],
          stats: {
            sections_found: [],
            sections_missing: [],
            udl_citations: 0,
            iep_citations: 0,
            compound_citations: 0,
            fabricated_udl_ids: 0,
            verbatim_accommodation_hits: 0,
            word_count: 0,
          },
        },
        items: [],
      });
      continue;
    }
    const r = grade(packet.body, packet.label);
    results.push(r);
    console.log(formatResult(r));
    console.log("");
  }

  // Aggregate summary
  const passedCount = results.filter((r) => r.passed).length;
  const mean =
    results.reduce((sum, r) => sum + r.total_score, 0) / Math.max(1, results.length);
  console.log("════════════════════════════════════════════════════════════════");
  console.log(
    `Mean score: ${mean.toFixed(1)} / 100  over ${results.length} packet${results.length === 1 ? "" : "s"}, ${passedCount}/${results.length} passed`
  );
  console.log("════════════════════════════════════════════════════════════════");

  // JSON report (next to source eval/, not compiled dist/eval/)
  try {
    mkdirSync(SOURCE_EVAL_DIR, { recursive: true });
    const reportPath = join(SOURCE_EVAL_DIR, "last-report.json");
    writeFileSync(
      reportPath,
      JSON.stringify(
        { generated_at: new Date().toISOString(), results },
        null,
        2
      )
    );
    console.log(`Wrote JSON report → ${reportPath}`);
  } catch (err) {
    console.error(`Could not write JSON report: ${(err as Error).message}`);
  }

  return passedCount === results.length ? 0 : 1;
}

process.exit(main());
