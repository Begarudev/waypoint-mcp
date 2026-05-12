// Tests for lintModificationPacket. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintModificationPacket } from "./lint.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/_lint.test.js → server/examples/...
const EXAMPLE_PATH = resolve(__dirname, "..", "examples", "jasmine_community_lesson.md");

const MINIMAL_COMPLIANT = `# Differentiation Packet — Test Student

## 1. Student snapshot
- Snapshot content. Repeat directions are core. *(UDL 1.1: foo, IEP: plaafp_academics)*

## 2. Lesson at a glance
- Objective: x. *(UDL 2.1: bar, IEP: plaafp_academics)*

## 3. Accommodation checklist
- Repeat directions
- Extra time
- 1:1 check ins

## 4. UDL-aligned modifications
- mod one *(UDL 3.1: baz, IEP: goals_ela)*
- mod two *(UDL 4.1: qux, IEP: plaafp_behavioral)*
- mod three *(UDL 5.1: quux, IEP: accommodations)*
- mod four *(UDL 6.1: corge, IEP: goals_counseling)*

## 5. Scaffolded question ladder
- DOK 1: x

## 6. Leveled passage
| Original | Leveled |
|---|---|
| a | b |

## 7. Alternative assessment
- Task: x

## 8. Teacher cheat-sheet
- bullet
`;

test("minimal compliant packet scores 100 and ok=true", () => {
  const r = lintModificationPacket(MINIMAL_COMPLIANT);
  assert.equal(r.ok, true);
  assert.equal(r.score, 100);
  assert.deepEqual(r.stats.sections_missing, []);
  assert.equal(r.stats.udl_citations, 6);
  assert.ok(r.stats.verbatim_accommodation_hits >= 1);
});

test("missing §6 (Leveled passage) produces a missing-section finding and lowers score", () => {
  const md = MINIMAL_COMPLIANT.replace(
    /## 6\. Leveled passage[\s\S]*?(?=## 7\.)/,
    ""
  );
  const r = lintModificationPacket(md);
  assert.equal(r.ok, false);
  assert.ok(r.score < 100);
  const missing = r.findings.filter((f) => f.rule === "missing-section");
  assert.equal(missing.length, 1);
  assert.match(missing[0].message, /Leveled passage/);
  assert.ok(r.stats.sections_missing.includes("Leveled passage"));
});

test("compound `+ Action.G5` citation flags both bad-udl-citation and fabricated-udl-id", () => {
  const md =
    MINIMAL_COMPLIANT +
    "\n- bonus mod *(UDL 3: Building Knowledge + Action.G5, IEP: goals_ela)*\n";
  const r = lintModificationPacket(md);
  const bad = r.findings.find((f) => f.rule === "bad-udl-citation");
  const fab = r.findings.find((f) => f.rule === "fabricated-udl-id");
  assert.ok(bad, "expected a bad-udl-citation finding");
  assert.ok(fab, "expected a fabricated-udl-id finding");
  assert.equal(bad?.severity, "error");
  assert.equal(fab?.severity, "error");
  assert.ok(r.stats.compound_citations >= 1);
  assert.ok(r.stats.fabricated_udl_ids >= 1);
});

test("invalid IEP key like `goals[ELA]` produces iep-citation-grammar finding", () => {
  const md = MINIMAL_COMPLIANT + "\n- mod *(UDL 7.1: foo, IEP: goals[ELA])*\n";
  const r = lintModificationPacket(md);
  const grammar = r.findings.find((f) => f.rule === "iep-citation-grammar");
  assert.ok(grammar, "expected an iep-citation-grammar finding");
  assert.equal(grammar?.severity, "error");
  assert.match(grammar!.message, /goals\[ELA\]/);
});

test("dotted IEP key like `goals.ela` is also flagged", () => {
  const md = MINIMAL_COMPLIANT + "\n- mod *(UDL 7.1: foo, IEP: goals.ela)*\n";
  const r = lintModificationPacket(md);
  const grammar = r.findings.find((f) => f.rule === "iep-citation-grammar");
  assert.ok(grammar, "expected an iep-citation-grammar finding for goals.ela");
});

test("fewer than 6 compliant citations triggers low-citation-density warn", () => {
  const stripped = MINIMAL_COMPLIANT.replace(
    /\*\(UDL [^)]+\)\*/g,
    ""
  );
  // add 2 back so we have 2, not zero (still under 6)
  const md =
    stripped +
    "\n- mod *(UDL 1.1: foo, IEP: plaafp_academics)*" +
    "\n- mod *(UDL 2.1: bar, IEP: plaafp_academics)*\n";
  const r = lintModificationPacket(md);
  const low = r.findings.find((f) => f.rule === "low-citation-density");
  assert.ok(low, "expected low-citation-density warn");
  assert.equal(low?.severity, "warn");
});

test("no verbatim accommodation phrases in §3 → missing-verbatim-accommodation warn", () => {
  const md = MINIMAL_COMPLIANT.replace(
    /## 3\. Accommodation checklist[\s\S]*?(?=## 4\.)/,
    "## 3. Accommodation checklist\n- generic supports only\n\n"
  );
  const r = lintModificationPacket(md);
  const miss = r.findings.find((f) => f.rule === "missing-verbatim-accommodation");
  assert.ok(miss, "expected missing-verbatim-accommodation warn");
  assert.equal(miss?.severity, "warn");
});

test("error/warn arithmetic: score = 100 − 15·errors − 5·warns, floored at 0", () => {
  // Build a packet that's missing 4 sections (4 errors) and triggers
  // 1 warn (low-citation-density). 100 − 4*15 − 1*5 = 35.
  const md = `## 1. Student snapshot
## 2. Lesson at a glance
## 3. Accommodation checklist
- Repeat directions
## 4. UDL-aligned modifications
`;
  const r = lintModificationPacket(md);
  assert.equal(r.ok, false);
  // 4 missing sections (5–8) * 15 = 60, plus low-citation-density warn 5 = 65.
  // 100 - 65 = 35.
  assert.equal(r.score, 35);
});

test("regression: the shipped jasmine_community_lesson.md scores ≥ 85 with no errors", () => {
  const md = readFileSync(EXAMPLE_PATH, "utf8");
  const r = lintModificationPacket(md);
  const errors = r.findings.filter((f) => f.severity === "error");
  assert.deepEqual(
    errors,
    [],
    `example should have zero error findings but had: ${JSON.stringify(errors, null, 2)}`
  );
  assert.ok(
    r.score >= 85,
    `example should score ≥ 85 but scored ${r.score}. Findings: ${JSON.stringify(r.findings, null, 2)}`
  );
  assert.equal(r.ok, true);
});

test("prose 'IEP: services' outside a citation tuple does NOT trigger iep-citation-grammar", () => {
  // The phrase "see also IEP: services" in prose used to false-positive
  // because the old regex matched any `IEP: <token>` anywhere. After
  // scoping to canonical `(UDL ..., IEP: <key>)`, prose is exempt.
  const md =
    MINIMAL_COMPLIANT +
    "\n\nFollow up: see also IEP: services and the profile section for additional context.\n";
  const r = lintModificationPacket(md);
  const grammar = r.findings.filter((f) => f.rule === "iep-citation-grammar");
  assert.deepEqual(
    grammar,
    [],
    `expected no iep-citation-grammar findings for prose mention, got: ${JSON.stringify(grammar)}`
  );
});

test("multi-key IEP citation with `;` separator is accepted when all keys are valid", () => {
  const md =
    MINIMAL_COMPLIANT +
    "\n- bonus mod *(UDL 8.2: Differentiate feedback, IEP: goals_mathematics; goals_counseling)*\n";
  const r = lintModificationPacket(md);
  const grammar = r.findings.filter((f) => f.rule === "iep-citation-grammar");
  assert.deepEqual(
    grammar,
    [],
    `multi-key citation should be accepted, got: ${JSON.stringify(grammar)}`
  );
});

test("multi-key IEP citation with `+` separator is accepted; invalid sub-key still flagged", () => {
  const md =
    MINIMAL_COMPLIANT +
    "\n- bonus *(UDL 8.2: foo, IEP: goals_mathematics + nope_invalid)*\n";
  const r = lintModificationPacket(md);
  const grammar = r.findings.filter((f) => f.rule === "iep-citation-grammar");
  assert.equal(grammar.length, 1, "expected one finding for the invalid sub-key");
  assert.match(grammar[0].message, /nope_invalid/);
});

test("stats: word_count is whitespace-split, non-empty token count", () => {
  const r = lintModificationPacket("hello world  foo\n\nbar");
  assert.equal(r.stats.word_count, 4);
});
