# Radha's Kitchen: Graph API → growth tracker

`graph-sync.gs` runs daily inside the Radha's Kitchen growth tracker (a Google Sheet, via Apps Script).
It pulls the last 7 days of Instagram and Facebook post performance from Meta's Graph API and writes
one row per day into the tracker's `Daily Check` tab. The public case study at
[stostr.com/radhashomemade](https://stostr.com/radhashomemade#growth) reads that tab as CSV, so the
"Measure" step of the growth loop runs without a human.

```
Meta Graph API (IG + FB Page)  →  Apps Script, daily 6 am CT  →  Google Sheet 'Daily Check'
                                                                        ↓ published CSV
                                                        stostr.com/radhashomemade (case study)
```

**Pulled per day:** posts published, views, reach, interactions (IG `total_interactions`; FB reactions +
comments + shares), order-link clicks (FB post link clicks + Instagram bio-link taps), followers.

**Design choices**
- **Idempotent upsert.** Re-syncs the last 7 days every run, because posts keep collecting views for days.
  Running it twice changes nothing.
- **Human columns are never touched.** Orders, order channel and notes stay manual: Cash App isn't on Meta.
- **Resilient to metric renames.** Meta retired `impressions` for `views` in 2025, and Page metrics keep changing.
  Each metric is requested on its own, and anything unavailable is logged rather than failing the run.
- **Secrets stay out of code.** The Page access token lives in Script Properties (`META_PAGE_TOKEN`),
  never in this repo. A Page token from a long-lived user token doesn't expire.
- **Observable.** Every run writes a line to the `Sync log` tab (status, days synced, any metric gaps).

**Permissions (Development-mode app, Facebook Login):** `pages_show_list`, `pages_read_engagement`,
`read_insights`, `instagram_basic`, `instagram_manage_insights`, `business_management`.
