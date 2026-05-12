// Lint a Waypoint modification packet (markdown) against the operative
// output contract enforced by the `generate_modifications` prompt.
//
// Pure functions — no MCP coupling. Consumed by the `waypoint_lint_packet`
// tool and by `_lint.test.ts`.

export type LintFinding = {
  rule: string;
  severity: "error" | "warn";
  message: string;
  location?: string;
};

export type LintReport = {
  ok: boolean;
  score: number;
  findings: LintFinding[];
  stats: {
    sections_found: string[];
    sections_missing: string[];
    udl_citations: number;
    iep_citations: number;
    compound_citations: number;
    fabricated_udl_ids: number;
    verbatim_accommodation_hits: number;
    word_count: number;
  };
};

const REQUIRED_SECTIONS = [
  "Student snapshot",
  "Lesson at a glance",
  "Accommodation checklist",
  "UDL-aligned modifications",
  "Scaffolded question ladder",
  "Leveled passage",
  "Alternative assessment",
  "Teacher cheat-sheet",
] as const;

const VALID_IEP_KEYS = new Set([
  "plaafp_academics",
  "plaafp_behavioral",
  "accommodations",
  "modifications",
  "goals_counseling",
  "goals_mathematics",
  "goals_ela",
  "services",
  "profile",
  "placement",
  "assessments",
]);

// Common IEP accommodation phrases the lint tool looks for in §3 to validate
// the "use the student's named accommodations verbatim" operative rule.
// Intentionally student-agnostic: includes phrases that appear across the
// shipped fixtures (Jasmine, Marcus) and common IEP boilerplate beyond.
// Matching is case-insensitive (see countVerbatimAccommodations below).
const VERBATIM_ACCOMMODATION_PHRASES = [
  // Jasmine (Health Impairment)
  "Repeat directions",
  "Reminders to pause, plan, proceed",
  "1:1 check ins",
  "Extra time",
  "Frequent breaks",
  "graphic organizers and checklists",
  "Small group",
  "Copy of teacher's notes",
  "Reminder to remain engaged",
  // Marcus (SLD/Dyscalculia)
  "chunked math problems",
  "color-coded operation cues",
  "worked examples in margin",
  "math reference sheet",
  "graph paper",
  "verbal response option",
  "extended time",
  "frequent supervised breaks",
  // Generic / cross-IEP
  "preferential seating",
  "scheduled breaks",
  "sentence frames",
  "text-to-speech",
];

function findSectionLine(markdown: string, sectionName: string): number {
  const lines = markdown.split("\n");
  const lc = sectionName.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Strip leading markdown heading markers, numbering, and bold markers.
    const stripped = line
      .replace(/^#{1,6}\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/^\d+\.\s*/, "")
      .trim()
      .toLowerCase();
    if (stripped.startsWith(lc)) {
      // Sanity: only match heading-like lines or numbered list items.
      if (/^#{1,6}\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
        return i + 1;
      }
    }
  }
  return -1;
}

export function lintModificationPacket(markdown: string): LintReport {
  const findings: LintFinding[] = [];

  // ── §1: required sections + ordering ────────────────────────────────────
  const sectionPositions: Array<{ name: string; line: number }> = [];
  const sectionsFound: string[] = [];
  const sectionsMissing: string[] = [];

  for (const name of REQUIRED_SECTIONS) {
    const line = findSectionLine(markdown, name);
    if (line === -1) {
      sectionsMissing.push(name);
      findings.push({
        rule: "missing-section",
        severity: "error",
        message: `Required section "${name}" not found.`,
      });
    } else {
      sectionsFound.push(name);
      sectionPositions.push({ name, line });
    }
  }

  // Check ordering of found sections against required order.
  if (sectionPositions.length >= 2) {
    const orderedByLine = [...sectionPositions].sort((a, b) => a.line - b.line);
    const expectedOrder = sectionsFound; // already in REQUIRED_SECTIONS order
    const actualOrder = orderedByLine.map((s) => s.name);
    const outOfOrder = expectedOrder.some((n, i) => n !== actualOrder[i]);
    if (outOfOrder) {
      findings.push({
        rule: "out-of-order-sections",
        severity: "warn",
        message: `Sections appear in unexpected order. Expected: ${expectedOrder.join(
          " → "
        )}. Found: ${actualOrder.join(" → ")}.`,
      });
    }
  }

  // ── §2: bad-udl-citation (compound `+` form) ───────────────────────────
  // e.g. `(UDL 3: Building Knowledge + Action.G5, IEP: goals_ela)`
  const compoundRe = /\(UDL [^,)]*\+[^,)]*,/g;
  const compoundMatches = markdown.match(compoundRe) ?? [];
  for (const m of compoundMatches) {
    findings.push({
      rule: "bad-udl-citation",
      severity: "error",
      message: `Compound UDL citation (fabricated "+ G#" shorthand): ${m}`,
      location: m,
    });
  }

  // ── §3: fabricated UDL ids ─────────────────────────────────────────────
  const fabricatedRe = /\b(?:Engagement|Representation|Action)\.G\d\b/g;
  const fabricatedMatches = markdown.match(fabricatedRe) ?? [];
  for (const m of fabricatedMatches) {
    findings.push({
      rule: "fabricated-udl-id",
      severity: "error",
      message: `Fabricated UDL identifier: ${m}. Use real CAST 3.0 checkpoint numbers (e.g. "UDL 7.1").`,
      location: m,
    });
  }

  // ── §4: compliant UDL+IEP citations ────────────────────────────────────
  const compliantRe = /\(UDL \d+(?:\.\d+)?: [^,)]+, IEP: [a-z_]+\)/g;
  const compliantMatches = markdown.match(compliantRe) ?? [];
  const udlCitations = compliantMatches.length;

  // ── §5: IEP citation grammar (any `IEP: <key>` not in valid set) ───────
  // Match `IEP: ` followed by a non-whitespace, non-`)`, non-`,` token —
  // so `goals[ELA]` and `goals.ela` get caught, not just clean keys.
  const iepCitationRe = /IEP:\s*([^\s),]+)/g;
  let iepCitations = 0;
  let iepMatch: RegExpExecArray | null;
  while ((iepMatch = iepCitationRe.exec(markdown)) !== null) {
    iepCitations++;
    const key = iepMatch[1];
    if (!VALID_IEP_KEYS.has(key)) {
      findings.push({
        rule: "iep-citation-grammar",
        severity: "error",
        message: `Invalid IEP section key: "${key}". Valid keys: ${[
          ...VALID_IEP_KEYS,
        ].join(", ")}.`,
        location: iepMatch[0],
      });
    }
  }

  // ── §6: low citation density ────────────────────────────────────────────
  if (udlCitations < 6) {
    findings.push({
      rule: "low-citation-density",
      severity: "warn",
      message: `Only ${udlCitations} compliant UDL+IEP citations found; expected ≥ 6.`,
    });
  }

  // ── §7: verbatim accommodation use ─────────────────────────────────────
  // Look inside section 3 (accommodation checklist) when present, else
  // the full document.
  let acc3Body = markdown;
  const acc3StartLine = findSectionLine(markdown, "Accommodation checklist");
  if (acc3StartLine !== -1) {
    const lines = markdown.split("\n");
    let endIdx = lines.length;
    // Find the next required section after §3.
    for (const name of REQUIRED_SECTIONS) {
      if (name === "Accommodation checklist") continue;
      const l = findSectionLine(markdown, name);
      if (l > acc3StartLine && l < endIdx) endIdx = l;
    }
    acc3Body = lines.slice(acc3StartLine - 1, endIdx - 1).join("\n");
  }
  let verbatimHits = 0;
  const acc3Lower = acc3Body.toLowerCase();
  for (const phrase of VERBATIM_ACCOMMODATION_PHRASES) {
    if (acc3Lower.includes(phrase.toLowerCase())) verbatimHits++;
  }
  if (verbatimHits === 0) {
    findings.push({
      rule: "missing-verbatim-accommodation",
      severity: "warn",
      message:
        "No known verbatim accommodation phrases found in §3 (Accommodation checklist). Expected at least one of: " +
        VERBATIM_ACCOMMODATION_PHRASES.map((p) => `"${p}"`).join(", "),
    });
  }

  // ── stats ──────────────────────────────────────────────────────────────
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  // ── scoring ────────────────────────────────────────────────────────────
  let score = 100;
  for (const f of findings) {
    score -= f.severity === "error" ? 15 : 5;
  }
  if (score < 0) score = 0;
  const errorCount = findings.filter((f) => f.severity === "error").length;

  return {
    ok: errorCount === 0,
    score,
    findings,
    stats: {
      sections_found: sectionsFound,
      sections_missing: sectionsMissing,
      udl_citations: udlCitations,
      iep_citations: iepCitations,
      compound_citations: compoundMatches.length,
      fabricated_udl_ids: fabricatedMatches.length,
      verbatim_accommodation_hits: verbatimHits,
      word_count: wordCount,
    },
  };
}
