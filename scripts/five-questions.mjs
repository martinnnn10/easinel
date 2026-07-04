// Verifies the 5 required questions return an ANSWER-FIRST expert response (no
// raw passage dump, safety present) against the running server's chat API.
const BASE = process.env.BASE || "http://localhost:3914";
const QUESTIONS = [
  "What code is under voltage for a PowerFlex drive?",
  "What should I check first for PowerFlex 525 F004?",
  "Can I listen for bearing noise after LOTO?",
  "What should I inspect before replacing a VFD?",
  "What does overload fault usually mean?",
];

function extractAnswer(raw) {
  // The chat stream is a JSON meta line followed by the markdown answer.
  const i = raw.indexOf("## Answer");
  const j = raw.search(/## (Problem Summary|Answer|What)/);
  const k = i >= 0 ? i : j;
  return k >= 0 ? raw.slice(k) : raw;
}

let pass = 0;
for (const q of QUESTIONS) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: q }),
  });
  const raw = await res.text();
  const ans = extractAnswer(raw);
  const answerFirst = /##\s*Answer/i.test(ans);
  const idxAnswer = ans.search(/##\s*Answer/i);
  const idxSources = ans.search(/##\s*Sources/i);
  const beforeSources = idxAnswer >= 0 && (idxSources < 0 || idxAnswer < idxSources);
  const noDump = !/what your documents say/i.test(raw);
  const hasSafety = /##\s*Safety|LOTO|lockout|zero energy|de-?energ/i.test(raw);
  const ok = answerFirst && beforeSources && noDump && hasSafety;
  if (ok) pass++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${q}"`);
  console.log(`      answer-first:${answerFirst} before-sources:${beforeSources} no-dump:${noDump} safety:${hasSafety}`);
  const firstLine = (ans.split("\n").find((l) => l.trim() && !l.startsWith("##")) || "").slice(0, 120);
  console.log(`      → ${firstLine}`);
}
console.log(`\n==== ${pass}/${QUESTIONS.length} answered expert-style ====`);
if (pass !== QUESTIONS.length) process.exitCode = 1;
