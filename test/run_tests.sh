#!/bin/bash
# Cuubz Test Runner — Run all tests and report results
# Usage: bash test/run_tests.sh

cd "$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0
TOTAL=0
FAILED_TESTS=""

echo "==================================="
echo "  Cuubz Test Suite"
echo "==================================="
echo ""

# Find all test files
for test_file in test/test_*.js; do
  # Skip if no test files exist yet
  [ -e "$test_file" ] || continue
  
  TOTAL=$((TOTAL + 1))
  TEST_NAME=$(basename "$test_file" .js)
  
  echo "Running: $TEST_NAME..."
  
  # Run test, capture output and exit code
  OUTPUT=$(node "$test_file" 2>&1)
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
echo "  Results: $PASS/$TOTAL passed, $FAIL failed"
echo "==================================="

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
