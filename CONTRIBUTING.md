# Contributing

## Before you open a PR

```bash
python tools/validate.py
```

That checks the manifests, skill frontmatter, every relative link, the eval file,
and a set of regression guards. CI runs the same script plus a build and smoke
test of `examples/issue-board`.

## The one rule about API details

**Never write an MCP Apps signature from memory or from prose documentation.**
Several published guides — including official ones — contradict each other, and
this repo has already shipped three wrong signatures because of it. Verify
against the SDK's type-checked examples:

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 \
  https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
```

`src/app.examples.ts` and `src/server/index.examples.ts` are the authority. They
compile, so they cannot drift.

When you correct a signature, add a guard for the wrong form to `FORBIDDEN` in
`tools/validate.py`. These mistakes fail silently at runtime — a grep is the only
cheap place to catch them.

## Changing the skill

The reference files are loaded on demand, `SKILL.md` is always in context. Keep
`SKILL.md` as an index and decision procedure; put detail in `reference/`.

Explain *why* something matters rather than issuing instructions. A model that
understands the failure mode generalises to cases you didn't write down; one that
was told "always do X" does not.

If a change affects behaviour, add or adjust an eval in
`skills/mcp-builder-ui/evals/evals.json`. An expectation must be verifiable by
reading the output — "uses host CSS variables" qualifies, "looks good" does not.
Prefer expectations a model *without* the skill would plausibly fail; anything
that passes in both configurations measures nothing.

## Changing the example

`examples/issue-board` is documentation that compiles. Every part of it is there
to demonstrate something named in its README table — if you add code, say what it
teaches; if it teaches nothing, it doesn't belong.

```bash
cd examples/issue-board
npm install && npx tsc --noEmit && npm run build
```

No lockfile is committed on purpose: the example should keep working against
current SDK releases, and CI is how we learn when it stops.

## Versioning

Bump the version in **both** `.claude-plugin/marketplace.json` (in two places)
and `.claude-plugin/plugin.json`. The validator fails on drift.

Rough guide: patch for corrections, minor for new reference material or example
capability, major only if the skill's workflow changes shape.

## Provenance

This is a derivative of Anthropic's Apache-2.0 `mcp-builder` skill. If you modify
a file inherited from upstream, or add a new one, update `NOTICE` — it lists
files as unmodified, modified or added, and that list is the license obligation,
not a formality.
