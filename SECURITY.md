# Security policy

Firebreak is a security tool, so bypasses matter. If you find a way to get a call past a rule that
should have stopped it, to approve a call without the dashboard token, or to alter the audit log
without `firebreak audit verify` noticing, please report it privately through
[GitHub's private vulnerability reporting](https://github.com/basartuncay/firebreak/security/advisories/new)
instead of opening a public issue.

Known, documented limits (see `docs/threat-model.md`) are not vulnerabilities: paraphrased or encoded
values, attack text inside a message to a legitimate recipient, and value substitution in
non-destination fields. Ideas for closing them are welcome as regular issues.
