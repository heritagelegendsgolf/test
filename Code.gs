/**
 * Heritage Legends Tournament — backend (Google Apps Script)
 *
 * STAGE 1: Settings, Roster, Hole Handicaps, and Day 1 / Day 2 Pairings.
 * STAGE 2 (added): ScoresDay1 / ScoresDay2 sheets + getScores/saveMatchScores
 * actions, powering live.html's Live Scoring and Scoreboard tabs.
 * STAGE 3 (added): "Not participating" as a third Roster Team option (no
 * schema change needed), and a startNewSeason action that archives the
 * current season's Settings/Roster/Pairings/Scores into hidden
 * "Archive_<label>_<Sheet>" tabs, then resets team assignments, pairings,
 * scores and the year-specific Settings fields for the next season.
 *
 * If you're adding this to a Sheet that was already set up for stage 1,
 * just re-run `initializeSheets` once — it only creates sheets/rows that
 * don't already exist, so it won't touch your Roster, Pairings, etc.
 *
 * SETUP (one time):
 *   1. Create a new Google Sheet (e.g. "LIVE Legends Tournament Data" or
 *      "TEST Legends Tournament Data" if you want a test copy first, same
 *      pattern as the tee sheet app).
 *   2. Extensions > Apps Script, paste this whole file in as Code.gs.
 *   3. In the Apps Script editor open Project Settings (gear icon) > Script
 *      Properties > Add script property, and add TWO properties:
 *        SPREADSHEET_ID = the sheet's ID (the long string in its URL
 *                         between /d/ and /edit)
 *        SECRET_KEY     = your own random string (see step 4)
 *      This file is identical for TEST and LIVE — only these two properties
 *      differ between the two Apps Script projects, so you never edit code
 *      when pasting a new version. Run `checkSetup` from the editor to
 *      confirm both are set and the sheet opens.
 *   4. Pick your own SECRET_KEY (any random string) — this is what
 *      keeps randoms off the internet from hitting your API.
 *   5. Run the `initializeSheets` function once from the Apps Script editor
 *      (Run menu). It builds all the tabs with headers and placeholder rows.
 *      The first run will ask you to authorize the script — that's normal.
 *   6. Deploy > New deployment > Web app. "Execute as: Me", "Who has
 *      access: Anyone". Copy the deployment URL — that's your backend URL
 *      for the front-end (index.html)'s CONFIG.
 */

// SPREADSHEET_ID and SECRET_KEY live in this project's Script Properties
// (Project Settings > Script Properties), NOT in this file, so the exact same
// code can be pasted into both the TEST and the LIVE Apps Script project.
function scriptProp_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
}
function secretKey_() { return scriptProp_('SECRET_KEY'); }
function openSpreadsheet_() {
  const id = scriptProp_('SPREADSHEET_ID');
  if (!id) {
    throw new Error('SPREADSHEET_ID is not set — in Apps Script open Project Settings > Script Properties and add SPREADSHEET_ID (the sheet\'s ID, not its full URL).');
  }
  return SpreadsheetApp.openById(id);
}
// Run this from the Apps Script editor (Run menu) after adding the two
// Script Properties — it tells you in the Execution log whether they're set
// and the sheet opens.
function checkSetup() {
  const problems = [];
  if (!secretKey_()) problems.push('SECRET_KEY is not set in Script Properties.');
  let name = '';
  try { name = openSpreadsheet_().getName(); } catch (e) { problems.push(e.message); }
  Logger.log(problems.length ? 'PROBLEMS:\n- ' + problems.join('\n- ') : 'OK — connected to spreadsheet "' + name + '". Backend version ' + BACKEND_VERSION + '.');
}

// Bumped by hand every time this file changes. Fetch it via the getVersion
// action (index.html shows it in the header as "Backend: ...") to check
// whether what's pasted into Apps Script is actually the latest copy.
const BACKEND_VERSION = '2026-11-26a';

const SHEETS = {
  SETTINGS: 'Settings',
  ROSTER: 'Roster',
  HOLE_HANDICAPS: 'HoleHandicaps',
  HOLE_HANDICAPS_RED: 'HoleHandicapsRed',
  PAIRINGS_DAY1: 'PairingsDay1',
  PAIRINGS_DAY2: 'PairingsDay2',
  SCORES_DAY1: 'ScoresDay1',
  SCORES_DAY2: 'ScoresDay2',
  MATCH_PINS: 'MatchPins',
  SCORE_LOG: 'ScoreLog',
  ADMINS: 'Admins',
  ACTIVITY_LOG: 'ActivityLog',
  MEMBER_PINS: 'MemberPins',
  HANDICAPS: 'Handicaps',
};

// Email and Phone (added 2026-10-07 for the Legends sign-up app) make this
// the one shared list of every Legend: the annual tournament uses Team/
// HandicapIndex/Tee/Scorekeeper as before, and the sign-up app uses Email
// to sign people in. Email/Phone are PRIVATE — every public read (boot data,
// getRoster, archived seasons) strips them out via publicRoster_, and
// saveRoster_ keeps them when a save from the tournament admin page (which
// never sees them) doesn't include them. Member PINs live in their own
// MemberPins tab and are never sent to any browser.
// Phone is the original single phone column, kept only so older rows can be
// split into HomePhone/MobilePhone the first time they're shown (see splitPhones_).
// GHIN is the player's GHIN number, edited on the Members admin page and kept
// private like Email — it's what a Club Template Report import will match on.
// Deceased ('TRUE') puts a Legend on the RIP list (always saved with Active FALSE,
// so everything else treats them as inactive); DiedYear is the year, if known.
// EmergencyContact is free text (who to call and their number), private like Email.
// PlayGroup: which Legends group they mostly play with, 'fun' | 'nassau' | 'both' | ''
// (set by the member under My info, or on the Members admin page; Tom 2026-11-01, for group mailing lists).
const ROSTER_HEADERS = ['PlayerID', 'Name', 'Team', 'HandicapIndex', 'Tee', 'Active', 'Scorekeeper', 'Email', 'Phone', 'HomePhone', 'MobilePhone', 'GHIN', 'Deceased', 'DiedYear', 'EmergencyContact', 'PlayGroup'];
const PLAY_GROUPS_ = ['fun', 'nassau', 'both'];
// Only edited on the Members admin page / My info; kept when another page saves the roster without them.
const ROSTER_MEMBER_FIELDS = ['Deceased', 'DiedYear', 'PlayGroup'];
const ROSTER_PRIVATE_FIELDS = ['Email', 'Phone', 'HomePhone', 'MobilePhone', 'GHIN', 'EmergencyContact'];
function publicRoster_(rows) {
  return (rows || []).map((r) => {
    const o = Object.assign({}, r);
    ROSTER_PRIVATE_FIELDS.forEach((f) => { delete o[f]; });
    return o;
  });
}
const HOLE_HC_HEADERS = ['Hole', 'StrokeIndex', 'Par'];
// Red tees play to a different Stroke Index than every other tee (Gold, White,
// Blue, etc. all share the table above) — this is a second, separate 18-row
// table, keyed on Hole only, no Par (Par doesn't change by tee). Any player
// whose Roster Tee is "Red" (case-insensitive) gets strokes from this table
// instead of the main one; everyone else keeps using HoleHandicaps as before.
const HOLE_HC_RED_HEADERS = ['Hole', 'StrokeIndex'];
// The club's actual Red tee Stroke Index, hole by hole — seeded once below so
// this doesn't need to be hand-typed into the admin page after setup.
const RED_STROKE_INDEX_DEFAULTS = [7, 17, 13, 3, 9, 1, 5, 15, 11, 8, 10, 16, 2, 4, 6, 14, 18, 12];
const PAIRINGS_DAY1_HEADERS = ['MatchNum', 'TeamA_P1', 'TeamA_P2', 'TeamB_P1', 'TeamB_P2', 'StartHole'];
// StartHole is appended at the end rather than inserted alongside the other
// fields, purely so an existing Sheet's column layout is safe: the sheet
// gets fully rewritten (header row included) the next time Day 2 Pairings is
// saved, so this new column just shows up then — no manual Sheet edit needed.
// (The per-match "Tee" field that used to live here was removed — it was
// only ever a printed display label, never used for any scoring, and nobody
// was using it consistently. Each player's own Tee on the Roster is what
// actually drives handicap strokes, and is untouched by this.)
const PAIRINGS_DAY2_HEADERS = [
  'MatchNum', 'TeamA_P1', 'TeamA_P2', 'TeamB_P1', 'TeamB_P2',
  'MP1_TeamA', 'MP1_TeamB', 'MP2_TeamA', 'MP2_TeamB', 'MPSwapped', 'StartHole',
];
// A match's Scorekeeper PIN used to live on each day's own Pairings sheet
// separately (so the same foursome's Day 1 and Day 2 match needed the PIN
// typed in twice, and the two copies could silently drift apart). It now
// lives in its own sheet, keyed only by MatchNum — ONE PIN per match number,
// shared by both days — since in practice the same foursome plays that match
// number on both days. (If a match's actual players ever differ between the
// two days, its one PIN still unlocks both — there's no way to give the two
// days separate codes anymore, so keep that in mind when assigning them.)
// Optional: blank means anyone with the live link can still score that match,
// same as before this existed. Day1PIN/Day2PIN (added later) let a match
// have DIFFERENT codes per day when needed — PIN remains the shared/default
// code used whenever a day-specific override is blank, so nothing changes
// for anyone who never sets a per-day override. See effectivePin_ below for
// the actual day-aware lookup used everywhere a PIN is checked.
const MATCH_PIN_HEADERS = ['MatchNum', 'PIN', 'Day1PIN', 'Day2PIN'];
// Scores now record who won each hole DIRECTLY (entered by the scorekeeper
// after they work out the net result themselves) rather than gross strokes
// the app used to convert into a winner — "we don't care about scores per
// se, only who wins a hole." Winner values are always 'A' | 'B' | 'Half' |
// '' (not yet entered). Day 1 is one combined result per team per hole, so
// one Winner field covers it (Captain's Choice on the front 9, Modified
// Alternate Shot on the back 9 — never both on the same hole).
const SCORES_DAY1_HEADERS = ['MatchNum', 'Hole', 'Winner'];
// Day 2's front 9 (Best Ball) is one team-level result per hole. The back 9
// (Individual Match Play) is two separate 1-on-1 matches happening on the
// same holes at once, so it gets its own two Winner fields — MP1Winner for
// whichever players are in the MP1 slot, MP2Winner for MP2 (see
// MP1_TeamA/MP1_TeamB etc. on the Pairings sheet for who that actually is).
// A hole only ever has the field(s) that apply to its 9 filled in.
const SCORES_DAY2_HEADERS = ['MatchNum', 'Hole', 'BestBallWinner', 'MP1Winner', 'MP2Winner'];

const DEFAULT_SETTINGS = {
  TournamentName: 'Heritage Legends Tournament',
  Day1Date: '',
  Day2Date: '',
  TeamAName: 'Team A',
  TeamACaptain: 'TBD',
  // Each captain's chosen team color, shown as a small colored dot next to
  // the team's name throughout the admin page, Live Scoring, the Scoreboard,
  // and printed scorecards. Plain hex strings — Settings has a color picker
  // for changing them without touching the Sheet by hand.
  TeamAColor: '#ADD8E6',
  TeamBName: 'Team B',
  TeamBCaptain: 'TBD',
  TeamBColor: '#F08080',
  // The admin page's PIN gate now lives here instead of being hardcoded in
  // index.html, so "Change PIN" in the Settings tab can update it without
  // anyone needing to hand-edit the file. '1234' only applies the very first
  // time this key gets created (see the self-heal in getSettings_ below) —
  // change it from the admin page once you're set up.
  AdminPIN: '1234',
  // Once a day is locked from the admin's Settings tab, saveMatchScores_
  // refuses any further writes to that day's Scores sheet (see the check
  // there) — a way to freeze official results at the end of a day of play.
  // 'TRUE'/'FALSE' as strings, same convention as MPSwapped on Pairings.
  Day1Locked: 'FALSE',
  Day2Locked: 'FALSE',
  // Temporarily lets anyone enter scores for ANY match on Live Scoring without
  // its PIN, regardless of what each match's own PIN is set to — meant for
  // letting the guys test the app before the tournament without needing to
  // hand out real PINs yet. Existing per-match PINs are untouched; turning
  // this back off makes them required again exactly as before.
  SuspendScorePins: 'FALSE',
  // Whether Live Scoring offers a losing team's scorekeeper the option to
  // concede a match/segment once it's mathematically decided but holes
  // remain unplayed. Defaults ON so existing behavior is unchanged unless
  // the admin explicitly turns it off from the Settings tab.
  ConcedeEnabled: 'TRUE',
};

// ---------- one-time setup ----------

function initializeSheets() {
  const ss = openSpreadsheet_();

  const settingsSheet = getOrCreateSheet_(ss, SHEETS.SETTINGS);
  if (settingsSheet.getLastRow() === 0) {
    settingsSheet.appendRow(['Key', 'Value']);
    Object.keys(DEFAULT_SETTINGS).forEach((k) => settingsSheet.appendRow([k, DEFAULT_SETTINGS[k]]));
  }

  const rosterSheet = getOrCreateSheet_(ss, SHEETS.ROSTER);
  if (rosterSheet.getLastRow() === 0) {
    rosterSheet.appendRow(ROSTER_HEADERS);
  }

  const hcSheet = getOrCreateSheet_(ss, SHEETS.HOLE_HANDICAPS);
  if (hcSheet.getLastRow() === 0) {
    hcSheet.appendRow(HOLE_HC_HEADERS);
    for (let h = 1; h <= 18; h++) hcSheet.appendRow([h, '', '']); // fill StrokeIndex/Par in later
  }

  const hcRedSheet = getOrCreateSheet_(ss, SHEETS.HOLE_HANDICAPS_RED);
  if (hcRedSheet.getLastRow() === 0) {
    hcRedSheet.appendRow(HOLE_HC_RED_HEADERS);
    for (let h = 1; h <= 18; h++) hcRedSheet.appendRow([h, RED_STROKE_INDEX_DEFAULTS[h - 1]]);
  }

  const p1Sheet = getOrCreateSheet_(ss, SHEETS.PAIRINGS_DAY1);
  if (p1Sheet.getLastRow() === 0) {
    p1Sheet.appendRow(PAIRINGS_DAY1_HEADERS);
    for (let m = 1; m <= 9; m++) p1Sheet.appendRow([m, '', '', '', '', '']);
  }

  const p2Sheet = getOrCreateSheet_(ss, SHEETS.PAIRINGS_DAY2);
  if (p2Sheet.getLastRow() === 0) {
    p2Sheet.appendRow(PAIRINGS_DAY2_HEADERS);
    for (let m = 1; m <= 9; m++) p2Sheet.appendRow([m, '', '', '', '', '', '', '', '', false, '']);
  }

  const s1Sheet = getOrCreateSheet_(ss, SHEETS.SCORES_DAY1);
  if (s1Sheet.getLastRow() === 0) {
    s1Sheet.appendRow(SCORES_DAY1_HEADERS);
  }

  const s2Sheet = getOrCreateSheet_(ss, SHEETS.SCORES_DAY2);
  if (s2Sheet.getLastRow() === 0) {
    s2Sheet.appendRow(SCORES_DAY2_HEADERS);
  }

  ensureMatchPinsSheet_(ss);

  Logger.log('Sheets initialized.');
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// Reads a 'PIN' column directly by header name, regardless of what the
// current PAIRINGS_DAY*_HEADERS constants say (they no longer list it) —
// used once, by ensureMatchPinsSheet_, to carry forward any PINs already set
// under the old per-day design into the new shared MatchPins sheet instead
// of quietly starting everyone over with blank PINs.
function readLegacyPinColumn_(sheet) {
  if (!sheet) return {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const pinCol = headerRow.indexOf('PIN');
  const matchCol = headerRow.indexOf('MatchNum');
  if (pinCol === -1 || matchCol === -1) return {};
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = {};
  values.forEach((row) => {
    const pin = String(row[pinCol] || '').trim();
    const matchNum = row[matchCol];
    if (pin && matchNum !== '' && matchNum !== null && matchNum !== undefined) out[String(matchNum)] = pin;
  });
  return out;
}

// Creates the MatchPins sheet the first time anything needs it. If it's
// brand new AND either day's Pairings sheet still has an old-style 'PIN'
// column with data in it (from before PINs moved here), that data is
// migrated in once — Day 1's value wins if the two ever differed — so
// upgrading to this design doesn't reset everyone's PINs to blank.
function ensureMatchPinsSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.MATCH_PINS);
  if (sheet.getLastRow() > 0) {
    migrateMatchPinsHeader_(sheet); // upgrade an existing PIN-only sheet to also have Day1PIN/Day2PIN
    return sheet;
  }
  const day1Pins = readLegacyPinColumn_(ss.getSheetByName(SHEETS.PAIRINGS_DAY1));
  const day2Pins = readLegacyPinColumn_(ss.getSheetByName(SHEETS.PAIRINGS_DAY2));
  sheet.appendRow(MATCH_PIN_HEADERS);
  for (let m = 1; m <= 9; m++) {
    sheet.appendRow([m, day1Pins[String(m)] || day2Pins[String(m)] || '', '', '']);
  }
  // Same plain-text protection objectsToSheet_ gives every other sheet, so a
  // migrated or freshly-typed PIN can't silently lose a leading zero.
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, MATCH_PIN_HEADERS.length).setNumberFormat('@');
  }
  return sheet;
}

// One-time, idempotent upgrade for a MatchPins sheet that was created before
// Day1PIN/Day2PIN existed (just MatchNum + PIN). Adds the two new header
// cells in place without touching any existing MatchNum/PIN data — safe to
// call on every request (it no-ops instantly once the headers are already
// there), same pattern as the rest of this file's self-healing reads.
function migrateMatchPinsHeader_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headerRow.indexOf('Day1PIN') !== -1) return; // already migrated
  const startCol = lastCol + 1;
  sheet.getRange(1, startCol, 1, 2).setValues([['Day1PIN', 'Day2PIN']]);
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, startCol, lastRow - 1, 2).setNumberFormat('@');
  }
}

function getMatchPins_(ss) {
  return sheetToObjects_(ensureMatchPinsSheet_(ss), MATCH_PIN_HEADERS);
}

// Bundles every read the front-end's boot-time load needs (settings, roster,
// both hole-handicap tables, both days' pairings, match PINs) into a single
// request. Added after a live-test page load took ~16s: each request here
// opens the Spreadsheet by ID from scratch (SpreadsheetApp.openById in
// handleRequest_ below) before it can read anything, and the front end used
// to fire 7 of these in parallel for one page load — 7x that per-request
// open-and-authorize overhead, some or all of it likely serialized by Apps
// Script's own per-project execution limits rather than truly parallel.
// One request here pays that overhead once.
function getBootData_(ss) {
  return {
    settings: getPublicSettings_(ss),
    roster: publicRoster_(sheetToObjects_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS)),
    holeHandicaps: sheetToObjects_(ss.getSheetByName(SHEETS.HOLE_HANDICAPS), HOLE_HC_HEADERS),
    holeHandicapsRed: sheetToObjects_(ss.getSheetByName(SHEETS.HOLE_HANDICAPS_RED), HOLE_HC_RED_HEADERS),
    pairings1: getPairings_(ss, '1'),
    pairings2: getPairings_(ss, '2'),
    matchPins: getMatchPins_(ss),
  };
}

function saveMatchPins_(ss, matchPins) {
  const admins = readAdmins_(ss).filter((a) => a.Active === 'TRUE');
  matchPins.forEach((m) => {
    [m.PIN, m.Day1PIN, m.Day2PIN].forEach((mp) => {
      if (mp && admins.some((a) => pinsMatch_(a.PIN, mp))) {
        throw new Error('Match ' + m.MatchNum + ': that PIN is the same as an admin PIN — choose a different one.');
      }
    });
  });
  const sheet = ensureMatchPinsSheet_(ss);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    objectsToSheet_(sheet, MATCH_PIN_HEADERS, matchPins);
  } finally {
    lock.releaseLock();
  }
  return sheetToObjects_(sheet, MATCH_PIN_HEADERS);
}

// ---------- HTTP entry points ----------

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  const params = e.postData ? JSON.parse(e.postData.contents) : e.parameter;
  return handleRequest_({ parameter: Object.assign({}, e.parameter, params) });
}

const WRITE_ACTIONS_ = ['saveSettings', 'saveRoster', 'saveHoleHandicaps', 'saveHoleHandicapsRed', 'savePairings', 'saveMatchPins', 'saveMatchScores', 'startNewSeason', 'replacePlayerDay2', 'saveMembers', 'resetMemberPin', 'memberSetPin', 'memberChangePin', 'memberSaveContact', 'saveHandicaps', 'memberPinResetRequest', 'memberPinResetConfirm'];
const FORCE_BACKUP_ACTIONS_ = ['startNewSeason', 'replacePlayerDay2'];

function handleRequest_(e) {
  try {
    const p = e.parameter || {};
    const expectedKey = secretKey_();
    if (!expectedKey) {
      return jsonOut_({ success: false, error: 'SECRET_KEY is not set — add it in Apps Script Project Settings > Script Properties.' });
    }
    // keyEnc is the same key, URL-encoded so it's plain ASCII: the key contains
    // a "£", which can occasionally arrive garbled and caused stray "Invalid key" errors.
    let encOk = false;
    try { encOk = !!p.keyEnc && decodeURIComponent(String(p.keyEnc)) === expectedKey; } catch (err) { encOk = false; }
    if (p.key !== expectedKey && !encOk) {
      return jsonOut_({ success: false, error: 'Invalid key' });
    }
    const ss = openSpreadsheet_();
    // Runs on every request, but returns immediately once MatchPins already
    // exists (see ensureMatchPinsSheet_) — placed here, before any action can
    // run, so the one-time legacy-PIN migration always happens on the very
    // first request after upgrading to this version, no matter which action
    // the front-end happens to call first. Migration depends on the old
    // per-day 'PIN' column still being in PairingsDay1/PairingsDay2 — a
    // savePairings call rewrites those sheets without that column (per the
    // current PAIRINGS_DAY*_HEADERS), so running migration any later than
    // this — e.g. only inside the getMatchPins/saveMatchPins actions below —
    // risked a savePairings call wiping the legacy column first and silently
    // migrating in blanks instead of the real PINs.
    ensureMatchPinsSheet_(ss);
    // Snapshot the data BEFORE any change is made (throttled — see Automatic
    // backups). Season start and player replacement always snapshot.
    // Admin-only actions need a valid admin PIN (checked here on the server).
    // One email's settings: the limited-admin check goes by which email (see LIMITED_PAGES_).
    REQUEST_ACTION_ = String(p.action || '') + (p.action === 'legendsSaveEmailSettings' || p.action === 'legendsEmailSendNow' ? ':' + String(p.type || '') : '');
    // a tournament's teams and email: the limited-admin check goes by which tournament ($10, $5, Annual)
    if (typeof laTournReqKind_ === 'function') { const tk = laTournReqKind_(ss, p); if (tk) REQUEST_ACTION_ += ':' + tk; }
    REQUEST_IS_WRITE_ = WRITE_ACTIONS_.indexOf(p.action) !== -1 || ['saveAdmins', 'backupNow'].indexOf(p.action) !== -1 ||
      (typeof LA_WRITE_ACTIONS_ !== 'undefined' && LA_WRITE_ACTIONS_.indexOf(p.action) !== -1);
    let adminName = null;
    let before = null;
    if (ADMIN_ACTIONS_.indexOf(p.action) !== -1) {
      adminName = requireAdmin_(ss, p.adminPin);
      before = captureBefore_(ss, p.action, p);
    }
    if (WRITE_ACTIONS_.indexOf(p.action) !== -1) maybeBackup_(ss, FORCE_BACKUP_ACTIONS_.indexOf(p.action) !== -1);
    let result;
    switch (p.action) {
      case 'getSettings':
        result = getPublicSettings_(ss);
        break;
      case 'saveSettings':
        result = saveSettings_(ss, JSON.parse(p.settings));
        break;
      case 'getRoster':
        result = publicRoster_(sheetToObjects_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS));
        break;
      case 'saveRoster':
        result = saveRoster_(ss, JSON.parse(p.roster));
        break;
      case 'getHoleHandicaps':
        result = sheetToObjects_(ss.getSheetByName(SHEETS.HOLE_HANDICAPS), HOLE_HC_HEADERS);
        break;
      case 'saveHoleHandicaps':
        result = saveHoleHandicaps_(ss, JSON.parse(p.holeHandicaps));
        break;
      case 'getHoleHandicapsRed':
        result = sheetToObjects_(ss.getSheetByName(SHEETS.HOLE_HANDICAPS_RED), HOLE_HC_RED_HEADERS);
        break;
      case 'saveHoleHandicapsRed':
        result = saveHoleHandicapsRed_(ss, JSON.parse(p.holeHandicapsRed));
        break;
      case 'getPairings':
        result = getPairings_(ss, p.day);
        break;
      case 'savePairings':
        result = savePairings_(ss, p.day, JSON.parse(p.pairings));
        break;
      case 'getMatchPins':
        result = getMatchPins_(ss);
        break;
      case 'saveMatchPins':
        result = saveMatchPins_(ss, JSON.parse(p.matchPins));
        break;
      case 'getScores':
        result = getScores_(ss, p.day);
        break;
      case 'saveMatchScores':
        result = saveMatchScores_(ss, p.day, p.matchNum, JSON.parse(p.holes), p.source);
        break;
      case 'startNewSeason':
        result = startNewSeason_(ss, p.archiveLabel);
        break;
      case 'replacePlayerDay2':
        result = replacePlayerDay2_(ss, p.outgoingName, JSON.parse(p.incoming));
        break;
      case 'listArchivedSeasons':
        result = listArchivedSeasons_(ss);
        break;
      case 'getArchivedSeason':
        result = getArchivedSeasonData_(ss, p.label);
        break;
      case 'verifyAdminPin':
        result = verifyAdminPin_(ss, p.pin, p.where);
        // The Legends app asks for its data in the same request, saving a second round trip.
        if (p.withBoard && typeof laGetBoard_ === 'function') {
          try { result.board = laGetBoard_(ss, laViewer_(ss, Object.assign({}, p, { adminPin: p.pin }))); } catch (err) { /* page loads it separately */ }
        }
        break;
      case 'adminPresence':
        result = adminPresence_(ss, p.adminPin, p.sid, p.where);
        break;
      case 'getAdmins':
        result = getAdmins_(ss, adminName);
        break;
      case 'saveAdmins':
        result = saveAdmins_(ss, JSON.parse(p.admins), adminName);
        break;
      case 'getActivityLog':
        result = getActivityLog_(ss, p.limit);
        break;
      case 'backupNow':
        result = backupNow_(ss);
        break;
      case 'listBackups':
        result = listBackups_(ss);
        break;
      case 'getBootData':
        result = getBootData_(ss);
        break;
      case 'memberCheckEmail':
        result = memberCheckEmail_(ss, p.email);
        break;
      case 'memberLogin':
        result = memberLogin_(ss, p.email, p.pin);
        break;
      case 'memberSetPin':
        result = memberSetPin_(ss, p.email, p.newPin);
        break;
      case 'memberPinResetRequest':
        result = memberPinResetRequest_(ss, p.email);
        break;
      case 'memberPinResetConfirm':
        result = memberPinResetConfirm_(ss, p.email, p.code, p.newPin);
        break;
      case 'memberMe':
        result = memberMe_(ss, p.token);
        break;
      case 'memberChangePin':
        result = memberChangePin_(ss, p.token, p.newPin);
        break;
      case 'memberRoster':
        result = memberRoster_(ss, p.token, p.adminPin);
        break;
      case 'getHandicaps':
        result = getHandicaps_(ss, p.token, p.adminPin);
        break;
      case 'saveHandicaps':
        result = saveHandicaps_(ss, JSON.parse(p.players), p.asOf, p.adminPin);
        break;
      case 'memberGetContact':
        result = memberGetContact_(ss, p.token);
        break;
      case 'memberSaveContact':
        result = memberSaveContact_(ss, p.token, p.email, p.homePhone, p.mobilePhone, p.emergencyContact, p.preferredTee, p.playGroup);
        break;
      case 'getMembersAdmin':
        result = getMembersAdmin_(ss);
        break;
      case 'saveMembers':
        result = saveMembers_(ss, JSON.parse(p.members));
        break;
      case 'resetMemberPin':
        result = resetMemberPin_(ss, p.playerId);
        break;
      case 'getVersion':
        result = { version: BACKEND_VERSION, legends: typeof LA_VERSION !== 'undefined' ? LA_VERSION : 'old' };
        break;
      default: {
        // Sign-ups / tee time duty actions live in LegendsApp.gs.
        const routed = typeof legendsRoute_ === 'function' ? legendsRoute_(ss, p) : { handled: false };
        if (!routed.handled) return jsonOut_({ success: false, error: 'Unknown action: ' + p.action });
        result = routed.result;
      }
    }
    if (adminName) {
      const d = describeAdminAction_(p.action, p, before, result);
      if (d) logActivity_(ss, adminName, d.action, d.detail);
    }
    return jsonOut_({ success: true, data: result });
  } catch (err) {
    return jsonOut_({ success: false, error: err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- generic sheet <-> object helpers ----------

// Reads by matching each wanted header NAME against the sheet's own row-1
// header labels — not by column position. That matters because
// objectsToSheet_ below fully rewrites a sheet's header row (in whatever
// order the *_HEADERS constant lists) every time that sheet is saved, so a
// header can be added, removed, or reordered in code (like Tee being
// dropped here) without corrupting rows that were saved under the old
// layout and haven't been re-saved yet — a missing header just reads as ''
// until the next save catches the sheet up.
function sheetToObjects_(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const all = sheet.getRange(1, 1, lastRow, lastCol).getValues(); // one read for header + data
  const headerRow = all[0];
  const colIndex = {};
  headerRow.forEach((h, i) => { if (h && !(h in colIndex)) colIndex[h] = i; });
  const values = all.slice(1);
  return values.map((row) => {
    const obj = {};
    headers.forEach((h) => { obj[h] = (h in colIndex) ? row[colIndex[h]] : ''; });
    return obj;
  });
}

function objectsToSheet_(sheet, headers, objects) {
  // Writes the new rows over the old ones and then clears whatever is left below, instead of
  // emptying the tab first. While a tab was empty for that moment, anything reading it at
  // the same time got nothing back; for AppSettings that made the app put every setting
  // back to its starting value, turning the emails back on (Tom 2026-11-17).
  const oldRows = sheet.getLastRow(), oldCols = sheet.getLastColumn();
  const rows = objects.map((obj) => headers.map((h) => (obj[h] !== undefined ? obj[h] : '')));
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (oldCols > headers.length) sheet.getRange(1, headers.length + 1, Math.max(oldRows, 1), oldCols - headers.length).clearContent();
  if (oldRows > rows.length + 1) sheet.getRange(rows.length + 2, 1, oldRows - rows.length - 1, Math.max(oldCols, headers.length)).clearContent();
  if (objects.length === 0) return;
  const range = sheet.getRange(2, 1, rows.length, headers.length);
  // Plain-text format (same fix as saveSettings_ uses for dates) stops Sheets
  // from silently turning an all-digits value — like a Scorekeeper PIN
  // ("0483") — into a real number on save. That's more than cosmetic: a
  // front-end that expects a string (e.g. calling .trim() on it) can throw
  // outright on a number, and a converted PIN can quietly lose a leading
  // zero. Every sheet written through this function gets this protection,
  // since none of them rely on the Sheet's own native number type — every
  // numeric field here is parsed back out in JS regardless of whether the
  // cell holds "4" or 4.
  range.setNumberFormat('@');
  range.setValues(rows);
}

// ---------- Settings ----------

// The settings every browser may see — the old single AdminPIN row is never
// handed out (admin PINs now live in the Admins tab and are only ever checked
// on the server, see "Admin users" below).
function getPublicSettings_(ss) {
  const st = getSettings_(ss);
  delete st.AdminPIN;
  return st;
}

function getSettings_(ss) {
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  const settings = {};
  values.forEach(([k, v]) => {
    // A "YYYY-MM-DD" string that Sheets auto-converted into a real date (see the
    // plain-text fix in saveSettings_ below — this also self-heals any value that
    // got converted before that fix was in place) reads back here as a JS Date,
    // not the original string. An <input type="date"> needs it back as exactly
    // "YYYY-MM-DD", so re-format it rather than handing back a full timestamp.
    settings[k] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : v;
  });
  // Self-heal: a Settings tab created before some key existed in DEFAULT_SETTINGS
  // (e.g. AdminPIN, added later) won't have that row yet. Add it here so older
  // deployments pick up new settings automatically the first time this runs,
  // without anyone having to touch the Sheet by hand.
  const missingKeys = Object.keys(DEFAULT_SETTINGS).filter((k) => settings[k] === undefined);
  if (missingKeys.length) {
    missingKeys.forEach((k) => {
      sheet.appendRow([k, DEFAULT_SETTINGS[k]]);
      settings[k] = DEFAULT_SETTINGS[k];
    });
  }
  return settings;
}

function saveSettings_(ss, settings) {
  settings = Object.assign({}, settings);
  delete settings.AdminPIN; // admin PINs are managed only through saveAdmins
  const sheet = ss.getSheetByName(SHEETS.SETTINGS);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < values.length; i++) {
      const key = values[i][0];
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        const cell = sheet.getRange(i + 2, 2);
        // Plain-text format stops Sheets' automatic type detection from silently
        // turning a "YYYY-MM-DD" string into a real date value — without this,
        // it round-trips back in a different (and wrong-looking) format.
        cell.setNumberFormat('@');
        cell.setValue(settings[key]);
      }
    }
  } finally {
    lock.releaseLock();
  }
  return getPublicSettings_(ss);
}

// ---------- Roster ----------

function saveRoster_(ss, roster) {
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Keep each player's private contact fields (Email/Phone) when the save
    // came from a page that never had them — the tournament admin page loads
    // its roster from public data with those fields stripped out.
    const existingById = {};
    sheetToObjects_(sheet, ROSTER_HEADERS).forEach((r) => { if (r.PlayerID !== '') existingById[String(r.PlayerID)] = r; });
    roster.forEach((p) => {
      const old = existingById[String(p.PlayerID)];
      if (!old) return;
      ROSTER_PRIVATE_FIELDS.concat(ROSTER_MEMBER_FIELDS).forEach((f) => { if (p[f] === undefined) p[f] = old[f]; });
    });
    // assign PlayerIDs to any new rows that don't have one yet
    let nextId = rosterNextId_(roster);
    roster.forEach((p) => {
      if (!p.PlayerID) p.PlayerID = nextId++;
    });
    objectsToSheet_(sheet, ROSTER_HEADERS, roster);
  } finally {
    lock.releaseLock();
  }
  return sheetToObjects_(sheet, ROSTER_HEADERS);
}

// ---------- Hole Handicaps ----------

function saveHoleHandicaps_(ss, holeHandicaps) {
  const sheet = ss.getSheetByName(SHEETS.HOLE_HANDICAPS);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    objectsToSheet_(sheet, HOLE_HC_HEADERS, holeHandicaps);
  } finally {
    lock.releaseLock();
  }
  return sheetToObjects_(sheet, HOLE_HC_HEADERS);
}

function saveHoleHandicapsRed_(ss, holeHandicapsRed) {
  const sheet = ss.getSheetByName(SHEETS.HOLE_HANDICAPS_RED);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    objectsToSheet_(sheet, HOLE_HC_RED_HEADERS, holeHandicapsRed);
  } finally {
    lock.releaseLock();
  }
  return sheetToObjects_(sheet, HOLE_HC_RED_HEADERS);
}

// ---------- Pairings ----------

function pairingsSheetName_(day) {
  return day === '2' || day === 2 ? SHEETS.PAIRINGS_DAY2 : SHEETS.PAIRINGS_DAY1;
}
function pairingsHeaders_(day) {
  return day === '2' || day === 2 ? PAIRINGS_DAY2_HEADERS : PAIRINGS_DAY1_HEADERS;
}

function getPairings_(ss, day) {
  return sheetToObjects_(ss.getSheetByName(pairingsSheetName_(day)), pairingsHeaders_(day));
}

function savePairings_(ss, day, pairings) {
  const sheet = ss.getSheetByName(pairingsSheetName_(day));
  const headers = pairingsHeaders_(day);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    objectsToSheet_(sheet, headers, pairings);
  } finally {
    lock.releaseLock();
  }
  return sheetToObjects_(sheet, headers);
}

// ---------- Scores ----------
//
// One scorekeeper per match/foursome enters that match's own scores, so
// writes from different matches essentially never collide — but every save
// still rewrites the whole sheet (all matches), keeping every other match's
// rows untouched and lock-protected, so two saves landing at the same moment
// can't clobber each other.

function scoresSheetName_(day) {
  return day === '2' || day === 2 ? SHEETS.SCORES_DAY2 : SHEETS.SCORES_DAY1;
}
function scoresHeaders_(day) {
  return day === '2' || day === 2 ? SCORES_DAY2_HEADERS : SCORES_DAY1_HEADERS;
}

// One-time migration helper for a Sheet that already had ScoresDay1/
// ScoresDay2 tabs from before the direct-hole-winner redesign (old headers
// like TeamA_Strokes / TeamA_P1_Gross, plus whatever test data was entered
// under that old model). objectsToSheet_ only rewrites a tab's header row
// the next time something is actually SAVED to it — getScores_ reads by
// name, so until that first save happens, old rows just sit there with
// their old columns and look untouched by the new code. Run this once from
// the Apps Script editor (Run menu → resetScoresSheets, same as
// initializeSheets) to force both tabs to the current header row right now,
// with all rows cleared — there's no way to carry old gross-score data
// forward into a "who won the hole" value automatically, so this is a clean
// wipe, not a conversion. Safe to run any time play hasn't started yet;
// don't run it once real results have been entered, since it clears them.
function resetScoresSheets() {
  const ss = openSpreadsheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    objectsToSheet_(ss.getSheetByName(SHEETS.SCORES_DAY1), SCORES_DAY1_HEADERS, []);
    objectsToSheet_(ss.getSheetByName(SHEETS.SCORES_DAY2), SCORES_DAY2_HEADERS, []);
  } finally {
    lock.releaseLock();
  }
  Logger.log('ScoresDay1/ScoresDay2 reset to the current header row.');
}

function getScores_(ss, day) {
  return sheetToObjects_(ss.getSheetByName(scoresSheetName_(day)), scoresHeaders_(day));
}

function isDayLocked_(ss, day) {
  const settings = getSettings_(ss);
  const key = (day === '2' || day === 2) ? 'Day2Locked' : 'Day1Locked';
  const v = settings[key];
  return v === true || v === 'TRUE' || v === 'true';
}

// `holes` is the complete current set of hole rows for this one match (the
// front-end holds the whole 18-hole grid in memory and sends it as a unit) —
// this replaces just this match's rows, leaving every other match's rows in
// the sheet exactly as they were.
function saveMatchScores_(ss, day, matchNum, holes, source) {
  // Enforced server-side, not just hidden in the UI — once the admin locks a
  // day (Settings tab), scores for that day are frozen everywhere, including
  // anyone still holding an old page or hitting the API directly.
  if (isDayLocked_(ss, day)) {
    throw new Error(`Day ${day} is locked — ask the admin to unlock it in Settings before making changes.`);
  }
  const sheet = ss.getSheetByName(scoresSheetName_(day));
  const headers = scoresHeaders_(day);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing = sheetToObjects_(sheet, headers);
    const otherMatches = existing.filter((row) => String(row.MatchNum) !== String(matchNum));
    const previousRows = existing.filter((row) => String(row.MatchNum) === String(matchNum));
    const thisMatchRows = holes.map((h) => Object.assign({}, h, { MatchNum: matchNum }));
    objectsToSheet_(sheet, headers, otherMatches.concat(thisMatchRows));
    try {
      appendScoreLog_(ss, day, matchNum, diffScoreRows_(previousRows, thisMatchRows, headers), source);
    } catch (logErr) {
      Logger.log('Score log skipped: ' + logErr.message); // never lose a score over a logging problem
    }
    try {
      const m = /^Admin(?::\s*(.+))?$/.exec(String(source || ''));
      if (m) {
        const n = diffScoreRows_(previousRows, thisMatchRows, headers).length;
        if (n) logActivity_(ss, (m[1] || 'Admin').trim(), 'Edited scores', 'Day ' + day + ' Match ' + matchNum + ': ' + n + ' change' + (n === 1 ? '' : 's'));
      }
    } catch (actErr) { /* logging only */ }
  } finally {
    lock.releaseLock();
  }
  return sheetToObjects_(sheet, headers).filter((row) => String(row.MatchNum) === String(matchNum));
}

// ---------- Score change log ----------
//
// Every time a match's scores are saved, each hole result that actually
// changed (new, changed or cleared) gets one row in the ScoreLog tab: when,
// which day/match/hole/contest, the old and new value, and where the change
// came from ("Scorekeeper" for a normal match-PIN session, "Admin" when the
// Admin PIN was used). Settles "who entered that?" questions and makes
// admin corrections visible. Rows are only ever appended.

const SCORE_LOG_HEADERS = ['Timestamp', 'Day', 'MatchNum', 'Hole', 'Contest', 'OldValue', 'NewValue', 'Source'];

// Pure: compares one match's old and new hole rows, returns one entry per
// changed (hole, contest) cell.
function diffScoreRows_(oldRows, newRows, headers) {
  const fields = headers.filter((h) => h !== 'MatchNum' && h !== 'Hole');
  const norm = (v) => (v === undefined || v === null ? '' : String(v));
  const oldByHole = {};
  (oldRows || []).forEach((r) => { oldByHole[String(r.Hole)] = r; });
  const newByHole = {};
  (newRows || []).forEach((r) => { newByHole[String(r.Hole)] = r; });
  const holes = Object.keys(Object.assign({}, oldByHole, newByHole)).sort((a, b) => Number(a) - Number(b));
  const changes = [];
  holes.forEach((hole) => {
    fields.forEach((f) => {
      const o = norm((oldByHole[hole] || {})[f]);
      const n = norm((newByHole[hole] || {})[f]);
      if (o !== n) changes.push({ hole: hole, contest: f, oldValue: o, newValue: n });
    });
  });
  return changes;
}

function appendScoreLog_(ss, day, matchNum, changes, source) {
  if (!changes.length) return;
  let sheet = ss.getSheetByName(SHEETS.SCORE_LOG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.SCORE_LOG);
    sheet.appendRow(SCORE_LOG_HEADERS);
  }
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  const rows = changes.map((c) => [stamp, String(day), String(matchNum), c.hole, c.contest, c.oldValue, c.newValue, source || '']);
  const range = sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SCORE_LOG_HEADERS.length);
  range.setNumberFormat('@');
  range.setValues(rows);
}

// ---------- Automatic backups ----------
//
// Every snapshot is ONE tab in a separate Google Sheet named "Heritage Legends
// Backups" (made automatically, in the Drive of the account that runs this
// script). Each tab holds every data tab of this spreadsheet — tournament and
// Legends app — one after another, each under a "=== TabName ===" line.
// Keeping backups out of the main spreadsheet keeps the app fast: dozens of
// hidden backup tabs there slowed down every request.
//
// When: by the hourly job (installLegendsTriggers) at most every
// BACKUP_MIN_INTERVAL_MIN minutes; during an ordinary save only if no backup
// has run for a day (so the app still backs up if the hourly job isn't set
// up); and always before a season start or Day 2 substitution. The newest
// BACKUP_KEEP snapshots are kept. To recover something, open the backups
// sheet, find the tab from the time you want, and copy the rows under the
// tab's heading back (or ask Claude to help).

const BACKUP_MIN_INTERVAL_MIN = 120;
const BACKUP_REQUEST_INTERVAL_MIN = 24 * 60;
const BACKUP_KEEP = 8;
const BACKUP_SHEET_NAMES = [
  SHEETS.SETTINGS, SHEETS.ROSTER, SHEETS.PAIRINGS_DAY1, SHEETS.PAIRINGS_DAY2,
  SHEETS.SCORES_DAY1, SHEETS.SCORES_DAY2, SHEETS.MATCH_PINS, SHEETS.SCORE_LOG,
  SHEETS.ADMINS, SHEETS.ACTIVITY_LOG, SHEETS.MEMBER_PINS,
];
const LEGENDS_BACKUP_SHEETS = ['AppSettings', 'Signups', 'Closures', 'Notices', 'ClubTeeTimes', 'DayConfig', 'TeeTimeDuty', 'Events', 'SwapRequests', 'ProShopLog', 'RelatedFiles', 'News', 'ReminderLog', 'DutyAway'];

function backupSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('BACKUP_SPREADSHEET_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (err) { /* deleted — make a new one */ } }
  const b = SpreadsheetApp.create('Heritage Legends Backups');
  props.setProperty('BACKUP_SPREADSHEET_ID', b.getId());
  return b;
}
// Pure: given every snapshot label found, returns the ones to delete so only
// the newest `keep` remain (labels sort chronologically).
function backupLabelsToDelete_(labels, keep) {
  const sorted = Array.from(new Set(labels)).sort();
  return sorted.length > keep ? sorted.slice(0, sorted.length - keep) : [];
}
function backupLabelFromSheetName_(name) {
  const m = /^Backup_(\d{8}-\d{4})/.exec(name);
  return m ? m[1] : null;
}
function listBackups_(ss) {
  const labels = [];
  backupSpreadsheet_().getSheets().forEach((sh) => { const l = backupLabelFromSheetName_(sh.getName()); if (l) labels.push(l); });
  return Array.from(new Set(labels)).sort().reverse();
}
function backupNow_(ss) {
  const label = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
  const bss = backupSpreadsheet_();
  const name = 'Backup_' + label;
  if (!bss.getSheetByName(name)) {
    const blocks = [];
    let width = 1;
    BACKUP_SHEET_NAMES.concat(LEGENDS_BACKUP_SHEETS).forEach((tab) => {
      const sh = ss.getSheetByName(tab);
      if (!sh || sh.getLastRow() < 1) return;
      const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getValues();
      width = Math.max(width, vals[0].length);
      blocks.push(['=== ' + tab + ' ===']);
      vals.forEach((r) => blocks.push(r));
    });
    if (blocks.length) {
      const rows = blocks.map((r) => { const o = r.slice(); while (o.length < width) o.push(''); return o; });
      const out = bss.insertSheet(name);
      out.getRange(1, 1, rows.length, width).setNumberFormat('@').setValues(rows);
    }
  }
  const doomed = backupLabelsToDelete_(bss.getSheets().map((sh) => backupLabelFromSheetName_(sh.getName())).filter(Boolean), BACKUP_KEEP);
  bss.getSheets().forEach((sh) => {
    const l = backupLabelFromSheetName_(sh.getName());
    if (l && doomed.indexOf(l) !== -1 && bss.getSheets().length > 1) bss.deleteSheet(sh);
  });
  const blank = bss.getSheetByName('Sheet1');
  if (blank && bss.getSheets().length > 1) bss.deleteSheet(blank);
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP_MS', String(Date.now()));
  return { label: label, kept: listBackups_(ss) };
}
// Best-effort and never blocks the save it precedes: a failed backup is
// logged but doesn't stop the request.
function maybeBackup_(ss, force, intervalMin) {
  try {
    const last = Number(PropertiesService.getScriptProperties().getProperty('LAST_BACKUP_MS') || 0);
    if (!force && Date.now() - last < (intervalMin || BACKUP_REQUEST_INTERVAL_MIN) * 60 * 1000) return;
    backupNow_(ss);
  } catch (err) {
    Logger.log('Backup skipped: ' + err.message);
  }
}
// Older versions kept backups as hidden tabs in this spreadsheet, which made
// everything slow. The hourly job removes them a batch at a time (they're
// replaced by the separate backups sheet); this can also be run by hand.
function removeOldBackupTabs(limit) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  let n = 0;
  ss.getSheets().forEach((sh) => {
    if ((limit && n >= limit) || !/^Backup_\d{8}-\d{4}_/.test(sh.getName())) return;
    ss.deleteSheet(sh); n++;
  });
  Logger.log('Removed ' + n + ' old backup tabs from the main spreadsheet.');
  return n;
}

// ---------- Admin users, sign-in and activity log ----------
//
// Each admin has their own name and PIN (Admins tab; managed from the admin
// page's Settings > Admin users). The server checks the PIN — it is never sent
// to browsers — on every admin action, and every change an admin makes is
// recorded in the ActivityLog tab under that person's name. (Scorekeepers'
// match PINs are separate, and still checked in the browser as before.)

const ADMIN_HEADERS = ['Name', 'PIN', 'Active', 'Role']; // Role: Full, View (look but can't save) or Pages:days,duty (limited; see LIMITED_PAGES_)
const ACTIVITY_HEADERS = ['Timestamp', 'Admin', 'Action', 'Detail'];

// Everything that changes tournament setup, plus reading admin-only data.
const ADMIN_ACTIONS_ = [
  'saveSettings', 'saveRoster', 'saveHoleHandicaps', 'saveHoleHandicapsRed', 'savePairings',
  'saveMatchPins', 'startNewSeason', 'replacePlayerDay2', 'backupNow', 'listBackups',
  'saveAdmins', 'getAdmins', 'getActivityLog',
  'getMembersAdmin', 'saveMembers', 'resetMemberPin', 'saveHandicaps',
];
const MAX_ADMIN_PIN_FAILS_ = 30; // wrong-PIN tries allowed per 10 minutes, across everyone

function pinsMatch_(a, b) {
  a = String(a == null ? '' : a).trim();
  b = String(b == null ? '' : b).trim();
  if (!a || !b) return false;
  if (a === b) return true;
  return /^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b);
}
function isTruthyCell_(v) { return v === true || v === 'TRUE' || v === 'true'; }

function ensureAdminsSheet_(ss) {
  let sheet = ss.getSheetByName(SHEETS.ADMINS);
  if (sheet) return sheet;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet = ss.getSheetByName(SHEETS.ADMINS);
    if (sheet) return sheet;
    sheet = ss.insertSheet(SHEETS.ADMINS);
    sheet.appendRow(ADMIN_HEADERS);
    // Carry over the single admin PIN from the old Settings row so whoever was
    // already the admin can still sign in; rename them under Admin users.
    let legacy = '1234';
    const st = ss.getSheetByName(SHEETS.SETTINGS);
    if (st && st.getLastRow() > 1) {
      st.getRange(2, 1, st.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
        if (k === 'AdminPIN' && String(v).trim()) legacy = String(v).trim();
      });
    }
    const r = sheet.getRange(2, 1, 1, ADMIN_HEADERS.length);
    r.setNumberFormat('@');
    r.setValues([['Admin', legacy, 'TRUE']]);
    return sheet;
  } finally {
    lock.releaseLock();
  }
}
function readAdmins_(ss) {
  return sheetToObjects_(ensureAdminsSheet_(ss), ADMIN_HEADERS)
    .filter((a) => String(a.Name).trim() && String(a.PIN).trim())
    .map((a) => ({ Name: String(a.Name).trim(), PIN: String(a.PIN).trim(), Active: String(a.Active) === '' ? 'TRUE' : (isTruthyCell_(a.Active) ? 'TRUE' : 'FALSE'),
      Role: normAdminRole_(a.Role) }));
}
// Limited admins (Tom 2026-10-25): Role "Pages:days,events" lets them open and save
// only those Admin pages, and nothing else (no tournament changes, no adding or
// removing players for others). Each page lists the saves it may make.
const LIMITED_PAGES_ = {
  duty: ['legendsSaveDuty', 'legendsSaveDutySetup', 'legendsSaveEmailSettings:duty', 'legendsDutyAwaySave'],
  days: ['legendsSaveDayConfig'],
  events: ['legendsSaveEvents'],
  handicaps: ['saveHandicaps'],
  pairnassau: ['legendsPairingsMake', 'legendsPairingsSave', 'legendsPairingsSend', 'legendsSaveEmailSettings:pairings', 'legendsSaveEmailSettings:nassauchanges', 'legendsEmailSendNow:nassauchanges', 'legendsSaveEmailSettings:nassautomorrow', 'legendsNassauGamesSave'],
  pairfun: ['legendsFunMake', 'legendsFunSave', 'legendsProShopSend', 'legendsSaveEmailSettings:funpairings', 'legendsEmailSendNow:funpairings', 'legendsFunAdd', 'legendsFunRemove'],
  noshows: ['legendsAttendanceSave'],
  // One right per tournament (Tom 2026-11-23): its rows on Setup › Tournaments, its teams and its email.
  // The tournament email settings stay with Full admins.
  tournten: ['legendsSaveTournaments', 'legendsTournFormatsSave', 'legendsTournPairMake:ten', 'legendsTournPairSave:ten', 'legendsTournEmailSend:ten'],
  tournfive: ['legendsSaveTournaments', 'legendsTournFormatsSave', 'legendsTournPairMake:five', 'legendsTournPairSave:five', 'legendsTournEmailSend:five'],
  tournannual: ['legendsSaveTournaments', 'legendsTournFormatsSave', 'legendsTournPairMake:annual', 'legendsTournPairSave:annual', 'legendsTournEmailSend:annual'],
};
function normAdminRole_(v) {
  const s = String(v || '').trim();
  if (/^view/i.test(s)) return 'View';
  const m = s.match(/^pages?\s*:(.*)$/i);
  if (!m) return 'Full';
  const keys = m[1].split(/[,\s]+/).map((k) => k.trim().toLowerCase()).filter((k, i, all) => LIMITED_PAGES_[k] && all.indexOf(k) === i);
  return keys.length ? 'Pages:' + keys.join(',') : 'View';
}
function isLimitedRole_(role) { return String(role || '').indexOf('Pages:') === 0; }
function limitedMayDo_(role, action) {
  return String(role).slice(6).split(',').some((k) => (LIMITED_PAGES_[k] || []).indexOf(action) !== -1);
}
const LIMITED_MSG_ = 'Your admin rights only cover some Admin pages, and this change isn\'t one of them.';

function logActivity_(ss, admin, action, detail) {
  try {
    let sheet = ss.getSheetByName(SHEETS.ACTIVITY_LOG);
    if (!sheet) {
      sheet = ss.insertSheet(SHEETS.ACTIVITY_LOG);
      sheet.appendRow(ACTIVITY_HEADERS);
    }
    const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, ACTIVITY_HEADERS.length);
    range.setNumberFormat('@');
    range.setValues([[stamp, admin || '', action, String(detail || '').slice(0, 900)]]);
  } catch (err) {
    Logger.log('Activity log skipped: ' + err.message); // never block a change over a logging problem
  }
}

// Returns the matching active admin's name, or null. Counts a wrong guess
// toward the brute-force limit.
function findAdminName_(ss, pin) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('adminFails') || 0);
  if (fails >= MAX_ADMIN_PIN_FAILS_) {
    throw new Error('Too many incorrect admin PIN attempts — wait about 10 minutes and try again.');
  }
  const hit = readAdmins_(ss).filter((a) => a.Active === 'TRUE').find((a) => pinsMatch_(a.PIN, pin));
  if (!hit) {
    cache.put('adminFails', String(fails + 1), 600);
    return null;
  }
  return hit.Name;
}
// View-only admins ("guests") can open every admin page but can't save.
// The request's action decides whether it's a save (see handleRequest_).
let REQUEST_IS_WRITE_ = false;
let REQUEST_ACTION_ = '';
const VIEW_ONLY_MSG_ = 'You are signed in as a view-only admin — you can look around, but changes can\'t be saved.';
function adminRole_(ss, name) {
  const a = readAdmins_(ss).find((x) => x.Name === name && x.Active === 'TRUE');
  return a ? a.Role : 'Full';
}
function requireAdmin_(ss, pin) {
  const name = findAdminName_(ss, pin);
  if (!name) throw new Error('Admin PIN missing or incorrect — sign in to the admin page again.');
  if (REQUEST_IS_WRITE_) {
    const role = adminRole_(ss, name);
    if (role === 'View') throw new Error(VIEW_ONLY_MSG_);
    if (isLimitedRole_(role) && !limitedMayDo_(role, REQUEST_ACTION_)) throw new Error(LIMITED_MSG_);
  }
  return name;
}
// Who else is in Admin right now (Tom 2026-10-25). Each open Admin page checks in
// about once a minute (sid = that browser tab, where = the page it is on) and gets
// back the other admins seen in the last 3 minutes, so two admins know not to undo
// each other's changes. An empty where means the tab left Admin. Kept in the script
// cache only; a lost update just drops someone for a minute.
const ADMIN_PRESENCE_SECS_ = 180;
function adminPresence_(ss, pin, sid, where) {
  const name = requireAdmin_(ss, pin);
  const role = adminRole_(ss, name);
  sid = String(sid || '').slice(0, 20);
  const cache = CacheService.getScriptCache();
  let all = {};
  try { all = JSON.parse(cache.get('adminPresence') || '{}') || {}; } catch (e) { all = {}; }
  const now = Date.now();
  Object.keys(all).forEach((k) => { if (!all[k] || now - all[k].at > ADMIN_PRESENCE_SECS_ * 1000) delete all[k]; });
  if (sid) {
    if (where) all[sid] = { name, role, where: String(where).slice(0, 60), at: now };
    else delete all[sid];
  }
  cache.put('adminPresence', JSON.stringify(all), 21600);
  const seen = {}, others = [];
  Object.keys(all).sort((a, b) => all[b].at - all[a].at).forEach((k) => {
    const a = all[k];
    if (k === sid || a.name === name || seen[a.name]) return;
    seen[a.name] = true;
    others.push({ name: a.name, role: a.role, where: a.where });
  });
  return { others };
}
// Used by the admin page's sign-in and by the scoring page's "Admin PIN
// unlocks every match" shortcut. `where` is just a label for the log.
function verifyAdminPin_(ss, pin, where) {
  const name = findAdminName_(ss, pin);
  if (!name) {
    logActivity_(ss, '', 'Wrong admin PIN', where || '');
    throw new Error('Incorrect PIN.');
  }
  logActivity_(ss, name, 'Signed in', where || '');
  return { name: name, role: adminRole_(ss, name) };
}

// The owner admin can't be removed, switched off, renamed or made view-only.
const OWNER_ADMIN_ = 'Admin-Tom';
function isOwnerAdmin_(name) { return String(name || '').trim().toLowerCase() === OWNER_ADMIN_.toLowerCase(); }
// Removing a full-rights admin (deleting, unticking Active or making them view-only)
// needs two admins: the first save only records the request; a different admin
// (not the one being removed) saving the same removal carries it out.
// Requests: { [lower-case name]: { by, at } }, kept for 7 days.
const ADMIN_REMOVAL_DAYS_ = 7;
function readAdminRemovals_() {
  let all = {};
  try { all = JSON.parse(PropertiesService.getScriptProperties().getProperty('ADMIN_REMOVALS') || '{}'); } catch (e) { all = {}; }
  const cutoff = Date.now() - ADMIN_REMOVAL_DAYS_ * 86400000;
  Object.keys(all).forEach((k) => { if (!all[k] || !(all[k].at > cutoff)) delete all[k]; });
  return all;
}
function writeAdminRemovals_(all) { PropertiesService.getScriptProperties().setProperty('ADMIN_REMOVALS', JSON.stringify(all)); }

// Nobody sees another admin's PIN — each admin gets only their own (view-only
// admins not even that). PINs aren't sent to the browser at all. Each row says
// whether a removal is waiting for a second admin (RemovalRequestedBy).
function getAdmins_(ss, viewerName) {
  const viewOnly = adminRole_(ss, viewerName) === 'View';
  const removals = readAdminRemovals_();
  return readAdmins_(ss).map((a) => Object.assign({}, a, {
    PIN: !viewOnly && a.Name === viewerName ? a.PIN : '',
    Owner: isOwnerAdmin_(a.Name) ? 'TRUE' : '',
    RemovalRequestedBy: removals[a.Name.toLowerCase()] ? removals[a.Name.toLowerCase()].by : '',
  }));
}

// admins: [{Name, OrigName?, PIN, Active, Role?, CancelRemoval?}]. A blank PIN keeps
// that admin's current PIN; only the admin themselves (or the owner) can set a new
// PIN for an existing admin. byName is who is saving.
function saveAdmins_(ss, admins, byName) {
  const existing = readAdmins_(ss);
  const exByName = {}; existing.forEach((a) => { exByName[a.Name.toLowerCase()] = a; });
  const removals = readAdminRemovals_();
  const notes = [];
  const used = {};
  let clean = (admins || []).map((a) => {
    const name = String(a.Name || '').trim();
    const orig = exByName[String(a.OrigName || name).trim().toLowerCase()] || null;
    if (orig) used[orig.Name.toLowerCase()] = true;
    let pin = String(a.PIN || '').trim();
    if (orig && !pin) pin = orig.PIN;
    else if (orig && pin !== orig.PIN && !pinsMatch_(pin, orig.PIN) && orig.Name !== byName && !isOwnerAdmin_(byName)) {
      throw new Error('You can only change your own admin PIN — ' + orig.Name + ' has to change theirs.');
    }
    if (orig && a.CancelRemoval) delete removals[orig.Name.toLowerCase()];
    return {
      _orig: orig,
      Name: name,
      PIN: pin,
      Active: isTruthyCell_(a.Active) || a.Active === true ? 'TRUE' : 'FALSE',
      // the tournament admin page doesn't send Role — keep what they had
      Role: a.Role === undefined && orig ? orig.Role : normAdminRole_(a.Role),
    };
  }).filter((a) => a.Name || a.PIN);
  // Admins left out of the list are being deleted.
  existing.filter((a) => !used[a.Name.toLowerCase()]).forEach((a) => clean.push({ _orig: a, _deleted: true, Name: a.Name, PIN: a.PIN, Active: a.Active, Role: a.Role }));
  clean = clean.filter((a) => {
    const o = a._orig;
    if (isOwnerAdmin_(o ? o.Name : '')) {
      if (a._deleted || a.Active !== 'TRUE' || a.Role !== 'Full' || !isOwnerAdmin_(a.Name)) {
        notes.push(OWNER_ADMIN_ + ' can\'t be removed, switched off, renamed or made view-only.');
        a.Name = o.Name; a.Active = 'TRUE'; a.Role = 'Full';
      }
      return true;
    }
    const removing = o && o.Active === 'TRUE' && o.Role === 'Full' && (a._deleted || a.Active !== 'TRUE' || a.Role !== 'Full');
    const key = o ? o.Name.toLowerCase() : '';
    if (!removing) { if (o && o.Active === 'TRUE' && o.Role === 'Full') delete removals[key]; return !a._deleted; }
    const req = removals[key];
    if (req && req.by !== byName && o.Name !== byName) { // second admin agrees
      delete removals[key];
      notes.push('Removed ' + o.Name + ' (requested by ' + req.by + ', agreed by ' + byName + ').');
      return !a._deleted;
    }
    if (!req) removals[key] = { by: byName, at: Date.now() };
    notes.push(req && req.by !== byName ? 'Admins can\'t approve their own removal — ' + o.Name + ' is still an admin.'
      : 'Removing ' + o.Name + ' needs a second admin to agree — they stay an admin until another admin removes them too.');
    a.Name = o.Name; a.PIN = o.PIN; a.Active = o.Active; a.Role = o.Role;
    return true;
  }).map(({ Name, PIN, Active, Role }) => ({ Name, PIN, Active, Role }));
  const seenNames = {};
  const seenPins = {};
  clean.forEach((a) => {
    if (!a.Name) throw new Error('Every admin needs a name.');
    if (!/^\d{4,8}$/.test(a.PIN)) throw new Error(a.Name + ': a PIN must be 4 to 8 digits.');
    const key = a.Name.toLowerCase();
    if (seenNames[key]) throw new Error('Two admins are named "' + a.Name + '" — names must be different.');
    seenNames[key] = true;
    if (a.Active === 'TRUE') {
      if (seenPins[a.PIN]) throw new Error(a.Name + ': that PIN can\'t be used — please choose a different one.');
      seenPins[a.PIN] = true;
    }
  });
  if (!clean.some((a) => a.Active === 'TRUE' && a.Role === 'Full')) throw new Error('At least one admin with full rights must stay active.');
  // An admin PIN may not equal any match's scorekeeper PIN, since the scoring
  // page treats a typed PIN that matches a match as that match's PIN.
  getMatchPins_(ss).forEach((m) => {
    [m.PIN, m.Day1PIN, m.Day2PIN].forEach((mp) => {
      clean.forEach((a) => {
        if (a.Active === 'TRUE' && pinsMatch_(a.PIN, mp)) throw new Error(a.Name + '\'s PIN is the same as a scorekeeper PIN (match ' + m.MatchNum + ') — choose a different one.');
      });
    });
  });
  const sheet = ensureAdminsSheet_(ss);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    objectsToSheet_(sheet, ADMIN_HEADERS, clean);
    writeAdminRemovals_(removals);
  } finally {
    lock.releaseLock();
  }
  if (notes.length) logActivity_(ss, byName, 'Admin removal', notes.join(' '));
  return getAdmins_(ss, byName);
}

function getActivityLog_(ss, limit) {
  const sheet = ss.getSheetByName(SHEETS.ACTIVITY_LOG);
  if (!sheet) return [];
  const rows = sheetToObjects_(sheet, ACTIVITY_HEADERS);
  return rows.slice(-Math.max(1, Math.min(Number(limit) || 300, 1000))).reverse();
}

// ---- describing what an admin changed, for the ActivityLog ----
function shortVal_(v) {
  v = v === undefined || v === null || v === '' ? '(blank)' : String(v);
  return v.length > 40 ? v.slice(0, 37) + '…' : v;
}
function listSome_(items, max) {
  max = max || 6;
  return items.length > max ? items.slice(0, max).join('; ') + '; +' + (items.length - max) + ' more' : items.join('; ');
}
function captureBefore_(ss, action, p) {
  try {
    if (action === 'saveSettings') return getSettings_(ss);
    if (action === 'saveRoster') return sheetToObjects_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS);
    if (action === 'savePairings') return getPairings_(ss, p.day);
    if (action === 'saveMatchPins') return getMatchPins_(ss);
    if (action === 'saveAdmins') return readAdmins_(ss);
  } catch (e) { /* description just falls back to something generic */ }
  return null;
}
// Returns { action, detail } or null when there is nothing worth logging.
function describeAdminAction_(action, p, before, result) {
  const norm = (v) => (v === undefined || v === null ? '' : String(v));
  if (action === 'saveSettings') {
    const patch = JSON.parse(p.settings);
    const changed = Object.keys(patch).filter((k) => k !== 'AdminPIN' && before && norm(before[k]) !== norm(patch[k]))
      .map((k) => k + ': ' + shortVal_(before[k]) + ' → ' + shortVal_(patch[k]));
    return changed.length ? { action: 'Changed settings', detail: listSome_(changed, 8) } : null;
  }
  if (action === 'saveRoster') {
    const nu = JSON.parse(p.roster);
    const old = before || [];
    const byName = {}; old.forEach((r) => { byName[r.Name] = r; });
    const newNames = {}; nu.forEach((r) => { newNames[r.Name] = r; });
    const added = nu.filter((r) => r.Name && !byName[r.Name]).map((r) => r.Name);
    const removed = old.filter((r) => r.Name && !newNames[r.Name]).map((r) => r.Name);
    const changed = [];
    nu.forEach((r) => {
      const o = byName[r.Name]; if (!o) return;
      const diffs = ['Team', 'HandicapIndex', 'Tee', 'Active', 'Scorekeeper'].filter((f) => norm(o[f]).toUpperCase() !== norm(r[f]).toUpperCase())
        .map((f) => f + ' ' + shortVal_(o[f]) + '→' + shortVal_(r[f]));
      if (diffs.length) changed.push(r.Name + ' (' + diffs.join(', ') + ')');
    });
    const parts = [];
    if (added.length) parts.push('Added: ' + listSome_(added));
    if (removed.length) parts.push('Removed: ' + listSome_(removed));
    if (changed.length) parts.push('Changed: ' + listSome_(changed));
    return parts.length ? { action: 'Saved roster', detail: parts.join(' | ') } : null;
  }
  if (action === 'savePairings') {
    const nu = JSON.parse(p.pairings);
    const byNum = {}; (before || []).forEach((r) => { byNum[String(r.MatchNum)] = r; });
    const fields = Object.keys(nu[0] || {}).filter((f) => f !== 'MatchNum');
    const changed = nu.filter((r) => { const o = byNum[String(r.MatchNum)]; return !o || fields.some((f) => norm(o[f]).toUpperCase() !== norm(r[f]).toUpperCase()); }).map((r) => r.MatchNum);
    return changed.length ? { action: 'Saved Day ' + p.day + ' pairings', detail: 'Matches changed: ' + changed.join(', ') } : null;
  }
  if (action === 'saveMatchPins') {
    const nu = JSON.parse(p.matchPins);
    const byNum = {}; (before || []).forEach((r) => { byNum[String(r.MatchNum)] = r; });
    const changed = nu.filter((r) => { const o = byNum[String(r.MatchNum)]; return !o || ['PIN', 'Day1PIN', 'Day2PIN'].some((f) => norm(o[f]) !== norm(r[f])); }).map((r) => r.MatchNum);
    return changed.length ? { action: 'Changed scorekeeper PINs', detail: 'Matches: ' + changed.join(', ') + ' (PIN values are not logged)' } : null;
  }
  if (action === 'saveHoleHandicaps' || action === 'saveHoleHandicapsRed') return { action: 'Edited hole handicaps', detail: '' };
  if (action === 'startNewSeason') return { action: 'Started new season', detail: 'Archived as ' + norm(result && result.archived) };
  if (action === 'replacePlayerDay2') return { action: 'Replaced a player on Day 2', detail: norm(result && result.outgoing) + ' → ' + norm(result && result.incoming) + (result && result.matchesUpdated && result.matchesUpdated.length ? ' (match ' + result.matchesUpdated.join(', ') + ')' : '') };
  if (action === 'saveMembers') {
    const list = JSON.parse(p.members) || [];
    const removed = list.filter((m) => m.Remove && m.PlayerID !== undefined && m.PlayerID !== '').map((m) => norm(m.Name));
    const n = list.length - removed.length;
    return { action: 'Saved Legends members', detail: n + ' member row' + (n === 1 ? '' : 's') + ' saved (emails/phones/GHIN not logged)' + (removed.length ? ' | Removed: ' + listSome_(removed, 8) : '') };
  }
  if (action === 'saveHandicaps') {
    const n = (JSON.parse(p.players) || []).length;
    return { action: 'Saved handicaps', detail: n + ' player' + (n === 1 ? '' : 's') + ', effective ' + norm(p.asOf) };
  }
  if (action === 'resetMemberPin') return { action: 'Reset a member PIN', detail: norm(result && result.name) };
  if (action === 'backupNow') return { action: 'Manual backup', detail: norm(result && result.label) };
  if (action === 'saveAdmins') {
    const old = {}; (before || []).forEach((a) => { old[a.Name.toLowerCase()] = a; });
    const nu = {}; (result || []).forEach((a) => { nu[a.Name.toLowerCase()] = a; });
    const parts = [];
    const added = (result || []).filter((a) => !old[a.Name.toLowerCase()]).map((a) => a.Name);
    const removed = (before || []).filter((a) => !nu[a.Name.toLowerCase()]).map((a) => a.Name);
    // result has other admins' PINs blanked, so look at what was sent instead
    const pinChanged = (JSON.parse(p.admins) || []).filter((a) => { const o = old[String(a.OrigName || a.Name || '').trim().toLowerCase()]; return o && String(a.PIN || '').trim() && !pinsMatch_(o.PIN, a.PIN); }).map((a) => String(a.Name).trim());
    const toggled = (result || []).filter((a) => old[a.Name.toLowerCase()] && old[a.Name.toLowerCase()].Active !== a.Active).map((a) => a.Name + (a.Active === 'TRUE' ? ' (reactivated)' : ' (deactivated)'));
    if (added.length) parts.push('Added: ' + added.join(', '));
    if (removed.length) parts.push('Removed: ' + removed.join(', '));
    if (pinChanged.length) parts.push('PIN changed: ' + pinChanged.join(', '));
    if (toggled.length) parts.push(toggled.join(', '));
    return parts.length ? { action: 'Changed admin users', detail: parts.join(' | ') } : null;
  }
  return null;
}

// ---------- Day 2 player substitution ----------
//
// Handles the "a player had to drop before Day 2" case in one step: marks
// the outgoing player "Not participating" (stored as NOT_PLAYING) on the Roster, adds the incoming
// player to the Roster if they're not already on it (or just updates their
// Team if they are — e.g. someone already marked Not participating earlier),
// and swaps the outgoing player's name for the incoming one everywhere it
// appears on the Day 2 Pairings sheet (both the Best Ball slots and whichever
// Individual Match Play slot they're in). Day 1 Pairings and all of Day 1's
// locked scores are untouched — this only ever affects Day 2.
//
// Match PINs need no changes at all: they're keyed by MatchNum, not by
// player name, so whichever PIN already unlocked that match keeps working
// for the substitute automatically.
//
// `incoming` is { Name, HandicapIndex?, Tee? } — HandicapIndex/Tee are only
// used if this is a brand-new player not already on the Roster.
function replacePlayerDay2_(ss, outgoingName, incoming) {
  if (!outgoingName) throw new Error('No outgoing player specified.');
  if (!incoming || !incoming.Name) throw new Error('No incoming player specified.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rosterSheet = ss.getSheetByName(SHEETS.ROSTER);
    const roster = sheetToObjects_(rosterSheet, ROSTER_HEADERS);
    const outgoing = roster.find((p) => p.Name === outgoingName);
    if (!outgoing) throw new Error('Player not found on roster: ' + outgoingName);
    const originalTeam = outgoing.Team;
    outgoing.Team = 'NOT_PLAYING'; // the value the Roster dropdown uses for "Not participating"

    let incomingPlayer = roster.find((p) => p.Name === incoming.Name);
    if (incomingPlayer) {
      incomingPlayer.Team = originalTeam;
      incomingPlayer.Active = 'TRUE';
      if (incoming.HandicapIndex !== undefined && incoming.HandicapIndex !== '') {
        incomingPlayer.HandicapIndex = incoming.HandicapIndex;
      }
      if (incoming.Tee) incomingPlayer.Tee = incoming.Tee;
    } else {
      const nextId = rosterNextId_(roster);
      incomingPlayer = {
        PlayerID: nextId,
        Name: incoming.Name,
        Team: originalTeam,
        HandicapIndex: incoming.HandicapIndex || '',
        Tee: incoming.Tee || '',
        Active: 'TRUE',
        Scorekeeper: 'FALSE',
      };
      roster.push(incomingPlayer);
    }
    objectsToSheet_(rosterSheet, ROSTER_HEADERS, roster);

    const p2Sheet = ss.getSheetByName(SHEETS.PAIRINGS_DAY2);
    const pairings = sheetToObjects_(p2Sheet, PAIRINGS_DAY2_HEADERS);
    const nameFields = ['TeamA_P1', 'TeamA_P2', 'TeamB_P1', 'TeamB_P2', 'MP1_TeamA', 'MP1_TeamB', 'MP2_TeamA', 'MP2_TeamB'];
    const matchesUpdated = [];
    pairings.forEach((row) => {
      let touched = false;
      nameFields.forEach((f) => {
        if (row[f] === outgoingName) {
          row[f] = incoming.Name;
          touched = true;
        }
      });
      if (touched) matchesUpdated.push(row.MatchNum);
    });
    objectsToSheet_(p2Sheet, PAIRINGS_DAY2_HEADERS, pairings);

    return {
      outgoing: outgoingName,
      incoming: incoming.Name,
      team: originalTeam,
      matchesUpdated: matchesUpdated,
    };
  } finally {
    lock.releaseLock();
  }
}

// ---------- Viewing past tournament years ----------
//
// Reads back whatever startNewSeason_ archived (see below) without touching
// current data. The public Scoreboard's year picker calls listArchivedSeasons
// to get the dropdown options, then getArchivedSeason for whichever year
// someone selects — both strictly read-only.

function sheetToObjectsSafe_(sheet, headers) {
  return sheet ? sheetToObjects_(sheet, headers) : [];
}

function listArchivedSeasons_(ss) {
  const prefix = 'Archive_';
  const suffix = '_' + SHEETS.SETTINGS;
  const labels = {};
  ss.getSheets().forEach((sh) => {
    const name = sh.getName();
    if (name.indexOf(prefix) === 0 && name.lastIndexOf(suffix) === name.length - suffix.length) {
      labels[name.slice(prefix.length, name.length - suffix.length)] = true;
    }
  });
  // Newest-looking label first — works well for plain year labels like
  // "2025"/"2026"; any other label still sorts predictably, just not
  // necessarily chronologically.
  return Object.keys(labels).sort().reverse();
}

function getArchivedSeasonData_(ss, label) {
  if (!label) throw new Error('No season label specified.');
  const named = (name) => ss.getSheetByName('Archive_' + label + '_' + name);
  const settingsSheet = named(SHEETS.SETTINGS);
  if (!settingsSheet) throw new Error('No archived season found for: ' + label);
  const settingsValues = settingsSheet.getRange(2, 1, Math.max(settingsSheet.getLastRow() - 1, 0), 2).getValues();
  const settings = {};
  settingsValues.forEach(([k, v]) => {
    settings[k] = (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd') : v;
  });
  delete settings.AdminPIN;
  return {
    label: label,
    settings: settings,
    roster: publicRoster_(sheetToObjectsSafe_(named(SHEETS.ROSTER), ROSTER_HEADERS)),
    pairings1: sheetToObjectsSafe_(named(SHEETS.PAIRINGS_DAY1), PAIRINGS_DAY1_HEADERS),
    pairings2: sheetToObjectsSafe_(named(SHEETS.PAIRINGS_DAY2), PAIRINGS_DAY2_HEADERS),
    scores1: sheetToObjectsSafe_(named(SHEETS.SCORES_DAY1), SCORES_DAY1_HEADERS),
    scores2: sheetToObjectsSafe_(named(SHEETS.SCORES_DAY2), SCORES_DAY2_HEADERS),
    matchPins: sheetToObjectsSafe_(named(SHEETS.MATCH_PINS), MATCH_PIN_HEADERS),
  };
}

// ---------- Start New Season ----------
//
// Archives the current season's data into dated "Archive_<label>_<Sheet>"
// tabs (raw copies, viewable/exportable straight from the Google Sheet UI),
// then resets everything that's specific to one year's tournament: every
// player's Team assignment goes back to unassigned, both Pairings sheets go
// back to 9 blank template rows, both Scores sheets are cleared out
// entirely, and Settings' year-specific fields (dates, team names/captains)
// reset to their defaults. TournamentName, the full Roster (names/handicaps/
// tees), and HoleHandicaps (the course's Stroke Index table) are untouched,
// since those normally carry over year to year unchanged.

function archiveSheet_(ss, sourceName, label) {
  const source = ss.getSheetByName(sourceName);
  if (!source) return;
  const copy = source.copyTo(ss);
  let newName = 'Archive_' + label + '_' + sourceName;
  // avoid colliding with an existing archive tab of the same name
  let suffix = 2;
  let finalName = newName;
  while (ss.getSheetByName(finalName)) {
    finalName = newName + '_' + suffix;
    suffix++;
  }
  copy.setName(finalName);
  copy.hideSheet();
}

function startNewSeason_(ss, archiveLabel) {
  const label = (archiveLabel || new Date().getFullYear().toString()).toString().replace(/[^A-Za-z0-9_-]/g, '');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // 1. Archive current data as raw copies.
    [
      SHEETS.SETTINGS,
      SHEETS.ROSTER,
      SHEETS.PAIRINGS_DAY1,
      SHEETS.PAIRINGS_DAY2,
      SHEETS.SCORES_DAY1,
      SHEETS.SCORES_DAY2,
      SHEETS.MATCH_PINS,
      SHEETS.SCORE_LOG,
    ].forEach((name) => archiveSheet_(ss, name, label));
    const logSheet = ss.getSheetByName(SHEETS.SCORE_LOG);
    if (logSheet) objectsToSheet_(logSheet, SCORE_LOG_HEADERS, []); // fresh change log for the new season

    // 2. Reset Roster team assignments to unassigned (keep names/handicaps/tees).
    const rosterSheet = ss.getSheetByName(SHEETS.ROSTER);
    const roster = sheetToObjects_(rosterSheet, ROSTER_HEADERS);
    roster.forEach((p) => (p.Team = ''));
    objectsToSheet_(rosterSheet, ROSTER_HEADERS, roster);

    // 3. Reset both Pairings sheets back to 9 blank template rows.
    const p1Sheet = ss.getSheetByName(SHEETS.PAIRINGS_DAY1);
    const p1Blank = [];
    for (let m = 1; m <= 9; m++) {
      p1Blank.push({ MatchNum: m, TeamA_P1: '', TeamA_P2: '', TeamB_P1: '', TeamB_P2: '', StartHole: '' });
    }
    objectsToSheet_(p1Sheet, PAIRINGS_DAY1_HEADERS, p1Blank);

    const p2Sheet = ss.getSheetByName(SHEETS.PAIRINGS_DAY2);
    const p2Blank = [];
    for (let m = 1; m <= 9; m++) {
      p2Blank.push({
        MatchNum: m, TeamA_P1: '', TeamA_P2: '', TeamB_P1: '', TeamB_P2: '',
        MP1_TeamA: '', MP1_TeamB: '', MP2_TeamA: '', MP2_TeamB: '', MPSwapped: false,
      });
    }
    objectsToSheet_(p2Sheet, PAIRINGS_DAY2_HEADERS, p2Blank);

    // 4. Clear both Scores sheets entirely.
    objectsToSheet_(ss.getSheetByName(SHEETS.SCORES_DAY1), SCORES_DAY1_HEADERS, []);
    objectsToSheet_(ss.getSheetByName(SHEETS.SCORES_DAY2), SCORES_DAY2_HEADERS, []);

    // 4b. Reset Scorekeeper PINs to 9 blank rows for the new season.
    const pinsSheet = ss.getSheetByName(SHEETS.MATCH_PINS);
    const pinsBlank = [];
    for (let m = 1; m <= 9; m++) {
      pinsBlank.push({ MatchNum: m, PIN: '' });
    }
    objectsToSheet_(pinsSheet, MATCH_PIN_HEADERS, pinsBlank);

    // 5. Reset year-specific Settings fields; leave TournamentName as-is.
    const settingsSheet = ss.getSheetByName(SHEETS.SETTINGS);
    const currentSettings = getSettings_(ss);
    const resetSettings = Object.assign({}, currentSettings, {
      Day1Date: '',
      Day2Date: '',
      TeamAName: 'Team A',
      TeamACaptain: 'TBD',
      TeamAColor: '#ADD8E6',
      TeamBName: 'Team B',
      TeamBCaptain: 'TBD',
      TeamBColor: '#F08080',
      Day1Locked: 'FALSE',
      Day2Locked: 'FALSE',
      SuspendScorePins: 'FALSE',
    });
    const values = settingsSheet.getRange(2, 1, settingsSheet.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < values.length; i++) {
      const key = values[i][0];
      if (Object.prototype.hasOwnProperty.call(resetSettings, key)) {
        settingsSheet.getRange(i + 2, 2).setValue(resetSettings[key]);
      }
    }
  } finally {
    lock.releaseLock();
  }
  return { archived: label };
}

// ---------- Legends members: email-then-PIN sign-in ----------
//
// Every Legend on the Roster who has an Email can sign in to the sign-up app
// (index.html): they type their email, then their 4-digit PIN (or choose one
// the first time). PINs live in the MemberPins tab (PlayerID | PIN) and are
// checked here on the server — never sent to a browser. A successful sign-in
// returns a token the browser keeps; it is signed with a server-only secret
// and tied to the member's current PIN, so an admin resetting someone's PIN
// (or the member changing it) signs that person out everywhere.

const MEMBER_PIN_HEADERS = ['PlayerID', 'PIN'];
const MAX_MEMBER_PIN_FAILS_PER_EMAIL_ = 8;   // per 10 minutes
const MAX_MEMBER_PIN_FAILS_TOTAL_ = 60;      // per 10 minutes, everyone

function normEmail_(e) { return String(e == null ? '' : e).trim().toLowerCase(); }
function isValidEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim()); }
function memberIsActive_(r) {
  const v = r.Active;
  return !(v === false || v === 'FALSE' || v === 'false') && !memberIsDeceased_(r);
}
function memberIsDeceased_(r) {
  const v = r.Deceased;
  return v === true || String(v).toUpperCase() === 'TRUE';
}
// Next free PlayerID. Also remembers the highest ID ever handed out, so a removed
// member's ID is never given to someone new (their old sign-ups and PIN stay theirs).
function rosterNextId_(roster) {
  let max = parseInt(PropertiesService.getScriptProperties().getProperty('ROSTER_MAX_ID'), 10) || 0;
  (roster || []).forEach((r) => { const n = parseInt(r.PlayerID, 10); if (!isNaN(n) && n > max) max = n; });
  return max + 1;
}
function rememberRosterMaxId_(roster) {
  const top = rosterNextId_(roster) - 1;
  if (top > 0) PropertiesService.getScriptProperties().setProperty('ROSTER_MAX_ID', String(top));
}

function ensureMemberPinsSheet_(ss) {
  let sheet = ss.getSheetByName(SHEETS.MEMBER_PINS);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEETS.MEMBER_PINS);
  sheet.appendRow(MEMBER_PIN_HEADERS);
  sheet.getRange(1, 1, sheet.getMaxRows(), MEMBER_PIN_HEADERS.length).setNumberFormat('@');
  return sheet;
}
function readMemberPins_(ss) {
  const map = {};
  sheetToObjects_(ensureMemberPinsSheet_(ss), MEMBER_PIN_HEADERS).forEach((r) => {
    const id = String(r.PlayerID).trim();
    const pin = String(r.PIN == null ? '' : r.PIN).trim();
    if (id && pin) map[id] = pin;
  });
  return map;
}
// pin '' removes that member's PIN. Caller should hold the script lock.
function writeMemberPin_(ss, playerId, pin) {
  const map = readMemberPins_(ss);
  if (pin) map[String(playerId)] = String(pin); else delete map[String(playerId)];
  const rows = Object.keys(map).map((id) => ({ PlayerID: id, PIN: map[id] }));
  objectsToSheet_(ensureMemberPinsSheet_(ss), MEMBER_PIN_HEADERS, rows);
}

function readRosterFull_(ss) {
  return sheetToObjects_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS);
}
function membersByEmail_(ss, email) {
  const e = normEmail_(email);
  if (!e) return [];
  return readRosterFull_(ss).filter((r) => normEmail_(r.Email) === e && memberIsActive_(r));
}
function memberPublic_(r) {
  return { PlayerID: r.PlayerID, Name: r.Name, Email: String(r.Email || '').trim() };
}

function tokenSecret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('MEMBER_TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('MEMBER_TOKEN_SECRET', s);
  }
  return s;
}
function memberToken_(playerId, pin) {
  const sig = Utilities.computeHmacSha256Signature(String(playerId) + ':' + String(pin), tokenSecret_());
  return String(playerId) + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}
// Returns the signed-in member's full Roster row, or null if the token is
// missing, forged, out of date (PIN changed/reset) or the member is inactive.
// Future sign-up actions call this to know who is making a change.
function memberFromToken_(ss, token) {
  const t = String(token || '');
  const dot = t.indexOf('.');
  if (dot < 1) return null;
  const id = t.slice(0, dot);
  const pin = readMemberPins_(ss)[id];
  if (!pin || memberToken_(id, pin) !== t) return null;
  const row = readRosterFull_(ss).find((r) => String(r.PlayerID) === id);
  return row && memberIsActive_(row) && String(row.Email || '').trim() ? row : null;
}
function requireMember_(ss, token) {
  const m = memberFromToken_(ss, token);
  if (!m) throw new Error('SIGNED_OUT: Please sign in again.');
  return m;
}

function checkMemberFailLimit_(email) {
  const cache = CacheService.getScriptCache();
  const per = Number(cache.get('mf_' + normEmail_(email)) || 0);
  const total = Number(cache.get('mf_total') || 0);
  if (per >= MAX_MEMBER_PIN_FAILS_PER_EMAIL_ || total >= MAX_MEMBER_PIN_FAILS_TOTAL_) {
    throw new Error('Too many incorrect PIN attempts — wait about 10 minutes and try again.');
  }
}
function countMemberFail_(email) {
  const cache = CacheService.getScriptCache();
  const k = 'mf_' + normEmail_(email);
  cache.put(k, String(Number(cache.get(k) || 0) + 1), 600);
  cache.put('mf_total', String(Number(cache.get('mf_total') || 0) + 1), 600);
}

// Step 1 of sign-in: is this email on file, and does that person already
// have a PIN? (needsPin: true means "choose a PIN" instead of "enter PIN".)
function memberCheckEmail_(ss, email) {
  if (!isValidEmail_(email)) throw new Error('Enter your full email address.');
  const matches = membersByEmail_(ss, email);
  if (!matches.length) return { found: false };
  const pins = readMemberPins_(ss);
  const anyPin = matches.some((m) => pins[String(m.PlayerID)]);
  if (!anyPin && matches.length > 1) {
    throw new Error('More than one Legend is listed with that email. Ask the admin to sort it out.');
  }
  return { found: true, needsPin: !anyPin, pinReset: laOn_(laSettings_(ss), 'PinResetEmailOn') && matches.length === 1 };
}

function memberLogin_(ss, email, pin) {
  checkMemberFailLimit_(email);
  const entered = String(pin == null ? '' : pin).trim();
  const matches = membersByEmail_(ss, email);
  const pins = readMemberPins_(ss);
  const hit = matches.find((m) => pins[String(m.PlayerID)] && pinsMatch_(pins[String(m.PlayerID)], entered));
  if (!hit) {
    countMemberFail_(email);
    throw new Error("That PIN doesn't match.");
  }
  logActivity_(ss, hit.Name, 'Member signed in', '');
  return { token: memberToken_(hit.PlayerID, pins[String(hit.PlayerID)]), member: memberPublic_(hit) };
}

// First-time sign-in: choose a PIN. Only allowed while that member has no
// PIN at all — once one is set, changing it needs the old one (memberChangePin)
// or an admin reset.
function memberSetPin_(ss, email, newPin) {
  const pin = String(newPin == null ? '' : newPin).trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Enter exactly 4 numbers, like 1234.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const matches = membersByEmail_(ss, email);
    if (!matches.length) throw new Error("We don't have that email on file.");
    if (matches.length > 1) throw new Error('More than one Legend is listed with that email. Ask the admin to sort it out.');
    const m = matches[0];
    if (readMemberPins_(ss)[String(m.PlayerID)]) throw new Error('A PIN is already set for this email — enter it instead.');
    writeMemberPin_(ss, m.PlayerID, pin);
    logActivity_(ss, m.Name, 'Member set first PIN', '');
    return { token: memberToken_(m.PlayerID, pin), member: memberPublic_(m) };
  } finally {
    lock.releaseLock();
  }
}

function memberMe_(ss, token) {
  return { member: memberPublic_(requireMember_(ss, token)) };
}

function memberChangePin_(ss, token, newPin) {
  const pin = String(newPin == null ? '' : newPin).trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Enter exactly 4 numbers, like 1234.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const m = requireMember_(ss, token);
    writeMemberPin_(ss, m.PlayerID, pin);
    logActivity_(ss, m.Name, 'Member changed PIN', '');
    return { token: memberToken_(m.PlayerID, pin), member: memberPublic_(m) };
  } finally {
    lock.releaseLock();
  }
}

// ---- "Forgot your PIN?" without an admin (Tom 2026-11-20) ----
// A 6-digit code is emailed to the address on file; it works for 15 minutes and 5 tries,
// then the member chooses a new PIN. Only when the PinResetEmailOn switch is On. At most
// one code a minute per email and 30 an hour in all, so nobody can flood a mailbox.
const PIN_RESET_MINUTES_ = 15;
function memberPinResetRequest_(ss, email) {
  if (!isValidEmail_(email)) throw new Error('Enter your full email address.');
  if (!laOn_(laSettings_(ss), 'PinResetEmailOn')) throw new Error('Ask the admin to reset your PIN.');
  const e = normEmail_(email);
  const cache = CacheService.getScriptCache();
  if (cache.get('pr_wait_' + e)) throw new Error('A code was just sent. Check your email (and the spam folder), or wait a minute and ask again.');
  const total = Number(cache.get('pr_total') || 0);
  if (total >= 30) throw new Error('Too many reset requests right now. Try again in an hour, or ask the admin.');
  const matches = membersByEmail_(ss, email);
  if (!matches.length) throw new Error("We don't have that email on file.");
  if (matches.length > 1) throw new Error('More than one Legend is listed with that email. Ask the admin to reset your PIN.');
  const m = matches[0];
  const code = String(100000 + Math.floor(Math.random() * 900000));
  cache.put('pr_' + e, JSON.stringify({ id: String(m.PlayerID), code: code, tries: 0, exp: Date.now() + PIN_RESET_MINUTES_ * 60000 }), PIN_RESET_MINUTES_ * 60);
  cache.put('pr_wait_' + e, '1', 60);
  cache.put('pr_total', String(total + 1), 3600);
  const first = String(m.Name || '').indexOf(',') !== -1 ? String(m.Name).split(',')[1].trim().split(' ')[0] : String(m.Name || '').split(' ')[0];
  laSendEmail_({ to: String(m.Email || email).trim(), subject: 'Your SUN PIN reset code: ' + code,
    body: 'Hi ' + first + ',\n\nYour code to reset your SUN (SignUp Now) PIN is:\n\n    ' + code + '\n\n' +
      'Enter it on the sign-in page within ' + PIN_RESET_MINUTES_ + ' minutes, then choose a new 4-digit PIN.\n\n' +
      'If you did not ask for this, you can ignore this email. Your PIN has not changed.\n\nHeritage Legends Golf' });
  logActivity_(ss, m.Name, 'Asked for a PIN reset code', '');
  return { sent: true, minutes: PIN_RESET_MINUTES_ };
}
function memberPinResetConfirm_(ss, email, code, newPin) {
  const pin = String(newPin == null ? '' : newPin).trim();
  if (!/^\d{4}$/.test(pin)) throw new Error('Enter exactly 4 numbers, like 1234.');
  const e = normEmail_(email);
  const cache = CacheService.getScriptCache();
  const raw = cache.get('pr_' + e);
  let o = null;
  try { o = raw ? JSON.parse(raw) : null; } catch (x) { o = null; }
  if (!o || Date.now() > o.exp) throw new Error('That code has expired. Click "Send me a new code".');
  if (String(code == null ? '' : code).replace(/\s/g, '') !== o.code) {
    o.tries = (o.tries || 0) + 1;
    if (o.tries >= 5) { cache.remove('pr_' + e); throw new Error('Too many wrong codes. Click "Send me a new code".'); }
    cache.put('pr_' + e, JSON.stringify(o), Math.max(1, Math.ceil((o.exp - Date.now()) / 1000)));
    throw new Error("That code doesn't match. Check the email and try again.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const m = membersByEmail_(ss, email).find((r) => String(r.PlayerID) === o.id);
    if (!m) throw new Error('Ask the admin to reset your PIN.');
    writeMemberPin_(ss, m.PlayerID, pin);
    cache.remove('pr_' + e);
    logActivity_(ss, m.Name, 'Member reset PIN with an emailed code', '');
    return { token: memberToken_(m.PlayerID, pin), member: memberPublic_(m) };
  } finally {
    lock.releaseLock();
  }
}

// ---- admin side: member contacts and PIN resets ----

// A member's own email and phone numbers (only ever returned to that member).
// The Roster tab: every active Legend's email, phones and emergency contact, for any
// signed-in member (or an admin signed in with their PIN only). A-Z by last name.
function memberRoster_(ss, token, adminPin) {
  if (!memberFromToken_(ss, token) && !(adminPin && findAdminName_(ss, adminPin))) throw new Error('SIGNED_OUT: Please sign in again.');
  return readRosterFull_(ss).filter((r) => String(r.Name || '').trim() && memberIsActive_(r)).map((r) => ({
    Name: r.Name,
    Email: String(r.Email || '').trim(),
    HomePhone: phonesOf_(r).home,
    MobilePhone: phonesOf_(r).mobile,
    EmergencyContact: String(r.EmergencyContact || '').trim(),
  })).sort((a, b) => String(a.Name).localeCompare(String(b.Name), 'en', { sensitivity: 'base' }));
}
function memberGetContact_(ss, token) {
  const m = requireMember_(ss, token);
  const r = readRosterFull_(ss).find((x) => String(x.PlayerID) === String(m.PlayerID)) || {};
  const pref = (readHandicaps_(ss)[String(m.PlayerID)] || {}).Tee || '';
  return { Email: String(r.Email || '').trim(), HomePhone: phonesOf_(r).home, MobilePhone: phonesOf_(r).mobile, EmergencyContact: String(r.EmergencyContact || '').trim(),
    PlayGroup: String(r.PlayGroup || '').trim(), PreferredTee: pref, UsualTee: signupTees_(ss)[String(m.PlayerID)] || '' };
}
// Members keep their own contact details up to date. The email is also how
// they sign in, so it must be valid and not used by another active member.
// Their PIN and sign-in stay the same.
function memberSaveContact_(ss, token, email, home, mobile, emergency, preferredTee, playGroup) {
  email = String(email || '').trim();
  const groupChanges = [];
  if (!isValidEmail_(email)) throw new Error('Enter a valid email address — it is also how you sign in.');
  const clean = (s) => String(s || '').trim().slice(0, 60);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let me;
  try {
    me = requireMember_(ss, token);
    const roster = readRosterFull_(ss);
    const row = roster.find((x) => String(x.PlayerID) === String(me.PlayerID));
    if (!row) throw new Error('SIGNED_OUT: Please sign in again.');
    const clash = roster.find((x) => String(x.PlayerID) !== String(me.PlayerID) && memberIsActive_(x) && normEmail_(x.Email) === normEmail_(email));
    if (clash) throw new Error('That email is already used by another Legend. Please use a different one or ask an admin.');
    const sig = (r, home, mobile) => [r.Email, home, mobile, String(r.EmergencyContact || '').trim(), String(r.PlayGroup || '').trim()].join('|');
    const before = sig(row, phonesOf_(row).home, phonesOf_(row).mobile);
    row.Email = email; row.Phone = ''; row.HomePhone = clean(home); row.MobilePhone = clean(mobile);
    // only when the page sent it, so an older cached page can't blank it
    if (emergency !== undefined) row.EmergencyContact = String(emergency || '').trim().slice(0, 200);
    if (playGroup !== undefined) {
      const g = String(playGroup || '').trim().toLowerCase();
      if (g && PLAY_GROUPS_.indexOf(g) === -1) throw new Error('Choose Fun Group, Nassau Group or Both.');
      if (g !== String(row.PlayGroup || '').trim()) groupChanges.push({ name: row.Name, email: email, from: String(row.PlayGroup || '').trim(), to: g, by: '' });
      row.PlayGroup = g;
    }
    if (before !== sig(row, row.HomePhone, row.MobilePhone)) {
      objectsToSheet_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS, roster);
      logActivity_(ss, me.Name, 'Updated own contact details', '');
    }
    // Preferred tee (kept with their handicap; '' = not chosen). Only when the page sent it.
    if (preferredTee !== undefined) {
      const tee = String(preferredTee || '').trim();
      if (tee && HCP_TEES_.indexOf(tee) === -1) throw new Error('Choose a tee from the list.');
      const hc = readHandicaps_(ss), id = String(me.PlayerID), cur = hc[id] || { HandicapIndex: '', Tee: '', ExtraStrokes: '' };
      if (cur.Tee !== tee) {
        hc[id] = Object.assign({}, cur, { Tee: tee });
        objectsToSheet_(ensureHandicapsSheet_(ss), HANDICAP_HEADERS, Object.keys(hc).map((k) => Object.assign({ PlayerID: k }, hc[k])));
        logActivity_(ss, me.Name, 'Changed own preferred tee', tee || '(none)');
      }
    }
  } finally {
    lock.releaseLock();
  }
  notifyPlayGroupChanges_(ss, groupChanges);
  return Object.assign({ member: Object.assign(memberPublic_(me), { Email: email }) }, memberGetContact_(ss, token));
}

// ---------- Handicaps ----------
// Each active Legend's Handicap Index (from GHIN, uploaded weekly on Admin > Info >
// Handicaps) and preferred tee, kept in the Handicaps tab by PlayerID. The GHIN #
// itself stays on the Roster (private). This is separate from the tournament's
// Roster HandicapIndex/Tee, which are never touched here. HANDICAPS_AS_OF (a script
// property) is the date the indexes took effect. Course handicaps are worked out in
// the page from the tee ratings (see HCP_TEES in index.html).
// ExtraStrokes: strokes an admin adds on top of the course handicap in Nassau pairings
// (e.g. a player back from a medical layoff); set on Admin > Pairings > Nassau.
const HANDICAP_HEADERS = ['PlayerID', 'HandicapIndex', 'Tee', 'ExtraStrokes'];
const HCP_TEES_ = ['Red', 'Gold/Red', 'Gold', 'White/Gold', 'White', 'Blue/White', 'Blue'];
// [rating, slope, par] per tee — the same numbers as HCP_TEES in index.html.
const HCP_RATINGS_ = { 'Red': [64.1, 111, 72], 'Gold/Red': [65.8, 114, 72], 'Gold': [67.1, 120, 72], 'White/Gold': [68.3, 124, 72], 'White': [69.4, 126, 72], 'Blue/White': [70.4, 127, 72], 'Blue': [71.4, 129, 72] };
// "+1.2" -> -1.2, "14.3" -> 14.3, '' -> null.
function hcpIndexNum_(hi) { const t = cleanHcpIndex_(hi); return t ? (t[0] === '+' ? -Number(t.slice(1)) : Number(t)) : null; }
// ROUND(Index x Slope / 113 + (Rating - Par)), halves away from zero (as Excel). null if unknown.
function courseHandicap_(hi, tee) {
  const n = hcpIndexNum_(hi), r = HCP_RATINGS_[tee];
  if (n === null || !r) return null;
  const v = n * r[1] / 113 + (r[0] - r[2]);
  return (v < 0 ? -1 : 1) * Math.round(Math.abs(v));
}
function ensureHandicapsSheet_(ss) {
  let sheet = ss.getSheetByName(SHEETS.HANDICAPS);
  if (sheet) return sheet;
  sheet = ss.insertSheet(SHEETS.HANDICAPS);
  sheet.appendRow(HANDICAP_HEADERS);
  return sheet;
}
function readHandicaps_(ss) {
  const map = {};
  sheetToObjects_(ensureHandicapsSheet_(ss), HANDICAP_HEADERS).forEach((r) => {
    const id = String(r.PlayerID).trim();
    if (id) map[id] = { HandicapIndex: String(r.HandicapIndex == null ? '' : r.HandicapIndex).trim(), Tee: String(r.Tee || '').trim(), ExtraStrokes: String(r.ExtraStrokes == null ? '' : r.ExtraStrokes).trim() };
  });
  return map;
}
// The tee each player has signed up with most (ties go to the latest), from every sign-up on file.
function signupTees_(ss) {
  const counts = {};
  if (typeof laRead_ !== 'function') return {};
  laRead_(ss, LA.SIGNUPS).forEach((s) => {
    const id = String(s.PlayerID).trim(), tee = String(s.Tee || '').trim();
    if (!id || HCP_TEES_.indexOf(tee) === -1) return;
    const c = counts[id] = counts[id] || {};
    c[tee] = { n: ((c[tee] && c[tee].n) || 0) + 1, last: String(s.DateKey) };
  });
  const out = {};
  Object.keys(counts).forEach((id) => {
    out[id] = Object.keys(counts[id]).sort((a, b) => (counts[id][b].n - counts[id][a].n) || (counts[id][b].last < counts[id][a].last ? -1 : 1))[0];
  });
  return out;
}
// "+1.2" (a plus handicap), "14.3", "8" -> tidy text; null when it isn't an index.
function cleanHcpIndex_(v) {
  const t = String(v == null ? '' : v).trim().replace(/^\+\s*/, '+');
  if (!t) return '';
  if (!/^\+?\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  return (t[0] === '+' ? '+' : '') + Number(t.replace('+', '')).toFixed(1);
}
// Finds the roster row for a GHIN-file line: by GHIN # first, then by last name
// (and first name / nickname when two Legends share a last name).
const HCP_NICKS_ = { charles: 'chuck', william: 'bill', robert: 'bob', james: 'jim', richard: 'dick', thomas: 'tom', david: 'dave', daniel: 'dan', jeffrey: 'jeff', gregory: 'greg', stephen: 'steve', steven: 'steve', michael: 'mike', lewis: 'lou', joseph: 'joe', edward: 'ed', kenneth: 'ken', ronald: 'ron', donald: 'don', lawrence: 'larry', gerald: 'jerry', peter: 'pete', albert: 'al', alan: 'al', allan: 'al', anthony: 'tony', frederick: 'fred', walter: 'walt', stanley: 'stan', kevin: 'kev' };
function hcpFindMember_(roster, ghin, name) {
  const live = roster.filter((r) => String(r.Name || '').trim() && !memberIsDeceased_(r));
  if (ghin) { const g = live.filter((r) => String(r.GHIN || '').trim() === String(ghin)); if (g.length === 1) return g[0]; }
  const key = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
  let first, last;
  const n = String(name || '').trim();
  if (n.indexOf(',') !== -1) { last = n.split(',')[0]; first = n.split(',').slice(1).join(',').trim().split(/\s+/)[0]; }
  else {
    const t = n.replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').replace(/,?\s+(jr|sr|ii|iii|iv)\.?$/i, '').split(/\s+/);
    first = t[0]; last = t[t.length - 1];
  }
  const same = live.filter((r) => key(String(r.Name).split(',')[0]) === key(last));
  if (same.length <= 1) return same[0] || null;
  const f = key(first), nick = HCP_NICKS_[f] || f;
  const hit = same.filter((r) => {
    const fn = key(String(r.Name).split(',').slice(1).join(',').trim().split(/\s+/)[0]);
    return fn && [f, nick].some((c) => fn === c || (Math.min(fn.length, c.length) >= 3 && (fn.indexOf(c) === 0 || c.indexOf(fn) === 0)));
  });
  return hit.length === 1 ? hit[0] : null;
}
// One-time load of the 2026-10-18 GHIN report Tom sent (GHIN #, name, index).
const HANDICAP_SEED_ = [
  ["793469", "Rufus Alston", "24.5"],
  ["793920", "Thomas Bacca", "14.3"],
  ["2553028", "Mr. Charles Buchanan", "20.9"],
  ["794164", "Randy Cobb", "12.0"],
  ["10384147", "David Colt", "7.3"],
  ["1436783", "Jay Davis", "15.0"],
  ["793749", "Larry Davis", "26.6"],
  ["10886057", "Jeff DeLisle", "19.1"],
  ["13061697", "Eric Dillon", "11.6"],
  ["7069144", "Bob Dunbar", "21.0"],
  ["2000512", "Gary Eiloo", "21.2"],
  ["793771", "Bob Grosso", "19.3"],
  ["794281", "Tom Gurganus", "20.6"],
  ["681360", "Daniel Haines Jr", "16.8"],
  ["12359163", "John Welte Harris", "8.9"],
  ["793358", "Ralf Haskell", "20.7"],
  ["725265", "Mr. Charles Hood", "26.3"],
  ["671727", "Bob Hope", "21.7"],
  ["794308", "Charles Houseworth", "14.9"],
  ["742315", "Ken Kalloway", "8.1"],
  ["3610524", "Charles Kimball", "15.2"],
  ["2721756", "Mr. Bill Kloepfer", "16.7"],
  ["12693051", "Kevin Kusilek", "9.0"],
  ["2140215", "Paul Landry", "19.8"],
  ["7907804", "Steve Latus", "18.8"],
  ["4449327", "Thomas Lionelli", "6.8"],
  ["436123", "Bill Luksis", "11.9"],
  ["793673", "Wayne McCulloch", "11.4"],
  ["1672910", "John McEver", "29.3"],
  ["2230828", "Don McFarland", "5.8"],
  ["850782", "Gary McGuffin", "12.5"],
  ["7534378", "Gregory Moreland", "13.3"],
  ["817117", "Ellis S Nelson", "15.9"],
  ["1234943", "John Neumann", "28.5"],
  ["12034961", "Bill Owens", "21.1"],
  ["793816", "Lewis Peverill", "16.2"],
  ["794250", "Kirby Primm", "11.3"],
  ["645243", "Mr. John H Recchia", "14.4"],
  ["11748904", "Ron Rich", "23.2"],
  ["6367785", "Michael Roane", "14.5"],
  ["794159", "Henry Rogers", "17.2"],
  ["1027009", "Al Rowinski", "20.6"],
  ["793507", "Mr. Dave Rowley", "27.8"],
  ["793740", "Jim Salisbury", "20.8"],
  ["945120", "Mr. Ray Schipani", "23.8"],
  ["11286364", "Winston Shade", "6.6"],
  ["856394", "Dave Simpson", "20.6"],
  ["709992", "Braxton Smith", "23.3"],
  ["794106", "Mr. Jeffrey Allan Stewart", "15.1"],
  ["846621", "Scott Striegel", "19.1"],
  ["793653", "Tom Sullivan", "19.2"],
  ["10561792", "Stan Swinson", "23.9"],
  ["793344", "Percy Taylor", "13.2"],
  ["729001", "Mark Truszkowski", "18.0"],
  ["12112574", "Mike Upfield", "21.9"],
  ["3053770", "Mr. Irwin Urban", "28.4"],
  ["12474155", "John Visser", "23.4"],
  ["806336", "Wayne Webster", "36.9"],
  ["1437938", "John Woloski", "25.2"],
  ["2654857", "Jim Woodard", "30.5"]
];
function seedHandicaps_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('HANDICAPS_SEEDED_2026_10_22')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (props.getProperty('HANDICAPS_SEEDED_2026_10_22')) return;
    const roster = readRosterFull_(ss);
    const hc = readHandicaps_(ss);
    const missing = [];
    let n = 0, ghinSet = 0;
    HANDICAP_SEED_.forEach(([ghin, name, hi]) => {
      const r = hcpFindMember_(roster, ghin, name);
      if (!r) { missing.push(name); return; }
      if (!String(r.GHIN || '').trim()) { r.GHIN = ghin; ghinSet++; }
      const id = String(r.PlayerID);
      hc[id] = Object.assign({ Tee: '', ExtraStrokes: '' }, hc[id], { HandicapIndex: cleanHcpIndex_(hi) || '' });
      n++;
    });
    if (ghinSet) objectsToSheet_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS, roster);
    objectsToSheet_(ensureHandicapsSheet_(ss), HANDICAP_HEADERS, Object.keys(hc).map((id) => Object.assign({ PlayerID: id }, hc[id])));
    if (!props.getProperty('HANDICAPS_AS_OF')) props.setProperty('HANDICAPS_AS_OF', '2026-10-18');
    props.setProperty('HANDICAPS_SEEDED_2026_10_22', new Date().toISOString());
    logActivity_(ss, 'System', 'Loaded handicaps', n + ' handicap indexes, ' + ghinSet + ' GHIN numbers' + (missing.length ? ' | Not found on the roster: ' + missing.join('; ') : ''));
  } finally {
    lock.releaseLock();
  }
}
// The Handicaps tabs: every living Legend's index and tee (A-Z by last name), inactive
// members included and flagged Inactive (Tom 2026-10-25). Any
// signed-in member may read it; admins (by PIN) also get each GHIN #.
// TeeFrom: 'set' (chosen on the admin page), 'signups' (their usual tee) or 'default' (Gold).
function getHandicaps_(ss, token, adminPin) {
  const admin = !!(adminPin && findAdminName_(ss, adminPin));
  if (!admin && !memberFromToken_(ss, token)) throw new Error('SIGNED_OUT: Please sign in again.');
  seedHandicaps_(ss);
  const hc = readHandicaps_(ss);
  const usual = signupTees_(ss);
  const players = readRosterFull_(ss).filter((r) => String(r.Name || '').trim() && !memberIsDeceased_(r)).map((r) => {
    const id = String(r.PlayerID), h = hc[id] || {};
    const set = HCP_TEES_.indexOf(h.Tee) !== -1;
    const o = { PlayerID: r.PlayerID, Name: r.Name, HandicapIndex: h.HandicapIndex || '', Tee: set ? h.Tee : (usual[id] || 'Gold'), TeeFrom: set ? 'set' : usual[id] ? 'signups' : 'default' };
    if (!memberIsActive_(r)) o.Inactive = true;
    if (admin) o.GHIN = String(r.GHIN || '').trim();
    return o;
  }).sort((a, b) => String(a.Name).localeCompare(String(b.Name), 'en', { sensitivity: 'base' }));
  return { asOf: PropertiesService.getScriptProperties().getProperty('HANDICAPS_AS_OF') || '', tees: HCP_TEES_, players };
}
// players: [{PlayerID, GHIN?, HandicapIndex, Tee}] from the admin page (only rows sent
// are changed). asOf: 'YYYY-MM-DD' the indexes take effect.
function saveHandicaps_(ss, players, asOf, adminPin) {
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(String(asOf))) throw new Error('The "effective as of" date is not a date.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const roster = readRosterFull_(ss);
    const byId = {};
    roster.forEach((r) => { byId[String(r.PlayerID)] = r; });
    const hc = readHandicaps_(ss);
    let ghinChanged = false;
    (players || []).forEach((p) => {
      const r = byId[String(p.PlayerID)];
      if (!r) return;
      const hi = cleanHcpIndex_(p.HandicapIndex);
      if (hi === null) throw new Error(r.Name + ': "' + p.HandicapIndex + '" is not a handicap index (like 14.3, or +1.2).');
      const tee = String(p.Tee || '').trim();
      if (tee && HCP_TEES_.indexOf(tee) === -1) throw new Error(r.Name + ': "' + tee + '" is not one of the tees.');
      hc[String(r.PlayerID)] = Object.assign({ ExtraStrokes: '' }, hc[String(r.PlayerID)], { HandicapIndex: hi, Tee: tee });
      if (p.GHIN !== undefined) {
        const g = String(p.GHIN || '').replace(/\s/g, '');
        if (g && !/^\d{5,10}$/.test(g)) throw new Error(r.Name + ': "' + p.GHIN + '" is not a valid GHIN number (digits only).');
        if (g !== String(r.GHIN || '').trim()) { r.GHIN = g; ghinChanged = true; }
      }
    });
    const seen = {};
    roster.forEach((r) => {
      const g = String(r.GHIN || '').trim();
      if (!g || memberIsDeceased_(r)) return;
      if (seen[g]) throw new Error(r.Name + ' and ' + seen[g] + ' have the same GHIN number (' + g + ').');
      seen[g] = r.Name;
    });
    if (ghinChanged) objectsToSheet_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS, roster);
    objectsToSheet_(ensureHandicapsSheet_(ss), HANDICAP_HEADERS, Object.keys(hc).filter((id) => byId[id]).map((id) => Object.assign({ PlayerID: id }, hc[id])));
    if (asOf) PropertiesService.getScriptProperties().setProperty('HANDICAPS_AS_OF', String(asOf));
  } finally {
    lock.releaseLock();
  }
  return getHandicaps_(ss, '', adminPin);
}

function getMembersAdmin_(ss) {
  seedRipList_(ss);
  seedEmergencyContacts_(ss);
  const pins = readMemberPins_(ss);
  return readRosterFull_(ss).map((r) => ({
    PlayerID: r.PlayerID,
    Name: r.Name,
    Team: r.Team,
    Email: String(r.Email || '').trim(),
    HomePhone: phonesOf_(r).home,
    MobilePhone: phonesOf_(r).mobile,
    GHIN: String(r.GHIN || '').trim(),
    Active: memberIsActive_(r) ? 'TRUE' : 'FALSE',
    Deceased: memberIsDeceased_(r) ? 'TRUE' : 'FALSE',
    DiedYear: String(r.DiedYear || '').trim(),
    EmergencyContact: String(r.EmergencyContact || '').trim(),
    PlayGroup: String(r.PlayGroup || '').trim(),
    hasPin: !!pins[String(r.PlayerID)],
  }));
}

// One-time load of the Legends who have died (list from Tom, 2026-10-20). Each name
// is matched to an existing roster row by last name (and first name or initial when
// several share it); anyone not found is added as a new RIP row. Runs once.
const RIP_SEED_ = [
  ['Ed Yarasheski', '2024'], ['Jerry Casler', ''], ['Mike Connell', '2022'], ['Dick Franchi', '2023'],
  ['Fritz Hintze', '2013'], ['Worth Joyner', ''], ['Bob Dawkins', ''], ['Jerry McInnes', '2026'],
  ['Jerry Simons', ''], ['John Ice', ''], ['Chuck Cascio', ''], ['Pete Zuleba', ''], ['Rich Brown', ''],
  ['Ed Eads', ''], ['Dick Jordan', ''], ['Ted Paczek', ''], ['Dick Berger', ''], ['W.C. Scruggs', ''],
];
function seedRipList_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('RIP_SEEDED_2026_10_20')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (props.getProperty('RIP_SEEDED_2026_10_20')) return;
    maybeBackup_(ss, true);
    const roster = readRosterFull_(ss);
    const key = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const lastFirst = (name) => {
      const n = String(name || '').trim();
      if (n.indexOf(',') !== -1) { const i = n.indexOf(','); return { last: n.slice(0, i).trim(), first: n.slice(i + 1).trim() }; }
      const parts = n.split(/\s+/); return { last: parts.pop() || '', first: parts.join(' ') };
    };
    let nextId = rosterNextId_(roster);
    const matched = [], added = [];
    RIP_SEED_.forEach(([full, year]) => {
      const want = lastFirst(full);
      const same = roster.filter((r) => key(lastFirst(r.Name).last) === key(want.last));
      const nick = { dick: 'richard', rich: 'richard', ed: 'edward', bob: 'robert', mike: 'michael', chuck: 'charles', pete: 'peter', ted: 'theodore', fritz: 'frederick', jerry: 'gerald' };
      const firstOf = (r) => key(lastFirst(r.Name).first);
      const w = key(want.first);
      let hit = same.filter((r) => firstOf(r) === w);
      if (hit.length !== 1) hit = same.filter((r) => nick[firstOf(r)] === nick[w] && nick[w] || firstOf(r) === nick[w] || nick[firstOf(r)] === w);
      if (hit.length !== 1) hit = same.filter((r) => firstOf(r).charAt(0) === w.charAt(0));
      if (hit.length === 1) {
        const r = hit[0];
        r.Deceased = 'TRUE'; r.Active = 'FALSE';
        if (year && !String(r.DiedYear || '').trim()) r.DiedYear = year;
        matched.push(r.Name);
      } else {
        const name = want.last + ', ' + want.first;
        roster.push({ PlayerID: nextId++, Name: name, Team: '', HandicapIndex: '', Tee: '', Active: 'FALSE', Scorekeeper: '', Email: '', Phone: '', HomePhone: '', MobilePhone: '', GHIN: '', Deceased: 'TRUE', DiedYear: year });
        added.push(name);
      }
    });
    objectsToSheet_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS, roster);
    props.setProperty('RIP_SEEDED_2026_10_20', new Date().toISOString());
    logActivity_(ss, 'System', 'Loaded RIP list', 'Marked: ' + (matched.join('; ') || 'none') + ' | Added: ' + (added.join('; ') || 'none'));
  } finally {
    lock.releaseLock();
  }
}

// One-time load of emergency contacts from the Roster of Legends (sent by Tom, 2026-10-20).
// [email, last name, first name(s), contact as sent, contact tidied to "Name (relationship) 919-555-1234"].
// Matched by email, else by last name + first name; fills members with no contact, or still
// holding the untidied text from the first version of this load. Runs once.
const EMERGENCY_SEED_ = [
  ["ralston10@nc.rr.com", "Alston", "Rufus & Ruby", "Ruby Alston 919 554 1757", "Ruby Alston (wife) 919-554-1757"],
  ["mike79anderson@gmail.com", "Anderson", "Mike & Roberta", "Roberta 919 606 3508. Steve Fleming 919 622 6274", "Roberta Anderson (wife) 919-606-3508; Steve Fleming 919-622-6274"],
  ["tbacca@nc.rr.com", "Bacca", "Tom & Cathie", "Cathie Bacca 919 633 0373", "Cathie Bacca (wife) 919-633-0373"],
  ["cwbuck1@gmail.com", "Buchanan", "Buck & Betsy", "Betsy Buchanan 919 522 1857", "Betsy Buchanan (wife) 919-522-1857"],
  ["rcobbx@gmail.com", "Cobb", "Randy", "Brent Cobb 704 302 5805", "Brent Cobb 704-302-5805"],
  ["dccolt5445@gmail.com", "Colt", "Dave (DC) & Vickie", "Vickie Colt 828-231-3591", "Vickie Colt (wife) 828-231-3591"],
  ["jdavis1947@icloud.com", "Davis", "Jay & Margaret", "Margaret Davis 540 219 0925", "Margaret Davis (wife) 540-219-0925"],
  ["ldavis010@icloud.com", "Davis", "Larry & Deb", "Deb Davis 724 316 4701", "Deb Davis (wife) 724-316-4701"],
  ["jdelislemd@gmail.com", "DeLisle", "Jeffrey & Julie", "Julie Delisle 518-248-4367", "Julie DeLisle (wife) 518-248-4367"],
  ["eric@opendoorlife.com", "Dillon", "Eric & Sally", "Sally Dillon 919-931-3295", "Sally Dillon (wife) 919-931-3295"],
  ["bemiluv@aol.com", "Dunbar", "Bob", "Bryan Dunbar 919 889 8106", "Bryan Dunbar 919-889-8106"],
  ["geiloo@twc.com", "Eiloo", "Gary & Christine", "Christine Eiloo 703 615 9819", "Christine Eiloo (wife) 703-615-9819"],
  ["rgrosso401@gmail.com", "Grosso", "Bob & Maria", "Maria Grosso 919 610 0434", "Maria Grosso (wife) 919-610-0434"],
  ["tomgurganus@gmail.com", "Gurganus", "Tom & Esther", "Esther Gurganus 678 230 8826", "Esther Gurganus (wife) 678-230-8826"],
  ["dhaineswmt@gmail.com", "Haines", "Dan & Kimberly", "Kim Haines 984 255 5616", "Kim Haines (wife) 984-255-5616"],
  ["jwelteharris@gmail.com", "Harris", "John & Tina", "Tina Harris 330-634-0447", "Tina Harris (wife) 330-634-0447"],
  ["ralfhaskell@gmail.com", "Haskell", "Ralf & Karen", "Karen Haskell 919 609 3007", "Karen Haskell (wife) 919-609-3007"],
  ["hoodmgnt@gmail.com", "Hood", "Chuck", "Brandon White 919 906 0661", "Brandon White 919-906-0661"],
  ["bhope1@aol.com", "Hope", "Bob & Betty Lou", "Betty Lou Hope 585-330-4502", "Betty Lou Hope (wife) 585-330-4502"],
  ["c.houseworth@gmail.com", "Houseworth", "Chuck & Meg", "Meg Houseworth 919 247 6873", "Meg Houseworth (wife) 919-247-6873"],
  ["kkalloway@hotmail.com", "Kalloway", "Ken", "Carolyn Hudspeth 630 292 1343", "Carolyn Hudspeth 630-292-1343"],
  ["kimball@ou.edu", "Kimball", "Charles & Nancy", "Nancy Kimball 405-595-9677", "Nancy Kimball (wife) 405-595-9677"],
  ["bill.kloepfer@yahoo.com", "Kloepfer", "Bill & Ginny", "Ginny Kloepfer 252-916-5951", "Ginny Kloepfer (wife) 252-916-5951"],
  ["kevinkusilek@gmail.com", "Kusilek", "Kevin & Cindy", "Cindy Kusilek 919-523-2882", "Cindy Kusilek (wife) 919-523-2882"],
  ["paullandrysr@hotmail.com", "Landry", "Paul & Nora", "Nora Landry 910-398-7727", "Nora Landry (wife) 910-398-7727"],
  ["slatus@comcast.net", "Latus", "Stephen & Ruth Stevens", "Ruth Stevens 609-658-0519", "Ruth Stevens (wife) 609-658-0519"],
  ["tlionelli@yahoo.com", "Lionelli", "Tom & Vicki", "Vicki Lionelli 919 263 1856", "Vicki Lionelli (wife) 919-263-1856"],
  ["bluksis46@gmail.com", "Luksis", "Bill (Duke) & Sue", "Sue Luksis 919 349 1792", "Sue Luksis (wife) 919-349-1792"],
  ["jwmcculloch@msn.com", "McCulloch", "Wayne & Jill", "Jill McCulloch 919 946 6556", "Jill McCulloch (wife) 919-946-6556"],
  ["mcever.john@gmail.com", "McEver", "John & Diane", "Diane McEver 410 707 6122", "Diane McEver (wife) 410-707-6122"],
  ["dp48mcfarland@gmail.com", "McFarland", "Don & Kay (Gamble)", "919-949-3441", "919-949-3441"],
  ["guff24@aol.com", "McGuffin", "Gary & Angie", "Angie McGuffin 919 235 7515", "Angie McGuffin (wife) 919-235-7515"],
  ["gmoreland624@spectrum.net", "Moreland", "Greg & Tricia", "Patricia Moreland 518 330 7177", "Patricia Moreland (wife) 518-330-7177"],
  ["nelsone@nc.rr.com", "Nelson", "Ellis & Ronnee", "Ronnee Nelson 919 614 6272", "Ronnee Nelson (wife) 919-614-6272"],
  ["jpn129@aol.com", "Neumann", "Pete & Susan", "Susan Neumann 919 606 6150", "Susan Neumann (wife) 919-606-6150"],
  ["billowens223@gmail.com", "Owens", "Bill & Terryn", "Paul Owens 919 605 5132", "Paul Owens 919-605-5132"],
  ["lewispev@yahoo.com", "Peverill", "Lou", "Dustin Peverill 757 274 8741, Sharron Busbee 757 561 4437", "Dustin Peverill 757-274-8741; Sharron Busbee 757-561-4437"],
  ["kirbyprimm@gmail.com", "Primm", "Kirby & Sharon", "Sharon Primm 509 669 1511", "Sharon Primm (wife) 509-669-1511"],
  ["j.recchia@yahoo.com", "Recchia", "John & Ruth", "Ruth Reccchia 845-242-2230", "Ruth Recchia (wife) 845-242-2230"],
  ["rrich15@hotmail.com", "Rich", "Ron & Angela", "Angela Rich 516-330-4977", "Angela Rich (wife) 516-330-4977"],
  ["mroane28@gmail.com", "Roane", "Michael & Chris", "Chris Uithoven 602-524-6574", "Chris Uithoven (wife) 602-524-6574"],
  ["rogers_henry@yahoo.com", "Rogers", "Henry & Ann", "Ann Rogers 919 812 5682", "Ann Rogers (wife) 919-812-5682"],
  ["rowinskial@gmail.com", "Rowinski", "Al & Carol", "Carol Rowinski 610 731 1480", "Carol Rowinski (wife) 610-731-1480"],
  ["jimsalisburync@gmail.com", "Salisbury", "Jim & Joanne", "Joanne Salisbury 919 880 8862", "Joanne Salisbury (wife) 919-880-8862"],
  ["rlschipani@gmail.com", "Schipani", "Ray & Deidre", "Deidre Schipani 612 695 9594", "Deidre Schipani (wife) 612-695-9594"],
  ["wfshade@gmail.com", "Shade", "Winston & Teresa", "Teresa Shade 919-880-7685", "Teresa Shade (wife) 919-880-7685"],
  ["davidgsimpson@msn.com", "Simpson", "Dave & Debbie", "Debbie Simpson 704 572 6285", "Debbie Simpson (wife) 704-572-6285"],
  ["braxtonwsmith79@gmail.com", "Smith", "Braxton & Karen", "Karen Smith 919 522 3082", "Karen Smith (wife) 919-522-3082"],
  ["stewclannc.jas@gmail.com", "Stewart", "Jeff & Karen", "Karen Stewart 919 931 3007", "Karen Stewart (wife) 919-931-3007"],
  ["striegelscg@aol.com", "Striegel", "Scott & Janet", "Janey Striegel 919 454 3831", "Janey Striegel (wife) 919-454-3831"],
  ["t.j.sullivan@earthlink.net", "Sullivan", "Tom & Sandra", "Sandra Sullivan 919 616 0872", "Sandra Sullivan (wife) 919-616-0872"],
  ["tarheelstan@icloud.com", "Swinson", "Stan & Ann", "Ann Swinson 919 417 5798", "Ann Swinson (wife) 919-417-5798"],
  ["percytaylor24@gmail.com", "Taylor", "Percy & Linda", "Linda Taylor 919 215-0500 (M)", "Linda Taylor (wife) 919-215-0500"],
  ["m2001b@yahoo.com", "Upfield", "Mike & Barb", "Barb Upfield 803 210 9662", "Barb Upfield (wife) 803-210-9662"],
  ["johndvisser@gmail.com", "Visser", "John & Rebecca", "Rebecca Visser 919 614 1137 (M)", "Rebecca Visser (wife) 919-614-1137"],
  ["websterwayne584@gmail.com", "Webster", "Wayne & Irene", "Irene Webster 910-512-3323", "Irene Webster (wife) 910-512-3323"],
  ["jwoloski@msn.com", "Woloski", "John & Mary Ann", "Mary Ann 919 917 4599", "Mary Ann Woloski (wife) 919-917-4599"],
  ["jamesphylliswoodard@gmail.com", "Woodard", "Jim & Phyllis", "Phyllis Woodard 919 556 1189", "Phyllis Woodard (wife) 919-556-1189"],
];
function seedEmergencyContacts_(ss) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('EMERGENCY_SEEDED_2026_10_21')) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (props.getProperty('EMERGENCY_SEEDED_2026_10_21')) return;
    const roster = readRosterFull_(ss);
    const key = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
    let filled = 0;
    const missing = [];
    EMERGENCY_SEED_.forEach(([email, last, first, raw, contact]) => {
      let hit = roster.filter((r) => normEmail_(r.Email) === email);
      if (hit.length !== 1) {
        const own = String(first).split('&')[0];
        const cands = [own.replace(/\([^)]*\)/g, '').trim().split(/\s+/)[0], (own.match(/\(([^)]+)\)/) || [])[1]].filter(Boolean).map(key);
        const same = roster.filter((r) => !memberIsDeceased_(r) && key(String(r.Name).split(',')[0]) === key(last));
        hit = same.length === 1 ? same : same.filter((r) => { const fn = key(String(r.Name).split(',').slice(1).join(',')); return cands.some((c) => fn === c || fn.indexOf(c) === 0 || c.indexOf(fn) === 0); });
      }
      if (hit.length !== 1) { missing.push(first.split('&')[0].trim() + ' ' + last); return; }
      const cur = String(hit[0].EmergencyContact || '').trim();
      if (!cur || cur === raw) { hit[0].EmergencyContact = contact; filled++; }
    });
    if (filled) objectsToSheet_(ss.getSheetByName(SHEETS.ROSTER), ROSTER_HEADERS, roster);
    props.setProperty('EMERGENCY_SEEDED_2026_10_21', new Date().toISOString());
    logActivity_(ss, 'System', 'Loaded emergency contacts', filled + ' filled in' + (missing.length ? ' | Not found on the roster: ' + missing.join('; ') : ''));
  } finally {
    lock.releaseLock();
  }
}

// members: [{PlayerID?, Name, Email, Phone, GHIN?, Active, Deceased?, DiedYear?, Remove?}] —
// updates those fields on existing Roster rows (matched by PlayerID) and adds rows
// without a PlayerID as new Legends (Team left unassigned). Tournament fields (Team,
// HandicapIndex, Tee, Scorekeeper) are never touched here. Rows not included are
// left exactly as they are; a row sent with Remove: true is deleted from the Roster
// (with its member PIN). Their past sign-ups keep the name they were saved with.
function saveMembers_(ss, members) {
  const sheet = ss.getSheetByName(SHEETS.ROSTER);
  const groupChanges = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const roster = readRosterFull_(ss);
    const byId = {};
    roster.forEach((r) => { byId[String(r.PlayerID)] = r; });
    let nextId = rosterNextId_(roster);
    const removeIds = {};
    (members || []).forEach((m) => {
      const name = String(m.Name || '').trim();
      if (m.Remove) { if (m.PlayerID !== undefined && m.PlayerID !== '') removeIds[String(m.PlayerID)] = true; return; }
      const email = String(m.Email || '').trim();
      if (email && !isValidEmail_(email)) throw new Error((name || 'A member') + ': "' + email + '" is not a valid email address.');
      const fields = { Email: email, Phone: '', HomePhone: String(m.HomePhone || '').trim(), MobilePhone: String(m.MobilePhone || '').trim(), Active: (m.Active === false || m.Active === 'FALSE') ? 'FALSE' : 'TRUE' };
      if (m.EmergencyContact !== undefined) fields.EmergencyContact = String(m.EmergencyContact || '').trim().slice(0, 200);
      if (m.PlayGroup !== undefined) {
        fields.PlayGroup = PLAY_GROUPS_.indexOf(String(m.PlayGroup || '').toLowerCase()) === -1 ? '' : String(m.PlayGroup).toLowerCase();
        const was = m.PlayerID !== undefined && m.PlayerID !== '' && byId[String(m.PlayerID)] ? String(byId[String(m.PlayerID)].PlayGroup || '').trim() : '';
        if (fields.PlayGroup !== was) groupChanges.push({ name: name, email: email, from: was, to: fields.PlayGroup, by: 'an admin (Members page)' });
      }
      // RIP status is only touched when the page sent it (older cached pages don't know it).
      if (m.Deceased !== undefined) {
        fields.Deceased = String(m.Deceased).toUpperCase() === 'TRUE' ? 'TRUE' : '';
        if (fields.Deceased) fields.Active = 'FALSE';
        const yr = String(m.DiedYear || '').trim();
        if (yr && !/^(19|20)\d\d$/.test(yr)) throw new Error((name || 'A member') + ': "' + yr + '" is not a year (e.g. 2024).');
        fields.DiedYear = fields.Deceased ? yr : '';
      }
      // GHIN is only touched when the page sent it, so an older cached admin
      // page that doesn't know about the column can't blank everyone's number.
      if (m.GHIN !== undefined) {
        const ghin = String(m.GHIN || '').replace(/\s/g, '');
        if (ghin && !/^\d{5,10}$/.test(ghin)) throw new Error((name || 'A member') + ': "' + m.GHIN + '" is not a valid GHIN number (digits only).');
        fields.GHIN = ghin;
      }
      const existing = m.PlayerID !== undefined && m.PlayerID !== '' ? byId[String(m.PlayerID)] : null;
      if (existing) {
        if (name) existing.Name = name;
        Object.assign(existing, fields);
      } else {
        if (!name) return; // blank new row — ignore
        roster.push(Object.assign({ PlayerID: nextId++, Name: name, Team: '', HandicapIndex: '', Tee: '', Scorekeeper: '' }, fields));
      }
    });
    const removedNow = roster.filter((r) => removeIds[String(r.PlayerID)]);
    if (removedNow.length) {
      rememberRosterMaxId_(roster);
      for (let i = roster.length - 1; i >= 0; i--) if (removeIds[String(roster[i].PlayerID)]) roster.splice(i, 1);
    }
    const names = {}, emails = {};
    roster.forEach((r) => {
      const k = String(r.Name || '').trim().toLowerCase();
      if (!k) return;
      if (names[k]) throw new Error('Two members are named "' + r.Name + '" — names must be different.');
      names[k] = true;
      const e = normEmail_(r.Email);
      if (e && memberIsActive_(r)) {
        if (emails[e]) throw new Error(r.Name + ' and ' + emails[e] + ' have the same email (' + e + ') — each active member needs their own, since it is how they sign in.');
        emails[e] = r.Name;
      }
    });
    objectsToSheet_(sheet, ROSTER_HEADERS, roster);
    if (removedNow.length) {
      const pins = readMemberPins_(ss);
      if (removedNow.some((r) => pins[String(r.PlayerID)])) {
        removedNow.forEach((r) => { delete pins[String(r.PlayerID)]; });
        objectsToSheet_(ensureMemberPinsSheet_(ss), MEMBER_PIN_HEADERS, Object.keys(pins).map((id) => ({ PlayerID: id, PIN: pins[id] })));
      }
    }
  } finally {
    lock.releaseLock();
  }
  notifyPlayGroupChanges_(ss, groupChanges);
  return getMembersAdmin_(ss);
}
// Emails the Legends admin (AdminEmail setting) whenever someone's email-list choice
// changes, so the Fun / Nassau Google Groups can be updated by hand (Tom 2026-11-01).
// A failed email never stops the save.
function notifyPlayGroupChanges_(ss, changes) {
  if (!changes || !changes.length) return;
  try {
    const st = laSettings_(ss);
    if (!laOn_(st, 'ListChangeEmailOn')) return; // Admin > Setup > Emails switch (Tom 2026-11-17)
    const to = laEmailList_(st.AdminEmail).join(',');
    if (!to) return;
    const label = (g) => ({ fun: 'Fun Group', nassau: 'Nassau Group', both: 'Both (Fun and Nassau)' })[g] || '(none)';
    const lines = changes.map((c) => displayName_(c.name) + ' (' + (c.email || 'no email') + '): ' + label(c.from) + ' -> ' + label(c.to) + (c.by ? ', changed by ' + c.by : ''));
    const subject = changes.length === 1 ? 'Legends email list change: ' + displayName_(changes[0].name) + ' -> ' + label(changes[0].to) : 'Legends email list changes (' + changes.length + ')';
    laSendEmail_({ to: to, subject: subject, name: 'Heritage Legends Golf',
      body: 'Please update the Legends Google Groups:\n\n' + lines.join('\n') + '\n\nEveryone\'s choice is in the Email list column of the members table on Admin > Info > Members (the Info tab, then Members), and in the PlayGroup column of the Roster tab in the HeritageLegends sheet.' });
  } catch (e) {
    console.error('notifyPlayGroupChanges_: ' + e);
  }
}

// Splits a combined phone string like "919-453-1896 (H) 919-610-0433 (M)"
// (the Roster of Legends layout) into home and mobile. (M) and (C) are both
// mobile; a number with no label is treated as mobile.
function splitPhones_(s) {
  const out = { home: [], mobile: [] };
  String(s || '').replace(/(\+?\(?\d[\d\s().-]{6,}\d)\s*(?:\(([HMC])\))?/gi, (all, num, tag) => {
    (tag && tag.toUpperCase() === 'H' ? out.home : out.mobile).push(num.trim().replace(/[\s,]+$/, ''));
    return all;
  });
  return { home: out.home.join(' / '), mobile: out.mobile.join(' / ') };
}
function phonesOf_(r) {
  const home = String(r.HomePhone || '').trim(), mobile = String(r.MobilePhone || '').trim();
  if (home || mobile || !String(r.Phone || '').trim()) return { home: home, mobile: mobile };
  return splitPhones_(r.Phone);
}

function resetMemberPin_(ss, playerId) {
  const row = readRosterFull_(ss).find((r) => String(r.PlayerID) === String(playerId));
  if (!row) throw new Error('Member not found.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    writeMemberPin_(ss, playerId, '');
  } finally {
    lock.releaseLock();
  }
  return { name: row.Name };
}
