# Made With Mira Studio: APIs → daily tracker

`mira-sync.gs` runs every morning inside the Mira growth tracker (a Google Sheet, via Apps Script). It pulls
Instagram/Facebook numbers from Meta's Graph API, orders and listing counters from Etsy's Open API v3, and
optionally pins and outbound clicks from Pinterest. It writes them into the `Daily Check` tab, and
[stostr.com/work/mira-studio](https://stostr.com/work/mira-studio) reads that tab as CSV. It replaces the AI
agent that read Metricool and the Etsy Stats page in Chrome every day.

```
Meta Graph API (IG + FB)  ┐
Etsy Open API v3          ├→  Apps Script, daily 6 am ET  →  'Daily Check'  →  published CSV  →  stostr.com/work/mira-studio
Pinterest API v5 (opt.)   ┘
```

| Column | Source | Rule |
|---|---|---|
| B Etsy views | change in each active listing's lifetime `views` since yesterday's snapshot | fills an empty cell only |
| C Etsy visits | **manual**: Etsy's API doesn't expose shop visits | never touched |
| D Favorites | change in each listing's `num_favorers` since yesterday's snapshot | fills an empty cell only |
| E Orders | Etsy receipts created yesterday (ET) | fills an empty cell only |
| F Top traffic source | **manual**: not in Etsy's API | never touched |
| G Meta reach | IG post reach + FB post viewers | re-synced for the last 7 days |
| H Meta link clicks | IG bio-link taps + FB link clicks + Pinterest outbound clicks | re-synced for the last 7 days |
| I Posts published | IG posts + FB posts + Pinterest pins | re-synced for the last 7 days |
| J, K | % formulas on new rows | |
| L, M | manual | never touched |
| N | sync stamp | |

Each run adds a line to the `Sync log` tab. Each source runs on its own, so one expired token leaves the
other sources' numbers in place and logs `PARTIAL`.

**Why not Metricool?** Metricool's REST API is only on its Advanced/Custom plans. Its numbers also come from
these same platform APIs, so going straight to the source costs nothing and cuts out a middle layer. You can
keep scheduling posts in Metricool: the script counts the posts once they go live.

**Etsy views are an estimate.** They come from listing counters, so the number can differ a little from
the Stats page. The first run after setup only saves a starting snapshot, so B and D stay blank on the
first day. If a run is missed, the script skips that day instead of putting two days of views into one.

## Setup (about 30 minutes, once)

1. **Open the script editor.** In the Mira tracker sheet, go to Extensions → Apps Script and paste in `mira-sync.gs`.
2. **Meta.** Create an app at developers.facebook.com and generate an Instagram token with
   `instagram_business_basic` and `instagram_business_manage_insights` (same steps as Radha's Kitchen). Save it as
   the script property `IG_TOKEN`. To get Facebook numbers too, save a Page token as `META_PAGE_TOKEN` instead.
3. **Etsy.** Create an app at etsy.com/developers (Personal access is enough for your own shop) and register a
   redirect URI such as `https://stostr.com/`. Then add these script properties:
   - `ETSY_API_KEY`: the x-api-key value shown on the app page
   - `ETSY_CLIENT_ID`: the keystring
   - `ETSY_REDIRECT_URI`: the URI you registered

   Run `etsyStartAuth`, open the link it logs and click Allow. Copy the `code=` value from the address bar of
   the page you land on, paste it into `etsyFinishAuth` and run that once.
4. **Pinterest (optional).** Create an app at developers.pinterest.com and save a token with
   `user_accounts:read` and `pins:read` as `PINTEREST_TOKEN`.
5. **Start it.** Run `setup` and approve Google's permission prompt. It runs a first sync and installs the
   daily 6 am ET trigger. Check the `Sync log` tab to confirm it worked.
