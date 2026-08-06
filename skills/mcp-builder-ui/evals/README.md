# Evals

Five test cases in [`evals.json`](./evals.json), in the `skill-creator` format.

## What they're for

Each eval targets a failure this skill exists to prevent, and each is designed to
**differentiate** — a model without the skill plausibly fails it:

| # | Targets |
|---|---|
| 1 | The whole happy path: content fallback, `structuredContent`, single-file build, handler order, initial `getHostContext()`, `updateModelContext` |
| 2 | The CSP placement trap — `_meta.ui.csp` in `contents[]`, not in the config object. Silent failure, so nothing else catches it |
| 3 | The Python gap — no Python SDK, FastMCP `meta=`, exact mimetype, CDN vs bundled |
| 4 | Restraint. A skill that always builds a view is a bad skill. The correct answer is "don't" |
| 5 | The conversational loop end to end, including app-only visibility and reporting mutations back to the model |

Eval 4 is the one worth watching. Skills tend to over-trigger: having read a
detailed UI guide, a model wants to use it. If the skill can't say no, it makes
every server worse.

## Running them

From the `skill-creator` skill, following its "Running and evaluating test cases"
procedure: for each eval, spawn one run with this skill and one baseline without
it, grade the `expectations` against the outputs, then aggregate:

```bash
python -m scripts.aggregate_benchmark <workspace>/iteration-1 --skill-name mcp-builder-ui
```

Put the workspace outside this repo — results are not source.

## Reading the results

An expectation that passes 100% in both configurations isn't measuring the skill;
either the expectation is too easy or the baseline already knows it. Drop it or
sharpen it. The expectations that matter are the ones where the gap is wide:
historically, CSP placement (eval 2) and the content fallback (evals 1 and 5).

When adding an eval, write the expectation as something a grader can verify by
reading the output, not as a matter of taste. "Uses host CSS variables" is
checkable; "looks good" is not — judge that one by eye.
