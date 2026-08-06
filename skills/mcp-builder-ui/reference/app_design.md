# 🧭 Designing Conversational Apps

The SDK tells you how to render a view. This tells you what is worth rendering,
and how to make it belong in a conversation.

Read this **before** writing any view code. Most bad MCP Apps are not badly built
— they are well-built versions of the wrong idea.

---

## 1. The three consumers of a tool result

Every App tool result is read by three different consumers with different needs:

| Consumer | Reads | Needs |
|---|---|---|
| **The model** | `content` (and `structuredContent`) | Facts it can reason about and cite in its answer |
| **The human** | the view | Perception and manipulation — things eyes and hands do better than tokens |
| **The view** | `structuredContent` | Data dense enough to render, in a shape it can index |

Almost every design failure is a failure to serve all three.

**The governing rule:** the model must be able to answer the user's question with
the view switched off. The view earns its place by adding what the model's answer
*can't* carry — not by carrying the answer.

A concrete test. Your tool returns 200 sales records.

- `content`: "Q3 revenue was €1.2M across 200 orders, up 14% QoQ. Top region: DACH
  (€420k). Two orders were flagged for review." — the model can now discuss it.
- `structuredContent`: the 200 records — the view can chart and filter them.
- The view: a chart with a region filter, so the user can *see* the DACH spike and
  poke at it.

If you had put only the 200 raw records in `content`, you would have burned
context and the model would still summarise them badly. If you had put only the
chart in the view, the model would be unable to answer "how much was DACH?".

---

## 2. When a view earns its place

### The read-aloud test

Could you read the tool's result aloud over the phone and be just as useful? If
yes, don't build a view. This kills most candidates immediately, and that's the
point.

A view is justified when it provides one of three things:

**Perception.** Structure that lives in space or time and collapses when
serialised into a sentence. A trend line. A geographic cluster. A retention
heatmap where the eye finds the cohort that fell off a cliff in week 3. Rendering
these as prose is lossy in a way summarisation can't fix.

**Manipulation.** Input the model physically cannot produce. Dragging a slider
across a continuous range. Selecting a region on a map. Reordering a list.
Cropping an image. Anywhere the natural interaction is *direct* rather than
*described*, a view converts three clarifying turns into one gesture.

**Volume with structure.** More rows than anyone wants read to them, where the
value is in scanning, sorting and filtering rather than in any single row.

### When it actively hurts

- **Confirmations and single values.** "File created." "The answer is 42." A view
  here is a box around a sentence.
- **Anything that ends the interaction.** If the user's next move is to close the
  tab, a view adds a permission prompt and a load for nothing.
- **Content the model needs to reason about anyway.** You'll have to put it in
  `content` regardless, so the view is duplication.

Views are not free. Each one costs the user vertical space in a scrolling
conversation, a permission prompt the first time, and a small load. A server with
one excellent view is better than a server where every tool renders something.

---

## 3. Design the loop, not the screen

The unit of design here is not a screen. It's a **turn**, and turns come in
loops:

```
model calls tool  →  view renders  →  user acts in the view
        ↑                                      ↓
  next model turn   ←   updateModelContext / sendMessage
```

Four moments, each with a design decision:

**1. The call.** What does the model need to know to call this well? Input schema
descriptions are prompt engineering — `"ISO 3166-1 alpha-2, e.g. DE"` prevents a
whole class of retries.

**2. The render.** What does the user see in the first 200ms, before data arrives?
Use `ontoolinputpartial` for a preview. A skeleton beats a spinner; a spinner beats
a blank iframe.

**3. The act.** What is the *one* thing the user is most likely to do here? Make
that obvious and cheap. Everything else can be a second click.

**4. The return.** After they act, does the model know? This is the moment almost
everyone skips, and it's the one that decides whether the thing feels like an app
or a decoration.

If your design has no step 4 — if nothing the user does in the view ever comes
back — you have not built a conversational app. You've built an iframe that happens
to be in a chat window. That may be fine! But be honest about which one you're
shipping, because the second kind is better served by a link.

---

## 4. What to send back, and when

### Granularity

`updateModelContext` is not a change stream. Fire it on **commitments**, not
motions:

| Fire | Don't fire |
|---|---|
| Selection confirmed | Every mousemove |
| Filter applied | Every keystroke in the filter box |
| Item added to cart | Hover |
| Map settled after pan/zoom | Every frame of the pan |
| Page changed in a document | Every scroll tick |

Debounce continuous interactions (300–500ms after the user stops). Every update
consumes context; a chatty view degrades the whole conversation.

### Shape

Frontmatter for facts, prose for intent:

```
---
selected-region: DACH
date-range: 2026-07-01/2026-09-30
order-count: 84
---

User filtered the revenue chart to DACH for Q3 and selected the two flagged
orders (#4471, #4488).
```

The frontmatter is what the model will quote back. The prose is what tells it
*why* the user is looking, which shapes the next answer. Keep the whole thing
under a few hundred tokens — you are writing a note to a colleague who is looking
away from the screen, not a state dump.

### The three channels, restated

| Channel | Direction | Use for |
|---|---|---|
| `content` | tool → model | The answer, always, standalone |
| `structuredContent` | tool → view | Render data |
| `updateModelContext` | view → model | What the user is doing now |
| `sendMessage` | view → conversation | The user asking for the next turn |

`sendMessage` is a stronger move than `updateModelContext` — it consumes a turn
and produces a visible response. Reserve it for explicit user intent (a button
labelled "Explain this"), never for ambient state. A view that sends messages on
its own is a view that talks over the user.

---

## 5. Space etiquette

Your view lives inside someone else's scrolling conversation, above their message
box. Behave like a guest.

- **Default small.** Inline height should feel like a rich message, not a page.
  Offer `requestDisplayMode({ mode: "fullscreen" })` for the user who wants more —
  don't take it by default.
- **Never steal focus.** The user may be typing in the chat input while your view
  loads.
- **No autoplay with sound.** Ever.
- **Don't scroll-jack.** The page scroll belongs to the conversation.
- **Pause when offscreen.** The conversation keeps growing; your WebGL canvas is
  three screens up and still burning a core. `IntersectionObserver`.
- **Match the host.** Host CSS variables, both themes, safe-area insets. A view
  with its own visual identity looks like an ad.

---

## 6. Design for cold start

A conversation is append-only, but view instances are not. Each tool call mounts
a **fresh** view: no memory of the previous one, possibly re-mounted after a
reload, possibly one of five instances of the same view alive in one thread.

Consequences:

- Everything the view needs must arrive through `ontoolinput` / `ontoolresult`,
  or be fetchable by an app-only tool. There is no session.
- Ephemeral view state (scroll, camera, current page) → `localStorage` keyed by
  the server-minted `viewUUID`.
- State that represents **user effort** — annotations, saved configs, bookmarks —
  → server-side via an app-only tool scoped by `viewUUID`. Losing it to a reload
  is a data-loss bug, not a UI glitch.
- Scrolling back to an old view in the thread should show something coherent, not
  a broken shell.

---

## 7. Trust

The first time your view renders, the user is asked to permit it. Everything
about that moment is a trust negotiation.

- **Earn capabilities, don't demand them.** A view that requests camera or
  microphone on mount gets denied. Ask when the user reaches for the feature that
  needs it.
- **Degrade visibly.** If a permission is denied or an API fails, show it *and*
  tell the model with `updateModelContext`. A silently degraded view produces
  confidently wrong answers in the conversation, which is worse than an error.
- **Declare narrow CSP.** `connectDomains` should list the two hosts you need, not
  a wildcard. It is inspectable, and it will be inspected.
- **Never route links through `window.open`.** Use `app.openLink()` and handle the
  denial.

---

## 8. Anti-patterns

**The dashboard that replaces the answer.** Beautiful view, `content` reduced to
"Here is your dashboard." The model is now blind and every follow-up question
fails. The most common serious failure.

**The form that should have been a tool call.** If the model could fill these
fields from the conversation, let it. Forms are for input the model doesn't have
and can't guess — not for making the user retype what they just said.

**The website in a box.** Nav bar, sidebar, tabs, footer. If your view has
navigation, it's an app that wandered into a chat. One view, one job; a second job
is a second tool.

**Chat inside chat.** Never build a message list and an input box inside a view.
The user already has one, it's better than yours, and the model can see it.

**The infinite scroller.** Endless feeds inside a conversation trap the page
scroll and never end. Page it, or cap it and offer fullscreen.

**The silent mutator.** A view that changes server state through app-only tools
without ever telling the model. The user says "undo that" and Claude doesn't know
what "that" was.

**The context firehose.** `updateModelContext` on every interaction. The context
window fills with UI noise and the model's answers get worse as the user does
more.

---

## 9. Worked example

**Tool:** `list_issues(project, status)` — returns 60 issues from a tracker.

### The obvious bad version

- `content`: "Rendered 60 issues."
- View: a table with sorting, plus a "close issue" button calling an app-only tool.
- No `updateModelContext`.

Why it fails: the user sorts by priority, spots three stale bugs, closes one, then
asks "summarise what's blocking the release". Claude knows nothing — not the
issues, not the sort, not the closure. The app and the conversation are two
separate products sharing a window.

### The good version

- `content`: "60 open issues. 8 are P0, of which 3 have been open more than 14
  days (#221 auth timeout, #245 payment retry, #260 CSV export). No P0s are
  unassigned." — the model can now hold a conversation about the release with the
  view closed.
- `structuredContent`: the 60 issues with the fields the table needs.
- View: table, priority/age sort, a filter, and one primary action.
- On filter or selection (debounced): `updateModelContext` with frontmatter
  (`filter`, `visible-count`, `selected`) and one line of prose.
- On close-issue (app-only tool): `updateModelContext` — "User closed #245
  (payment retry) from the issues view."
- On a row's "Explain" button: `sendMessage` — "Why is #221 still open?"
- `_meta.viewUUID` from the server; sort and filter persisted to `localStorage`.

Now the user sorts, closes, and asks "what's blocking the release" — and Claude
answers with the three stale P0s, knows #245 is gone, and knows the user is
looking at P0s only. That coherence is the entire product.

---

## 10. Review rubric

Before shipping a view, answer these. A "no" is a redesign, not a polish item.

1. Switch the view off. Does `content` still answer the user's question?
2. Read the result aloud. Is the view still adding perception, manipulation or
   scannable volume?
3. Does the user's most likely action take one click, from a cold mount?
4. Does everything meaningful the user does reach the model?
5. Does anything trivial the user does reach the model? (It shouldn't.)
6. Reload mid-use. Is anything the user worked on gone?
7. Toggle the host theme. Does it follow?
8. Scroll it offscreen. Does it stop consuming CPU?
9. Deny its permissions and break its network. Does it fail visibly, and does the
   model find out?
10. Would this be better as a link to a web app? If yes, ship the link.

Question 10 is not a trap. Some things genuinely belong on the web. The apps worth
building in a conversation are the ones that get *better* by being in it.
