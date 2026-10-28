# USCIS-2026-0364-0001 Comment Period Timer (GitHub Pages + TypeScript)

A deliberately small page about the public comments filed on **[Eliminating the Discretionary 60-Day Grace Period (USCIS-2026-0364-0001)](https://www.regulations.gov/document/USCIS-2026-0364-0001/comment)** through the **November 10, 2026 (11:59 PM EST)** deadline.

The page shows four things and nothing else:

1. **A countdown** to the close of the comment period.
2. **The count** — total comments filed, split into **Support**, **Oppose**, and **Can't tell**.
3. **A line chart** of that split over time, switchable between percentage and raw counts.
4. **A donut** of the shares at any recorded snapshot, driven by a timeline dragger.

It is informational only: no solicitation, no recommendations, no legal advertising, no software service.

## Where the numbers come from

`scripts/sync-comments.ts` classifies each comment into **Support**, **Oppose**, or **Can't tell** from Regulations.gov data and writes two files:

- `docs/data/summary.json` — the current snapshot the page renders.
- `docs/data/history.json` — an append-only log of `{ t, support, oppose, cantTell, total }` points, one per sync run, capped at 2,000 points.

The GitHub Actions workflow runs every 6 hours (cron `15 */6 * * *`) until the deadline, then commits both files and deploys `docs/` to Pages.

### How it gets all 26,786+ comments

1. **Sliding `lastModifiedDate` window pagination**: the Regulations.gov v4 API caps a single query at 20 pages of 250 items (5,000 comments). The sync sorts by `lastModifiedDate,documentId` and advances `filter[lastModifiedDate][ge]` across windows so the whole docket is retrieved.
2. **Mass-mail campaign deduplication (`MM78`, `MM83`, `MM73`)**: over 75% of submissions belong to these campaigns. The sync fetches and classifies one representative comment per campaign and applies that stance to all matching submissions, saving API quota under the 1,000 requests/hour `data.gov` limit.

### A note on history

The line chart needs at least two snapshots. On the first sync that retrieves the full docket, `history.json` is backfilled from each comment's `postedDate`, which reconstructs the cumulative curve for the entire comment period in one run. Until then the page says so plainly rather than drawing a fake line.

## Quick Start (Local Development)

```bash
# 1. Compile TypeScript frontend (src/app.ts -> docs/app.js)
npm run build

# 2. (Optional) Run a full sync from the command line
REGULATIONS_API_KEY="your_datagov_key" GEMINI_API_KEY="your_gemini_key" npm run sync

# 3. Preview the site locally at http://localhost:8080
npm run serve
```

Node.js 22.6+ is required (the build uses native `module.stripTypeScriptTypes`).

## Hosting on GitHub Pages

1. Push this folder to a repository's `main` branch.
2. **Settings → Pages** → **Build and deployment** → Source: **GitHub Actions**.
3. **Settings → Secrets and variables → Actions** → add:
   - `REGULATIONS_API_KEY` — your `data.gov` key for Regulations.gov.
   - `GEMINI_API_KEY` — your Gemini key from [Google AI Studio](https://aistudio.google.com/apikey).
4. The workflow syncs, classifies with `gemini-2.5-flash`, commits the data, and publishes `docs/`.

Pages cannot be served from a **private** repo on a free plan, so the workflow checks the repository visibility and skips the deploy steps while the repo is private. It resumes automatically on the next run after the repo is made public. With no secrets configured, the sync step is a no-op and the site keeps serving the last committed snapshot.
