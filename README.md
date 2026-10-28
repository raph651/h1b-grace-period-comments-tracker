# USCIS-2026-0364-0001 Public Comment Tracker (GitHub Pages + TypeScript)

Simple TypeScript web dashboard and automated sync pipeline that tracks all public comments on **[Eliminating the Discretionary 60-Day Grace Period (USCIS-2026-0364-0001)](https://www.regulations.gov/document/USCIS-2026-0364-0001/comment)** through the **November 10, 2026 (11:59 PM EST)** deadline and classifies each comment into **Support**, **Oppose**, or **Can't tell**.

## How It Gets All 26,786+ Comments Without Missing Any

1. **Sliding `lastModifiedDate` Window Pagination**: The Regulations.gov v4 API caps a single query at 20 pages of 250 items (5,000 comments). `scripts/sync-comments.ts` sorts by `lastModifiedDate,documentId` and advances `filter[lastModifiedDate][ge]` across windows so all 26,786+ comments are retrieved.
2. **Mass-Mail Campaign Deduplication (`MM78`, `MM83`, `MM73`)**: Over 75% of submissions on `USCIS-2026-0364-0001` belong to mass-mail campaigns (`MM78`, `MM83`, `MM73`). Rather than burning 26,000 individual `/v4/comments/{id}` calls against the 1,000 requests/hour `data.gov` limit, the sync engine fetches and classifies one representative comment per campaign and applies that stance to all matching campaign submissions, saving API quota for unique individual comments.
3. **Bulk CSV Import Support**: You can also upload a Regulations.gov Bulk CSV file directly in the browser UI (`Import Regulations.gov CSV`) to classify all rows immediately.

## Quick Start (Local Development)

```bash
# 1. Compile TypeScript frontend (src/app.ts -> docs/app.js)
npm run build

# 2. (Optional) Run a full sync from the command line
REGULATIONS_API_KEY="your_datagov_key" GEMINI_API_KEY="your_gemini_key" npm run sync

# 3. Preview the GitHub Pages site locally at http://localhost:8080
npm run serve
```

## Hosting on GitHub Pages

1. Create a new GitHub repository and push this folder to the `main` branch.
2. In your GitHub repository, go to **Settings → Pages** and under **Build and deployment**, set **Source** to **GitHub Actions** (or **Deploy from a branch** → `main` / `/docs`).
3. Go to **Settings → Secrets and variables → Actions** and add two Repository Secrets:
   - `REGULATIONS_API_KEY`: Your `data.gov` API key for Regulations.gov.
   - `GEMINI_API_KEY`: Your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).
4. The workflow in `.github/workflows/sync-and-deploy.yml` will automatically sync new comments every 6 hours until November 10, 2026 EST, classify them with Gemini (`gemini-2.5-flash`), update `docs/data/summary.json`, and publish the site to GitHub Pages.

If the two secrets are not set, the sync step is a no-op and the site simply keeps serving the last committed snapshot.
