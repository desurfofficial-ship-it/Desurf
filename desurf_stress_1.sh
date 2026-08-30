#!/usr/bin/env bash
# Desurf stress test harness #1 — CLI parsing, suite loading, assertions, provenance
# Each scenario prints header, exit code, and trimmed output. Fast + offline only.
D=${DESURF_TEST_DIR:-/tmp/desurf-test-fx1}
DESURF=desurf
rm -rf "$D"; mkdir -p "$D"
cd "$D" || exit 1

r() { # r <label> <expectation-note> <cmd...>
  local label="$1"; local note="$2"; shift 2
  echo "### $label"
  echo "    expect: $note"
  local out code
  out=$("$@" 2>&1); code=$?
  echo "$out" | sed 's/^/    /' | head -6
  echo "    EXIT=$code"
  echo
}

# ---------- baseline ----------
$DESURF init good >/dev/null 2>&1
r "B0 baseline: init'd suite passes" "exit 0" $DESURF test --suite good

# ---------- A. CLI parsing ----------
r "A1 --version ANYWHERE hijacks test run (CI green skip)" "should run tests, exit 0 only if tests pass; bug: version wins" $DESURF test --suite good --version
r "A2 --suite eats next flag: --suite --verbose" "clear 'missing value' error; bug: suite='--verbose'" $DESURF test --suite --verbose
r "A3 dangling --suite at end" "clear 'requires a value'; bug: Unknown option: --suite" $DESURF test --suite
r "A4 --case '' empty string value" "clear error; bug: Unknown option: --case" $DESURF test --suite good --case ""
r "A5 --repeat 0x10 hex accepted?" "reject hex; bug: silently accepted as 16" $DESURF test --suite good --repeat 0x10 --case NOPE
r "A6 --repeat 1e9 accepted (fast-fail via bad case id)" "reject huge; bug: accepted → DoS/cost bomb" $DESURF test --suite good --repeat 1000000000 --case NOPE
r "A7 stray positional silently ignored" "error or warn; bug: ignored, runs suite anyway" $DESURF test ./typo-dir --suite good
r "A8 unknown command" "exit 2 (expected OK)" $DESURF frobnicate
r "A9 'desurf version' as subcommand" "works in many CLIs; here: unknown command" $DESURF version

# ---------- B. suite loading ----------
mkdir -p empty-cases && printf '{"name":"e","cases":[]}' > empty-cases/suite.json
r "B1 EMPTY suite → exit 0 PASS?" "exit 2/warn; bug: green CI with zero tests" $DESURF test --suite empty-cases

mkdir -p empty-assert inputs prompts outputs
printf 'in' > inputs/i.txt; printf 'p' > prompts/p.txt; printf '{"ok":true}' > outputs/o.json
cat > empty-assert/suite.json <<'EOF'
{"name":"e","cases":[{"id":"c1","input":"inputs/i.txt","prompt":"prompts/p.txt","output":"outputs/o.json","assertions":[]}]}
EOF
r "B2 EMPTY assertions [] → auto-pass" "error/warn; bug: vacuous PASS (every() on empty array)" $DESURF test --suite empty-assert

mkdir -p bom && $DESURF init bom-src >/dev/null 2>&1
printf '\xEF\xBB\xBF' > bom/suite.json; cat bom-src/suite.json >> bom/suite.json
cp -r bom-src/inputs bom-src/prompts bom-src/outputs bom/
r "B3 BOM-prefixed suite.json (Windows/PowerShell)" "parse OK; bug: 'Invalid JSON'" $DESURF test --suite bom

mkdir -p suitedir/suite.json
r "B4 suite.json is a DIRECTORY" "friendly error; bug: raw EISDIR errno" $DESURF test --suite suitedir

$DESURF init cn >/dev/null 2>&1 && mv cn/suite.json cn/other.json
r "B5 custom-named suite file other.json" "documented? only literal suite.json works" $DESURF test --suite cn/other.json

mkdir -p miss-in && cp good/suite.json miss-in/ 2>/dev/null
mkdir -p miss-in/inputs miss-in/prompts miss-in/outputs
printf 'x' > miss-in/prompts/classify.txt
printf 'x' > miss-in/outputs/classify.json
# input file intentionally missing
sed -i 's|inputs/support-request.txt|inputs/MISSING.txt|' miss-in/suite.json
r "B6 missing input file → error message quality" "actionable msg; bug: raw ENOENT dump" $DESURF test --suite miss-in

mkdir -p dup && cp -r good/inputs good/prompts good/outputs dup/
node -e '
const s=require("fs").readFileSync("good/suite.json","utf8");
const j=JSON.parse(s); j.cases.push(JSON.parse(JSON.stringify(j.cases[0])));
require("fs").writeFileSync("dup/suite.json", JSON.stringify(j));'
r "B7 duplicate case ids accepted" "error on dup ids; bug: accepted" $DESURF test --suite dup --json

# ---------- C. assertions ----------
mkdir -p badregex && cp -r good/inputs good/prompts good/outputs badregex/
node -e '
const j=JSON.parse(require("fs").readFileSync("good/suite.json","utf8"));
j.cases[0].assertions=[{type:"regex",pattern:"(["}];
require("fs").writeFileSync("badregex/suite.json", JSON.stringify(j));'
r "C1 invalid regex pattern → exit code?" "exit 2 (config ERROR per own docs); bug: exit 1 REGRESSION" $DESURF test --suite badregex

mkdir -p ctorkey && cp -r good/inputs good/prompts good/outputs ctorkey/
node -e '
const j=JSON.parse(require("fs").readFileSync("good/suite.json","utf8"));
j.cases[0].assertions=[{type:"json_schema",schema:{required:["constructor","__proto__","toString"]}}];
require("fs").writeFileSync("ctorkey/suite.json", JSON.stringify(j));'
r "C2 required:[__proto__/constructor] → auto-pass" "reject; bug: 'in' check hits prototype chain" $DESURF test --suite ctorkey

mkdir -p constobj && cp -r good/inputs good/prompts good/outputs constobj/
node -e '
const j=JSON.parse(require("fs").readFileSync("good/suite.json","utf8"));
j.cases[0].assertions=[{type:"json_schema",schema:{properties:{reason:{const:{evil:"object"}}}}}];
require("fs").writeFileSync("constobj/suite.json", JSON.stringify(j));'
r "C3 non-primitive const → reference compare" "deep-equal or reject at load; bug: can NEVER pass" $DESURF test --suite constobj

mkdir -p reqempty && cp -r good/inputs good/prompts good/outputs reqempty/
node -e '
const j=JSON.parse(require("fs").readFileSync("good/suite.json","utf8"));
j.cases[0].assertions=[{type:"required",value:""},{type:"forbidden",value:""}];
require("fs").writeFileSync("reqempty/suite.json", JSON.stringify(j));'
r "C4 required value:'' → vacuous pass" "reject at load; bug: ''.includes always true" $DESURF test --suite reqempty

mkdir -p schemaloose && cp -r good/inputs good/prompts good/outputs schemaloose/
node -e '
const j=JSON.parse(require("fs").readFileSync("good/suite.json","utf8"));
j.cases[0].assertions=[{type:"json_schema",schema:{type:"string",required:"category"}}];
require("fs").writeFileSync("schemaloose/suite.json", JSON.stringify(j));'
r "C5 schema type:'string' & required:string → silently ignored" "reject unsupported; bug: no-op assertion green" $DESURF test --suite schemaloose

mkdir -p bomout && cp -r good/inputs good/prompts bomout/ && mkdir bomout/outputs
printf '\xEF\xBB\xBF' > bomout/outputs/classify.json && cat good/outputs/classify.json >> bomout/outputs/classify.json
cp good/suite.json bomout/
r "C6 BOM-prefixed OUTPUT cassette (Windows)" "json_schema should parse; bug: 'not valid JSON' REGRESSION" $DESURF test --suite bomout

mkdir -p latin1 && cp -r good/inputs good/prompts latin1/ && mkdir latin1/outputs
printf 'caf\xE9 ok' > latin1/outputs/classify.json   # latin-1 é, invalid UTF-8
node -e '
const j=JSON.parse(require("fs").readFileSync("good/suite.json","utf8"));
j.cases[0].assertions=[{type:"required",value:"café"}];
require("fs").writeFileSync("latin1/suite.json", JSON.stringify(j));'
r "C7 non-UTF8 output bytes → silent U+FFFD" "warn about invalid UTF-8; bug: silent mojibake" $DESURF test --suite latin1

# ---------- D. provenance / fingerprint ----------
mkdir -p badsrc && cp -r good/inputs good/prompts good/outputs badsrc/
sed 's/"source"/"source"/' good/suite.json > badsrc/suite.json
node -e 'const f="badsrc/outputs/classify.json.desurf";const j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.source="banana";require("fs").writeFileSync(f,JSON.stringify(j));' 2>/dev/null || cp good/outputs/classify.json.desurf badsrc/outputs/ 2>/dev/null
ls good/outputs/
echo "(constructing badsrc sidecar)"
r "D1 sidecar source:'banana' → desurf test (whole-suite crash?)" "per-case ERROR row; bug: raw crash after all execs ran" $DESURF test --suite badsrc
r "D1b same suite → desurf inspect (per-case INVALID, exit 2)" "inconsistent w/ test path" $DESURF inspect --suite badsrc

mkdir -p badhash && cp -r good/inputs good/prompts good/outputs badhash/
node -e 'const f="badhash/outputs/classify.json.desurf";const j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.inputSha256="banana";require("fs").writeFileSync(f,JSON.stringify(j));'
r "D2 inputSha256:'banana' (not hex)" "INVALID meta; bug: accepted → misleading 'Input changed'" $DESURF inspect --suite badhash

mkdir -p v99 && cp -r good/inputs good/prompts good/outputs v99/
node -e 'const f="v99/outputs/classify.json.desurf";const j=JSON.parse(require("fs").readFileSync(f,"utf8"));j.version=99;require("fs").writeFileSync(f,JSON.stringify(j));'
r "D3 meta version:99 → ignored" "version check; bug: v99 treated as v1" $DESURF inspect --suite v99

mkdir -p crlf && cp -r good/inputs good/prompts good/outputs crlf/
sed -i 's/$/\r/' crlf/inputs/support-request.txt   # simulate git autocrlf checkout
r "D4 CRLF input after seal (git autocrlf on Windows)" "should PASS (content-equal); bug: false STALE exit 2" $DESURF test --suite crlf

# ---------- F. provider / record ----------
r "F1 record --provider offline rejected" "exit 2 (expected OK)" $DESURF record --suite good --provider offline
r "F2 record openrouter w/o API key" "clean per-case error, exit 2" $DESURF record --suite good --provider openrouter
r "F3 unknown provider" "exit 2 (expected OK)" $DESURF test --suite good --provider bogus

# ---------- G. init ----------
touch afile
r "G1 init onto existing FILE path" "friendly error; bug: raw ENOTDIR/ENOTEMPTY" $DESURF init afile
r "G2 init refuses existing suite (good)" "exit 2 (expected OK)" $DESURF init good

echo "=== harness 1 done ==="
