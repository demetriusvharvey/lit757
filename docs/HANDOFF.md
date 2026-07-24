# Buzz work handoff

Written 2026-07-24. Read this before starting work on Buzz accuracy from a new
machine or a new session. It exists so the next session does not re-derive
context that took a while to establish, and does not repeat two mistakes that
were expensive here.

---

## Read this first

**Fetch before you analyse.** A local clone in this repo was 450 commits behind
`main` and looked complete. An entire architectural review was produced against
a months-old snapshot and had to be thrown away. `main` has 500+ commits and
roughly 95 branches.

```bash
git fetch --all --prune
git log --oneline -5 origin/main
```

**A branch being "ahead" does not mean it has unmerged work.** Three Buzz
branches looked like they held real work. Two were already fully absorbed into
`main` and only appeared ahead because of how they were landed. Merging either
would have been a pure regression, deleting the security layer and several
migrations. Check content, not commit counts:

```bash
git diff --stat origin/main origin/<branch>       # what actually differs
git diff --quiet origin/main origin/<branch> -- <file> && echo IDENTICAL
```

---

## Open pull requests

| PR | What it does | Base |
| --- | --- | --- |
| #88 | Hugging Face ML routes, hardened. Inert on merge. | `main` |
| #98 | Batch-trained calibration model and trainer | `main` |
| #99 | Verified production setup doc (this directory) | `main` |
| #100 | Leakage-proof evaluation library | #98 |
| #101 | Counterfactual signal ablation | #100 |

**Merge order for the chain: #98, then #100, then #101.** GitHub retargets each
one automatically as its parent lands. #88 and #99 are independent.

Nothing here requires environment variables to merge safely. #88 stays dormant
until `ML_DISCOVERY_ENABLED` is set, and #98's trainer fails closed with a 401
until `BUZZ_GROUND_TRUTH_SECRET` exists.

---

## Retired branches

`feature/buzz-intelligence-v3` and `feature/buzz-calibration` are **fully
absorbed** into `main` and should be closed or deleted rather than merged. Every
library file in the first is byte-identical to `main`, and the second differs
only by using the pre-hardening `createClient` instead of `getSupabaseAdmin()`.

```bash
git push origin --delete feature/buzz-intelligence-v3 feature/buzz-calibration
```

`agent/canonical-buzz-accuracy` does not exist. A Codex run committed to it
inside its own container and hit a quota wall before pushing. Commit `52093f6`
is not recoverable. Most of what it did was already on `main`.

---

## Decisions already made, and why

These were deliberate. Reversing any of them should be a conscious choice.

**Relevance never moves activity.** ML search re-ranking decides result order
only. `score`, `confidence` and `heat` are canonical activity truth and pass
through untouched. The previous behaviour republished a venue's activity score
as `max(canonicalScore, relevance * 100)`, so a quiet venue that matched a query
well was published as busy. That is a false-Hot generator no observation could
ever correct, because the inflation happened after scoring.

**ML discovery is opt-in and off by default.** A re-ranker must not become a
hard dependency of the canonical path. `/api/nearby` and `/api/live` both flow
through `/api/discover`.

**Calibration training does not accept `CRON_SECRET`.** `CRON_SECRET` goes to
schedulers for read-only refresh work. Training reads raw ground truth and
writes the artifact that can move public scores, so it sits on the narrower
`BUZZ_GROUND_TRUTH_SECRET` boundary. There is a test asserting `CRON_SECRET` is
rejected.

**The trained calibration model is stored but not wired into public scoring.**
Promotion should follow held-out evaluation. `confidenceFromCalibration` was
deliberately not ported: it promoted confidence to `high` on in-sample error
alone, with no per-venue check.

**Evaluation splits are time-based or leave-one-night-out, never random.** A
random split scatters one night's observations across training and holdout and
inflates every metric. Nights roll over at 6am local, so a 1am Saturday
observation grades as Friday night.

**Empty metric sets return `null`, not `0`.** Zero error would read as perfect
accuracy.

**False-Hot rate is measured against predictions that presented as hot**, not
against all samples, so a run of quiet nights cannot dilute a bad call.

**Ablation is arithmetic on frozen factors, never a recomputation.** Every
published score is the sum of its factor points, so subtracting a family's
points reconstructs what would have been published without it. Recomputing would
run after the observation exists and would see the outcome it is grading.

---

## Bugs found and fixed, worth not reintroducing

- **Timezone.** The calibration trainer bucketed observations with
  `getHours()`/`getDay()`/`getMonth()`, which is UTC on Vercel. Every
  Friday-night observation was filed under Saturday. Both calibration paths now
  share one `America/New_York` helper, with a regression test.
- **`Number(null)` is `0`, not `NaN`.** `observedValue` treated a null occupancy
  as a dead room. `occupancy_pct` is nullable and most observations are
  band-only, so this would have graded nearly the whole dataset against 0% and
  invented enormous errors while appearing to work.
- **NaN propagation.** `Math.min`/`Math.max` pass `NaN` straight through. A
  non-numeric score poisoned the relevance blend and made the result sort
  non-deterministic.
- **Migration ordering.** A migration dated earlier than already-applied ones
  would have sorted into the past. Always date new migrations after the newest
  existing file.

---

## What is left in the evaluation spine

Sections refer to the accuracy brief.

- **Section 5 endpoint.** A protected route surfacing the evaluation and
  ablation reports with breakdowns by venue, hour, weekday, horizon and signal
  availability. The library exists; this is wiring.
- **Section 6 version comparison.** Snapshots carry a score version but not
  calibration, feature-schema or baseline versions. A comparison view should
  show whether a candidate improves error, false-Hot rate and state accuracy
  before promotion.
- **Sections 1-3, 9-25.** Demo venue registry, venue-specific baselines, the
  gold-set workflow, passive presence, QR arrivals, partner pulse, observer
  reputation, and the four-week field protocol. None are started.

**None of the accuracy targets can be claimed yet.** They are measured against
ground truth that does not exist in volume. The evaluation spine makes them
measurable; it does not make them true. Do not report a metric as achieved
without held-out observations behind it.

---

## Known production state

See `PRODUCTION_SETUP.md` in this directory for the verified setup checklist.
Summary of what matters most:

- The build is **not** broken. `Build Check` passes and `npm run validate`
  exits 0.
- The recurring red X is `Buzz signal refresh`: BestTime reports its free
  forecast credits are exhausted. That is a plan decision, not a code fault.
- `AIRNOW_API_KEY`, `NPS_API_KEY` and `AI_GATEWAY_API_KEY` are not read by any
  code. They appear only as catalog entries.
- CodeQL, secret scanning and push protection are enabled. Branch protection and
  Dependabot security updates are not.
- The repository is public.

---

## Working agreements

- Deliver work as small reviewable PRs, not one large diff. An earlier
  36-minute agent run produced a large unverifiable change set and was lost
  before it was ever pushed.
- Run `npm run validate` (test, lint, typecheck, build) before pushing.
- This is **Next.js 16**. Read `node_modules/next/dist/docs/` before using a
  framework API. Middleware is renamed to Proxy and runs on the Node runtime,
  which is easy to get wrong from memory.
- Report honestly. If a metric is unproven, say so.
