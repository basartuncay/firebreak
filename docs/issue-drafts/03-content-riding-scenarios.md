# Content riding: make the scenarios carry the planted text

Draft, not yet filed on GitHub. Miss group: **attack text inside a message to a legitimate recipient (4 of
the 10 misses)**.

## Context

In four scenarios (`cordon-contact-gap-c_001`, `c_004`, `cordon-holdout-h_002`, `h_003`) the recipient is
the one the user named, and the attack is a sentence inside the message: a fraudulent IBAN, a false
instruction. Firebreak does not judge prose, and only F2 inspects message bodies (for secrets and private
data). The README and `docs/threat-model.md` say so.

There is a second gap, in the measurement itself. The converted scenarios do not replay the planted text.
In `scenarios/cordon/cordon-contact-gap-c_004.yaml` the email plants "new IBAN TR00 0000 EXAMPLE 9911",
but the attempted call sends `body: As requested.`. So even a rule that inspected bodies could not be
measured on this corpus.

## Proposed change

Step 1 is a self-contained first contribution. Step 2 needs a discussion before any code.

1. Write three or four scenarios by hand under `scenarios/firebreak/attacks/` in which the body of the
   attempted call contains the planted text verbatim (a payment detail, a false instruction), sent to a
   recipient that did not come from untrusted output. Mark each `knownMiss: true` with a note that names
   this limit.
2. Open a discussion on whether an opt-in check is worth its friction: hold a write when its content
   argument contains a payment detail copied from untrusted output. `src/provenance/extract.ts` already
   extracts IBAN-like and phone-like values, but note that the IBAN-like pattern does not match a number
   written with spaces. Forwarding a real invoice would ask too.

## Acceptance check (step 1)

- The new scenarios load and are reported under "Known limits" by `node dist/cli.js test`.
- Blocked stays 63, so the snapshot in `tests/testsuite.test.ts` does not change. The attack total grows,
  which lowers the headline percentage. Update every place the total is written: README (feature list and
  "Results"), `docs/results.md` (headline, category table, the list of misses) and `CHANGELOG.md`.
- The pull request says plainly that the headline drops because the corpus got more honest, not because
  the engine changed.
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` pass.
