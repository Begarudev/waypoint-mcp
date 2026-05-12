// Data-layer smoke tests. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadIep, loadLesson, listIeps, listLessons, udlMarkdown, type IepSectionKey, type LessonSectionKey } from "./data.js";
import { buildGenerateModificationsPrompt } from "./prompts.js";

const iep = loadIep("jasmine-bailey");
const lesson = loadLesson("community-lowe");
const marcus = loadIep("marcus-chen");
const fractions = loadLesson("fractions-5nf1");

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

// ── Second-student / second-lesson fixtures ────────────────────────────────

test("loadIep('marcus-chen') returns expected metadata", () => {
  assert.equal(marcus.student_name, "Marcus Chen");
  assert.equal(marcus.grade, "9th");
  assert.match(marcus.disability, /Dyscalculia/);
  assert.match(marcus.reading_level_summary, /Lexile/);
});

test("Marcus accommodations contains 'chunked math problems' AND 'extended time'", () => {
  const acc = marcus.sections.accommodations;
  assert.match(acc, /chunked math problems/i, "expected verbatim 'chunked math problems'");
  assert.match(acc, /extended time/i, "expected verbatim 'extended time'");
});

test("Marcus goals_mathematics encodes the 40% → 70% multi-step word-problem goal", () => {
  // The arrow may be rendered as the unicode arrow or as 'to' depending on
  // how the fixture is authored — accept either.
  assert.match(marcus.sections.goals_mathematics, /40%?\s*(?:→|to)\s*70/i);
  assert.match(marcus.sections.goals_mathematics, /multi-step word problems/i);
});

test("Marcus profile indicates AT: Yes (TI-30XS + Desmos authorized)", () => {
  const profile = marcus.sections.profile;
  assert.match(profile, /TI-30XS/);
  assert.match(profile, /Desmos/);
  // The check-box just above 'TI-30XS' marks AT: Yes.
  assert.match(profile, /☑\s*Yes/);
});

test("Marcus has no ELA annual goal — goals_ela is intentionally empty", () => {
  assert.equal(marcus.sections.goals_ela, "");
});

test("loadLesson('fractions-5nf1') returns expected metadata", () => {
  assert.equal(fractions.title, "Adding & Subtracting Fractions with Unlike Denominators");
  assert.equal(fractions.subject, "Math");
  assert.equal(fractions.standard.code, "5.NF.A.1");
  assert.equal(fractions.duration_minutes, 50);
});

test("fractions lesson worked_example and independent_practice_problems are non-empty", () => {
  assert.ok(fractions.sections.worked_example.trim().length > 0, "worked_example empty");
  assert.match(fractions.sections.worked_example, /1\/4 \+ 2\/3/);
  assert.ok(
    fractions.sections.independent_practice_problems.trim().length > 0,
    "independent_practice_problems empty"
  );
});

test("fractions lesson has NO reading_passage (Operative Rule 9 trigger)", () => {
  assert.equal(
    fractions.sections.reading_passage,
    "",
    "math lesson must not have a reading passage — this is what triggers the non-reading-lesson fallback in §6"
  );
});

test("registries now expose at least two IEPs and two lessons", () => {
  const ieps = listIeps();
  const lessons = listLessons();
  assert.ok(ieps.length >= 2, `expected ≥2 IEPs, got ${ieps.length}`);
  assert.ok(lessons.length >= 2, `expected ≥2 lessons, got ${lessons.length}`);
  const iepIds = ieps.map((i) => i.student_id);
  const lessonIds = lessons.map((l) => l.lesson_id);
  assert.ok(iepIds.includes("marcus-chen"));
  assert.ok(lessonIds.includes("fractions-5nf1"));
});

test("loadIep('does-not-exist') throws a clear error", () => {
  assert.throws(() => loadIep("does-not-exist"), /Unknown IEP id: "does-not-exist"/);
});

test("loadLesson('does-not-exist') throws a clear error", () => {
  assert.throws(() => loadLesson("does-not-exist"), /Unknown lesson id: "does-not-exist"/);
});

test("generate_modifications prompt wires in the waypoint_lint_packet self-check", () => {
  // Regression guard: Rule 11 + the SELF-CHECK PROCEDURE block must instruct
  // the model to call the lint tool by name. Without this assertion, a future
  // edit could silently drop the self-check wiring.
  const prompt = buildGenerateModificationsPrompt(lesson, iep, udlMarkdown());
  const text = prompt.messages[0].content.text;
  assert.match(
    text,
    /waypoint_lint_packet/,
    "rendered prompt should mention the waypoint_lint_packet tool"
  );
});

