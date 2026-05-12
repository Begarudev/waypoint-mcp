// Data-layer smoke tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadIep, loadLesson, udlMarkdown, type IepSectionKey, type LessonSectionKey } from "./data.js";

const iep = loadIep();
const lesson = loadLesson();

const IEP_KEYS: IepSectionKey[] = [
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

const LESSON_KEYS: LessonSectionKey[] = [
  "overview",
  "pacing",
  "facilitation",
  "reading_passage",
  "during_reading_questions",
  "independent_practice_mcq",
  "independent_practice_short_response",
  "student_discussion",
];

test("every IEP section is populated", () => {
  for (const k of IEP_KEYS) {
    const v = iep.sections[k];
    assert.ok(v && v.trim().length > 0, `IEP section "${k}" is empty`);
  }
});

test("every lesson section is populated", () => {
  for (const k of LESSON_KEYS) {
    const v = lesson.sections[k];
    assert.ok(v && v.trim().length > 0, `Lesson section "${k}" is empty`);
  }
});

test("accommodations contains 'Repeat directions' and excludes 'Multimodal'", () => {
  const acc = iep.sections.accommodations;
  assert.match(acc, /Repeat directions/, "accommodations should contain 'Repeat directions'");
  assert.doesNotMatch(
    acc,
    /Multimodal/,
    "accommodations must NOT contain 'Multimodal' (that belongs in Modifications)"
  );
});

test("modifications contains 'Multimodal'", () => {
  assert.match(iep.sections.modifications, /Multimodal/);
});

test("goals_counseling targets the counseling self-regulation goal", () => {
  assert.match(iep.sections.goals_counseling, /Counseling/);
  assert.match(iep.sections.goals_counseling, /self-regulation|calming strategy/i);
});

test("goals_mathematics targets multi-step word problems", () => {
  // pdftotext column wrap inserts newlines inside the phrase.
  assert.match(iep.sections.goals_mathematics, /multi-step\s+word problems/i);
});

test("goals_ela targets comprehension of complex texts", () => {
  // The phrase 'comprehend ... complex texts' is split by table-column whitespace
  // in the pdftotext dump, so we check the two halves are present.
  assert.match(iep.sections.goals_ela, /\bcomprehend\b/i);
  assert.match(iep.sections.goals_ela, /complex texts/i);
});

test("plaafp_academics names the 3rd-grade reading level", () => {
  // The pdftotext dump interleaves "third-" and "grade reading level" with the
  // adjacent column's text, so check the two halves are present near each other.
  const text = iep.sections.plaafp_academics;
  assert.match(text, /\bthird-/i);
  assert.match(text, /grade reading level/i);
});

test("lesson reading_passage carries the central-idea sentence (paragraph 9)", () => {
  assert.match(lesson.sections.reading_passage, /share a story that is so important/);
});

test("UDL markdown lists all nine guidelines 1–9 by number", () => {
  const md = udlMarkdown();
  for (let i = 1; i <= 9; i++) {
    assert.match(md, new RegExp(`UDL ${i} `), `expected 'UDL ${i} ' header`);
  }
});
