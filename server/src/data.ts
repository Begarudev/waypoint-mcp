import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pdfParse from "pdf-parse";

const here = dirname(fileURLToPath(import.meta.url));
// Repo root holds the canonical PDF artifacts shipped with the challenge
// (`<repo>/iep`, `<repo>/lesson`). The compiled server lives at
// `<repo>/server/dist/`, so the repo root is two levels up.
const REPO_ROOT = join(here, "..", "..");

// ─── PDF loader ─────────────────────────────────────────────────────────────
// Source of truth for IEP / lesson text is the PDF bundled at the repo root
// (`<repo>/iep`, `<repo>/lesson` — extensionless, but PDF documents). The
// `server/data/*.txt` files were a prior `pdftotext -layout` dump kept around
// for human inspection only; the server no longer reads them at runtime.
// If you regenerate them via `pdftotext -layout`, treat the output as a
// reference artifact, not as the canonical input.

async function loadPdfText(absPath: string): Promise<string> {
  if (!existsSync(absPath)) {
    throw new Error(
      `PDF source not found at ${absPath}. The Waypoint server expects ` +
        `the bundled PDFs at the repo root (\`<repo>/iep\`, \`<repo>/lesson\`).`
    );
  }
  const buf = readFileSync(absPath);
  const result = await pdfParse(buf);
  // pdf-parse occasionally emits runs of trailing spaces before line breaks
  // and zero-width artefacts; normalize trailing whitespace so the section
  // splitter regexes (which were written against `pdftotext -layout` output)
  // line up. We deliberately do NOT collapse internal whitespace — the
  // splitter relies on column-wrap newlines as separators.
  return result.text.replace(/[ \t]+\n/g, "\n");
}

// Synthetic .txt fixtures (e.g. `server/data/iep-marcus.txt`) are loaded
// directly. Same trailing-whitespace normalization as the PDF path so a
// downstream registry parser doesn't have to care which source produced
// the text.
function loadTxt(absPath: string): string {
  if (!existsSync(absPath)) {
    throw new Error(
      `Text source not found at ${absPath}. The Waypoint server expects ` +
        `synthetic fixtures under \`server/data/*.txt\`.`
    );
  }
  return readFileSync(absPath, "utf8").replace(/[ \t]+\n/g, "\n");
}

async function loadRegistrySource(source: RegistrySource): Promise<string> {
  if ("pdfPath" in source) return loadPdfText(source.pdfPath);
  return loadTxt(source.txtPath);
}

type RegistrySource = { pdfPath: string } | { txtPath: string };

export type IepSectionKey =
  | "student_info"
  | "concerns"
  | "vision"
  | "profile"
  | "plaafp_academics"
  | "plaafp_behavioral"
  | "accommodations"
  | "modifications"
  | "goals_counseling"
  | "goals_mathematics"
  | "goals_ela"
  | "services"
  | "assessments"
  | "placement";

export type Iep = {
  id: string;
  student_name: string;
  grade: string;
  disability: string;
  reading_level_summary: string;
  math_level_summary: string;
  sections: Record<IepSectionKey, string>;
  raw: string;
};

export type LessonSectionKey =
  | "overview"
  | "pacing"
  | "facilitation"
  // Reading-lesson modality (CommonLit-style).
  | "reading_passage"
  | "during_reading_questions"
  | "independent_practice_mcq"
  | "independent_practice_short_response"
  | "student_discussion"
  // Math-lesson modality (Eureka / Open Up-style).
  | "direct_instruction"
  | "worked_example"
  | "guided_practice"
  | "independent_practice_problems"
  | "exit_ticket";

// Every parser must return a value for every key. Keys that don't apply
// to a particular lesson modality return "" — the loader skips validation
// of empty sections, but still surfaces them in the prompt context. We
// require non-empty for `overview` and `facilitation` for every lesson.
const REQUIRED_LESSON_KEYS: LessonSectionKey[] = ["overview", "facilitation"];

export type Lesson = {
  id: string;
  title: string;
  subject: string;
  grade: string;
  standard: { code: string; description: string };
  duration_minutes: number;
  sections: Record<LessonSectionKey, string>;
  raw: string;
};

function slice(
  text: string,
  startPat: RegExp,
  endPat?: RegExp,
  opts: { allowMissing?: boolean } = {}
): string {
  const startMatch = text.match(startPat);
  if (!startMatch || startMatch.index === undefined) {
    if (opts.allowMissing) return "";
    throw new Error(
      `slice(): start pattern ${startPat} not found in source text. ` +
        `Either the source format changed or the regex is wrong. ` +
        `Pass { allowMissing: true } if this section is genuinely optional.`
    );
  }
  const startIdx = startMatch.index;
  if (!endPat) return text.slice(startIdx).trim();
  const tail = text.slice(startIdx + startMatch[0].length);
  const endMatch = tail.match(endPat);
  const endIdx =
    endMatch && endMatch.index !== undefined
      ? startIdx + startMatch[0].length + endMatch.index
      : text.length;
  return text.slice(startIdx, endIdx).trim();
}

function assertAllSectionsPopulated(
  label: string,
  sections: Record<string, string>
): void {
  for (const [k, v] of Object.entries(sections)) {
    if (!v || v.trim().length === 0) {
      throw new Error(`${label} section ${k} is empty`);
    }
  }
}

// Same as above but only requires a named subset of keys to be non-empty.
// Used for lessons, where the section-key union spans multiple modalities
// (reading vs math) and not every key applies to every lesson.
function assertRequiredSectionsPopulated(
  label: string,
  sections: Record<string, string>,
  requiredKeys: string[]
): void {
  for (const k of requiredKeys) {
    const v = sections[k];
    if (!v || v.trim().length === 0) {
      throw new Error(`${label} required section ${k} is empty`);
    }
  }
}

// ─── IEP registry ───────────────────────────────────────────────────────────

type IepMetadata = Pick<
  Iep,
  "student_name" | "grade" | "disability" | "reading_level_summary" | "math_level_summary"
>;

type IepRegistryEntry = {
  /**
   * Source of the IEP text. Either a bundled PDF at the repo root
   * (`pdfPath`) or a synthetic `.txt` fixture under `server/data/`
   * (`txtPath`). Exactly one is set per entry.
   */
  source: RegistrySource;
  parser: (raw: string) => Record<IepSectionKey, string>;
  metadata: IepMetadata;
  /**
   * IEP section keys that MUST be non-empty for this student. Keys not in
   * this list may legitimately be empty (e.g. a student whose IEP has no
   * ELA annual goal). Defaults to all keys.
   */
  requiredKeys?: IepSectionKey[];
};

const ALL_IEP_KEYS: IepSectionKey[] = [
  "student_info",
  "concerns",
  "vision",
  "profile",
  "plaafp_academics",
  "plaafp_behavioral",
  "accommodations",
  "modifications",
  "goals_counseling",
  "goals_mathematics",
  "goals_ela",
  "services",
  "assessments",
  "placement",
];

function parseJasmineIep(raw: string): Record<IepSectionKey, string> {
  return {
    student_info: slice(raw, /Administrative Data Sheet/, /STUDENT AND PARENT CONCERNS/),
    concerns: slice(raw, /STUDENT AND PARENT CONCERNS/, /STUDENT AND TEAM VISION/),
    vision: slice(raw, /STUDENT AND TEAM VISION/, /STUDENT PROFILE/),
    profile: slice(raw, /STUDENT PROFILE/, /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*ACADEMICS/),
    plaafp_academics: slice(
      raw,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*ACADEMICS/,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*BEHAVIORAL/
    ),
    plaafp_behavioral: slice(
      raw,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*BEHAVIORAL/,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*COMMUNICATION/
    ),
    accommodations: slice(
      raw,
      /Accommodations:\s*List the accommodations/,
      /Modifications:\s*List the modifications/
    ),
    modifications: slice(raw, /Modifications:\s*List/, /MEASURABLE ANNUAL GOALS/),
    goals_counseling: slice(
      raw,
      /Goal Area:\s*\n?\s*1 - Counseling/,
      /Goal Area:\s*\n?\s*2 - Mathematics/
    ),
    goals_mathematics: slice(
      raw,
      /Goal Area:\s*\n?\s*2 - Mathematics/,
      /Goal Area:\s*\n?\s*3 - ELA/
    ),
    goals_ela: slice(
      raw,
      /Goal Area:\s*\n?\s*3 - ELA/,
      /Participation in the General Education Setting/
    ),
    services: slice(raw, /SERVICE DELIVERY/, /Transportation Services/),
    assessments: slice(
      raw,
      /State and District-Wide Assessments and Accommodations/,
      /SCHEDULE MODIFICATION/
    ),
    placement: slice(raw, /Participation in the General Education Setting/, /SERVICE DELIVERY/),
  };
}

function parseMarcusIep(raw: string): Record<IepSectionKey, string> {
  const sections: Record<IepSectionKey, string> = {
    student_info: slice(raw, /Administrative Data Sheet/, /STUDENT AND PARENT CONCERNS/),
    concerns: slice(raw, /STUDENT AND PARENT CONCERNS/, /STUDENT AND TEAM VISION/),
    vision: slice(raw, /STUDENT AND TEAM VISION/, /STUDENT PROFILE/),
    profile: slice(raw, /STUDENT PROFILE/, /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*ACADEMICS/),
    plaafp_academics: slice(
      raw,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*ACADEMICS/,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*BEHAVIORAL/
    ),
    plaafp_behavioral: slice(
      raw,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*BEHAVIORAL/,
      /PRESENT LEVELS OF ACADEMIC ACHIEVEMENT AND FUNCTIONAL PERFORMANCE:\s*\n?\s*COMMUNICATION/
    ),
    accommodations: slice(
      raw,
      /Accommodations:\s*List the accommodations/,
      /Modifications:\s*List the modifications/
    ),
    modifications: slice(raw, /Modifications:\s*List/, /MEASURABLE ANNUAL GOALS/),
    goals_counseling: slice(
      raw,
      /Goal Area:\s*\n?\s*1 - Counseling/,
      /Goal Area:\s*\n?\s*2 - Mathematics/
    ),
    // Marcus has two math goals (multi-step word problems AND fraction
    // operations). The `goals_mathematics` section captures both — the
    // boundary is from goal 2 through the start of the placement block.
    goals_mathematics: slice(
      raw,
      /Goal Area:\s*\n?\s*2 - Mathematics/,
      /Participation in the General Education Setting/
    ),
    // Marcus has no ELA annual goal — at/above grade level in ELA. The
    // registry entry's `requiredKeys` reflects this; this slot stays empty.
    goals_ela: "",
    services: slice(raw, /SERVICE DELIVERY/, /Transportation Services/),
    assessments: slice(
      raw,
      /State and District-Wide Assessments and Accommodations/,
      /SCHEDULE MODIFICATION/
    ),
    placement: slice(raw, /Participation in the General Education Setting/, /SERVICE DELIVERY/),
  };
  return sections;
}

const IEP_REGISTRY: Record<string, IepRegistryEntry> = {
  "jasmine-bailey": {
    source: { pdfPath: join(REPO_ROOT, "iep") },
    parser: parseJasmineIep,
    metadata: {
      student_name: "Jasmine Regina Bailey",
      grade: "7th",
      disability: "Health Impairment",
      reading_level_summary:
        "Reads at a 3rd-grade level overall (iReady Fall 2025); Informational Text Comprehension at 2nd-grade level. Decodes grade-level words with adequate fluency but struggles with literal and inferential comprehension.",
      math_level_summary:
        "Working at a 4th-grade level on iReady; improving multi-digit operations and integer rules; below grade level on multi-step word problems.",
    },
  },
  "marcus-chen": {
    source: { txtPath: join(here, "..", "data", "iep-marcus.txt") },
    parser: parseMarcusIep,
    metadata: {
      student_name: "Marcus Chen",
      grade: "9th",
      disability: "Specific Learning Disability — Dyscalculia",
      reading_level_summary:
        "At or near grade level (Lexile ~1050) — strong narrative and informational comprehension.",
      math_level_summary:
        "Significant deficits — 5th-grade level on iReady; struggles with multi-step word problems, fraction operations, ratio reasoning, and computation under timed conditions.",
    },
    // Marcus has no ELA annual goal — at/above grade level in ELA.
    requiredKeys: ALL_IEP_KEYS.filter((k) => k !== "goals_ela"),
  },
};

// Pre-extracted PDF text, populated by the top-level await below. Keyed by
// IEP id. Splitting the parse step (async, I/O-bound) from `loadIep`
// (sync, called from hot paths and tests) lets callers keep a synchronous
// API while the PDFs are still the runtime source of truth.
const IEP_RAW_CACHE: Map<string, string> = new Map();

export function loadIep(id: string): Iep {
  const entry = IEP_REGISTRY[id];
  if (!entry) {
    throw new Error(
      `Unknown IEP id: "${id}". Known ids: ${Object.keys(IEP_REGISTRY).join(", ")}`
    );
  }
  const raw = IEP_RAW_CACHE.get(id);
  if (raw === undefined) {
    throw new Error(
      `IEP[${id}] PDF text not loaded. This indicates the module-level ` +
        `PDF ingest failed; check the startup logs.`
    );
  }
  const sections = entry.parser(raw);
  const required = entry.requiredKeys ?? ALL_IEP_KEYS;
  assertRequiredSectionsPopulated(`IEP[${id}]`, sections, required);
  return { id, ...entry.metadata, sections, raw };
}

export function listIeps(): Array<{ student_id: string } & IepMetadata> {
  return Object.entries(IEP_REGISTRY).map(([id, e]) => ({
    student_id: id,
    ...e.metadata,
  }));
}

// ─── Lesson registry ────────────────────────────────────────────────────────

type LessonMetadata = Pick<Lesson, "title" | "subject" | "grade" | "standard" | "duration_minutes">;

type LessonRegistryEntry = {
  /** Source of the lesson text — either bundled PDF or synthetic .txt fixture. */
  source: RegistrySource;
  parser: (raw: string) => Record<LessonSectionKey, string>;
  metadata: LessonMetadata;
  /**
   * Lesson section keys that MUST be non-empty for this lesson. Keys not
   * in this list may be empty — for example, a math lesson has no
   * `reading_passage`. Defaults to {@link REQUIRED_LESSON_KEYS}.
   */
  requiredKeys?: LessonSectionKey[];
};

const ALL_LESSON_KEYS: LessonSectionKey[] = [
  "overview",
  "pacing",
  "facilitation",
  "reading_passage",
  "during_reading_questions",
  "independent_practice_mcq",
  "independent_practice_short_response",
  "student_discussion",
  "direct_instruction",
  "worked_example",
  "guided_practice",
  "independent_practice_problems",
  "exit_ticket",
];

function emptyLessonSections(): Record<LessonSectionKey, string> {
  const o = {} as Record<LessonSectionKey, string>;
  for (const k of ALL_LESSON_KEYS) o[k] = "";
  return o;
}

function parseCommunityLowe(raw: string): Record<LessonSectionKey, string> {
  const sections = emptyLessonSections();
  sections.overview = slice(raw, /LESSON OVERVIEW/, /Suggested Pacing/);
  sections.pacing = slice(raw, /Suggested Pacing/, /How do I facilitate this lesson\?/);
  sections.facilitation = slice(raw, /How do I facilitate this lesson\?/, /TEACHER COPY/);
  sections.reading_passage = slice(raw, /TEACHER COPY/, /Independent Practice/);
  sections.during_reading_questions = slice(raw, /DURING READING QUESTIONS/, /Independent Practice/);
  sections.independent_practice_mcq = slice(
    raw,
    /Independent Practice\s*\n?\s*Directions: Answer the multiple choice/,
    /Independent Practice\s*\n?\s*Directions: Answer the short response/
  );
  sections.independent_practice_short_response = slice(
    raw,
    /Independent Practice\s*\n?\s*Directions: Answer the short response/,
    /Student-Led Discussion/
  );
  sections.student_discussion = slice(raw, /Student-Led Discussion/);
  return sections;
}

// Math-lesson layout (Eureka / Open Up-style). Different heading
// vocabulary, no reading passage. Operative Rule 9 routes §6 of the
// modification packet to a parallel scaffolded artifact for lessons
// returned by this parser.
function parseFractionsLesson(raw: string): Record<LessonSectionKey, string> {
  const sections = emptyLessonSections();
  sections.overview = slice(raw, /LESSON OVERVIEW/, /SUGGESTED PACING/);
  sections.pacing = slice(raw, /SUGGESTED PACING/, /HOW TO FACILITATE/);
  sections.facilitation = slice(raw, /HOW TO FACILITATE/, /TEACHER COPY/);
  sections.direct_instruction = slice(raw, /DIRECT INSTRUCTION/, /WORKED EXAMPLE/);
  sections.worked_example = slice(raw, /WORKED EXAMPLE/, /GUIDED PRACTICE/);
  sections.guided_practice = slice(raw, /GUIDED PRACTICE/, /INDEPENDENT PRACTICE/);
  sections.independent_practice_problems = slice(raw, /INDEPENDENT PRACTICE/, /EXIT TICKET/);
  sections.exit_ticket = slice(raw, /EXIT TICKET/);
  return sections;
}

const FRACTIONS_REQUIRED_KEYS: LessonSectionKey[] = [
  "overview",
  "pacing",
  "facilitation",
  "direct_instruction",
  "worked_example",
  "guided_practice",
  "independent_practice_problems",
  "exit_ticket",
];

const COMMUNITY_REQUIRED_KEYS: LessonSectionKey[] = [
  "overview",
  "pacing",
  "facilitation",
  "reading_passage",
  "during_reading_questions",
  "independent_practice_mcq",
  "independent_practice_short_response",
  "student_discussion",
];

const LESSON_REGISTRY: Record<string, LessonRegistryEntry> = {
  "community-lowe": {
    source: { pdfPath: join(REPO_ROOT, "lesson") },
    parser: parseCommunityLowe,
    metadata: {
      title: "What is 'community' and why is it important?",
      subject: "ELA",
      grade: "7th",
      standard: {
        code: "RI.7.2",
        description:
          "determine and summarize the central idea of a text and identify the details that develop it",
      },
      duration_minutes: 45,
    },
    requiredKeys: COMMUNITY_REQUIRED_KEYS,
  },
  "fractions-5nf1": {
    source: { txtPath: join(here, "..", "data", "lesson-fractions.txt") },
    parser: parseFractionsLesson,
    metadata: {
      title: "Adding & Subtracting Fractions with Unlike Denominators",
      subject: "Math",
      grade: "5th",
      standard: {
        code: "5.NF.A.1",
        description:
          "Add and subtract fractions with unlike denominators by replacing given fractions with equivalent fractions with like denominators.",
      },
      duration_minutes: 50,
    },
    requiredKeys: FRACTIONS_REQUIRED_KEYS,
  },
};

const LESSON_RAW_CACHE: Map<string, string> = new Map();

// ─── Module-level PDF ingest ────────────────────────────────────────────────
// Resolved at import time via top-level await. All consumers of this module
// (server.ts, _smoke.test.ts) therefore see fully-populated caches by the
// time their own top-level code runs. Failures here propagate as module
// initialization errors — exactly the behavior we want if a PDF is missing.
await Promise.all([
  ...Object.entries(IEP_REGISTRY).map(async ([id, entry]) => {
    IEP_RAW_CACHE.set(id, await loadRegistrySource(entry.source));
  }),
  ...Object.entries(LESSON_REGISTRY).map(async ([id, entry]) => {
    LESSON_RAW_CACHE.set(id, await loadRegistrySource(entry.source));
  }),
]);

export function loadLesson(id: string): Lesson {
  const entry = LESSON_REGISTRY[id];
  if (!entry) {
    throw new Error(
      `Unknown lesson id: "${id}". Known ids: ${Object.keys(LESSON_REGISTRY).join(", ")}`
    );
  }
  const raw = LESSON_RAW_CACHE.get(id);
  if (raw === undefined) {
    throw new Error(
      `Lesson[${id}] PDF text not loaded. This indicates the module-level ` +
        `PDF ingest failed; check the startup logs.`
    );
  }
  const sections = entry.parser(raw);
  const required = entry.requiredKeys ?? REQUIRED_LESSON_KEYS;
  assertRequiredSectionsPopulated(`Lesson[${id}]`, sections, required);
  return { id, ...entry.metadata, sections, raw };
}

export function listLessons(): Array<{ lesson_id: string } & LessonMetadata> {
  return Object.entries(LESSON_REGISTRY).map(([id, e]) => ({
    lesson_id: id,
    ...e.metadata,
  }));
}

export type UdlCheckpoint = {
  number: string; // e.g. "7.1"
  title: string;
  summary?: string;
};

export type UdlGuideline = {
  principle: "Engagement" | "Representation" | "Action & Expression";
  guideline_number: number; // 1–9 per CAST 3.0
  guideline_title: string;
  summary: string;
  checkpoints: UdlCheckpoint[];
};

// CAST UDL 3.0 — three principles, nine guidelines (1–9), with checkpoints.
// Engagement = 7–9, Representation = 1–3, Action & Expression = 4–6.
// Source: https://udlguidelines.cast.org/
export const UDL_GUIDELINES: UdlGuideline[] = [
  // Representation: 1–3
  {
    principle: "Representation",
    guideline_number: 1,
    guideline_title: "Perception",
    summary:
      "Offer ways of customizing the display of information; provide alternatives for auditory and visual information.",
    checkpoints: [
      { number: "1.1", title: "Support opportunities to customize the display of information" },
      { number: "1.2", title: "Support multiple ways to perceive information" },
      { number: "1.3", title: "Represent a diversity of perspectives and identities in authentic ways" },
    ],
  },
  {
    principle: "Representation",
    guideline_number: 2,
    guideline_title: "Language & Symbols",
    summary:
      "Clarify vocabulary, symbols, syntax, and structure; support decoding; illustrate through multiple media.",
    checkpoints: [
      { number: "2.1", title: "Clarify vocabulary, symbols, and language structures" },
      { number: "2.2", title: "Support decoding of text, mathematical notation, and symbols" },
      { number: "2.3", title: "Cultivate understanding and respect across languages and dialects" },
      { number: "2.4", title: "Address biases in the use of language and symbols" },
      { number: "2.5", title: "Illustrate through multiple media" },
    ],
  },
  {
    principle: "Representation",
    guideline_number: 3,
    guideline_title: "Building Knowledge",
    summary:
      "Connect to prior knowledge; highlight patterns, critical features, and relationships; support transfer and generalization.",
    checkpoints: [
      { number: "3.1", title: "Connect prior knowledge to new learning" },
      { number: "3.2", title: "Highlight and explore patterns, critical features, big ideas, and relationships" },
      { number: "3.3", title: "Cultivate multiple ways of knowing and making meaning" },
      { number: "3.4", title: "Maximize transfer and generalization" },
    ],
  },
  // Action & Expression: 4–6
  {
    principle: "Action & Expression",
    guideline_number: 4,
    guideline_title: "Interaction",
    summary:
      "Vary and honor methods for response, navigation, and movement; optimize access to accessible materials and assistive technologies.",
    checkpoints: [
      { number: "4.1", title: "Vary and honor the methods for response, navigation, and movement" },
      { number: "4.2", title: "Optimize access to accessible materials and assistive and accessible technologies" },
    ],
  },
  {
    principle: "Action & Expression",
    guideline_number: 5,
    guideline_title: "Expression & Communication",
    summary:
      "Use multiple media for communication; use multiple tools for construction, composition, and creativity; build fluencies with graduated support.",
    checkpoints: [
      { number: "5.1", title: "Use multiple media for communication" },
      { number: "5.2", title: "Use multiple tools for construction, composition, and creativity" },
      { number: "5.3", title: "Build fluencies with graduated support for practice and performance" },
      { number: "5.4", title: "Address biases related to modes of expression and communication" },
    ],
  },
  {
    principle: "Action & Expression",
    guideline_number: 6,
    guideline_title: "Strategy Development",
    summary:
      "Set meaningful goals; anticipate and plan for challenges; organize information and resources; enhance capacity for monitoring progress.",
    checkpoints: [
      { number: "6.1", title: "Set meaningful goals" },
      { number: "6.2", title: "Anticipate and plan for challenges" },
      { number: "6.3", title: "Organize information and resources" },
      { number: "6.4", title: "Enhance capacity for monitoring progress" },
      { number: "6.5", title: "Challenge exclusionary practices" },
    ],
  },
  // Engagement: 7–9
  {
    principle: "Engagement",
    guideline_number: 7,
    guideline_title: "Welcoming Interests & Identities",
    summary:
      "Optimize choice and autonomy; optimize relevance, value, and authenticity; nurture joy and play; minimize threats and distractions.",
    checkpoints: [
      { number: "7.1", title: "Optimize choice and autonomy" },
      { number: "7.2", title: "Optimize relevance, value, and authenticity" },
      { number: "7.3", title: "Nurture joy and play" },
      { number: "7.4", title: "Address biases, threats, and distractions" },
    ],
  },
  {
    principle: "Engagement",
    guideline_number: 8,
    guideline_title: "Sustaining Effort & Persistence",
    summary:
      "Heighten salience of goals and objectives; vary demands and resources; foster collaboration, interdependence, and belonging; increase mastery-oriented feedback.",
    checkpoints: [
      { number: "8.1", title: "Clarify the meaning and purpose of goals" },
      { number: "8.2", title: "Optimize challenge and support" },
      { number: "8.3", title: "Foster collaboration, interdependence, and collective learning" },
      { number: "8.4", title: "Foster belonging and community" },
      { number: "8.5", title: "Offer action-oriented feedback" },
    ],
  },
  {
    principle: "Engagement",
    guideline_number: 9,
    guideline_title: "Emotional Capacity",
    summary:
      "Recognize expectations, beliefs, and motivations; develop awareness of self and others; promote individual and collective reflection.",
    checkpoints: [
      { number: "9.1", title: "Recognize expectations, beliefs, and motivations" },
      { number: "9.2", title: "Develop awareness of self and others" },
      { number: "9.3", title: "Promote individual and collective reflection" },
      { number: "9.4", title: "Cultivate empathy and restorative practices" },
    ],
  },
];

export function udlMarkdown(): string {
  const lines = [
    "# CAST Universal Design for Learning Guidelines 3.0 (curated reference)",
    "",
    "Three principles, nine guidelines numbered 1–9, each with named checkpoints (e.g. `7.1`).",
    "When citing in output, prefer the checkpoint number + title: `UDL 7.1 (Optimize choice and autonomy)`.",
    "For a guideline-level citation: `UDL 7 (Welcoming Interests & Identities)`.",
    "",
  ];
  const principles = ["Engagement", "Representation", "Action & Expression"] as const;
  for (const p of principles) {
    lines.push(`## ${p}`);
    const guidelines = UDL_GUIDELINES.filter((g) => g.principle === p).sort(
      (a, b) => a.guideline_number - b.guideline_number
    );
    for (const g of guidelines) {
      lines.push(`### UDL ${g.guideline_number} — ${g.guideline_title}`);
      lines.push(g.summary);
      for (const c of g.checkpoints) {
        const tail = c.summary ? `: ${c.summary}` : "";
        lines.push(`- **${c.number}** ${c.title}${tail}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
