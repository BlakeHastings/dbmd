// TEMPORARY. This file exists to be watched failing and is reverted in the very
// next commit on this branch. Do not build on it and do not copy it.
//
// dbmd-55 made `check.yml` a matrix behind a gate job, and the gate is one line:
//
//     test "${{ needs.verify.result }}" = "success"
//
// That line is the merge gate for this repository, required by a ruleset with an
// empty bypass list. `AGENTS.md` says a gate nobody has watched fail is
// indistinguishable from one with nothing to catch, and dbmd-71 and dbmd-53 both
// paid for that proof rather than asserting it. This is that payment.
//
// The break is deliberately version-specific rather than universal, because that
// is the case the matrix exists for and it proves two things at once: that the
// gate reports a failure instead of vanishing into a skip, and that a break on
// one Node is caught rather than averaged away by the other.
//
// `RegExp.escape` is V8 13.5, which ships in Node 24 and not in Node 22. So this
// assertion is true on the `verify (24)` leg and false on `verify (22)`, with no
// reading of `process.version` anywhere: it is a real behavioural difference
// between the two runtimes rather than a sniff for one.
//
// The cast is because `lib: ["ES2023"]` in `tsconfig.json` does not declare it,
// and the point here is to fail at runtime on one Node rather than to fail
// typecheck on both.
import { describe, expect, it } from 'vitest'

describe('the merge gate reports a verdict when one leg of the matrix fails', () => {
  it('is red on Node 22 and green on Node 24, which is the whole demonstration', () => {
    const escape = (RegExp as unknown as { escape?: unknown }).escape
    expect(typeof escape).toBe('function')
  })
})
