/**
 * Radha's Kitchen: Instagram (and optionally Facebook) Graph API → growth tracker sync
 * ---------------------------------------------------------------------
 * Runs inside the "Radhas_Kitchen_Growth_Tracker" Google Sheet (Extensions → Apps Script).
 * Once a day it asks Meta's Graph API for the last 7 days of Radha's posts on
 * Instagram and Facebook, adds up each day's numbers, and writes them into the
 * 'Daily Check' tab. stostr.com/radhashomemade reads that tab, so the public
 * case study updates itself.
 *
 * What it writes per day (row = date the posts went out, Katy time):
 *   B Posts published · C Views · D Reach · E Interactions · F Order-link clicks (FB post link clicks + IG bio-link taps)
 *   G Instagram followers · H Facebook followers (latest day only) · L Top post · N Sync stamp
 * What it never touches: I Orders, J Order channel, K Notes (human-entered).
 *
 * Why the last 7 days every run: a post keeps collecting views for days, so
 * re-syncing the recent window keeps each day's totals current (idempotent upsert).
 *
 * Two ways to connect (set ONE in Project Settings → Script properties; never in code):
 *   IG_TOKEN        Instagram API with Instagram Login (instagram_business_basic +
 *                   instagram_business_manage_insights). Instagram only. The script refreshes
 *                   this 60-day token itself every week, so it never lapses.
 *                   Facebook numbers can still be typed into columns O–S and are added in.
 *   META_PAGE_TOKEN Instagram API with Facebook Login (Page token). Instagram + Facebook.
 *
 * Then run setup() once and approve Google's permission prompt. It runs a first sync
 * and installs a daily 6 am trigger.
 */

const CONFIG = {
  GRAPH: 'https://graph.facebook.com/v22.0',
  IG_GRAPH: 'https://graph.instagram.com/v22.0',
  DAYS_BACK: 7,
  START: '2026-10-06',             // first day of tracking; never write rows before it
  TZ: 'America/Chicago',          // Katy, TX
  SHEET: 'Daily Check',
  LOG_SHEET: 'Sync log',
  HEADER_ROW: 4,                  // row with "Date", "Posts published", ...
  COL: { date: 1, posts: 2, views: 3, reach: 4, inter: 5, clicks: 6, igFollowers: 7, fbFollowers: 8, top: 12, synced: 14, fbManual: 15 }  // O–S: FB posts, views, reach, interactions, link clicks (typed by hand in IG-only mode)
};

/* ---------- entry points ---------- */

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncGraph')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncGraph').timeBased().everyDays(1).atHour(6).inTimezone(CONFIG.TZ).create();
  syncGraph();
}

function syncGraph() {
  const started = new Date();
  const notes = [];
  try {
    const days = {};                                   // 'yyyy-MM-dd' → totals
    const since = new Date(started.getTime() - CONFIG.DAYS_BACK * 864e5);
    let ig, fbFollowers = null;

    if (MODE_() === 'instagram') {                     // Instagram Login: graph.instagram.com, 'me' = the IG account
      refreshIgToken_(notes);
      ig = graph_('me', { fields: 'user_id,username,followers_count' });
      ig.id = 'me';
    } else {                                           // Facebook Login: Page token, IG account hangs off the Page
      const page = graph_('me', { fields: 'id,name,followers_count,instagram_business_account{id,username,followers_count}' });
      ig = page.instagram_business_account;
      if (!ig) throw new Error('No Instagram business account is linked to this Page.');
      fbFollowers = page.followers_count;
      collectFacebook_(page.id, since, days, notes);
    }
    collectInstagram_(ig.id, since, days, notes);
    collectBioTaps_(ig.id, started, days, notes);

    const today = fmt_(started);
    const yesterday = fmt_(new Date(started.getTime() - 864e5));
    writeDays_(days, { date: yesterday, ig: ig.followers_count, fb: fbFollowers }, today);

    log_('OK', `${MODE_()} mode · ${Object.keys(days).length} day(s) synced · IG @${ig.username} ${ig.followers_count} followers` + (fbFollowers !== null ? ` · FB ${fbFollowers}` : '') + (notes.length ? ' · ' + notes.join('; ') : ''));
  } catch (e) {
    log_('ERROR', e.message);
    throw e;
  }
}

/* ---------- Instagram ---------- */

function collectInstagram_(igId, since, days, notes) {
  const media = graph_(`${igId}/media`, { fields: 'id,timestamp,caption,media_type,permalink', limit: 50 }).data || [];
  media.filter(m => new Date(m.timestamp) >= since).forEach(m => {
    const d = day_(days, fmt_(new Date(m.timestamp)));
    d.posts += 1;
    const ins = insights_(`${m.id}/insights`, ['views', 'reach', 'total_interactions'], notes, 'IG');
    d.views += ins.views || 0;
    d.reach += ins.reach || 0;
    d.inter += ins.total_interactions || 0;
    // Instagram feed posts have no clickable links; order-link taps come from the bio (account level).
    topPost_(d, 'IG', m.caption, ins.views || 0);
  });
}

// Taps on the link in Radha's Instagram bio (the Cash App order link), per day.
function collectBioTaps_(igId, now, days, notes) {
  for (let i = 1; i <= CONFIG.DAYS_BACK; i++) {
    const date = fmt_(new Date(now.getTime() - i * 864e5));
    const start = Math.floor(Utilities.parseDate(date, CONFIG.TZ, 'yyyy-MM-dd').getTime() / 1000);
    try {
      const data = graph_(`${igId}/insights`, { metric: 'profile_links_taps', period: 'day', metric_type: 'total_value', since: start, until: start + 86400 }).data || [];
      const v = data[0] && data[0].total_value ? data[0].total_value.value : 0;
      if (v) day_(days, date).clicks += v;
    } catch (e) {
      if (notes.indexOf('IG bio taps unavailable') === -1) notes.push('IG bio taps unavailable');
      return;
    }
  }
}

/* ---------- Facebook Page ---------- */

function collectFacebook_(pageId, since, days, notes) {
  const posts = graph_(`${pageId}/published_posts`, {
    fields: 'id,created_time,message,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)',
    limit: 50
  }).data || [];
  posts.filter(p => p.message && new Date(p.created_time) >= since).forEach(p => {
    const d = day_(days, fmt_(new Date(p.created_time)));
    d.posts += 1;
    const reactions = (p.reactions && p.reactions.summary && p.reactions.summary.total_count) || 0;
    const comments = (p.comments && p.comments.summary && p.comments.summary.total_count) || 0;
    const shares = (p.shares && p.shares.count) || 0;
    d.inter += reactions + comments + shares;

    // Meta has been renaming Page metrics; try the current name first, then older ones.
    const ins = insights_(`${p.id}/insights`, ['post_media_view', 'post_impressions_unique', 'post_clicks_by_type'], notes, 'FB');
    d.views += ins.post_media_view || 0;
    d.reach += ins.post_impressions_unique || 0;
    const clicks = ins.post_clicks_by_type;
    d.clicks += (clicks && typeof clicks === 'object') ? (clicks['link clicks'] || 0) : 0;
    topPost_(d, 'FB', p.message, ins.post_media_view || 0);
  });
}

/* ---------- sheet writing ---------- */

function writeDays_(days, followers, today) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET);
  if (sh.getRange(CONFIG.HEADER_ROW, CONFIG.COL.synced).getValue() === '') {
    sh.getRange(CONFIG.HEADER_ROW, CONFIG.COL.synced).setValue('Synced (Graph API)');
  }
  if (sh.getRange(CONFIG.HEADER_ROW, CONFIG.COL.fbManual).getValue() === '') {
    sh.getRange(CONFIG.HEADER_ROW, CONFIG.COL.fbManual, 1, 5)
      .setValues([['FB posts (manual)', 'FB views (manual)', 'FB reach (manual)', 'FB interactions (manual)', 'FB link clicks (manual)']]);
  }
  const first = CONFIG.HEADER_ROW + 1;
  const last = Math.max(sh.getLastRow(), first);
  const sheetTz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();   // date cells live in the sheet's zone
  const dates = sh.getRange(first, 1, last - first + 1, 1).getValues()
    .map(r => r[0] instanceof Date ? Utilities.formatDate(r[0], sheetTz, 'yyyy-MM-dd') : String(r[0]).trim());

  const rowFor = (date) => {
    let i = dates.indexOf(date);
    if (i === -1) {                                   // new day → append, keep dates in order
      i = dates.length;
      while (i > 0 && dates[i - 1] === '') i--;
      dates[i] = date;
      sh.getRange(first + i, 1).setValue(date);
    }
    return first + i;
  };

  if (!days[followers.date]) days[followers.date] = blank_();
  Object.keys(days).sort().filter(date => date >= CONFIG.START).forEach(date => {
    const d = days[date], r = rowFor(date), C = CONFIG.COL;
    // Instagram-only mode: add any Facebook numbers typed by hand in O–S, so totals stay IG + FB.
    const fb = MODE_() === 'instagram'
      ? sh.getRange(r, C.fbManual, 1, 5).getValues()[0].map(v => Number(v) || 0)
      : [0, 0, 0, 0, 0];
    sh.getRange(r, C.posts, 1, 5).setValues([[d.posts + fb[0], d.views + fb[1], d.reach + fb[2], d.inter + fb[3], d.clicks + fb[4]]]);
    if (d.top) sh.getRange(r, C.top).setValue(d.top);
    if (date === followers.date) {
      sh.getRange(r, C.igFollowers).setValue(followers.ig);
      if (followers.fb !== null) sh.getRange(r, C.fbFollowers).setValue(followers.fb);
    }
    sh.getRange(r, C.synced).setValue('Auto ' + today);
  });
}

/* ---------- helpers ---------- */

function MODE_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('IG_TOKEN')) return 'instagram';
  if (p.getProperty('META_PAGE_TOKEN')) return 'facebook';
  throw new Error('Add IG_TOKEN (or META_PAGE_TOKEN) in Project Settings → Script properties.');
}

// Instagram Login tokens last 60 days; refresh weekly so the sync never lapses.
function refreshIgToken_(notes) {
  const p = PropertiesService.getScriptProperties();
  const last = Number(p.getProperty('IG_TOKEN_REFRESHED') || 0);
  if (Date.now() - last < 7 * 864e5) return;
  try {
    const res = UrlFetchApp.fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(p.getProperty('IG_TOKEN'))}`, { muteHttpExceptions: true });
    const body = JSON.parse(res.getContentText());
    if (body.access_token) {
      p.setProperty('IG_TOKEN', body.access_token);
      p.setProperty('IG_TOKEN_REFRESHED', String(Date.now()));
      notes.push('token refreshed');
    } else notes.push('token refresh skipped: ' + (body.error && body.error.message || 'unknown'));
  } catch (e) { notes.push('token refresh failed'); }
}

function graph_(path, params) {
  const p = PropertiesService.getScriptProperties();
  const ig = MODE_() === 'instagram';
  const token = p.getProperty(ig ? 'IG_TOKEN' : 'META_PAGE_TOKEN');
  const qs = Object.keys(params || {}).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const res = UrlFetchApp.fetch(`${ig ? CONFIG.IG_GRAPH : CONFIG.GRAPH}/${path}?${qs}${qs ? '&' : ''}access_token=${encodeURIComponent(token)}`, { muteHttpExceptions: true });
  const body = JSON.parse(res.getContentText());
  if (body.error) throw new Error(`${path.split('?')[0]}: ${body.error.message}`);
  return body;
}

// Ask for several metrics one at a time so one renamed/retired metric doesn't sink the rest.
function insights_(path, metrics, notes, label) {
  const out = {};
  metrics.forEach(metric => {
    try {
      const data = graph_(path, { metric }).data || [];
      const v = data[0] && data[0].values && data[0].values[0] ? data[0].values[0].value
              : data[0] && data[0].total_value ? data[0].total_value.value : undefined;
      if (v !== undefined) out[metric] = v;
    } catch (e) {
      const msg = `${label} ${metric} unavailable`;
      if (notes.indexOf(msg) === -1) notes.push(msg);
    }
  });
  return out;
}

function topPost_(d, platform, text, views) {
  if (views >= d.topViews) {
    d.topViews = views;
    d.top = `${String(text || '').split('\n')[0].slice(0, 45)}… (${platform}, ${views} views)`;
  }
}

function day_(days, date) { return days[date] || (days[date] = blank_()); }
function blank_() { return { posts: 0, views: 0, reach: 0, inter: 0, clicks: 0, top: '', topViews: -1 }; }
function fmt_(date) { return Utilities.formatDate(date, CONFIG.TZ, 'yyyy-MM-dd'); }

function log_(status, message) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CONFIG.LOG_SHEET) || ss.insertSheet(CONFIG.LOG_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['When', 'Status', 'Details']);
  sh.appendRow([Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm'), status, message]);
}
