import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultSet =
  "C:/Users/admin/Downloads/AdGuard_Eval_Set_V1/adguard_eval_v1";
const evalRoot = process.argv[2] ?? defaultSet;
const endpoint =
  process.env.ADGUARD_EVAL_ENDPOINT ?? "http://127.0.0.1:3000/api/review";
const onlyText = process.argv.includes("--text-only");
const requestedCases = new Set(
  (process.argv.find((argument) => argument.startsWith("--cases=")) ?? "")
    .replace("--cases=", "")
    .split(",")
    .filter(Boolean),
);
const concurrency = Math.max(
  1,
  Number(
    (
      process.argv.find((argument) => argument.startsWith("--concurrency=")) ??
      "--concurrency=1"
    ).replace("--concurrency=", ""),
  ) || 1,
);

function expectedRuleIds(value) {
  return value
    .split(",")
    .map((ruleId) => ruleId.trim())
    .filter(Boolean);
}

function actualRuleIds(review) {
  return review.ruleResults
    .filter((result) => result.status !== "PASS")
    .map((result) => result.ruleId)
    .sort();
}

function sameSet(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function needsHumanReview(review) {
  return review.ruleResults.some(
    (result) =>
      (result.ruleId === "A-06" && result.status === "RISK") ||
      (result.ruleId === "A-09" && result.status === "UNCERTAIN"),
  );
}

async function fileToBlob(filePath) {
  const bytes = await readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const type = extension === ".webp" ? "image/webp" : "image/png";
  return new Blob([bytes], { type });
}

async function reviewCase(testCase) {
  const form = new FormData();
  if (testCase.input_text) form.set("text", testCase.input_text);
  const assets = testCase.image_assets
    ? testCase.image_assets
        .split(";")
        .map((asset) => asset.trim())
        .filter(Boolean)
    : [];
  for (const asset of assets) {
    const absolutePath = path.resolve(evalRoot, asset);
    form.append(
      "images",
      await fileToBlob(absolutePath),
      path.basename(absolutePath),
    );
  }
  const response = await fetch(endpoint, { method: "POST", body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.presentation?.review) {
    throw new Error(payload.error?.message ?? `HTTP ${response.status}`);
  }
  return payload.presentation.review;
}

const manifest = JSON.parse(
  await readFile(path.join(evalRoot, "expected_results.json"), "utf8"),
);
const selected = manifest.filter(
  (testCase) =>
    testCase.input_type !== "unsupported-file" &&
    (!onlyText || testCase.input_type === "text") &&
    (!requestedCases.size || requestedCases.has(testCase.case_id)),
);
async function evaluate(testCase) {
  const started = Date.now();
  try {
    const review = await reviewCase(testCase);
    const expectedRules = expectedRuleIds(testCase.expected_rule_hits).sort();
    const actualRules = actualRuleIds(review);
    const expectedHuman = testCase.expected_human_review === "是";
    const actualHuman = needsHumanReview(review);
    const row = {
      id: testCase.case_id,
      expected: testCase.expected_overall,
      actual: review.overallStatus,
      expectedRules: expectedRules.join(",") || "-",
      actualRules: actualRules.join(",") || "-",
      overall: review.overallStatus === testCase.expected_overall,
      rules: sameSet(actualRules, expectedRules),
      human: actualHuman === expectedHuman,
      ms: Date.now() - started,
      error: "",
    };
    console.log(`${row.id}\t${row.actual}\t${row.actualRules}\t${row.ms}ms`);
    return row;
  } catch (error) {
    const row = {
      id: testCase.case_id,
      expected: testCase.expected_overall,
      actual: "ERROR",
      expectedRules:
        expectedRuleIds(testCase.expected_rule_hits).join(",") || "-",
      actualRules: "-",
      overall: false,
      rules: false,
      human: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : "Unknown error",
    };
    console.log(
      `${row.id}\t${row.actual}\t${row.actualRules}\t${row.ms}ms\t${row.error}`,
    );
    return row;
  }
}

const rows = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (cursor < selected.length) {
      const testCase = selected[cursor++];
      rows.push(await evaluate(testCase));
    }
  }),
);
rows.sort((left, right) => left.id.localeCompare(right.id));

const summary = {
  cases: rows.length,
  overallMatched: rows.filter((row) => row.overall).length,
  ruleSetMatched: rows.filter((row) => row.rules).length,
  humanRouteMatched: rows.filter((row) => row.human).length,
  errors: rows.filter((row) => row.error).length,
};
console.log("\nSUMMARY");
console.log(JSON.stringify(summary, null, 2));
console.log("\nDETAILS");
console.table(rows);
