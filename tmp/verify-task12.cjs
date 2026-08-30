const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const assert = require("assert");

const bin = "/tmp/desurf-fresh-install-test/node_modules/.bin/desurf";
const workDir = "/tmp/desurf-verify-task12";

fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });

function run(cmd, opts = {}) {
  try {
    const stdout = cp.execSync(cmd, {
      cwd: workDir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      ...opts
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      status: err.status,
      stdout: err.stdout ? err.stdout.toString() : "",
      stderr: err.stderr ? err.stderr.toString() : ""
    };
  }
}

console.log("=== Verification Checklist ===");

// 1. -v cannot produce false-green
console.log("\n--- Checking 1: -v cannot produce false-green ---");
// a) Top-level -v prints version and exits 0
const rTopV = run(`"${bin}" -v`);
assert.strictEqual(rTopV.status, 0);
assert.strictEqual(rTopV.stdout.trim(), "0.4.0");

// b) Top-level --version prints version and exits 0
const rTopVer = run(`"${bin}" --version`);
assert.strictEqual(rTopVer.status, 0);
assert.strictEqual(rTopVer.stdout.trim(), "0.4.0");

// c) desurf test --version rejected with exit 2
const rTestVer = run(`"${bin}" test --version`);
assert.strictEqual(rTestVer.status, 2);

// d) desurf init suite
const rInit = run(`"${bin}" init sample-suite`);
assert.strictEqual(rInit.status, 0);

// e) desurf test -v runs tests with verbose output
const rTestV = run(`"${bin}" test --suite sample-suite -v`);
assert.strictEqual(rTestV.status, 0);
assert(rTestV.stdout.includes("PASS"));

// f) Inject failing assertion and verify -v still exits 1 (no false-green)
const suitePath = path.join(workDir, "sample-suite/suite.json");
const suiteData = JSON.parse(fs.readFileSync(suitePath, "utf8"));
suiteData.cases[0].assertions.push({ type: "required", value: "NEVER_MATCH_FAIL" });
fs.writeFileSync(suitePath, JSON.stringify(suiteData, null, 2));

const rFailV = run(`"${bin}" test --suite sample-suite -v`);
assert.strictEqual(rFailV.status, 1, "Expected exit code 1 on failed assertion with -v");
assert(rFailV.stdout.includes("REGRESSION"), "Expected REGRESSION output");

// Restore suite
suiteData.cases[0].assertions.pop();
fs.writeFileSync(suitePath, JSON.stringify(suiteData, null, 2));
console.log("✓ -v cannot produce false-green verified.");

// 2. 65 KB --json survives pipes
console.log("\n--- Checking 2: 65 KB --json survives pipes ---");
// Create a suite with 200 cases to generate >65KB json
const bigSuiteDir = path.join(workDir, "big-suite");
fs.mkdirSync(bigSuiteDir, { recursive: true });
fs.mkdirSync(path.join(bigSuiteDir, "inputs"), { recursive: true });
fs.mkdirSync(path.join(bigSuiteDir, "prompts"), { recursive: true });
fs.mkdirSync(path.join(bigSuiteDir, "outputs"), { recursive: true });

const bigCases = [];
for (let i = 0; i < 200; i++) {
  const inF = `inputs/in_${i}.txt`;
  const prF = `prompts/pr_${i}.txt`;
  const outF = `outputs/out_${i}.json`;
  const filler = "A".repeat(300);
  fs.writeFileSync(path.join(bigSuiteDir, inF), `Input data ${i} ${filler}`);
  fs.writeFileSync(path.join(bigSuiteDir, prF), `Prompt data ${i} ${filler}`);
  fs.writeFileSync(path.join(bigSuiteDir, outF), JSON.stringify({ index: i, result: `Success ${i}`, payload: filler }));
  bigCases.push({
    id: `case_${i}`,
    input: inF,
    prompt: prF,
    output: outF,
    assertions: [
      { type: "json_schema", schema: { type: "object", required: ["index", "result"] } },
      { type: "required", value: `Success ${i}` }
    ]
  });
}
fs.writeFileSync(path.join(bigSuiteDir, "suite.json"), JSON.stringify({ name: "big-suite", cases: bigCases }, null, 2));

// Test pipe to node JSON parser
const rPipe = run(`"${bin}" test --suite big-suite --json | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{console.log('Streamed byte length:', Buffer.byteLength(d)); const j=JSON.parse(d); console.log('Parsed test cases:', j.results.length); if (j.results.length !== 200 || j.summary.passed !== 200) process.exit(1); })"`);
console.log(rPipe.stdout.trim());
assert.strictEqual(rPipe.status, 0);
console.log("✓ >65KB --json output over pipes verified.");

// 3. ReDoS behavior and exit classification
console.log("\n--- Checking 3: ReDoS behavior and exit classification ---");
const redosSuiteDir = path.join(workDir, "redos-suite");
fs.mkdirSync(redosSuiteDir, { recursive: true });
fs.mkdirSync(path.join(redosSuiteDir, "inputs"), { recursive: true });
fs.mkdirSync(path.join(redosSuiteDir, "prompts"), { recursive: true });
fs.mkdirSync(path.join(redosSuiteDir, "outputs"), { recursive: true });

fs.writeFileSync(path.join(redosSuiteDir, "inputs/in.txt"), "in");
fs.writeFileSync(path.join(redosSuiteDir, "prompts/pr.txt"), "pr");
// Catastrophic string: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa!"
fs.writeFileSync(path.join(redosSuiteDir, "outputs/out.txt"), "a".repeat(28) + "!");
fs.writeFileSync(path.join(redosSuiteDir, "suite.json"), JSON.stringify({
  name: "redos-suite",
  cases: [
    {
      id: "redos-case",
      input: "inputs/in.txt",
      prompt: "prompts/pr.txt",
      output: "outputs/out.txt",
      assertions: [
        // Vulnerable regex pattern: (a+)+$
        { type: "regex", pattern: "^(a+)+$" }
      ]
    }
  ]
}));

const t0 = Date.now();
const rRedos = run(`"${bin}" test --suite redos-suite`);
const duration = Date.now() - t0;
console.log(`ReDoS run completed in ${duration}ms, exit code: ${rRedos.status}`);
assert.strictEqual(rRedos.status, 1, "Expected exit 1 (REGRESSION) on regex timeout / failure");
assert(duration < 2500, "ReDoS should safely timeout within ~1000ms");
assert(rRedos.stdout.includes("timed out") || rRedos.stdout.includes("REGRESSION"));

// Invalid regex pattern configuration error -> exit code 2
const badRegexDir = path.join(workDir, "bad-regex-suite");
fs.cpSync(redosSuiteDir, badRegexDir, { recursive: true });
const badRegexData = JSON.parse(fs.readFileSync(path.join(badRegexDir, "suite.json"), "utf8"));
badRegexData.cases[0].assertions = [{ type: "regex", pattern: "([a-z" }];
fs.writeFileSync(path.join(badRegexDir, "suite.json"), JSON.stringify(badRegexData));
const rBadRegex = run(`"${bin}" test --suite bad-regex-suite`);
assert.strictEqual(rBadRegex.status, 2, "Expected exit code 2 on invalid regex pattern (config error)");
console.log("✓ ReDoS timeout and regex error classification verified.");

// 4. Empty suites / assertions
console.log("\n--- Checking 4: Empty suites / assertions ---");
// Empty cases: []
const emptyCasesDir = path.join(workDir, "empty-cases-suite");
fs.mkdirSync(emptyCasesDir, { recursive: true });
fs.writeFileSync(path.join(emptyCasesDir, "suite.json"), JSON.stringify({ name: "empty", cases: [] }));
const rEmptyCases = run(`"${bin}" test --suite empty-cases-suite`);
assert.strictEqual(rEmptyCases.status, 2, "Expected exit code 2 for empty cases array");

// Empty assertions: []
const emptyAssDir = path.join(workDir, "empty-ass-suite");
fs.cpSync(path.join(workDir, "sample-suite"), emptyAssDir, { recursive: true });
const emptyAssData = JSON.parse(fs.readFileSync(path.join(emptyAssDir, "suite.json"), "utf8"));
emptyAssData.cases[0].assertions = [];
fs.writeFileSync(path.join(emptyAssDir, "suite.json"), JSON.stringify(emptyAssData));
const rEmptyAss = run(`"${bin}" test --suite empty-ass-suite`);
assert.strictEqual(rEmptyAss.status, 2, "Expected exit code 2 for empty assertions array");
console.log("✓ Empty suites/assertions rejection verified.");

// 5. Duplicate IDs
console.log("\n--- Checking 5: Duplicate IDs ---");
const dupDir = path.join(workDir, "dup-suite");
fs.cpSync(path.join(workDir, "sample-suite"), dupDir, { recursive: true });
const dupData = JSON.parse(fs.readFileSync(path.join(dupDir, "suite.json"), "utf8"));
dupData.cases.push({ ...dupData.cases[0] });
fs.writeFileSync(path.join(dupDir, "suite.json"), JSON.stringify(dupData));
const rDup = run(`"${bin}" test --suite dup-suite`);
assert.strictEqual(rDup.status, 2, "Expected exit code 2 for duplicate case ID");
console.log("✓ Duplicate IDs rejection verified.");

// 6. Prototype-chain JSON schema cases
console.log("\n--- Checking 6: Prototype-chain JSON schema cases ---");
const protoDir = path.join(workDir, "proto-suite");
fs.cpSync(path.join(workDir, "sample-suite"), protoDir, { recursive: true });
const protoData = JSON.parse(fs.readFileSync(path.join(protoDir, "suite.json"), "utf8"));
protoData.cases[0].assertions = [
  { type: "json_schema", schema: { type: "object", required: ["constructor"] } }
];
fs.writeFileSync(path.join(protoDir, "suite.json"), JSON.stringify(protoData));
const rProto = run(`"${bin}" test --suite proto-suite`);
assert.strictEqual(rProto.status, 1, "Expected exit code 1 (REGRESSION) because constructor is on prototype, not own property");
console.log("✓ Prototype-chain JSON schema safety verified.");

// 7. Malformed provenance
console.log("\n--- Checking 7: Malformed provenance ---");
const provDir = path.join(workDir, "prov-suite");
fs.cpSync(path.join(workDir, "sample-suite"), provDir, { recursive: true });
const sidecarFile = path.join(provDir, "outputs/classify.json.desurf");
// Test invalid non-hex hash
fs.writeFileSync(sidecarFile, JSON.stringify({
  version: 1,
  inputSha256: "not-a-valid-hex-hash",
  promptSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  source: "seal"
}));
const rInspectBadHash = run(`"${bin}" inspect --suite prov-suite`);
assert.strictEqual(rInspectBadHash.status, 2, "Expected exit code 2 for malformed hash sidecar");

// Test unsupported version
fs.writeFileSync(sidecarFile, JSON.stringify({
  version: 99,
  inputSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  promptSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  source: "seal"
}));
const rInspectBadVer = run(`"${bin}" inspect --suite prov-suite`);
assert.strictEqual(rInspectBadVer.status, 2, "Expected exit code 2 for unsupported version");
console.log("✓ Malformed provenance detection verified.");

// 8. Provider selection
console.log("\n--- Checking 8: Provider selection ---");
// a) record with offline provider rejected with exit 2
const rRecOffline = run(`"${bin}" record --suite sample-suite --provider offline`);
assert.strictEqual(rRecOffline.status, 2, "Expected exit 2 when recording with offline provider");

// b) unknown provider rejected with exit 2
const rUnknownProv = run(`"${bin}" test --suite sample-suite --provider nonexistent`);
assert.strictEqual(rUnknownProv.status, 2, "Expected exit 2 for unknown provider");
console.log("✓ Provider selection verified.");

// 9. Init overwrite / race safety
console.log("\n--- Checking 9: Init overwrite / race safety ---");
// a) Refuse to overwrite existing directory with suite.json
const rInitExisting = run(`"${bin}" init sample-suite`);
assert.strictEqual(rInitExisting.status, 2, "Expected exit 2 when target has existing suite.json");

// b) Refuse if target is an existing regular file
const aFilePath = path.join(workDir, "regular-file.txt");
fs.writeFileSync(aFilePath, "hello");
const rInitFile = run(`"${bin}" init regular-file.txt`);
assert.strictEqual(rInitFile.status, 2, "Expected exit 2 when target is a file");
console.log("✓ Init overwrite/race safety verified.");

console.log("\n==========================================");
console.log("ALL VERIFICATION CHECKS PASSED PERFECTLY!");
console.log("==========================================");
