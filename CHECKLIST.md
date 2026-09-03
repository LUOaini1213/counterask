# Submission checklist

Deadline: **3 September 2026, 1:00 pm PT**. In Singapore that is 4:00 am on the
4th. Confirm on the Devpost page before you rely on this line.

## Already verified in this repo

- [x] `npm test` green: 80 parser cases, 4,000 fuzzed sentences, 81 WebMCP-surface
      assertions, 36 page assertions, the bundled single file, both benchmarks.
- [x] Every registered tool has a `title`, a description, and an `inputSchema`;
      the three read-only tools carry `readOnlyHint`.
- [x] `answer_question` appears and disappears with the open question, and cannot
      be called out of turn.
- [x] Checkout is declarative, has no `toolautosubmit`, and is not registered as a
      callable tool.
- [x] Page serves correctly over plain HTTP from `public/` — no absolute paths, no
      localhost references, no build step required.
- [x] Only external requests are the two Google Fonts hosts; the page falls back
      to Georgia and the system sans without them.
- [x] `counterask-demo.html` is a single self-contained file that runs from
      `file://`.

## The one thing no test here can do

**The native WebMCP path has never run in a real browser.** Every "live mode"
result above comes from stand-ins shaped like the spec — the current
`document.modelContext`, the deprecated `navigator.modelContext` alias, and an
implementation that throws on duplicate names and only removes tools via
`unregisterTool`. The page is live on all three. But a stand-in is not Chrome.

Before you record anything, open the **deployed HTTPS URL** in ChatGPT's in-app
browser or Chrome with `chrome://flags/#enable-webmcp-testing`, and confirm all
three of these with your own eyes:

1. The header badge reads *WebMCP live in this browser*.
2. The Model Context Tool Inspector extension (or the ChatGPT browser) lists
   `search_products` and the other base tools.
3. Search for `belt`, and `answer_question` appears in that list. Answer it, and
   it disappears.

If (1) fails the page silently fell back to the stand-in and a judge will see no
tools at all. That is the single worst outcome available, and it is the one this
checklist cannot rule out for you. `[SecureContext]` means this must be HTTPS —
an `http://` URL will never go live no matter what the code does.

## To do before you submit

- [ ] **Push the repo public.** It must be public at submission time.
- [ ] **Deploy.** Any of the three configs in the repo works:
      - GitHub Pages: push to `main`, then set Pages → Source → *GitHub Actions*.
        `.github/workflows/pages.yml` runs `npm test` first and publishes `public/`.
      - Netlify: `netlify.toml` is present; publish directory `public`.
      - Vercel: `vercel.json` is present; output directory `public`.
- [ ] **Open the deployed URL and confirm the header badge.** In ChatGPT's in-app
      browser or Chrome with `chrome://flags/#enable-webmcp-testing` it should read
      *WebMCP live in this browser*. Anywhere else, *no WebMCP here — stand-in in
      use*. If it says the wrong thing, do not record.
- [ ] **Check `?agent=demo` on the deployed URL**, not just locally.
- [ ] **Record the video** using `DEMO_SCRIPT.md`. Upload to YouTube as public or
      unlisted per the rules; confirm which the rules require.
- [ ] **Paste `SUBMISSION.md` into Devpost**, and put the live URL in the "Try it"
      section — the placeholder is still in there.
- [ ] Confirm the demo video length limit on the Devpost page before uploading.
- [ ] Submit with margin. Devpost does not accept late entries and the last hour
      is when everyone else is uploading video.

## Two things worth deciding deliberately

**The live URL is a judged artifact.** "A working live app" is in the submission
requirements and *Execution* asks for a complete, coherent product experience
rather than a proof of concept. A URL that 404s or shows a stale build costs more
than any feature you could add in the remaining time. Deploy first, then spend
what's left on the video.

**Do not add features now.** Everything currently in the repo is covered by a test
that passes. An untested change made in the last hours is the single most likely
way to break the thing you are submitting.
