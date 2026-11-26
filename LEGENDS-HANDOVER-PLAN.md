# SUN (SignUp Now), the Heritage Legends Golf app: handover guide for Claude

Written 2026-10-29 by Claude (updated the same day after the new account's first review, then again once ScorekeeperEmails.gs had been read and documented, a third time to bring it up to 2026-11-01c, a fourth to Page 2026-11-01f and Backend 2026-11-01e, a fifth to Page 2026-11-01i, a sixth to Backend 2026-11-01g, a seventh to Page 2026-11-03a and Backend 2026-11-01i, an eighth to Page and Backend 2026-11-04b, a ninth to Page and Backend 2026-11-04c, a tenth to ScorekeeperEmails.gs, changed on 2026-11-04, an eleventh to Page and Backend 2026-11-07b, a twelfth to Page 2026-11-15c and Backend 2026-11-15a, a thirteenth to Page and Backend 2026-11-15d, a fourteenth to Page 2026-11-16a, a fifteenth to Page 2026-11-16b, a sixteenth to Page and Backend 2026-11-17a, a seventeenth to 2026-11-17b, an eighteenth to 2026-11-17c, a nineteenth to 2026-11-17e, a twentieth to Page 2026-11-18a, a twenty-first to Page and Backend 2026-11-20a, a twenty-second to Backend 2026-11-20b, a twenty-third to Page 2026-11-20c, and a twenty-fourth to Page and Backend 2026-11-20d, a twenty-fifth to Page 2026-11-24d, a twenty-sixth to Page 2026-11-24e, and a twenty-seventh to Page, Backend and LA_VERSION 2026-11-26a) for Tom, to move management of the Heritage Legends app into a Claude account dedicated to the Legends, and later to hand it to the people who run the Legends league.

**How to use this file:** In the new Claude account, create a Project called "Heritage Legends app". Upload this file and the code files that came with it (index.html, Code.gs, LegendsApp.gs, live.html, tournament-admin.html, and ScorekeeperEmails.gs, which is in the 2026-11-01 zip) as project knowledge. Paste section 1 below into the Project's custom instructions. Then every chat in that Project starts out knowing the app.

---

## 1. Instructions for Claude (paste into the Project's custom instructions)

> You help manage the Heritage Legends Golf app for the Heritage Legends league. The full guide is in LEGENDS-HANDOVER-PLAN.md in this project's knowledge; read it before changing anything. Key rules:
> - The backend is Google Apps Script (Code.gs, LegendsApp.gs, ScorekeeperEmails.gs). The front end is static HTML on GitHub Pages (index.html, live.html, tournament-admin.html).
> - There are two copies of everything: TEST and LIVE. The same code files go into both. Change and check TEST first, then LIVE.
> - After any .gs change, the person must paste the file into BOTH Apps Script projects and then do Deploy > Manage deployments > (pencil) Edit > Version: New version > Deploy, in each. Saving alone does not make it live. Never create a new deployment for LIVE, because that changes the URL.
> - After any .html change, the person must upload the file to BOTH GitHub repos, heritagelegendsgolf/test and heritagelegendsgolf/live.
> - Bump the version every time: BACKEND_VERSION in Code.gs and LA_VERSION in LegendsApp.gs together (always the same value) for any .gs change, and the changed page's own version for a page change (APP_VERSION in index.html, LIVE_VERSION in live.html, ADMIN_VERSION in tournament-admin.html). Format is YYYY-MM-DD plus a letter (e.g. 2026-10-28e). Each page shows "Page: ... • Backend: ...", which is how to check what is actually live.
> - Always give back the whole changed file, never a fragment to splice in. The people pasting it are not programmers.
> - Keep the existing style and comment habits of the code. Don't rewrite working parts.
> - ScorekeeperEmails.gs is different from the other two .gs files: it is run by hand from a menu in the tournament spreadsheet, has no trigger, and has Tom's name and the year written into it. Read section 4f before touching it.
> - This is NOT the "Gibson Group" tee sheet app, which is a different app with a different GitHub account. Never mix them.
> - Never put PINs, the SECRET_KEY or MEMBER_TOKEN_SECRET in chat replies or saved notes.
> - index.html is public (anyone can view its source on GitHub Pages). Never put real member emails or phone numbers in it, not even as examples; use fakes like jane@aol.com or 919-555-0100.
> - The admins call the app SUN (SignUp Now). Use that name with them.
> - Write replies in plain, friendly language for golf league volunteers.

---

## 2. Is a full handover possible?

Yes. Nothing in the app depends on Tom personally. It depends on three accounts, and whoever controls them controls the app:

| What | Account | What it holds |
|---|---|---|
| Google account | theheritagelegends@gmail.com (the account name is confirmed; whether it owns every piece is what 2a checks) | The TEST and LIVE Google Sheets (all data), both Apps Script projects (the backend), the Drive folder "Legends app", and the Gmail that sends every app email |
| GitHub account | TheHeritageLegends, which owns the heritagelegendsgolf/test and heritagelegendsgolf/live repos | The web pages (GitHub Pages sites heritagelegendsgolf.github.io/test/ and /live/) |
| Claude account | the new Legends Claude account | This guide and the chats used to change the app |

A Claude account can't be transferred from one person to another, and Claude doesn't carry memory between accounts. That's why this guide exists: it is the memory. Anyone can pick up the app in any Claude account by loading this file and the code files into a Project.

### 2a. Before handing over, Tom should check who owns what

**Checked 2026-11-07:** the LIVE and TEST sheets (and so both bound Apps Script projects) are owned by theheritagelegends@gmail.com, and the LIVE web app runs as "Me (theheritagelegends@gmail.com)". Item 1 below is done; it stays here for reference.

1. **Apps Script projects.** Open script.google.com while signed in as theheritagelegends@gmail.com. Both "HeritageLegends TEST" and "HeritageLegends LIVE" should be listed under "My projects". If either is owned by Tom's personal Google account instead, the app's emails are being sent from Tom's Gmail and will stop if Tom's account goes away. Fix: open the LIVE sheet's Share settings and make theheritagelegends@gmail.com the owner of the sheet (the bound script follows the sheet). Then, signed in as theheritagelegends, redeploy as a new version so "Execute as: Me" means the Legends account, and run installLegendsTriggers again (and delete the old trigger under Tom's account). To confirm the new trigger works: in the LIVE project open Triggers (clock icon) and check there is exactly one legendsHourly trigger, owned by the Legends account; then after about an hour open Executions and check legendsHourly ran and shows Completed, not Failed. Check that a scheduled email (e.g. the next pro shop list) actually arrives.
2. **Sheets.** The TEST sheet, the LIVE sheet ("LIVE HeritageLegends", ID 1lp9TeYdI80V0a46dFcRmcRlqbjfIorGFmWLFd5fua3k), the "Heritage Legends Backups" sheet, "LIVE Legends Tournament Data", and the Related Files Drive folder should all be owned by theheritagelegends@gmail.com.
3. **GitHub.** Confirm the TheHeritageLegends login and password (and 2-factor recovery codes) are written down somewhere the league can find them.
4. **Recovery.** Put a league officer's phone number and recovery email on theheritagelegends@gmail.com so the league isn't locked out if a password is lost.

### 2b. Suggested handover steps

1. Now: Tom sets up the new Claude account with this guide (section 1) and keeps working with it himself for a few weeks, so any gaps in the guide show up while he's still around.
2. Pick one or two league people as "app keepers". They don't need to code; they need to be comfortable copying and pasting a file and clicking Deploy.
3. Do one practice change together: the keeper asks Claude for a small change (e.g. wording on the sign-up page), then pastes and uploads it to TEST and LIVE following section 5, with Tom watching.
4. Don't give the keepers the passwords. Share each piece with their own Google and GitHub accounts and have them use their own Claude account with this guide loaded (see section 9a). Emergency access to the Legends account goes through Bitwarden (section 9a).
5. Make the keepers Full admins in the app (Admin > Info > Admins).
5a. If someone other than Tom sends the scorekeeper emails, change `SK_SIGNATURE_NAME` in ScorekeeperEmails.gs (see 4f), or the emails will be signed "Tom". Nothing else in that file needs editing from year to year.
6. Tom stays as a backup admin, or is removed (removing a Full admin needs a second admin to agree).

---

## 3. What the app is

The Heritage Legends are a group of senior golfers who play several days a week. The app handles:

- **Sign-ups** for each play day, in two groups: the **Fun Group** (nine-holers and eighteen-holers, casual) and the **Nassau** group (the betting game, "Larry's Game"). Players sign in with their email and a member PIN. Standby lists when a group is full.
- **Pairings:** automatic Fun Group pairings and Nassau pairings with A-D handicap bands and blinds.
- **Emails:** sign-up reminders, the pro shop list, change emails, Larry's Game email, duty reminders and more, sent from the app's Gmail on an hourly schedule.
- **Members:** roster, contact info, emergency contacts, RIP list, handicaps (weekly GHIN upload), preferred tees.
- **Tee Time Duty**, events, news, related files, closures and notices.
- **The annual tournament** (two-day team match, e.g. Sept 30-Oct 1 2026 Canesin6 vs Birdie Boys): tournament-admin.html sets it up, live.html is live scoring and the scoreboard.
- **Admins** with PINs: Full, View only, or Limited to certain pages.

---

## 4. How it is built

### 4a. Pieces

| File | Where it runs | What it is |
|---|---|---|
| index.html | GitHub Pages | The main Legends app (sign-ups, members, admin pages). One big file, about 420 KB. Version: APP_VERSION. |
| live.html | GitHub Pages | Tournament live scoring and scoreboard. Version: LIVE_VERSION, shown in the header badge. |
| tournament-admin.html | GitHub Pages | Tournament setup (teams, pairings, settings, Start New Season). Version: ADMIN_VERSION, filled into the versionBadge div by loadVersionBadge(). |
| Code.gs | Apps Script | Main backend: the web app router (doGet/doPost), roster, admins and PINs, tournament, handicaps, backups, permission checks. Holds BACKEND_VERSION. |
| LegendsApp.gs | Apps Script | Sign-up app backend: sign-ups, days, emails, pairings, hourly job (legendsHourly), installLegendsTriggers. Holds LA_VERSION, which must equal BACKEND_VERSION. |
| ScorekeeperEmails.gs | Apps Script | Sends the tournament scorekeepers their instructions, one email per match. Run by hand from a spreadsheet menu; no trigger. Present in both the TEST and LIVE projects (copied from TEST to LIVE on 2026-10-25). Full notes in 4f. |

The pages call the Apps Script web app URL. Each of the three pages has the same CONFIG block near the top of its script (index.html around line 475): `const CONFIG = { test: { backendUrl, key }, live: { backendUrl, key } }`. All three read `?env=` the same way: `const envParam = new URLSearchParams(location.search).get('env')`, then `ENV` is that value if it's test or live, otherwise TEST if the page address contains "test", otherwise LIVE; then `CFG = CONFIG[ENV]`. (A search for the literal text "env=" misses it in index.html because it's written as `.get('env')`.)

The `key` field in CONFIG is the SECRET_KEY: it must equal that project's SECRET_KEY script property, and every request sends it as `key` (and `keyEnc`). It sits in public page source, so it only keeps out casual traffic; the real protection is admin PINs and member PINs/tokens checked on the server. Don't change it unless you change the script property in the same go.

### 4b. TEST and LIVE

| | TEST | LIVE |
|---|---|---|
| Web page | heritagelegendsgolf.github.io/test/ (repo heritagelegendsgolf/test) | heritagelegendsgolf.github.io/live/ (repo heritagelegendsgolf/live) |
| Apps Script project | "HeritageLegends TEST" (script ID starts 1BjHHuhYSeMuAK204oZkl6GBj) | "HeritageLegends LIVE" (script ID starts 1Nihec), bound to the LIVE sheet |
| Web app URL | https://script.google.com/macros/s/AKfycbzTyDa25NoGyjcB7-3SIr8jnNCgBmzerlqZuNX5jWRZwLcoySdJxKsFURZFjJSjMzQq/exec | https://script.google.com/macros/s/AKfycbwoTlfNNHC9D-ulRs-Z77inQ3ItiBLDpYi2HE6RSBMsiqp6FwYevxQyqne1FXoi91-R-g/exec |
| Sheet | TEST HeritageLegends sheet | LIVE HeritageLegends, ID 1lp9TeYdI80V0a46dFcRmcRlqbjfIorGFmWLFd5fua3k |
| Hourly email job | **Off** (deleted on purpose) | **On** (legendsHourly, every hour) |

The TEST site shows a test banner. TEST sends no scheduled emails, so the league never gets doubles. Only LIVE has the hourly trigger. Don't add it to TEST.

LIVE went live 2026-10-25. The old LIVE backend (URL ending ...W38Vl3bDnlLv/exec) is gone and not used; the old sheet is named "OLD LIVE HeritageLegends".

### 4c. Script Properties (Apps Script > Project Settings > Script Properties)

Each project has its own set. Never paste the values into chat.

| Property | Purpose |
|---|---|
| SPREADSHEET_ID | Which sheet the project uses (this is what makes TEST and LIVE different) |
| SECRET_KEY | Must match the key in the pages' CONFIG block |
| MEMBER_TOKEN_SECRET | Signs member sign-in tokens. Changing it signs everyone out. |
| BACKUP_SPREADSHEET_ID | The "Heritage Legends Backups" sheet |
| LEGENDS_FILES_FOLDER_ID | Drive folder for Related Files uploads |
| ROSTER_MAX_ID | Highest PlayerID used, so IDs are never reused |
| ADMIN_REMOVALS | Pending "second admin must agree" removals |
| HANDICAPS_AS_OF | Date of the current handicap upload |
| HANDICAPS_SEEDED_2026_10_22, EMERGENCY_SEEDED_2026_10_21, RIP_SEEDED_2026_10_20 | One-time data loads already done. Don't delete them, or the old data loads again (the handicap one would put back the Oct 18 indexes). |
| LAST_BACKUP_MS | When the last backup ran |
| SUG_DROPS | Who dropped out of a day's Fun or Nassau group in the app, as `{ DateKey: [PlayerID, ...] }`, so a SignUp Genius import doesn't sign them up again. Past dates are removed automatically. Safe to leave alone. |
| PS_LIST_<date>, FP_LIST_<date>, NP_LIST_<date> | Per-day records of what the pro shop / Fun / Nassau emails last sent, used to work out "what changed" |
| FQ_LIST_<date>, NQ_LIST_<date> | What each group's players last received (the day-before evening emails show "What changed" from these) |
| DR_LIST_<date> | Who dropped out of each group that day, so the next email to that group's players also goes to them as confirmation |
| PS_MORNING | Makes sure the 5 AM change run happens once a day |

The per-date properties are cleaned up automatically once the date has passed.

### 4d. Sheet tabs

Tournament and shared (Code.gs): Settings, Roster, HoleHandicaps, HoleHandicapsRed, PairingsDay1, PairingsDay2, ScoresDay1, ScoresDay2, MatchPins, ScoreLog, Admins, ActivityLog, MemberPins, Handicaps.

Scorekeeper emails (ScorekeeperEmails.gs): ScorekeeperAssignments (made and filled in by hand; not created by `initializeSheets`; see 4f) and ScorekeeperEmailPreview (rebuilt each time Preview is run; holds match PINs).

Sign-up app (LegendsApp.gs): AppSettings, Signups, Closures, Notices, ClubTeeTimes, DayConfig, TeeTimeDuty, Events, SwapRequests, ProShopLog, RelatedFiles, News, ReminderLog, Pairings, Attendance, NassauGameList (the games Larry's Game is picked from, first filled from "Larrys Nassau games.pdf"), NassauGames (the game picked for each play day: DateKey, Game, Forced, SetAt, SetBy).

Roster is the one list of every Legend, shared by the tournament and the sign-up app. Email, phones, GHIN # and emergency contact are private and never sent to the public pages. Member PINs are in MemberPins and never leave the server. Most app settings (email wording, times, switches) are rows in AppSettings and are edited from Admin > Setup, not by hand. The Roster tab also has a `PlayGroup` column (`fun`, `nassau`, `both` or blank), which is the member's Legends email-list choice (see section 7); it is not private and goes to the board's roster.

### 4e. Useful functions to run from the Apps Script editor (Run menu)

- **checkSetup**: confirms the properties are set and the sheet opens, and logs the backend version.
- **installLegendsTriggers**: creates the hourly job. LIVE only. Safe to run twice.
- **initializeSheets**: creates any missing tabs and headers. Doesn't touch existing data.

---

### 4f. ScorekeeperEmails.gs (tournament scorekeeper emails)

**What it does.** For each tournament match that has volunteer scorekeepers listed, it sends one email, for Day 1 and Day 2 separately. The email tells them how to use the live scoring page (live.html on the LIVE site): click "I'm a Scorekeeper", enter the match PIN, which hole they start on, how to save each hole, and what to do if the signal is poor. The PIN comes from the MatchPins tab, the starting hole from PairingsDay1 or PairingsDay2, and the day names (Wednesday/Thursday) from the Day1Date and Day2Date settings. When a match has several scorekeepers it adds a note that only one of them should enter scores.

**How it is run.** There is no trigger and nothing in the app calls it. It is a spreadsheet-bound script that adds a menu called **Legends Scorekeeper Emails** when the tournament spreadsheet is opened (reload the sheet if the menu isn't there). Menu items: Preview Day 1 / Day 2 Emails, Send Day 1 / Day 2 Emails, and Send Test Email (check From address). It only works when opened from the spreadsheet, not from the web app. It is in both the TEST and LIVE Apps Script projects.

**What it needs.**
- A tab named exactly `ScorekeeperAssignments` in the same spreadsheet, with the header row `Day | MatchNum | Name | Nickname | Email`, one row per scorekeeper (a match with three scorekeepers has three rows). Nickname is used in the greeting and is optional; it falls back to the first name from "Last, First". A ready-made template file (ScorekeeperAssignments_template.tsv) was mentioned in the script's comments but was not part of the handover; recreate the tab from the header row if it isn't found.
- Helpers and names from Code.gs (`getSettings_`, `sheetToObjects_`, `getMatchPins_`, `SHEETS`, the Pairings headers). Because of this, don't rename those in Code.gs without checking ScorekeeperEmails.gs.

**How to use it.** Fill in ScorekeeperAssignments, set each match's starting hole and PIN in the app, run **Preview**, and read the emails in the `ScorekeeperEmailPreview` tab. Then run **Send**, which lists who is about to be emailed, anything skipped (missing hole, PIN or email) and anything excluded, and asks Yes/No. Delete the preview tab afterwards if you like; it contains PINs.

**Sender.** Every email must come from theheritagelegends@gmail.com. The script checks which Google account is running it. If that account isn't the Legends account, it looks for a verified Gmail "Send mail as" alias for it, and otherwise refuses to send and says why. So: open the spreadsheet signed in as theheritagelegends@gmail.com before sending. Use **Send Test Email** any time to check the "From" line; it reads no spreadsheet data.

**Things to know and do.**
- **The signature is Tom's.** `SK_SIGNATURE_NAME = 'Tom'` signs every email "Tom". When someone else takes over, change it. (The old `SK_SELF_NAME` setting that skipped the sender's own matches was removed on 2026-11-04: every listed scorekeeper, including the sender, now gets an email.)
- **The year comes from the tournament's date** (changed 2026-11-04): this day's Day1Date or Day2Date in Settings, else the other day's date, else the current calendar year if neither is set. So set the Day1Date and Day2Date in Settings before using Preview or Send. The day-name fallback is still Wednesday/Thursday when a date isn't set.
- **Each year, replace the ScorekeeperAssignments rows.** Start New Season does not touch this tab, so last year's names and emails stay until someone changes them.
- **There is no record of what was sent.** Running Send twice for the same day emails everyone twice. The Yes/No box is the only safeguard.
- **Anyone who can edit the spreadsheet can run it.** It doesn't use the app's admin PINs.
- **It always links to the LIVE scoring page**, even if it is run from the TEST sheet. Don't put real scorekeeper emails in the TEST copy of ScorekeeperAssignments.
- **It doesn't use the app's Gmail sending-limit check.** About 18 emails a day is well within the limit, but a large batch should be counted.
- **Changing the file.** It is not part of the web app, so the "New version" step in section 5 should not be needed: paste it in, Save, and reload the spreadsheet so the menu picks it up. Confirm this the first time a change is made, and paste it into both projects as usual.

---

## 5. How to make a change (the deploy routine)

1. Ask Claude for the change, describing what you want in plain words. Attach a screenshot if it helps.
2. Claude gives back whole files with a new version number.
3. **Backend files (.gs)**, for each of TEST then LIVE:
   1. Open the Apps Script project, click the file (e.g. LegendsApp.gs), select all, delete, paste the new file, and Save.
   2. Deploy > Manage deployments > click the pencil on the existing web app deployment > Version: **New version** > Deploy.
   3. Don't use "New deployment", because that gives a new URL and the pages would stop talking to it.
4. **Page files (.html)**, for each of heritagelegendsgolf/test then heritagelegendsgolf/live: on github.com, signed in as TheHeritageLegends, open the repo > Add file > Upload files > drop the file > Commit changes. GitHub Pages updates within a few minutes.
5. Open the TEST site, hard-refresh (Ctrl+F5), and check the footer shows the new Page and Backend versions. Try the change. Then check LIVE the same way.
6. If something breaks on LIVE, roll back:
   - **Backend:** Deploy > Manage deployments > pencil > Version: pick the previous numbered version > Deploy. Apps Script keeps every version, so this needs no saved copy.
   - **Pages:** GitHub keeps every upload. Open the repo > the file > History, open the last good commit, and use "Revert" (or download that version and upload it again).
   - **Code copies:** whoever deploys a change also saves the new files into the Drive folder "Legends app" right after the LIVE check passes, and into the Claude Project's knowledge. Then the Drive folder always holds the last good set.
   - **Data:** the backend backs up the main sheet tabs to the "Heritage Legends Backups" sheet automatically (at most once a day on a save, plus forced before Start New Season), keeping the newest 8 as tabs named Backup_yyyyMMdd-HHmm. Restoring is by hand: copy the rows you need back from that tab.

### 5a. Quick test after every change (TEST first, then LIVE)

1. Hard-refresh (Ctrl+F5) and check the footer/badge shows the new Page and Backend versions. If the badge is yellow and says "LegendsApp.gs ... doesn't match", one of the two .gs files wasn't pasted (or no New version was deployed).
2. Sign in as a member, open a play day, sign up, then remove the sign-up. (On LIVE use your own name and remove it straight away, or skip this.)
3. Sign in as an admin and open every Admin tab the change touched, plus Admin > Info > Members.
4. Open Admin > Setup > Emails and preview one email (e.g. the pro shop list). Preview only; don't send on LIVE.
5. If the change touched pairings, open Pairings > Nassau and Fun Group and check the tables draw.
6. If the change touched the tournament, open live.html and tournament-admin.html and check the badges show the right backend.
7. Then try the specific thing that changed.

Most mistakes so far came from forgetting step 3.2 (the page updated but the backend didn't, which gives errors like "Unknown reminder"). If the footer's Backend version is old, the redeploy didn't happen. On 2026-11-07 LIVE showed the new Backend version but still ran an old LegendsApp.gs (an admin could save 12 tee times past the 9 cap); since 2026-11-07b the badge catches that.

---

## 6. Admins and permissions

- Admins are rows in the Admins sheet with a PIN, managed on Admin > Info > Admins.
- Rights: **Full**, **View** (see everything, change nothing, PINs hidden), or **Limited** (a set of pages: duty, days, events, handicaps, pairnassau, pairfun, noshows). Limits are enforced on the server (requireAdmin_ and LIMITED_PAGES_ in Code.gs), not just hidden in the page.
- Removing a Full admin, or turning one into Limited, needs a second admin to agree.
- If two admins have Admin pages open at once, a red banner names the other one.
- Current limited admins (as of 2026-10-25): DC Colt (First Tee Time), Bob Dunbar (Tee Time Duty), Jim Salisbury (Events).
- Full admins besides Tom (as of 2026-11-10): Tommy Gurganus (backup admin, also has code rights) and Tom Bacca (Full admin rights in SUN).

---

## 7. Feature notes and league rules Claude must respect

These are decisions Tom and the league made. Don't undo them without being asked.

**Tees.** The choices, in this order, everywhere: Red, Gold/Red, Gold, White/Gold, White, Blue/White, Blue. No Black/Blue or Black. "Red/Gold" was renamed "Gold/Red". Ratings and slopes are in HCP_TEES in index.html; the sign-up list is the TeeOptions setting.

**Handicaps.** There's no GHIN API (GHIN's terms ban scraping), so an admin uploads the weekly GHIN "Handicap Index & Course/Playing Handicap Report" each Sunday on Admin > Info > Handicaps (xlsx, csv, PDF or pasted rows). It matches by GHIN #, then by name. Index and preferred tee live in the Handicaps sheet. Course handicap = ROUND(HI x slope / 113 + rating - par). ExtraStrokes on the Handicaps sheet are added.

**Fun Group pairings** (made automatically once sign-ups close, or Make/Redo on Admin > Pairings > Fun Group). Rules, most important first: nobody alone on a nine; at most one nine-holer per foursome; no threesome that drops to a twosome at the turn; same tees together; avoid 3 riders + 1 walker; avoid frequent repeat partners; first/last group wishes from the sign-up note. Handicap is NOT a rule: mixing high and low handicappers in the Fun group is fine (removed 2026-11-15; don't add it back). Changes after a hand edit or after the pro shop list goes out only move as few people as needed. Admins can add a Legend who didn't sign up and remove anyone (recording late drop / no-show). **Players can't request partners. Tom decided this; don't suggest it.**

**Nassau pairings / Larry's Game.** Made at 6 AM on a play day if none exist. Pairing names Aces, Kings, Queens, Jacks, Tens, Nines, Eights, Sevens, Sixes (tee letters A, K, Q, J, 10, 9, 8, 7, 6). Players are ranked by index into bands A-D. Layout (`laPairBase_`, since 2026-11-07a): ceil(players / 4) pairings, short pairings tee off first. One or two short pairings get that many blinds; three short pairings play Stableford with no blinds (13, 17, 21); if every pairing is short they are equal threesomes. Equal threesomes replace blinds when the count divides by 3 and the day has enough Nassau tee times (15 = five threesomes; 18 = six threesomes only on a day with at least 6 Nassau tee times). The number of pairings is limited only by that day's Nassau tee times (`laNassauMaxGroups_`, at most 9); the old five-pairing limit was lifted 2026-11-07. Blinds: each short pairing has one open column, filled by the player right below it; no one is a blind more than once in five rounds. "Not in bet" players play but are kept out of the betting teams. The Larry's Game email card has Copy, Print/PDF, Word (.docx) and Excel buttons.

**Tee times per day (2026-11-07a).** At most 9 tee times a day in all, Fun + Nassau, split however the admin enters them on Admin > Setup > First Tee Time (`LA_MAX_TEE_TIMES_`). A blank box counts as the usual number, and the usual Fun + Nassau numbers in Sign-up rules can't add up to more than 9 either. The input boxes stop at 9.

**Larry's Game picked at random (added 2026-11-01).** Admin > Pairings > Nassau has a "Larry's Game for upcoming days" card. Each play day gets a random game from the NassauGameList tab, avoiding games used on nearby days. Admins can force a game or ask for a new random one. If the sign-ups call for Stableford, the game is Stableford. Picks are stored in the NassauGames tab. The action is `legendsNassauGamesSave`; it is in `LIMITED_PAGES_.pairnassau`, so a limited admin with that page can use it. Nassau pairings that were made with no game (for example before the picks existed) show and email that day's pick instead, or Stableford if the player count needs it (`laPairRead_`, added 2026-11-01e).

**Tee Time Duty is generated in the app (added 2026-11-01).** Admin > Tee Time Duty has a Quarter assignments card with three tabs (Generate Assignments, Import Assignments, which is the spreadsheet paste, and Delete Assignments), plus Swap weeks. Don't change these rules without being asked:
- **Weekly pattern:** two people in person (Mon, Wed, Fri) and one phone-in, with the phone-in person taken from the "Phone-in only" list first. Everyone eligible gets one week. People left over sit out, starting with those who have sat out least often and longest ago, so nobody sits out twice before everyone else has sat out once. Nothing is saved until Save duty.
- **Quarters** run from the Monday of the week holding Jan 1, Apr 1, Jul 1 or Oct 1 to the Friday before the next one (`laQuarterOf_` on the server, `quarterOf` in the page). Q1 2027 is Mon Dec 28, 2026 to Fri Mar 26, 2027.
- **Delete Assignments** removes every assignment in a future quarter (it saves an empty range through `legendsSaveDuty`). Deleting rows in the TeeTimeDuty tab also works. **Swap weeks** trades two people's days, or gives one person's days to someone with no duty.
- **Heavy-demand days:** the busy rounds themselves, for example Mon, Jan 18, 2027 (MLK Day). The duty day that books that round (Mon, Jan 4, two weeks earlier, or whatever its target round is set to) is the heavy duty day. Its row shows "Heavy day Jan 18: need three in-person" and the page works this out with `heavyRoundFor`. On these days three people go in person, and the week's phone-in person stays on as a backup. The admin form asks for the duty day ("Need 3 in-person on") and "Due to" (for example "Martin Luther King Day"), shows the "Date of event" 14 days later, and stores the event date. Generate adds the third in-person person, and the reminder email names the reason (`laHeavyDays_(st)[info.target]`).
- **Who does tee time duty:** editable lists of Phone-in only, In-person only, HGC non-member and Medical leave, each with a reason. Non-members and people on medical leave get no duty, and inactive members never do. Names that break the lists show in red in the table, and a Show drop-down lists one category at a time. Dates on this page always show the year.
- **Arrival times:** in person, 2 hours before the club's first tee time; phone-in, 30 minutes before.
- **Import:** Admin > Tee Time Duty > Import a quarter (`parseDutyPaste`) works out each date's year from the first date pasted, so quarters that cross New Year come out right (fixed 2026-10-29).
- **Storage**, all in AppSettings and admin-only (removed from what members receive by `laPublicSettings_`): `DutyLists` (JSON `{ PlayerID: { s: 'phone'|'inperson'|'nonmember'|'medical', r: reason } }`, filled once from Tom's 2026-11-01 list by `laSeedDutyLists_`), `DutyHeavyDays` (JSON `{ round DateKey: reason }`, for example `{ "2027-01-18": "Martin Luther King Day" }`: the key is the date of the busy round, not the duty day, since Page 2026-11-01i; `laHeavyDays_` also still reads the older comma-separated form), and `DutySitOuts` (JSON `{ '2027-Q1': [PlayerIDs] }`, recorded by `laUpdateSitOuts_` whenever a save touches a quarter, for everyone eligible with no duty that quarter; a quarter with an empty week has no record). The action that saves the lists and heavy days is `legendsSaveDutySetup`, which is in `LA_WRITE_ACTIONS_` and in `LIMITED_PAGES_.duty`.
- **Reminder wording (changed 2026-11-01):** the in-person text now asks the person to request in-person tee times, arrive at the club by `{latest}` (preferably `{arrive}`), park in the circle behind the last car in line, request 9 tee times starting at the earliest available time two weeks ahead, and text the first time to three named people (DC, Ray and Bob D, with their phone numbers). The phone-in text uses the same "TEXT" line. `{latest}` is a new placeholder: 90 minutes before the club's first tee time (6:30 when the club starts at 8:00). The email's headline says "arrive by {latest} (preferably {arrive})". `DutyTextVersion` swaps the old default wording for this once; wording an admin wrote is left alone. The phone numbers live in LegendsApp.gs, not in the public pages; keep them out of public places.
- **Closed on the duty day (added 2026-11-15d).** If the club is closed on a Tee Time Duty day itself (Christmas Day, a snow day), the club lets us request tee times early. Enter the closure under Admin > Closures & notices and tick **Pro shop closed too**. Leave that box unticked for an outside event, when members can't play but the pro shop is open and takes tee time requests: duty that day stays put (closures entered before 15d start unticked). SUN then moves that day's duty to the closest earlier open day with no other duty and not in the past (e.g. Fri Dec 25 to Thu Dec 24), still booking the same round (Fri Jan 8). The people on duty get the reminder the evening before the new day, with "a day early, club closed <date>" in the subject and a note in the email; the app shows "A day early: club closed <date> (<reason>)" on the Duty tab, My Tee Time Duty and the admin duty table, and the closed day's tee sheet card says where the duty went. Open swap requests follow the duty. If the closure is removed before the duty, it moves back. If it can't move (closure entered too late, or the days before are taken), the admin save message says so and the duty shows "check with the Tee Times Manager"; move it by hand with "Add an extra duty day". Code: `laMoveDutyForClosures_` in LegendsApp.gs runs after closures or duty are saved, after a SignUp Genius import adds closures, and every hour before the reminders; only closures with `ShopClosed` TRUE count (`laShopClosedBy_`). New columns, added on the first save: `MovedFrom` on the TeeTimeDuty tab (the original, closed day) and `ShopClosed` on the Closures tab.
- **Export (added Page 2026-11-16a).** Under the duty table, **Download spreadsheet** and **Print / PDF** export the dates shown (From–To), including unsaved changes. The .xlsx (built in the page with ExcelJS, `downloadDutyExcel`) has tabs Assignments (one row per person per duty day: Date, Day, Duty = In person/Phone in, Name as on the roster, Tee times for, Notes), By person, one tab per "Who does tee time duty" group (In person or phone, Phone-in only, In-person only, HGC non-member, Medical leave: Name, Reason), Heavy days, and How to use. Rows copied from the Assignments tab paste straight into Import Assignments: `parseDutyPaste` reads a full date (01/04/2027, Mon 01/04/2027 or 2027-01-04) followed by the Duty and Name columns, and a Tee times for date that differs from the usual round is kept. Print / PDF (`printDutyList`) opens a print page with the assignments by day and the four duty lists; choose Save as PDF. No emails or phone numbers are exported.

**SignUp Genius import remembers app drop-outs (added 2026-11-04).** Admin > Sign-ups has an import from SignUp Genius. SignUp Genius closes two days ahead, so it can't show late changes made in the app. When someone drops out of a day's Fun or Nassau group in the app (not the automatic move to the other group), `laSugDropAdd_` records it in the `SUG_DROPS` script property. A normal import ("Make the app match SignUp Genius" unticked) then skips those people and the result says how many ("skipped N who dropped out in the app"). Ticking the box still makes the app an exact copy of SignUp Genius and clears those dates' remembered drop-outs. TEST and LIVE each have their own `SUG_DROPS`.

**"Nassau players for tomorrow" email layout (changed 2026-11-04).** It now looks like the Larry's Game email: the message you wrote, then a Nassau Group box (date, "N Players signed up", tee time, Larry's Game time), a STANDBY box, then everyone by Handicap Index in two columns with Tees, Index and Handicap. The old colour-coded names and the *, ** and + suffixes are gone, and so is the tee key; the Tees column spells out the tees (Red, White/Gold and so on). The text version of the email lists the tees the same way. Larry's Game uses the same table (`laIdxTable_`).

**Players who drop out after Nassau pairings are made (changed 2026-11-04).** Pairings, blinds, "not in bet" and the pairing emails leave out anyone who is no longer signed up. A player who has been removed still shows his tees, index and handicap from the Handicaps tab (his usual tees if he has none).

**Legends email list choice (added 2026-11-01, Page 2026-11-03a / Backend 2026-11-01i).** My Info asks every member which Legends email list they want to be on: the Fun Group, the Nassau Group or both (a required answer when saving My Info). A member who hasn't answered gets My Info opened automatically once per visit. The answer is stored in the Roster tab's `PlayGroup` column (`PLAY_GROUPS_` in Code.gs); the column is added to `ROSTER_HEADERS` and shows up the next time the roster is written. It is also in `ROSTER_MEMBER_FIELDS`, so a save from tournament-admin.html, which doesn't send it, doesn't erase it. Admins see and set it in the "Email list" column on Admin > Members.

Tom keeps the Fun and Nassau Google Groups up to date by hand, so every change, including a member's first answer, sends an email to the Legends admin address through `notifyPlayGroupChanges_` in Code.gs. It goes to the `AdminEmail` setting (if that is blank, nothing is sent), uses MailApp, and a failed email never stops the save. One email is sent per My Info save; one email covers all the changes in a single Members-page save. Because MailApp counts against the daily email limit that the reminders also use, a very large number of first-time answers on one day could use up the limit; the other emails in the app stop early when it is low, but this one doesn't check.

**Clearing a tee-duty slot (Page 2026-11-03a).** In the admin duty table, a filled slot's drop-down now starts with "✕ Clear (no one)" instead of a blank line.

**Tournament, each year.** On tournament-admin.html (signed in as admin), Settings has a red "Start New Season…" button. It runs startNewSeason, which first forces a data backup, then archives this season's Settings, Roster, Pairings, Scores, MatchPins and ScoreLog into hidden "Archive_<label>_<Sheet>" tabs, and resets team assignments, pairings, scores, scorekeeper PINs, the score change log and the year's Settings fields. Rehearse it on TEST (add ?env=test) before doing it on LIVE. Then set up the new teams and pairings on the same page. One thing it does not do: it leaves the `ScorekeeperAssignments` tab alone. So, before sending the new year's scorekeeper emails: replace the ScorekeeperAssignments rows with the new volunteers, set the new Day1Date and Day2Date in Settings (the emails take the year from them), set the new match PINs and start holes, then Preview and Send as described in 4f.

**Email timing and recipients (2026-11-05 to 2026-11-06).**
- **5 AM change run** (`laProShopMorning_`, inside legendsHourly, once a day via PS_MORNING): after the combined pro shop list has gone, changes are gathered overnight and sent at 5 AM: the Fun and Nassau change emails if they're on, then an UPDATED combined list only if a group without its own change email changed.
- **Play day after 5 AM** (`laPlayDayLive_`): Fun and Nassau change emails go out right away, but not to the pro shop (they already know who's at the club), and there are no combined-list updates.
- **Day before play:** if that group's evening email (Fun Group players for tomorrow / Nassau players for tomorrow) is on and not yet sent, the change emails skip the players and the evening email shows a "What changed" note instead (`laSkipPlayers_`, `laPlayersChangeNote_`).
- **Drop-out confirmation** (`laDropAdd_`): someone who drops out also gets the next email that goes to that group's players, so they see it confirmed.
- **Last day to sign up** reads "There is still time to sign up to play on {date}! There are X slots open in the Fun group and Y slots open in the Nassau group," then the close time. It goes to everyone not signed up (Tom: people may switch groups), and is skipped only if both groups are full. `{weekday}` and `{date}` work in its message and footer.

**Google Groups (2026-11-05 to 2026-11-06).** Admin > Setup > Emails > All emails card holds the group settings. If `DailyGroupEmail` (the All Legends group address) is set, "All Legends" on every email means that one group address, in To, instead of one copy per member, which keeps the app well under Gmail's daily limit. Any email that goes to a @googlegroups.com address gets the group note (`DailyGroupNoteText`). The app reads group members from Google (cached 30 minutes), but Google hides members without a Google account (for example aol.com and nc.rr.com addresses), so those are listed by hand in `DailyGroupMembers`, one line per group: `group: a, b`. Use **Check the group** to see who the app thinks is in it. Direct copies are dropped only for members the app actually knows; if the group can't be read, nobody's direct copy is dropped. theheritagelegends@gmail.com is the groups' owner; posting is limited to managers. The Fun and Nassau groups are planned but not wired in yet.

**Emails** (Admin > Setup > Emails lists them all in send order; each also has its settings on the page it belongs to):
1. Last day reminder
2. Pro shop list: the combined list, always first, at sign-up close (ProShopHour)
3. "Changes in Fun Group Pairings": only to the pro shop, Fun players and admin, with a "What changed" note
4. "Changes to Nassau Pairings": the same for Nassau, only after Larry's Game has gone
5. Sign-up summary (the day-before summary)
6. Tee Time Duty reminder
7. Fun Group players for tomorrow
8. Nassau players for tomorrow (copy of Tom Gurganus's hand-sent email; default Off)
9. Larry's Game email (the admin previews and sends; auto-send is optional)
10. Moved up from standby

The rule behind 3 and 4: don't email one group about the other group's changes. Gmail has a daily sending limit; the app checks it and warns.

### Tournaments: $10, $5 and Annual (2026-11-23, Page/Backend 2026-11-23a, rule fixed in 23b)

- The "Annual Tournament" tab is now **Tournaments**, with $10 / $5 / Annual buttons. Tournaments are set up on Admin › Setup › Tournaments (sheet tab `Tournaments`) and show under **Sign-ups** on their date and in My SUN Snapshot › My Sign-ups, not under Events. Sign-ups use group `tourn:<TournID>` in the Signups tab (event rules: sign-up order, standby).
- On its date a tournament replaces regular play: Who = "Fun and Nassau" replaces both groups ($10: all 9 tee times); "Fun Group only" ($5, 4 tee times) replaces only the Fun Group. Regular sign-ups for a replaced group are refused, and the regular emails for it are skipped (no combined pro shop list on a $10 day).
- Sign-ups open SignupOpens (blank = two weeks before) at the usual opening time and close 11:59 PM on SignupCloses (blank = TournCloseDaysBefore, 3). One round a day: someone in that day's Fun or Nassau group can't join the tournament, and the other way round (My info group doesn't matter, Tom 2026-11-23b). Members pick tees and walking/riding.
- Teams: A/B/C/D bands by Handicap Index, one per team, threesomes first when it doesn't divide by 4; 3000 random tries, closest team averages, fewest partners from the last tournament. Made automatically when sign-ups close, or Make/Redo on the admin page; admins can move players.
- Email "Tournament pairings" (switch TournEmailOn, default Off): the morning after sign-ups close at TournEmailHour (9), To players + standby, Cc pro shop (TournEmailProShop) and admin. Preview / Send now on the admin page; a re-send is marked UPDATED. Logged in ReminderLog as Type `tourn:<id>`.
- Dates (Tom 2026-11-23): $10 = last Wednesday of April–August; Five Dollar Tournament (Kind `five`, renamed from "$5 Tournament" in 23f; the $10 is likewise the "Ten Dollar Tournament", Kind `ten`, since 23g) = second Wednesday of May–September. Setup › Tournaments has a button for each set of dates. The Five Dollar Tournament takes the Fun Group's 4 tee times that day (Who = Fun Group only); the Nassau group plays as usual after them, and regular Fun sign-ups that day are refused.
- Formats (23e): tab TournFormats (Name, Description), seeded once with Tom's six write-ups (Captain's Choice, AB-CD Alternate Shot, Up or Back, Red White Blue & Brave, Five Club Challenge, 1-2-3 Game); edited in the "Tournament formats" box. Picking one in a tournament's Format / game fills its Details. Tournament tees: setting TournTees (default Gold,Red), the only tees offered and accepted for tournament sign-ups.
- 23h: a tournament's blank First tee time box shows the day's time from Setup › First Tee Time in grey (that's the time it uses). On every Admin page, typing in a field turns the Save button for it orange and pulsing until it's clicked (markSaveDue in index.html; pickers and filters are skipped via SAVE_DUE_SKIP / VIEW_OK_FIELDS).
- 23i: on a play day where a tournament replaces only the Fun Group (the Five Dollar), the Sign-ups day card lists the tournament's players under Fun group, and the header shows its count (e.g. "Fun: Five Dollar Tournament 3/16"). tournChipsHtml / dayTournObj in index.html.
- 23j: that day card's "Click to sign up" list also offers "Sign up · Five Dollar Tournament" (value tourn:<id>, handled by onTournSelect: Gold/Red + walking/riding box), and someone in the tournament sees "Signed up · Five Dollar Tournament ✓" with Remove me, tees and walking/riding, like a regular day. Admins get the "+ Admin: add a player" box for the tournament there.
- 23k / 24a: "+ Admin: add players" (every day card, event and tournament) collects several names first (dashed chips, × to take one off), then "Add N players" saves them all in ONE request (24a, Backend 2026-11-24a): legendsJoin with `many` = JSON [{signupId, playerId, tee, holes}] runs laJoinMany_, which checks each player like a single sign-up, refreshes pairings/emails once, and returns addResult {added, failed}. Anyone who couldn't be added stays on the list with the reason. adminAddQueue / adminAddMany in index.html.
- 24b: tournament email recipients are setting TournEmailSendTo (default legends,proshop,admin,extra; options legends, players, proshop, admin, extra), ticked under "Send to" on the "Tournament settings and email" card, which now also shows on Admin › Setup › Emails. "All Legends" = the Legends Google Group address (DailyGroupEmail, Sign-up summary), 1 recipient toward the ~100/day limit, with the usual group note; with no group address it falls back to the players by name. Players known to be in the group aren't sent a second copy. TournEmailProShop is no longer used.
- Limited admin rights, one per tournament (23c): `tournten`, `tournfive`, `tournannual` (Admin › Info › Admins tick boxes "Setup › Tournaments: $10/$5/Annual"). They let that admin edit only those rows on Setup › Tournaments, make/move its teams, and preview/send its email (REQUEST_ACTION_ gets `:<kind>` via laTournReqKind_). The tournament email settings stay with Full admins. Like Events, limited admins can't add or remove players for others.

---

## 8. Files in this package (latest as of 2026-11-24; newest code: Page 2026-11-26a, Backend 2026-11-26a)

| File | Version |
|---|---|
| index.html | Page 2026-11-26a |
| Code.gs | Backend 2026-11-26a |
| LegendsApp.gs | LA_VERSION 2026-11-26a |
| live.html | LIVE_VERSION 2026-10-06a (the version string wasn't bumped when the LIVE URL was updated on 2026-10-25; bump it next time live.html changes) |
| tournament-admin.html | ADMIN_VERSION 2026-10-07 (same: the LIVE URL was updated 2026-10-25 without a bump) |
| ScorekeeperEmails.gs | No version constant. A new copy was made on 2026-11-04 (year taken from the tournament date, sender no longer skipped; see 4f), replacing the one in the 2026-11-01 zip, which Claude had read on 2026-10-29. It is documented in 4f. It is in both the TEST and LIVE Apps Script projects (copied from TEST to LIVE on 2026-10-25, with the other two .gs files). If it is ever edited, paste the new copy into both projects and replace the file in the Claude Project's knowledge, as with the other files. |

**Check before relying on these:** make sure TEST and LIVE are actually running these versions (footer shows Page 2026-11-26a and Backend 2026-11-26a, with no yellow warning). If not, do the section 5 routine with these files first, so the Claude Project's copies match what's live. From then on, whenever a change goes live, replace the files in the Claude Project's knowledge too, or Claude will work from stale code.

**Change history since the 2026-10-29 handover.**
- **2026-11-26a (Page, Backend and LA_VERSION), the current set:** Two changes (Tom 2026-11-26). (1) Admin › Setup › Tournaments: the **Details** box for each tournament no longer scrolls; it grows to show all its text, adding lines as needed, on load, while typing, and when a format fills it in. It is the `grow: true` flag on the Description column in `renderTournAdmin`, handled by `growBox` and `wireListEditor` (a `data-grow` textarea, overflow hidden, no resize handle); any list-editor column can use `grow: true` the same way. (2) The Game-day Pairings email subject is now "Nassau Game-day Pairings for <date>" ("and Larry's Game" removed) in LegendsApp.gs, in the function that builds the Nassau pairings email (the line with `subject:` after the `html` is made). The email body and the Admin › Pairings › Nassau hint text still mention Larry's Game; only the subject changed. Code.gs changed only by its version, kept in step with LegendsApp.gs as the guide requires.
- **2026-11-24e (Page only), earlier:** The Sign-ups tab shows a centered, bold line "Restroom Passcode - ####" directly above the "Upcoming Dates" heading (Tom 2026-11-24). It is typed straight into `renderSignups` in index.html (a `<p class="signup-restroom">`, styled by the `.signup-restroom` rule), so changing the code means editing that line and uploading index.html to both repos. It is in the public page source, so anyone who views the source on GitHub Pages can read it. It also prints. Code.gs and LegendsApp.gs did not change.
- **2026-11-24d (Page only), earlier:** On My SUN Snapshot, the signed-in member's name beside the heading (for example "· Tommy Gurganus") is now shown at three-quarters the size of the "My SUN Snapshot" heading (Tom 2026-11-24). It is a `<span class="snap-who">` inside the h2 in `renderSnapshot`, styled in the `.snap-head h2 .snap-who` rule (`font-size:0.75em`, normal weight, muted color); it used to be a `hint` span. Because the size is in em, it follows the heading if the heading size ever changes. Tried and replaced along the way: 24c made it half the heading size, which Tom found too small. Code.gs and LegendsApp.gs did not change (Backend stays 2026-11-24b). Note: when this change was made the files were at Page 2026-11-24b and Backend 2026-11-24b, and this guide's change history had no entries for 2026-11-23 to 24b other than the Tournaments notes in section 7; if you need the details of those, read the code.
- **2026-11-22c (Page only), earlier:** On the Away weeks card, "Members can answer starting" now sits directly above "Members can answer until", with Save dates under them (Tom 2026-11-22).
- **2026-11-22b (Page only), earlier:** Admin › Setup › Tee Time Duty has a "Go to:" bar that stays at the top of the screen, with a button for each section (assignments, Away weeks, Quarter assignments, Heavy-demand days, Who does tee time duty, Email settings), plus Collapse all / Expand all / Top. Each section heading has Hide/Show (`sectionNav(el, dutyCollapsed)` in index.html; the hidden set survives redraws). Backend stays 2026-11-22a.
- **2026-11-22a (Page and Backend), earlier:** Admin-set window for the away weeks box (Tom 2026-11-22). The Away weeks card has "Members can answer starting" and "Members can answer until" dates per quarter (AppSettings `DutyAwayOpen` and `DutyAwayDue`, JSON by quarter id; Q1 2027: Nov 15 to Dec 14; otherwise 6 to 3 weeks before the quarter). Members see the box (and the Snapshot banner) only inside that window; outside it the box is hidden. The reminder emails count from the start date.
- **2026-11-21a (Page and Backend), earlier:** Away weeks for Tee Time Duty (Tom 2026-11-21). The Tee Time Duty tab has a box "Weeks I can't do duty next quarter": each signed-in member ticks their own away weeks and can add a note; they see only their own (`board.dutyAway.mine`), admins see everyone's (`dutyAway.all`). The box opens 6 weeks before the quarter and is due 3 weeks before (`LA_AWAY_OPEN_DAYS_`, `LA_AWAY_DUE_DAYS_`); admins can set a different due date per quarter (AppSettings `DutyAwayDue`, JSON `{ "2027-Q1": "2026-12-14" }`, Q1 2027 due Mon Dec 14 per Tom). After the due date only an admin or a swap can change things. Admin › Tee Time Duty has an **Away weeks** card at the top (quarter, due date, who has answered, inline editor, and "Fill in from a list" for canvassed answers: one line per member like `Hope, Bob, Jan 11 - Jan 22; Mar 15`). Anyone with duty in the month before a quarter (e.g. December) is kept out of the quarter's first month automatically ("auto"), every quarter. Generate assignments never uses an away or auto week; Swap weeks and members' swaps warn first. Members can now swap a **whole week** (all three days, `Week` column on SwapRequests) as well as single days. New tab `DutyAway` (Quarter, PlayerID, Name, Weeks, Note, Done, UpdatedAt, UpdatedBy), action `legendsDutyAwaySave` (in LA_WRITE_ACTIONS_ and LIMITED_PAGES_.duty). Reminder emails to members who haven't answered: switch `DutyAwayEmailOn` (Admin › Setup › Emails, "Away weeks reminder", Off to start), sent at 9 AM on the day the box opens, weekly after, and 2 days before the due date (`laDutyAwayHourly_`, logged in ReminderLog as `dutyaway`). Members who haven't answered also see a banner on My SUN Snapshot.
- **2026-11-20d (Page and Backend), earlier:** Self-service PIN reset (Tom 2026-11-20). New switch PinResetEmailOn (Admin › Setup › Emails, "Forgot your PIN?" reset code, Off to start). When On, the PIN step of sign-in shows **Forgot your PIN?**; `memberPinResetRequest_` (Code.gs) emails a 6-digit code to the address on file (via laSendEmail_, so TEST sends it only to the owner account), kept in the script cache for 15 minutes and 5 tries; `memberPinResetConfirm_` checks it and saves the new PIN. Limits: one code a minute per email, 30 an hour in all; emails shared by two members still need an admin. Logged as "Asked for a PIN reset code" and "Member reset PIN with an emailed code". Admin reset still works as before.
- **2026-11-20c (Page only), earlier:** Fun Group sign-ups (Tom 2026-11-20): choosing Fun (sign up, "also play", or switch to Fun) opens a box (`funPick`) with Tees, Holes and Walking/Riding, all starting blank; nothing is saved until all three are chosen and Sign up is clicked (Cancel saves nothing). Walking/Riding is now a dropdown everywhere a member picks it (the card under a Fun sign-up and the older join form, which also requires all three). Admin add and the SignUp Genius import are unchanged.
- **2026-11-20b (Backend only), earlier:** The Game-day Pairings email's subject is now "Nassau Game-day Pairings and Larry's Game for Friday, November 20" (Tom 2026-11-20; laPairBody_ in LegendsApp.gs).
- **2026-11-20a (Page and Backend), earlier:** On Admin › Pairings › Nassau the email card is now "Game-day Pairings email" (Tom 2026-11-20), matching its name on Admin › Setup › Emails; the "Larry's Game:" box, "Larry's Game for upcoming days", the email's subject and its body still say Larry's Game, as Tom wants. The late drop-out note to the admin now says the standby player was emailed only when the "Moved up from standby" switch (StandbyEmailOn) is On. LA_VERSION and BACKEND_VERSION bumped together.
- **2026-11-18a (Page only), earlier:** The Sign-ups tab shows round dates from today through two weeks from today, 15 days counting today (`SIGNUP_DAYS = 15`, Tom 2026-11-18), headed "next 2 weeks". Code.gs and LegendsApp.gs did not change.
- **2026-11-17e (Page and Backend), earlier:** LIVE → TEST data copy (Tom 2026-11-17, button only, never the other way). The TEST Apps Script project has the Script Property LIVE_SPREADSHEET_ID (never set it in LIVE); with it, `laIsTestCopy_()` is true and (1) Admin shows a "Copy LIVE data into TEST" card (`legendsCopyFromLive` → `laCopyFromLive_`, full admins only; also `copyLiveToTest()` from the editor). It backs TEST up, then copies every tab of the LIVE sheet except ActivityLog over TEST's (values and number formats, leftovers cleared), keeps TEST's own email switches, address lists, SendTo/CopyTo, DailyGroup* and SiteUrl (`laTestKeepsSetting_`), raises ROSTER_MAX_ID, and logs "Copied LIVE data into TEST". The LIVE sheet is only read. (2) Every email TEST sends (`laSendEmail_`, used by all app mail; `skSend_` in ScorekeeperEmails.gs) goes only to the account running the script, subject "[TEST] ...", with the real To/Cc/Bcc listed at the top. Page 2026-11-17d (Tommy Gurganus, 2026-11-17: Larry's Game card moved to the bottom of the Nassau page) is included.
- **2026-11-17d (Page only, Tommy Gurganus):** Larry's Game for upcoming days moved to the very bottom of Admin › Pairings › Nassau.
- **2026-11-17c (Page and Backend), earlier:** Root cause of the emails turning back on (LIVE, between Nov 7 and Nov 14; found from the sheet's version history: AppSettings went back to the code's starting values, e.g. ProShopExtraEmails and RemindDuty/RemindPlaying TRUE). `objectsToSheet_` (Code.gs, used for every tab) used to empty the tab and then write it, so a request reading at that moment saw an empty tab; `laSettings_` then treated every setting as missing and saved the starting values over the tab, unlocked and unlogged. Now `objectsToSheet_` writes over the old rows and clears only what's left below (never an empty tab), and `laSettings_` never saves starting values over a tab that read back empty once it has been set up (script property LA_SETTINGS_SEEDED); filling in new settings is logged as "Added new settings". With 17a's Off defaults, even a reset would leave the emails off.
- **2026-11-17b (Page and Backend), earlier:** Fixes a lost-update risk in AppSettings. Every save rewrites the whole tab, and laSaveAppSettings_ used to read the settings before taking the script lock, so two saves at once (e.g. several email switches clicked in quick succession, or a switch click while another admin saved a settings page) could write back each other's old values, with nothing in the Activity log. Now laSaveAppSettings_, laSaveDutySetup_ and laUpdateSitOuts_ read the settings fresh (`laSettingsFresh_`) while holding the lock and change only their own keys. "Changed sign-up settings" in the Activity log now shows the new values (e.g. RemindDuty = FALSE). Page change is the version number only.
- **2026-11-17a (Page and Backend), earlier:** No email goes out automatically unless its switch is On (Tom 2026-11-17, after emails went out on Nov 15-16 from LIVE because the switches had only been turned off on TEST). `laOn_(st, key)` is On only for TRUE; blank or missing is Off, and every email switch default in LA_DEFAULT_SETTINGS is now FALSE (saved values in the AppSettings tab are never changed by a code update). The updated combined pro shop list needs both the pro shop switch (ProShopAutoSend) and its "updated list" tick (ProShopResend). Three emails that had no switch now have one on Admin › Setup › Emails, Off to start: LateDropEmailOn (late drop-out note to the admin), SwapEmailOn (duty swap emails; requests still show in the app) and ListChangeEmailOn (email list change note to the admin, in Code.gs). Admin "Send" / "Send now" buttons still send by hand. All three files changed; LA_VERSION and BACKEND_VERSION bumped together.
- **2026-11-16b (Page only), earlier:** The top tabs are now My SUN Snapshot, Sign-ups, Tee Time Duty, Events, Roster, Handicaps, Related Files, Annual Tournament, Admin. **My SUN Snapshot** (`renderSnapshot`) is the landing page for members: swap requests to answer, Legends News, then MY TEE TIME DUTY, MY SIGN-UPS and MY EVENTS (each with Signed up, then Available under it, in a `.snap-grid` of two columns on screen, three when printed and one on a phone, built by `mySummaryHtml`), and a Print button. A sign-in as admin only still lands on Admin; its snapshot says to sign in with a member PIN. **Events** (`renderEvents`) lists every upcoming active event as cards. **Sign-ups** (`renderSignups`) now shows only round dates in the next 14 days (`SIGNUP_DAYS`), with no events and no snapshot. Handlers shared by the three tabs call `renderCurrent()` so they redraw whichever tab is open. Code.gs and LegendsApp.gs did not change.
- **2026-11-16a (Page only), earlier:** Tee Time Duty export to a spreadsheet or PDF, and Import Assignments reads the exported Assignments rows (see "Export" in section 7). Code.gs and LegendsApp.gs did not change.
- **2026-11-15d (Page and Backend), earlier:** Closures get a "Pro shop closed too" tick; Tee Time Duty on a day the pro shop is closed moves to the closest earlier open day and keeps its round (see "Closed on the duty day" in section 7). All three files changed; LA_VERSION and BACKEND_VERSION bumped together to 2026-11-15d.
- **2026-11-15 (Page 2026-11-15c, Backend 2026-11-15a), earlier:** Fun Group pairings no longer try to put similar handicaps together (the LA_FUN_HCP_ rule and its scoring line were removed from LegendsApp.gs, and the matching sentence from the Fun Group description in index.html). The "Game-day Pairings" email description under Admin > Setup > Emails now says "Game-day Pairings" instead of "Larry's Game" (Page 2026-11-15b, included in 15c). The other "Larry's Game" wording elsewhere in the app was left as it was. LA_VERSION and BACKEND_VERSION were bumped together to 2026-11-15a.
- **2026-11-07b (Page and Backend), earlier:** LegendsApp.gs has its own LA_VERSION, reported by Code.gs's getVersion; the version badge turns yellow if it doesn't match. Uploaded together with 07a.
- **2026-11-07a (Page and Backend):** at most 9 tee times a day (Fun + Nassau), split freely; the five-pairing Nassau limit lifted (pairings up to the day's Nassau tee times, names to Sixes); pairing layout now computed (section 7).
- **2026-11-05 and 2026-11-06 sets:** 5 AM change run, play-day-live change emails, day-before "What changed" in the evening emails, Google Groups support with Check the group, All Legends = group address, new Last day to sign up wording and recipients, drop-out confirmation, STANDBY and Tees rows inside the Larry's Game grid, the email-list change email now points to Admin > Info > Members, and fake example addresses in index.html (section 7).
- **2026-11-01f (Page) and 2026-11-01e (Backend), earlier in the day:** the tee-duty import year fix, Tee Time Duty generated in the app, Larry's Game picked at random, the new reminder wording, heavy days with a reason, the three-tab quarter card, and the Nassau game fallback (all described in section 7). This replaces the earlier 2026-11-01c set. live.html, tournament-admin.html and ScorekeeperEmails.gs did not change (its copy was added to the zip on 2026-11-01). Since 2026-10-28, Code.gs has changed only in the version and the two `LIMITED_PAGES_` entries.
- **ScorekeeperEmails.gs, changed 2026-11-04 (no version constant):** the email's year now comes from the tournament date, and `SK_SELF_NAME` was removed so the sender gets an email like every other listed scorekeeper. Paste the new copy into both Apps Script projects and replace the file in the Claude Project; no New version is needed for this file.
- **2026-11-04c (Page and Backend), earlier:** Nassau pairings now avoid blinds where they can (15 players = five threesomes) and never make more than five pairings, so the limit is 20 players on the course instead of 24. The admin page says so ("pairings handle at most 20 (five pairings)"). Code.gs changed only in the version; LegendsApp.gs has the layout change, index.html has the messages. live.html, tournament-admin.html and ScorekeeperEmails.gs did not change. If a day gets more than 20 sign-ups, check the pairings by hand, because the 6 AM run quietly makes none.
- **2026-11-04b (Page and Backend), earlier:** the SignUp Genius import now remembers app drop-outs (new `SUG_DROPS` script property), the "Nassau players for tomorrow" email and Larry's Game share a new table layout with a Tees column, and pairings leave out anyone who has dropped out (all in section 7). Code.gs changed only in the version; LegendsApp.gs has the real backend changes; index.html has the import wording and the email descriptions. live.html, tournament-admin.html and ScorekeeperEmails.gs did not change. Before going live, check the Nassau tomorrow and Larry's Game emails on TEST, since the look changed.
- **2026-11-03a (Page) with 2026-11-01i (Backend), earlier:** the Legends email list choice in My Info and on the Members page, with an email to the admin on every change (section 7), and "✕ Clear (no one)" in the tee-duty slots. Code.gs now has the new `PlayGroup` roster column and `notifyPlayGroupChanges_`; LegendsApp.gs changed by one line (it returns `PlayGroup` in the member data); live.html, tournament-admin.html and ScorekeeperEmails.gs did not change. Heads-up when going live: the first time the roster is written, the `PlayGroup` column is added to the Roster tab; every member will be asked to choose once, and each answer emails the admin.
- **2026-11-01i (Page) with 2026-11-01g (Backend), earlier:** heavy days are stored by the event (round) date, and the admin form is labelled "Need 3 in-person on / Due to / Date of event". The reminder email now looks up the heavy reason by the duty day's round date (`laHeavyDays_(st)[info.target]` in `laBuildReminders_`), so it matches. Closed-club wording: when the round a duty day books falls on a closure (for example Fri, Dec 25), the duty day says "No need to get tee times today. Club closed in two weeks, <date>, for <reason>." The admin duty table, the Tee Time Duty tab, the tee sheet's duty line and the reminder email ("No need to get tee times tomorrow, <duty day>. Club closed in two weeks, <date>, for <reason>.") all use it (`dutyClosedNote` in index.html). The closure must be entered under Admin > Closures & notices. Code.gs changed only in the version. **Heavy days saved before this set are keyed by the duty day and must be removed and re-entered with the new form**; the page now reads them as event dates and will show the wrong duty day.
- **How it went live:** paste LegendsApp.gs and Code.gs into both Apps Script projects (TEST and LIVE) and make a New version under Manage deployments; upload index.html to both GitHub repos (heritagelegendsgolf/test and heritagelegendsgolf/live); check the footer on both sites. Not yet tested by Claude: the new generate, sit-out and heavy-day behavior, which should be tried on TEST after any further change to that area.

---

## 9. Making it easier later (optional)

- In the new Claude account you can connect GitHub as **TheHeritageLegends**. Claude Code can then commit page changes to heritagelegendsgolf/test and /live itself, so nobody has to upload by hand. Keep that account separate from Tom's Gibson Group GitHub (HeritageGibsonGroup).
- You can also connect Google Drive as theheritagelegends@gmail.com, so Claude can save new file copies to the "Legends app" folder (ID 1i9AslabpQcOuA85qHYd73MATAvhsyTQi). It can't upload index.html there, because the file is too big for the connector.
- Apps Script still needs the copy-paste-redeploy step by a person. That's the safest arrangement for a volunteer-run league anyway.
- Put one copy of this guide in the "Legends app" Drive folder too, so the league has it even without Claude.

---

### 9a. Giving someone access, and protecting against misuse (2026-11-07)

Full write-up: "Giving a second person full SUN access" (Claude Doc in Tom's account). In short:
- Everyone uses their own Google, GitHub and Claude accounts; nobody but Tom signs in to the Legends accounts. Share the "Legends app" Drive folder and the LIVE and TEST sheets as Editor (untick "Editors can change permissions and share"), add them as GitHub collaborators on heritagelegendsgolf/test and /live, make them Google Group managers (not owners), and Full admins in SUN with their own PIN.
- The Legends accounts stay the owners, so they can always roll back (Sheets version history, Apps Script versions, GitHub history) and cut access. Keep at least two Full admins in SUN.
- Emergency access: the Legends Google and GitHub passwords and backup codes live in Bitwarden with Emergency access set to a 14-day wait for a named backup. Google's Inactive Account Manager is not a substitute (3 months minimum, data download only).
- Drive layout: "Legends app" folder (shared) holds the code files, this guide, the LIVE and TEST sheets and the SUN vs SignUp Genius risk summary; a "Legends private" folder (never shared) holds the Heritage Legends Backups sheets. Recovery codes don't belong in Drive at all.
- Not yet tested: whether emails still come from the Legends account after someone else deploys a New version. Check with a test email the first time.

---

## 10. Keep this guide private

The guide includes sheet IDs, script ID prefixes and the web app URLs. None of these are passwords, but keep the guide with the league (the Claude Project and the Drive folder) and don't post it publicly. Passwords, PINs, SECRET_KEY and MEMBER_TOKEN_SECRET are deliberately not in it; keep those in a password manager or a sealed note held by a league officer.
