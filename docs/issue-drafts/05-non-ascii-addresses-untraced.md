# Trace addresses that contain invisible or non-Latin characters

Draft, not yet filed on GitHub. Not yet a corpus scenario: found while building a hostile test case for the
dashboard (2026-11-23). No change to the gateway was made.

## Context

The email pattern in `extractAtoms` (`src/provenance/extract.ts`, line 7) is ASCII only:
`[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,8}`. Values shorter than
`SUBSTRING_MIN_LENGTH` (40, `src/provenance/taint.ts`) are traced only through atoms. So an address that
breaks the ASCII pattern and is shorter than 40 characters is not traced at all, and F1 does not fire.

Reproduced by driving the real gateway (`firebreak wrap` over `tests/fixtures/mock-server.mjs`, default
policy from `.preview/seed.mjs`): a tool result contained an address, and the agent copied it into
`send_email`. Two variants were **allowed without asking**:

- `to: "ops<U+200B>@evil.example"`: a zero-width space before the `@`. Many mail systems drop the
  character; the pattern finds no local part, so no atom.
- `cc: "billing@p<U+0430>ypal.example"`: a Cyrillic `а` in the domain. That is a different, registrable
  domain (IDN), so this is a real exfiltration destination, and it looks like a trusted one.

The same call with the plain `ops@evil.example` is held by F1 as expected. The dashboard now shows such
characters as `⟨U+…⟩` chips and warns about mixed scripts, but only for calls it is shown; an allowed call
only reaches the Activity view.

## Proposed change

1. Before atom extraction and before tracing an argument, remove zero-width and bidirectional formatting
   characters (U+200B-U+200F, U+2060, U+FEFF, U+202A-U+202E, U+2066-U+2069) from both sides, so
   `ops<U+200B>@evil.example` matches `ops@evil.example`.
2. Widen the email and host patterns to Unicode letters (`\p{L}`, with the `u` flag) and keep every
   quantifier bounded, as the file's header requires. Store the atom as written; optionally also its
   punycode form (`new URL("http://" + host).hostname`) so either spelling matches.
3. Consider a rule that asks when a destination argument mixes scripts, whether or not it is traced.

## Acceptance check

- New attack scenarios in `scenarios/firebreak/attacks/`: zero-width space in an address, Cyrillic letter
  in a domain, right-to-left override in a URL. Each is blocked or asked; none is `knownMiss`.
- The benign corpus still passes (an internationalised address the user typed is not flagged).
- `npm test` passes; the snapshot in `tests/testsuite.test.ts` changes only by the new scenarios, and the
  README's Results section is updated with the new numbers.
