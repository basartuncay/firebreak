# Threat model

## What Firebreak protects

The user's data and accounts behind the MCP servers an agent uses (mail, calendar, code hosting, files,
chat, HTTP), against actions the user did not intend, when those actions are triggered by content the
agent read.

## Trust

| Trusted                                           | Untrusted                                                             |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| The user's prompt (never seen by Firebreak)       | Every tool result from a server with `trust: untrusted` (the default) |
| The policy file and the Firebreak state directory | Tool names, descriptions and schemas reported by servers              |
| The MCP client and the model's sandbox            | Anything the model writes into tool arguments                         |

`trust: private` servers hold the user's own data: their output is not attacker text, but sending it to
an open-world tool needs approval (F2). `trust: trusted` servers are not tracked at all.

## Attacker

Can put text where the agent will read it: an email, an issue, a web page, a document, a calendar invite,
a tool description (a malicious or compromised MCP server). Cannot change the user's prompt, the policy,
the Firebreak process or the state directory.

## What Firebreak catches

| Attack                                                                                     | Rule |
| ------------------------------------------------------------------------------------------ | ---- |
| Recipient, URL, path, repository or channel taken from untrusted output                    | F1   |
| Credentials or private data in arguments of open-world tools, including reads like `fetch` | F2   |
| Deletions and other destructive calls                                                      | F3   |
| Data read from one server written to another (the "lethal trifecta" path)                  | F4   |
| Runaway loops and mass actions                                                             | F5   |
| Tool definitions changed after approval (rug pull); poisoned descriptions                  | F6   |

## Scope of provenance

Firebreak only sees servers it wraps. Every proxy that one MCP client starts (same parent process on
this machine, or the same `FIREBREAK_GROUP`) shares what it has read through the state store, so a
value read through the mail server is recognised when it is written through the chat server. A server
the client runs without Firebreak is invisible: data it returns is not tracked. Wrap all servers of a
client (`firebreak install` does) for the cross-server rules to hold.

To share provenance, copies of tool output (email bodies, issue text, pages) are kept in
`~/.firebreak/firebreak.db` for 12 hours, then deleted. Treat that file as sensitive.

## What it does not catch

- **Paraphrased, translated, encoded or split values.** Provenance is tracked by matching values that
  appear verbatim in tool output. A model that decodes base64 or rewrites an address defeats it.
- **Attacks that live in message text** sent to a legitimate recipient (a false instruction, a fake
  IBAN): the destination is fine, and Firebreak does not judge prose.
- **Value substitution in non-destination fields** (times, amounts, titles).
- **Read-only harm:** a poisoned summary shown to the user. Nothing crosses the gateway.
- **Remote (HTTP) MCP servers.** v0.1 wraps stdio servers only.
- **A compromised client or model host**, or anyone who can edit the policy or state directory.
- **Hostile local server code.** A wrapped server runs as your user. Malicious code inside it can open
  the state file and approve its own calls, lift a quarantine or rewrite the audit chain. Firebreak's
  defences hold against servers whose _content_ is hostile (an injected email, a changed remote tool
  description), not against a malicious program you installed. Run untrusted server code in a sandbox.
- **Following links.** Fetching a URL found on a page is allowed; only secrets or private data in an
  open-world read's arguments are checked.

## Failure behaviour

- Policy file invalid → `firebreak wrap` refuses to start (exit 2) and names the bad field.
- State store cannot be opened → the proxy still relays, allows only calls with no finding, denies
  everything else, and says so on stderr.
- Approval not answered within `approval.timeoutSeconds` → denied (recorded as `expired`).
- Upstream server exits → pending calls get a JSON-RPC error; the proxy exits with the server's code.

## Local attack surface

- The dashboard binds to `127.0.0.1` only. Every API request needs the random token printed by
  `firebreak ui`, sent as a header (kept in the tab's session storage, never a cookie, because browsers
  send cookies to every port on 127.0.0.1). Requests with a foreign `Host` (DNS rebinding) or from another
  origin are refused, so a web page in your browser cannot read or approve calls.
- The audit log is hash-chained: `firebreak audit verify` detects edited or deleted rows. It does not
  stop someone with write access to the state directory from rewriting the whole chain.
- Arguments are stored with known secret formats redacted.
