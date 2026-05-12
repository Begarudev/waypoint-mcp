// Smoke test for the data layer. Run with: npm run build && node dist/_smoke.js
import { loadIep, loadLesson, udlMarkdown } from "./data.js";

const iep = loadIep();
const lesson = loadLesson();

console.log("=== IEP sections (length) ===");
for (const [k, v] of Object.entries(iep.sections)) {
  console.log(`${k.padEnd(28)} ${String(v.length).padStart(6)} chars`);
}
console.log("\n=== Lesson sections (length) ===");
for (const [k, v] of Object.entries(lesson.sections)) {
  console.log(`${k.padEnd(36)} ${String(v.length).padStart(6)} chars`);
}

console.log("\n=== Sanity assertions ===");
const required: Array<[string, string]> = [
  ["iep.plaafp_academics", iep.sections.plaafp_academics],
  ["iep.accommodations", iep.sections.accommodations],
  ["iep.goals", iep.sections.goals],
  ["lesson.reading_passage", lesson.sections.reading_passage],
  ["lesson.independent_practice_mcq", lesson.sections.independent_practice_mcq],
];
let failed = 0;
for (const [name, value] of required) {
  if (!value || value.length < 100) {
    console.error(`FAIL: ${name} is too short (${value.length} chars)`);
    failed++;
  }
}
if (failed === 0) console.log("All required sections look populated.");
else process.exit(1);

console.log("\n=== UDL markdown preview ===");
console.log(udlMarkdown().split("\n").slice(0, 10).join("\n"));
