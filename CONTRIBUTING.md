# Contributing

Contributions and forks are welcome and encouraged. Open an issue for a bug, a question or an idea, or a pull request with a fix, a test or a doc. Forking it with your own pack of checks is just as welcome.

This is a personal research and learning project, not affiliated with the author's employer, Liquidware or Microsoft, and not intended for production use. Contributions are accepted under the [MIT License](LICENSE), as is and without warranty.

## What fits

The design is [docs/spec.md](docs/spec.md). The page measures from the user's own device, claims only what it measured, cites every threshold, and sends nothing anywhere unless the user shares it. Changes that keep those promises are the best fit. Anything that adds a third-party request, a sign-in, analytics or an upload belongs in a fork.

## Before you open a PR

Run the checks CI runs (Node.js 22, no install step):

```bash
node --test "tests/*.test.mjs"
```

## Never in an issue or a PR

- A log bundle, a raw log file, or a screenshot of one. They hold user, device and tenant names.
- A result exported from a custom pack (it names your organization's hosts).
- Tenant, subscription or object IDs, IP addresses, email addresses, secrets, or employer or customer names.

Test fixtures are synthetic, always.
