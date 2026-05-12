// Unit tests for the rubric module. Run via `npm test`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { grade } from "./rubric.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, "..", "..");

// A minimal but compliant packet that should pass every rubric item. Each
// section is named exactly as REQUIRED_SECTIONS expects, ordering matches,
// citations use the canonical grammar, §3 quotes ≥4 verbatim phrases, §6
// includes a markdown table, §8 has 5+ bullets.
const compliantMinimalPacket = `# Packet — Test

## 1. Student snapshot
Notes (UDL 7.1: Choice, IEP: plaafp_academics) and (UDL 8.1: Goals, IEP: goals_ela).

## 2. Lesson at a glance
Lesson info (UDL 6.1: Goals, IEP: plaafp_academics).

## 3. Accommodation checklist
- Repeat directions
- Reminders to pause, plan, proceed
- 1:1 check ins
- Extra time
- Frequent breaks
- graphic organizers and checklists
- Small group
(UDL 7.3: Threats, IEP: accommodations)

## 4. UDL-aligned modifications
- Item one (UDL 7.2: Relevance, IEP: plaafp_behavioral)
- Item two (UDL 5.1: Media, IEP: goals_ela)
- Item three (UDL 3.1: Background, IEP: plaafp_academics)
- Item four (UDL 4.1: Response, IEP: accommodations)
- Item five (UDL 9.1: Expectations, IEP: goals_counseling)

## 5. Scaffolded question ladder
- Q1 (UDL 6.2: Planning, IEP: goals_ela)
- Q2 (UDL 6.3: Resources, IEP: plaafp_academics)

## 6. Leveled passage

| Original | Leveled |
| --- | --- |
| The Newcastle example illustrates… | Newcastle helped its neighbors. |

(UDL 2.1: Vocabulary, IEP: goals_ela)

## 7. Alternative assessment
Short response (UDL 5.2: Tools, IEP: accommodations).

## 8. Teacher cheat-sheet
- Tip one
- Tip two
- Tip three
- Tip four
- Tip five
- Tip six
`;

test("grade(compliantMinimalPacket) passes with score ≥ 80", () => {
  const r = grade(compliantMinimalPacket, "compliant");
  assert.ok(
    r.total_score >= 80,
    `expected score ≥ 80, got ${r.total_score}. items: ${JSON.stringify(
      r.items.filter((i) => !i.passed),
      null,
      2
    )}`
  );
  assert.equal(r.passed, true);
});

test("grade(packetMissingSection6) fails with all_8_sections item failing", () => {
  const missing = compliantMinimalPacket
    .split("\n")
    .filter((l) => !l.startsWith("## 6.") && !l.includes("Leveled passage"))
    .join("\n");
  const r = grade(missing, "missing-§6");
  assert.equal(r.passed, false);
  const sectionItem = r.items.find((i) => i.id === "all_8_sections");
  assert.ok(sectionItem);
  assert.equal(sectionItem!.passed, false);
});

test("grade(packetWithFabricatedUDL) fails with udl_citation_grammar item failing", () => {
  const bad = compliantMinimalPacket.replace(
    "(UDL 7.2: Relevance, IEP: plaafp_behavioral)",
    "(UDL 3: Building Knowledge + Action.G5, IEP: goals_ela)"
  );
  const r = grade(bad, "fabricated");
  assert.equal(r.passed, false);
  const grammarItem = r.items.find((i) => i.id === "udl_citation_grammar");
  assert.ok(grammarItem);
  assert.equal(grammarItem!.passed, false);
});

test("dok_ladder_well_formed: 3 tiers + tier-1 stem → score 1.0", () => {
  const withLadder = compliantMinimalPacket.replace(
    "## 5. Scaffolded question ladder\n- Q1 (UDL 6.2: Planning, IEP: goals_ela)\n- Q2 (UDL 6.3: Resources, IEP: plaafp_academics)",
    `## 5. Scaffolded question ladder
- DOK 1 — Recall: "The central idea is ______." (UDL 6.2: Planning, IEP: goals_ela)
- DOK 2 — Apply: explain how the author supports the central idea. (UDL 6.3: Resources, IEP: plaafp_academics)
- DOK 3 — Analyze: evaluate the strongest piece of evidence.`
  );
  const r = grade(withLadder, "ladder-full");
  const item = r.items.find((i) => i.id === "dok_ladder_well_formed");
  assert.ok(item, "expected dok_ladder_well_formed item");
  assert.equal(item!.score, 1, `expected 1.0, got ${item!.score} (${item!.detail})`);
  assert.equal(item!.passed, true);
});

test("dok_ladder_well_formed: 3 tiers but no tier-1 stem → score 0.5", () => {
  const noStem = compliantMinimalPacket.replace(
    "## 5. Scaffolded question ladder\n- Q1 (UDL 6.2: Planning, IEP: goals_ela)\n- Q2 (UDL 6.3: Resources, IEP: plaafp_academics)",
    `## 5. Scaffolded question ladder
- DOK 1 — Recall: What is the central idea? (UDL 6.2: Planning, IEP: goals_ela)
- DOK 2 — Apply: how does the author support it? (UDL 6.3: Resources, IEP: plaafp_academics)
- DOK 3 — Analyze: evaluate strongest evidence.`
  );
  const r = grade(noStem, "ladder-no-stem");
  const item = r.items.find((i) => i.id === "dok_ladder_well_formed");
  assert.ok(item);
  assert.equal(item!.score, 0.5);
  assert.equal(item!.passed, false);
});

test("dok_ladder_well_formed: missing tier-3 → score < 1.0", () => {
  const missingT3 = compliantMinimalPacket.replace(
    "## 5. Scaffolded question ladder\n- Q1 (UDL 6.2: Planning, IEP: goals_ela)\n- Q2 (UDL 6.3: Resources, IEP: plaafp_academics)",
    `## 5. Scaffolded question ladder
- DOK 1 — Recall: "The idea is ______."
- DOK 2 — Apply: use it.`
  );
  const r = grade(missingT3, "ladder-no-t3");
  const item = r.items.find((i) => i.id === "dok_ladder_well_formed");
  assert.ok(item);
  assert.ok(item!.score < 1.0, `expected score < 1.0, got ${item!.score}`);
});

test("grade(real jasmine_community_lesson.md) scores ≥ 85 and passes", () => {
  const path = resolve(SERVER_ROOT, "examples", "jasmine_community_lesson.md");
  const body = readFileSync(path, "utf8");
  const r = grade(body, "jasmine_community_lesson.md");
  assert.ok(
    r.total_score >= 85,
    `expected ≥85, got ${r.total_score}. failing items: ${JSON.stringify(
      r.items.filter((i) => !i.passed),
      null,
      2
    )}`
  );
  assert.equal(r.passed, true);
});
