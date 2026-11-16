/**
 * Made With Mira Studio: Meta + Etsy (+ optional Pinterest) APIs → daily tracker sync
 * ---------------------------------------------------------------------
 * Runs inside the Mira growth tracker Google Sheet (Extensions → Apps Script).
 * Every morning it pulls the last 7 days of social numbers and yesterday's Etsy
 * numbers and writes them into the 'Daily Check' tab. stostr.com/work/mira-studio
 * reads that tab, so the dashboard updates without a human or an AI agent.
 *
 * Columns (header row 4):
 *   A Date | B Etsy views | C Etsy visits | D Favorites | E Orders | F Top traffic source
 *   G Meta reach | H Meta link clicks | I Posts published | J, K formulas | L Notes | M Listings optimized
 *
 * What it writes:
 *   G, H, I  every run, for the last 7 days (posts keep collecting reach for days; idempotent upsert)
 *            G = IG reach + FB reach · H = IG bio-link taps + FB link clicks + Pinterest outbound clicks
 *            I = IG posts + FB posts + Pinterest pins
 *   E        Etsy orders for yesterday (receipts API), only if the cell is empty
 *   B, D     yesterday's Etsy listing views / new favorites, from the day-over-day change in each
 *            active listing's lifetime counters, only if the cell is empty. Needs one earlier run
 *            to have a starting snapshot, so the first day after setup is left blank.
 *   J, K     the two % formulas, on any new row
 *   N        sync stamp
 * What it never touches: C Visits and F Top traffic source (Etsy has no API for shop stats),
 *   L Notes, M Listings optimized, any value typed by hand in B, D or E, and row 5 (example row).
 *
 * Script properties (Project Settings → Script properties; never in code):
 *   Meta, set ONE of:
 *     IG_TOKEN          Instagram API with Instagram Login (instagram_business_basic,
 *                       instagram_business_manage_insights). Refreshed weekly by the script.
 *     META_PAGE_TOKEN   Page token via Facebook Login (pages_show_list, pages_read_engagement,
 *                       read_insights, instagram_basic, instagram_manage_insights). IG + FB.
 *   Etsy (Open API v3):
 *     ETSY_API_KEY      the app's x-api-key value exactly as Etsy's developer portal shows it
 *     ETSY_CLIENT_ID    the app's keystring (used for OAuth)
 *     ETSY_REDIRECT_URI a redirect URI registered on the app, e.g. https://stostr.com/
 *     ETSY_REFRESH_TOKEN set automatically by etsyFinishAuth()
 *   Pinterest (optional, API v5): PINTEREST_TOKEN (scopes user_accounts:read, pins:read)
 *
 * Setup: add the properties, run etsyStartAuth() and follow the log, then run setup() once.
 */

const CONFIG = {
  GRAPH: 'https://graph.facebook.com/v22.0',
  IG_GRAPH: 'https://graph.instagram.com/v22.0',
  ETSY: 'https://api.etsy.com/v3',
  PINTEREST: 'https://api.pinterest.com/v5',
  DAYS_BACK: 7,
  START: '2026-10-07',            // first day of tracking; never write rows before it
  TZ: 'America/New_York',
  SHEET: 'Daily Check',
  LOG_SHEET: 'Sync log',
  HEADER_ROW: 4,
  EXAMPLE_ROW: 5,                 // example row; never written
  COL: { date: 1, views: 2, visits: 3, favs: 4, orders: 5, source: 6, reach: 7, clicks: 8, posts: 9, cvr: 10, ctr: 11, synced: 14 }
};

/* ---------- entry points ---------- */

function setup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncMira')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncMira').timeBased().everyDays(1).atHour(6).inTimezone(CONFIG.TZ).create();
  syncMira();
}

function syncMira() {
  const now = new Date();
  const notes = [];
  const days = {};                                   // 'yyyy-MM-dd' → totals
  const since = new Date(now.getTime() - CONFIG.DAYS_BACK * 864e5);
  const yesterday = fmt_(new Date(now.getTime() - 864e5));
  const etsy = {};
  const parts = [];

  // Each source runs on its own, so one broken token doesn't stop the others.
  try {
    collectMeta_(since, now, days, notes);
    parts.push('Meta ' + metaMode_());
  } catch (e) { notes.push('Meta failed: ' + e.message); }

  if (prop_('PINTEREST_TOKEN')) {
    try { collectPinterest_(since, now, days, notes); parts.push('Pinterest'); }
    catch (e) { notes.push('Pinterest failed: ' + e.message); }
  }

  if (prop_('ETSY_REFRESH_TOKEN')) {
    try { Object.assign(etsy, collectEtsy_(yesterday, notes)); parts.push('Etsy'); }
    catch (e) { notes.push('Etsy failed: ' + e.message); }
  } else notes.push('Etsy not connected (run etsyStartAuth)');

  writeDays_(days, yesterday, etsy, fmt_(now));
  const failed = notes.some(n => / failed/.test(n));
  log_(failed ? 'PARTIAL' : 'OK', `${parts.join(' + ') || 'nothing'} · ${Object.keys(days).length} social day(s)` +
    (Object.keys(etsy).length ? ` · Etsy ${yesterday}: ${JSON.stringify(etsy)}` : '') +
    (notes.length ? ' · ' + notes.join('; ') : ''));
}

/* ---------- Meta (Instagram + Facebook Page) ---------- */

function collectMeta_(since, now, days, notes) {
  let igId;
  if (metaMode_() === 'instagram') {
    refreshIgToken_(notes);
    graph_('me', { fields: 'user_id,username' });
    igId = 'me';
  } else {
    const page = graph_('me', { fields: 'id,instagram_business_account{id}' });
    if (!page.instagram_business_account) throw new Error('No Instagram business account is linked to this Page.');
    igId = page.instagram_business_account.id;
    collectFacebook_(page.id, since, days, notes);
  }

  const media = graph_(`${igId}/media`, { fields: 'id,timestamp', limit: 50 }).data || [];
  media.filter(m => new Date(m.timestamp) >= since).forEach(m => {
    const d = day_(days, fmt_(new Date(m.timestamp)));
    d.posts += 1;
    d.reach += insights_(`${m.id}/insights`, ['reach'], notes, 'IG').reach || 0;
  });

  // Taps on the link in the Instagram bio (the Etsy shop link), per day.
  for (let i = 1; i <= CONFIG.DAYS_BACK; i++) {
    const date = fmt_(new Date(now.getTime() - i * 864e5));
    const start = Math.floor(Utilities.parseDate(date, CONFIG.TZ, 'yyyy-MM-dd').getTime() / 1000);
    try {
      const data = graph_(`${igId}/insights`, { metric: 'profile_links_taps', period: 'day', metric_type: 'total_value', since: start, until: start + 86400 }).data || [];
      const v = data[0] && data[0].total_value ? data[0].total_value.value : 0;
      day_(days, date).clicks += v || 0;
    } catch (e) { notes.push('IG bio taps unavailable'); break; }
  }
}

function collectFacebook_(pageId, since, days, notes) {
  const posts = graph_(`${pageId}/published_posts`, { fields: 'id,created_time', limit: 50 }).data || [];
  posts.filter(p => new Date(p.created_time) >= since).forEach(p => {
    const d = day_(days, fmt_(new Date(p.created_time)));
    d.posts += 1;
    const ins = insights_(`${p.id}/insights`, ['post_total_media_view_unique', 'post_clicks_by_type'], notes, 'FB');
    d.reach += ins.post_total_media_view_unique || 0;
    const c = ins.post_clicks_by_type;
    d.clicks += (c && typeof c === 'object') ? (c['link clicks'] || 0) : 0;
  });
}

/* ---------- Pinterest (optional) ---------- */

function collectPinterest_(since, now, days, notes) {
  const opts = { headers: { Authorization: 'Bearer ' + prop_('PINTEREST_TOKEN') }, muteHttpExceptions: true };
  const get = (path) => {
    const res = UrlFetchApp.fetch(CONFIG.PINTEREST + path, opts);
    const body = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300) throw new Error(`${path.split('?')[0]}: ${body.message || res.getResponseCode()}`);
    return body;
  };
  (get('/pins?page_size=100').items || [])
    .filter(p => new Date(p.created_at) >= since)
    .forEach(p => { day_(days, fmt_(new Date(p.created_at))).posts += 1; });

  const start = fmt_(since), end = fmt_(new Date(now.getTime() - 864e5));
  const a = get(`/user_account/analytics?start_date=${start}&end_date=${end}&metric_types=OUTBOUND_CLICK`);
  const daily = (a.all && a.all.daily_metrics) || [];
  daily.forEach(m => {
    if (m.data_status === 'READY' && m.metrics) day_(days, m.date).clicks += m.metrics.OUTBOUND_CLICK || 0;
  });
}

/* ---------- Etsy (Open API v3) ---------- */

// Step 1 of a one-time OAuth connection: logs a link to open while signed in to Etsy.
function etsyStartAuth() {
  const verifier = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const challenge = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, verifier, Utilities.Charset.US_ASCII)).replace(/=+$/, '');
  const state = Utilities.getUuid();
  const p = PropertiesService.getScriptProperties();
  p.setProperty('ETSY_PKCE_VERIFIER', verifier);
  p.setProperty('ETSY_PKCE_STATE', state);
  const url = 'https://www.etsy.com/oauth/connect?response_type=code' +
    `&client_id=${encodeURIComponent(prop_('ETSY_CLIENT_ID'))}` +
    `&redirect_uri=${encodeURIComponent(prop_('ETSY_REDIRECT_URI'))}` +
    `&scope=${encodeURIComponent('transactions_r listings_r shops_r')}` +
    `&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
  Logger.log('Open this link, click Allow, then copy the "code" value from the page you land on and run etsyFinishAuth with it:\n' + url);
}

// Step 2: paste the code into CODE below (or call etsyFinishAuth('...')) and run it once.
function etsyFinishAuth(code) {
  const CODE = code || 'PASTE_CODE_HERE';
  const p = PropertiesService.getScriptProperties();
  const tok = etsyToken_({ grant_type: 'authorization_code', code: CODE,
    redirect_uri: prop_('ETSY_REDIRECT_URI'), code_verifier: p.getProperty('ETSY_PKCE_VERIFIER') });
  p.deleteProperty('ETSY_PKCE_VERIFIER');
  p.deleteProperty('ETSY_PKCE_STATE');
  const me = etsy_('/application/users/me', tok);
  p.setProperty('ETSY_SHOP_ID', String(me.shop_id));
  Logger.log('Etsy connected. Shop ID ' + me.shop_id);
}

function collectEtsy_(date, notes) {
  const access = etsyToken_({ grant_type: 'refresh_token', refresh_token: prop_('ETSY_REFRESH_TOKEN') });
  const shop = prop_('ETSY_SHOP_ID');
  const out = {};

  // Orders placed yesterday (Eastern time).
  const start = Math.floor(Utilities.parseDate(date, CONFIG.TZ, 'yyyy-MM-dd').getTime() / 1000);
  const receipts = etsy_(`/application/shops/${shop}/receipts?min_created=${start}&max_created=${start + 86399}&limit=100`, access);
  out.orders = (receipts.results || []).length;

  // Lifetime views / favorites summed over active listings; yesterday = today's total − last snapshot.
  let views = 0, favs = 0, offset = 0, page;
  do {
    page = etsy_(`/application/shops/${shop}/listings/active?limit=100&offset=${offset}`, access);
    (page.results || []).forEach(l => { views += l.views || 0; favs += l.num_favorers || 0; });
    offset += 100;
  } while (page.results && page.results.length === 100);

  const p = PropertiesService.getScriptProperties();
  const snap = JSON.parse(p.getProperty('ETSY_SNAPSHOT') || 'null');
  const today = fmt_(new Date());
  if (snap && snap.taken === fmt_(new Date(Date.now() - 864e5))) {
    // Only trust a snapshot from exactly one day ago; a missed run would turn 2+ days into one day.
    out.views = Math.max(0, views - snap.views);
    out.favs = Math.max(0, favs - snap.favs);
  } else if (!snap || snap.taken !== today) {
    notes.push('Etsy views/favorites need yesterday\'s snapshot; left blank today');
  }
  if (!snap || snap.taken !== today) p.setProperty('ETSY_SNAPSHOT', JSON.stringify({ taken: today, views, favs }));
  return out;
}

function etsyToken_(form) {
  form.client_id = prop_('ETSY_CLIENT_ID');
  const res = UrlFetchApp.fetch('https://api.etsy.com/v3/public/oauth/token', { method: 'post', payload: form, muteHttpExceptions: true });
  const body = JSON.parse(res.getContentText() || '{}');
  if (!body.access_token) throw new Error('token: ' + (body.error_description || body.error || res.getResponseCode()));
  PropertiesService.getScriptProperties().setProperty('ETSY_REFRESH_TOKEN', body.refresh_token);  // Etsy rotates it every use
  return body.access_token;
}

function etsy_(path, access) {
  const res = UrlFetchApp.fetch(CONFIG.ETSY + path, {
    headers: { 'x-api-key': prop_('ETSY_API_KEY'), Authorization: 'Bearer ' + access }, muteHttpExceptions: true });
  const body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300) throw new Error(`${path.split('?')[0]}: ${body.error || res.getResponseCode()}`);
  return body;
}

/* ---------- sheet writing ---------- */

function writeDays_(days, yesterday, etsy, today) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET);
  const C = CONFIG.COL;
  if (sh.getRange(CONFIG.HEADER_ROW, C.synced).getValue() === '') sh.getRange(CONFIG.HEADER_ROW, C.synced).setValue('Synced (API)');

  const first = CONFIG.EXAMPLE_ROW + 1;
  const last = Math.max(sh.getLastRow(), first);
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const dates = sh.getRange(first, 1, last - first + 1, 1).getValues()
    .map(r => r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0]).trim());

  const rowFor = (date) => {
    let i = dates.indexOf(date);
    if (i === -1) {                                  // new day → next row under the last filled one
      i = dates.length;
      while (i > 0 && dates[i - 1] === '') i--;
      dates[i] = date;
      const r = first + i;
      sh.getRange(r, C.date).setValue(date);
      sh.getRange(r, C.cvr, 1, 2).setFormulas([[
        `=IF(OR(C${r}="",C${r}=0),"",E${r}/C${r})`,
        `=IF(OR(H${r}="",H${r}=0),"",C${r}/H${r})`]]);
    }
    return first + i;
  };

  if (!days[yesterday]) days[yesterday] = blank_();
  Object.keys(days).sort().filter(d => d >= CONFIG.START && d < today).forEach(date => {
    const d = days[date], r = rowFor(date);
    sh.getRange(r, C.reach, 1, 3).setValues([[d.reach, d.clicks, d.posts]]);
    if (date === yesterday) {
      const fillIfEmpty = (col, v) => { if (v !== undefined && sh.getRange(r, col).getValue() === '') sh.getRange(r, col).setValue(v); };
      fillIfEmpty(C.orders, etsy.orders);
      fillIfEmpty(C.views, etsy.views);
      fillIfEmpty(C.favs, etsy.favs);
    }
    sh.getRange(r, C.synced).setValue('Auto ' + today);
  });
}

/* ---------- helpers ---------- */

function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

function metaMode_() {
  if (prop_('IG_TOKEN')) return 'instagram';
  if (prop_('META_PAGE_TOKEN')) return 'facebook';
  throw new Error('add IG_TOKEN or META_PAGE_TOKEN');
}

function refreshIgToken_(notes) {
  const p = PropertiesService.getScriptProperties();
  if (Date.now() - Number(p.getProperty('IG_TOKEN_REFRESHED') || 0) < 7 * 864e5) return;
  try {
    const res = UrlFetchApp.fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(p.getProperty('IG_TOKEN'))}`, { muteHttpExceptions: true });
    const body = JSON.parse(res.getContentText());
    if (body.access_token) {
      p.setProperty('IG_TOKEN', body.access_token);
      p.setProperty('IG_TOKEN_REFRESHED', String(Date.now()));
      notes.push('IG token refreshed');
    } else notes.push('IG token refresh skipped');
  } catch (e) { notes.push('IG token refresh failed'); }
}

function graph_(path, params) {
  const ig = metaMode_() === 'instagram';
  const token = prop_(ig ? 'IG_TOKEN' : 'META_PAGE_TOKEN');
  const qs = Object.keys(params || {}).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const res = UrlFetchApp.fetch(`${ig ? CONFIG.IG_GRAPH : CONFIG.GRAPH}/${path}?${qs}${qs ? '&' : ''}access_token=${encodeURIComponent(token)}`, { muteHttpExceptions: true });
  const body = JSON.parse(res.getContentText());
  if (body.error) throw new Error(`${path.split('?')[0]}: ${body.error.message}`);
  return body;
}

// One metric per request so a renamed/retired metric doesn't sink the rest.
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

function day_(days, date) { return days[date] || (days[date] = blank_()); }
function blank_() { return { posts: 0, reach: 0, clicks: 0 }; }
function fmt_(date) { return Utilities.formatDate(date, CONFIG.TZ, 'yyyy-MM-dd'); }

function log_(status, message) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CONFIG.LOG_SHEET) || ss.insertSheet(CONFIG.LOG_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(['When', 'Status', 'Details']);
  sh.appendRow([Utilities.formatDate(new Date(), CONFIG.TZ, 'yyyy-MM-dd HH:mm'), status, message]);
}
