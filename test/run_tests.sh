#!/bin/bash
# Cuubz Test Runner — Run all tests and report results
# Usage: bash test/run_tests.sh
#
# Tests listed in test/QUARANTINE.md are skipped and reported as SKIP. They do not
# affect the exit code. See that file for why each one is deferred and who owns it.

cd "$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
SKIP=0
TOTAL=0
FAILED_TESTS=""
SKIPPED_TESTS=""

QUARANTINE_FILE="test/QUARANTINE.md"

echo "==================================="
echo "  Cuubz Test Suite"
echo "==================================="
echo ""

# Collect quarantined basenames from QUARANTINE.md.
#
# Only the FIRST COLUMN of a markdown table row counts. Matching any test_*.js
# anywhere in the file is wrong — the prose discusses tests that are deliberately
# NOT quarantined, and scooping those up silently skips passing tests.
QUARANTINED=""
if [ -f "$QUARANTINE_FILE" ]; then
  QUARANTINED=$(grep -E '^[[:space:]]*\|' "$QUARANTINE_FILE" \
    | sed -E 's/^[[:space:]]*\|[[:space:]]*`?([A-Za-z0-9_]+\.js)`?[[:space:]]*\|.*/\1/' \
    | grep -E '^test_[A-Za-z0-9_]+\.js$' \
    | sort -u)
fi

is_quarantined() {
  local name="$1"
  for q in $QUARANTINED; do
    [ "$q" = "$name" ] && return 0
  done
  return 1
}

# Find all test files
for test_file in test/test_*.js; do
  # Skip if no test files exist yet
  [ -e "$test_file" ] || continue

  TEST_BASENAME=$(basename "$test_file")
  TEST_NAME=$(basename "$test_file" .js)

  if is_quarantined "$TEST_BASENAME"; then
    SKIP=$((SKIP + 1))
    SKIPPED_TESTS="$SKIPPED_TESTS\n  ⏭️  SKIP — $TEST_NAME (see test/QUARANTINE.md)"
    echo "Running: $TEST_NAME..."
    echo "  ⏭️  SKIP — $TEST_NAME (quarantined)"
    continue
  fi

  TOTAL=$((TOTAL + 1))

  echo "Running: $TEST_NAME..."

  # Run test, capture output and exit code.
  #
  # -r test/helpers/esmRequire.js installs the require hook that lets these CommonJS
  # tests require() the ES modules in src/ (PR 9). Without it every test that requires
  # a source file dies on "Cannot use import statement outside a module". Read that
  # file's header before changing this line; PR 31 deletes both.
  OUTPUT=$(node -r ./test/helpers/esmRequire.js "$test_file" 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    PASS=$((PASS + 1))
    echo "  ✅ PASS — $TEST_NAME"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS="$FAILED_TESTS\n  ❌ FAIL — $TEST_NAME\n$OUTPUT"
    echo "  ❌ FAIL — $TEST_NAME"
    # Show first few lines of failure output
    echo "$OUTPUT" | head -5 | sed 's/^/    /'
  fi
done

echo ""
echo "==================================="
echo "  Results: $PASS/$TOTAL passed, $FAIL failed, $SKIP skipped"
echo "==================================="

if [ $SKIP -gt 0 ]; then
  echo ""
  echo "Quarantined (not run, see test/QUARANTINE.md):"
  echo -e "$SKIPPED_TESTS"
fi

if [ $TOTAL -eq 0 ]; then
  echo "  ⚠️  No test files found in test/"
  exit 0
fi

if [ -n "$FAILED_TESTS" ]; then
  echo ""
  echo "Failed Tests Detail:"
  echo -e "$FAILED_TESTS"
  exit 1
fi

if [ $FAIL -eq 0 ]; then
  echo "  🎉 All tests passing!"
fi

exit $FAIL
