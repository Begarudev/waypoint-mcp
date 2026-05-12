// Deterministic, offline rubric for grading a Waypoint modification packet.
//
// The rubric reuses `lintModificationPacket` from `../src/lint.ts` as its
// underlying check engine. Each rubric item produces a 0-1 score; the final
// total is a weighted sum across all items (weights sum to 75; we normalize
// to a 0-100 scale).

// Compiled layout (from eval/tsconfig.json):
//   dist/eval/rubric.js  ←  this file
//   dist/src/lint.js     ←  re-compiled by the eval tsconfig project
import { lintModificationPacket, type LintReport } from "../src/lint.js";

export type RubricItem = {
  id: string;
  description: string;
  weight: number; // share of total
  check: (
    packet: string,
    lint: LintReport
  ) => { passed: boolean; score: number; detail?: string };
};

export const RUBRIC: RubricItem[] = [
  // ── structure (22) ────────────────────────────────────────────────────────
  {
    id: "all_8_sections",
    weight: 15,
    description: "All eight required sections present in correct order",
    check: (_p, l) => {
      const missing = l.findings.filter((f) => f.rule === "missing-section");
      const ooo = l.findings.filter((f) => f.rule === "out-of-order-sections");
      const passed = missing.length === 0 && ooo.length === 0;
      return {
        passed,
        score: passed ? 1 : 0,
        detail: passed ? undefined : `${missing.length} missing, ${ooo.length} OOO`,
      };
    },
  },
  // ── citations (30) ────────────────────────────────────────────────────────
  {
    id: "udl_citation_grammar",
    weight: 15,
    description:
      "Citations use the (UDL X: title, IEP: key) grammar; no compound or fabricated tags",
    check: (_p, l) => {
      const compound = l.stats.compound_citations;
      const fabricated = l.stats.fabricated_udl_ids;
      const passed = compound === 0 && fabricated === 0;
      return {
        passed,
        score: passed ? 1 : 0,
        detail: passed ? undefined : `${compound} compound, ${fabricated} fabricated`,
      };
    },
  },
  {
    id: "udl_citation_density",
    weight: 4,
    description: "At least 8 compliant UDL+IEP citations",
    check: (_p, l) => {
      const n = l.stats.udl_citations;
      return { passed: n >= 8, score: Math.min(1, n / 10), detail: `count=${n}` };
    },
  },
  {
    id: "iep_section_grammar",
    weight: 7,
    description: "All IEP citations use canonical section keys",
    check: (_p, l) => {
      const bad = l.findings.filter((f) => f.rule === "iep-citation-grammar");
      const passed = bad.length === 0;
      return {
        passed,
        score: passed ? 1 : 0,
        detail: passed ? undefined : `${bad.length} bad keys`,
      };
    },
  },
  // ── domain content (30) ───────────────────────────────────────────────────
  {
    id: "verbatim_accommodations",
    weight: 9,
    description:
      "At least 4 verbatim IEP accommodation phrases appear in §3",
    check: (_p, l) => {
      const n = l.stats.verbatim_accommodation_hits;
      return { passed: n >= 4, score: Math.min(1, n / 6), detail: `hits=${n}` };
    },
  },
  {
    id: "leveled_passage_or_alternative",
    weight: 8,
    description:
      "§6 contains either a side-by-side leveled passage table OR a parallel scaffolded artifact",
    check: (p) => {
      const hasTable = /\n\|.+\|.+\n\|[\s|:\-]+\|/.test(p);
      const hasAlt =
        /\b(worked example|strategy card|structured note|scaffolded artifact|annotated example)\b/i.test(
          p
        );
      const passed = hasTable || hasAlt;
      return {
        passed,
        score: passed ? 1 : 0,
        detail: passed ? (hasTable ? "table" : "alternative") : "neither",
      };
    },
  },
  {
    id: "cheat_sheet_present",
    weight: 5,
    description: "§8 cheat-sheet has at least 5 bullet items",
    check: (p) => {
      const m = p.match(/Teacher cheat[- ]?sheet[\s\S]+?(?=\n(?:##|$))/i);
      const bullets = m ? (m[0].match(/^[ \t]*[-*•]\s+/gm) || []).length : 0;
      return {
        passed: bullets >= 5,
        score: Math.min(1, bullets / 5),
        detail: `bullets=${bullets}`,
      };
    },
  },
  {
    id: "lint_score_high",
    weight: 5,
    description: "Overall lint score ≥ 85",
    check: (_p, l) => {
      const passed = l.score >= 85;
      return { passed, score: l.score / 100, detail: `lint_score=${l.score}` };
    },
  },
  // ── independent structural-content check (not covered by lint) ────────────
  {
    id: "dok_ladder_well_formed",
    weight: 7,
    description:
      "§5 scaffolded question ladder has three DOK tiers AND tier-1 includes at least one sentence stem",
    check: (p) => {
      // Extract the §5 body (Scaffolded question ladder → next ## or §6).
      const sec5 = p.match(
        /Scaffolded question ladder[\s\S]+?(?=\n##\s|\n###\s+(?:Leveled|Alternative)|\n\d+\.\s+\*?\*?Leveled passage|$)/i
      );
      if (!sec5) return { passed: false, score: 0, detail: "§5 not found" };
      const body = sec5[0];
      // Look for tier markers. Accept DOK 1/2/3 (any case) or Recall/Apply/Analyze.
      const hasTier1 = /\bDOK\s*1\b|\bRecall\b/i.test(body);
      const hasTier2 = /\bDOK\s*2\b|\bApply\b/i.test(body);
      const hasTier3 = /\bDOK\s*3\b|\bAnalyze\b/i.test(body);
      const tierCount = [hasTier1, hasTier2, hasTier3].filter(Boolean).length;

      // Extract tier-1 sub-body: from the tier-1 marker to the tier-2 marker
      // (or end of §5). Use this to verify a sentence stem appears in tier 1.
      let tier1Body = "";
      const t1Idx = body.search(/\bDOK\s*1\b|\bRecall\b/i);
      if (t1Idx !== -1) {
        const after = body.slice(t1Idx);
        const t2 = after.search(/\bDOK\s*2\b|\bApply\b/i);
        tier1Body = t2 === -1 ? after : after.slice(0, t2);
      }
      // A sentence stem looks like: three or more underscores in a row,
      // or the literal phrase "sentence stem"/"sentence frame".
      const hasStem =
        /_{3,}/.test(tier1Body) ||
        /sentence stem|sentence frame/i.test(tier1Body);

      if (tierCount === 3 && hasStem) {
        return { passed: true, score: 1, detail: "3 tiers + tier-1 stem" };
      }
      if (tierCount === 3 && !hasStem) {
        return { passed: false, score: 0.5, detail: "3 tiers, no tier-1 stem" };
      }
      return {
        passed: false,
        score: 0,
        detail: `tiers=${tierCount}, stem=${hasStem}`,
      };
    },
  },
];

export type RubricItemResult = {
  id: string;
  weight: number;
  description: string;
  passed: boolean;
  score: number;
  detail?: string;
};

export type RubricResult = {
  packet_label: string;
  total_score: number; // weighted 0–100
  passed: boolean; // total_score ≥ 80 AND no lint errors
  lint: LintReport;
  items: RubricItemResult[];
};

const TOTAL_WEIGHT = RUBRIC.reduce((s, r) => s + r.weight, 0);

export function grade(packet: string, label = "(packet)"): RubricResult {
  const lint = lintModificationPacket(packet);
  const items: RubricItemResult[] = RUBRIC.map((r) => {
    const { passed, score, detail } = r.check(packet, lint);
    return {
      id: r.id,
      weight: r.weight,
      description: r.description,
      passed,
      score,
      detail,
    };
  });
  const weighted = items.reduce((sum, it) => sum + it.weight * it.score, 0);
  const total = Math.round((weighted / TOTAL_WEIGHT) * 100);
  const errorCount = lint.findings.filter((f) => f.severity === "error").length;
  const passed = total >= 80 && errorCount === 0;
  return {
    packet_label: label,
    total_score: total,
    passed,
    lint,
    items,
  };
}
