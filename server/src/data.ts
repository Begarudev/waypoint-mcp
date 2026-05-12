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
  | "goals"
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
  standard: string;
  duration_minutes: number;
  sections: Record<LessonSectionKey, string>;
  raw: string;
};

function slice(text: string, startPat: RegExp, endPat?: RegExp): string {
  const startMatch = text.match(startPat);
  if (!startMatch || startMatch.index === undefined) return "";
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

export function loadIep(): Iep {
  const raw = readFileSync(join(DATA_DIR, "iep-jasmine.txt"), "utf-8");

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
    accommodations: slice(raw, /ACCOMMODATIONS AND MODIFICATIONS/, /Modifications:/),
    modifications: slice(raw, /Modifications:\s*List/, /MEASURABLE ANNUAL GOALS/),
    goals: slice(raw, /MEASURABLE ANNUAL GOALS/, /Participation in the General Education Setting/),
    services: slice(raw, /SERVICE DELIVERY/, /Transportation Services/),
    assessments: slice(
      raw,
      /State and District-Wide Assessments and Accommodations/,
      /SCHEDULE MODIFICATION/
    ),
    placement: slice(raw, /Participation in the General Education Setting/, /SERVICE DELIVERY/),
  };

  return {
    id: "jasmine-bailey",
    student_name: "Jasmine Regina Bailey",
    grade: "7th",
    disability: "Health Impairment",
    reading_level_summary:
      "Reads at a 3rd-grade level overall (iReady Fall 2025); Informational Text Comprehension at 2nd-grade level. Decodes grade-level words with adequate fluency but struggles with literal and inferential comprehension.",
    math_level_summary:
      "Working at a 4th-grade level on iReady; improving multi-digit operations and integer rules; below grade level on multi-step word problems.",
    sections,
    raw,
  };
}

export function loadLesson(): Lesson {
  const raw = readFileSync(join(DATA_DIR, "lesson-community.txt"), "utf-8");

  const sections: Record<LessonSectionKey, string> = {
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

  return {
    id: "community-lowe",
    title: "What is 'community' and why is it important?",
    subject: "ELA",
    grade: "7th",
    standard: "RI.7.2 (determine and summarize the central idea of a text and identify the details that develop it)",
    duration_minutes: 45,
    sections,
    raw,
  };
}

export type UdlGuideline = {
  id: string;
  principle: "Engagement" | "Representation" | "Action & Expression";
  title: string;
  summary: string;
};

export const UDL_GUIDELINES: UdlGuideline[] = [
  {
    id: "Engagement.G7",
    principle: "Engagement",
    title: "Welcoming Interests & Identities",
    summary:
      "Recruit interest by connecting tasks to learners' identities, lived experience, and choice; minimize threats and distractions.",
  },
  {
    id: "Engagement.G8",
    principle: "Engagement",
    title: "Sustaining Effort & Persistence",
    summary:
      "Heighten salience of goals; vary demands and supports to optimize challenge; foster collaboration; increase mastery-oriented feedback.",
  },
  {
    id: "Engagement.G9",
    principle: "Engagement",
    title: "Emotional Capacity",
    summary:
      "Promote expectations and beliefs that optimize motivation; facilitate coping skills, self-assessment, and reflection.",
  },
  {
    id: "Representation.G1",
    principle: "Representation",
    title: "Perception",
    summary:
      "Offer ways of customizing the display of information; alternatives for auditory and visual information (audio, captions, images, large print).",
  },
  {
    id: "Representation.G2",
    principle: "Representation",
    title: "Language & Symbols",
    summary:
      "Clarify vocabulary, symbols, syntax, and structure; pre-teach key terms; support decoding; illustrate through multiple media.",
  },
  {
    id: "Representation.G3",
    principle: "Representation",
    title: "Building Knowledge",
    summary:
      "Activate or supply background knowledge; highlight patterns, big ideas, and relationships; guide processing and visualization; maximize transfer.",
  },
  {
    id: "Action.G4",
    principle: "Action & Expression",
    title: "Interaction",
    summary:
      "Vary methods for response and navigation; optimize access to tools and assistive technologies.",
  },
  {
    id: "Action.G5",
    principle: "Action & Expression",
    title: "Expression & Communication",
    summary:
      "Use multiple media for communication; provide sentence frames, scaffolded composition tools, and graduated supports for practice.",
  },
  {
    id: "Action.G6",
    principle: "Action & Expression",
    title: "Strategy Development",
    summary:
      "Support planning, goal-setting, organization, and self-monitoring; teach strategies for managing frustration and persisting.",
  },
];

export function udlMarkdown(): string {
  const lines = [
    "# CAST Universal Design for Learning Guidelines 3.0 (curated reference)",
    "",
    "Three principles. Each guideline below should be cited by its `id` when justifying a modification.",
    "",
  ];
  const principles = ["Engagement", "Representation", "Action & Expression"] as const;
  for (const p of principles) {
    lines.push(`## ${p}`);
    for (const g of UDL_GUIDELINES.filter((g) => g.principle === p)) {
      lines.push(`- **${g.id} — ${g.title}**: ${g.summary}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
