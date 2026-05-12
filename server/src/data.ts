import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, "..", "data");

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
  | "reading_passage"
  | "during_reading_questions"
  | "independent_practice_mcq"
  | "independent_practice_short_response"
  | "student_discussion";

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

// ─── IEP registry ───────────────────────────────────────────────────────────

type IepMetadata = Pick<
  Iep,
  "student_name" | "grade" | "disability" | "reading_level_summary" | "math_level_summary"
>;

type IepRegistryEntry = {
  file: string;
  parser: (raw: string) => Record<IepSectionKey, string>;
  metadata: IepMetadata;
};

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

const IEP_REGISTRY: Record<string, IepRegistryEntry> = {
  "jasmine-bailey": {
    file: "iep-jasmine.txt",
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
};

export function loadIep(id: string): Iep {
  const entry = IEP_REGISTRY[id];
  if (!entry) {
    throw new Error(
      `Unknown IEP id: "${id}". Known ids: ${Object.keys(IEP_REGISTRY).join(", ")}`
    );
  }
  const raw = readFileSync(join(DATA_DIR, entry.file), "utf-8");
  const sections = entry.parser(raw);
  assertAllSectionsPopulated(`IEP[${id}]`, sections);
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
  file: string;
  parser: (raw: string) => Record<LessonSectionKey, string>;
  metadata: LessonMetadata;
};

function parseCommunityLowe(raw: string): Record<LessonSectionKey, string> {
  return {
    overview: slice(raw, /LESSON OVERVIEW/, /Suggested Pacing/),
    pacing: slice(raw, /Suggested Pacing/, /How do I facilitate this lesson\?/),
    facilitation: slice(raw, /How do I facilitate this lesson\?/, /TEACHER COPY/),
    reading_passage: slice(raw, /TEACHER COPY/, /Independent Practice/),
    during_reading_questions: slice(raw, /DURING READING QUESTIONS/, /Independent Practice/),
    independent_practice_mcq: slice(
      raw,
      /Independent Practice\s*\n?\s*Directions: Answer the multiple choice/,
      /Independent Practice\s*\n?\s*Directions: Answer the short response/
    ),
    independent_practice_short_response: slice(
      raw,
      /Independent Practice\s*\n?\s*Directions: Answer the short response/,
      /Student-Led Discussion/
    ),
    student_discussion: slice(raw, /Student-Led Discussion/),
  };
}

const LESSON_REGISTRY: Record<string, LessonRegistryEntry> = {
  "community-lowe": {
    file: "lesson-community.txt",
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
  },
};

export function loadLesson(id: string): Lesson {
  const entry = LESSON_REGISTRY[id];
  if (!entry) {
    throw new Error(
      `Unknown lesson id: "${id}". Known ids: ${Object.keys(LESSON_REGISTRY).join(", ")}`
    );
  }
  const raw = readFileSync(join(DATA_DIR, entry.file), "utf-8");
  const sections = entry.parser(raw);
  assertAllSectionsPopulated(`Lesson[${id}]`, sections);
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
