/**
 * LegendsApp.gs — Heritage Legends sign-ups & tee time duty (index.html).
 *
 * Add this as a SECOND script file in the same Apps Script project as
 * Code.gs (File > + > Script, name it LegendsApp). Apps Script shares one
 * global scope across files, so this uses Code.gs's helpers (openSpreadsheet_,
 * sheetToObjects_, objectsToSheet_, requireAdmin_, requireMember_,
 * logActivity_, maybeBackup_, ...) and Code.gs sends every "legends*" action
 * here (see the default branch of handleRequest_).
 *
 * Everything here needs either a signed-in member (token) or an admin PIN.
 *
 * Tabs it creates on first use (all plain text, so dates stay "YYYY-MM-DD"):
 *   AppSettings   Key | Value                — sign-up rules, duty instructions
 *   Signups       one row per sign-up, in the order people signed up
 *   Closures      DateKey | Reason | ShopClosed — no Legends tee times that day; ShopClosed TRUE = the pro shop
 *                 is closed too (Christmas, snow), so tee time duty that day moves earlier (Tom 2026-11-15)
 *   Notices       DateKey | Text             — a note shown on that date
 *   ClubTeeTimes  EffectiveDate | FirstTeeTime — the CLUB's first tee time
 *   DayConfig     per-date overrides: Legends first time, group times, slots
 *   TeeTimeDuty   DateKey (the day duty is done) | Role | PlayerID | Name | TargetKey | MovedFrom
 *                 (MovedFrom: the duty day the club is closed on; the row moved earlier, see laMoveDutyForClosures_)
 *   Events        banquet, $5/$10 tournaments, divot day, ...
 *
 * EMAIL: sign-ups send two kinds of email from the account that owns this
 * script (theheritagelegends@gmail.com): to a standby player who moves up,
 * and to the admin address when someone drops out after sign-ups close.
 * After pasting this file, run authorizeLegendsEmail once from the editor
 * (choose it in the function menu, click Run, approve the prompt).
 */

function authorizeLegendsEmail() {
  Logger.log('Remaining email quota: ' + MailApp.getRemainingDailyQuota());
}

// Run ONCE from the Apps Script editor (select it, click Run, approve) to start
// the hourly job that sends each round's players list to the pro shop when
// sign-ups close. Running it again does no harm — it never makes a second copy.
// Run ONCE from the Apps Script editor (select it, click Run, approve) so the
// app can keep the Related Files in a Google Drive folder.
function authorizeLegendsDrive() {
  Logger.log('Related Files folder: ' + laFilesFolder_().getName());
}

function installLegendsTriggers() {
  const have = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'legendsHourly');
  if (!have) ScriptApp.newTrigger('legendsHourly').timeBased().everyHours(1).create();
  Logger.log(have ? 'The hourly Legends job was already set up.' : 'Hourly Legends job set up.');
}

const LA = {
  APP_SETTINGS: 'AppSettings',
  SIGNUPS: 'Signups',
  CLOSURES: 'Closures',
  NOTICES: 'Notices',
  CLUB_TEE_TIMES: 'ClubTeeTimes',
  DAY_CONFIG: 'DayConfig',
  DUTY: 'TeeTimeDuty',
  EVENTS: 'Events',
  SWAPS: 'SwapRequests',
  PRO_SHOP_LOG: 'ProShopLog',
  FILES: 'RelatedFiles',
  NEWS: 'News',
  REMINDER_LOG: 'ReminderLog',
  PAIRINGS: 'Pairings',
  ATTENDANCE: 'Attendance',
  GAME_LIST: 'NassauGameList',
  GAME_PICKS: 'NassauGames',
  DUTY_AWAY: 'DutyAway',
  TOURNAMENTS: 'Tournaments', // $10, $5 and Annual tournaments (Tom 2026-11-23)
  TOURN_FORMATS: 'TournFormats', // the tournament formats admins pick from (Tom 2026-11-23)
};
const LA_HEADERS = {
  AppSettings: ['Key', 'Value'],
  Signups: ['SignupID', 'DateKey', 'Group', 'PlayerID', 'Name', 'Tee', 'Holes', 'Riding', 'Note', 'SignedUpAt', 'AddedBy'],
  Closures: ['DateKey', 'Reason', 'ShopClosed'],
  Notices: ['DateKey', 'Text'],
  ClubTeeTimes: ['EffectiveDate', 'FirstTeeTime'],
  DayConfig: ['DateKey', 'LegendsFirst', 'FunTimes', 'NassauTimes', 'FunSlots', 'NassauSlots', 'OpenEarly', 'FunTeeTimes', 'NassauTeeTimes'],
  News: ['NewsID', 'Title', 'Body', 'PhotoID', 'PostedAt', 'PostedBy', 'ShowUntil', 'Hidden'],
  ReminderLog: ['Type', 'DateKey', 'SentAt', 'Recipients'],
  RelatedFiles: ['FileID', 'DriveID', 'Title', 'Description', 'Category', 'FileName', 'MimeType', 'Size', 'SortOrder', 'Hidden', 'UploadedAt', 'UploadedBy'],
  ProShopLog: ['DateKey', 'SentAt', 'SentBy', 'To', 'Cc', 'Players'],
  SwapRequests: ['SwapID', 'FromKey', 'RequesterID', 'RequesterName', 'ToKey', 'TargetID', 'TargetName', 'Status', 'CreatedAt', 'ResolvedAt', 'Week'], // Week TRUE = whole weeks (Tom 2026-11-21)
  TeeTimeDuty: ['DateKey', 'Role', 'PlayerID', 'Name', 'TargetKey', 'MovedFrom'],
  Events: ['EventID', 'DateKey', 'Title', 'Description', 'Capacity', 'GuestPrompt', 'Active', 'SignupOpens'],
  Pairings: ['DateKey', 'Group', 'Data', 'UpdatedAt', 'UpdatedBy', 'EmailSentAt'],
  Attendance: ['RecordID', 'DateKey', 'Group', 'PlayerID', 'Name', 'Kind', 'RecordedAt', 'RecordedBy'], // Kind: late, noshow
  NassauGameList: ['Game'],
  NassauGames: ['DateKey', 'Game', 'Forced', 'SetAt', 'SetBy'],
  // Weeks each member can't do tee time duty in a quarter (Tom 2026-11-21). Weeks = the Mondays, comma-separated.
  DutyAway: ['Quarter', 'PlayerID', 'Name', 'Weeks', 'Note', 'Done', 'UpdatedAt', 'UpdatedBy'],
  // Kind: ten | five | annual. Who: all (Fun and Nassau) | fun (Fun Group only). See "Tournaments" below.
  TournFormats: ['Name', 'Description'],
  Tournaments: ['TournID', 'Kind', 'Title', 'DateKey', 'SignupOpens', 'SignupCloses', 'TeeTimes', 'FirstTee', 'Who', 'Game', 'Prizes', 'Description', 'Active'],
};

const LA_DEFAULT_SETTINGS = {
  StandbySlots: '9',
  // Tournaments (Tom 2026-11-23): sign-ups close at 11:59 PM this many days before (unless the
  // tournament has its own "Sign-ups close" date); the pairings email goes the next morning.
  TournCloseDaysBefore: '3',
  TournEmailOn: 'FALSE',        // the "Tournament pairings" email: Off until an admin turns it on
  TournEmailHour: '9',          // the morning after sign-ups close, at this hour
  TournEmailProShop: 'TRUE',    // (before 24b) copy the pro shop; now part of TournEmailSendTo
  // Who gets the tournament email (Tom 2026-11-24: send it to all the Legends through the Google
  // Group, so 36 players don't use up the ~100 a day limit): legends = the Legends Google Group
  // (Sign-up summary's group address; players instead if none is set), players = everyone signed
  // up and on standby, proshop, admin, extra (TournEmailExtraEmails).
  TournEmailSendTo: 'legends,proshop,admin,extra',
  TournEmailExtraEmails: '',
  TournEmailMessage: '',
  TournTees: 'Gold,Red',        // the tees players choose from for a tournament (Tom 2026-11-23: Gold or Red)
  TournEmailFooterText: 'Can\'t make it? Remove yourself in SUN so the first person on standby moves up, and tell an admin.',
  SignupOpenDaysBefore: '14',
  SignupOpenTime: '7:10 AM',
  // Last day to sign up is this many days before play (sign-ups close at
  // 11:59 PM that day). 2 = a Wednesday round closes Monday night.
  SignupCloseDaysBefore: '2',
  DefaultClubFirstTee: '8:00 AM',
  TeeIntervalMin: '8',           // minutes between tee times (the club restarts on the hour — see laNextTee_)
  FunTeeTimes: '4',              // first 4 Legends tee times are the Fun group
  NassauTeeTimes: '5',           // the next 5 are the Nassau group
  BoardDaysAhead: '15',
  PlayersPerTeeTime: '4',
  // Link put in emails (e.g. a swap request) so people can open the app.
  SiteUrl: 'https://heritagelegendsgolf.github.io/live/',
  AdminEmail: 'theheritagelegends@gmail.com',
  // The players list for each round goes to the pro shop when sign-ups close.
  ProShopEmails: 'rdelfs@theheritageclub.net, rsatterwhite@theheritageclub.net',
  ProShopExtraEmails: 'stevekirchhoff52@gmail.com, rtleene@aol.com', // copied on the list (same as the Gibson Group app)
  ProShopAutoSend: 'FALSE',
  ProShopResend: 'FALSE',   // send an updated list when the players change after it has gone (Tom 2026-10-26), once a morning at 5 AM (Tom 2026-11-05)
  ProShopHour: '',         // blank = as soon as sign-ups close (11:59 PM); else that hour the next morning (Tom 2026-10-27)
  // Reminder emails (sent by the hourly job — see installLegendsTriggers).
  RemindDuty: 'FALSE',        // evening before a duty day, to the people on duty
  RemindPlaying: 'FALSE',     // evening before a round, to the Fun group players (Nassau has NassauTomorrow*)
  RemindClosing: 'FALSE',    // morning of the last sign-up day, to active members not yet signed up
  ReminderHour: '17',        // evening reminders go out after this hour (24-hour clock)
  ClosingReminderHour: '9',
  // Gmail's daily limit on email recipients (every To, Cc and Bcc address counts):
  // 100 for a free Gmail account, 1500 for Google Workspace. Admin shows a warning
  // when the automatic emails due on a day would go over it (laEmailForecast_).
  EmailDailyLimit: '100',
  // The "Legends Signups for <day>" email to every Legend the day before play
  // (the one sent by hand today). Off to start — see the email limit note in the app.
  RemindDaily: 'FALSE',
  DailyHour: '8',
  DailyFunText: 'If there is still a last-minute drop out, please text one of: JAY DAVIS 703-314-0070, RAY SCHIPANI 612-220-5830, SCOTT S. 919-302-4320, JIM SALISBURY 919-815-6172.',
  DailyNassauText: 'Call the Pro Shop to sign up. Also text Tom Bacca and Tom Gurganus.',
  DailyCancelText: 'If you cancel your tee time, ask the Pro Shop to replace your name with "Guest".',
  DailyExtraEmails: '',    // anyone else who should get it (besides the Legends and the pro shop list)
  // A Google Group address that contains every Legend (e.g. heritage-legends@googlegroups.com).
  // When set, the email goes To that one address: replies-to-all reach everyone, and it uses
  // only one of Gmail's ~100 recipients a day. When blank, every Legend is listed openly in To.
  DailyGroupEmail: '',
  // Added to an email when it goes to a Google Group address (Tom 2026-11-05): {group} the
  // group's address, {count} how many Legends, {names} their names, {link} "click here" (a new
  // email addressed to all of them).
  DailyGroupMembers: '',  // group members Google can't show the app (no Google account, e.g. aol.com), one line per group "group: a, b" (Tom 2026-11-05)
  DailyGroupNoteText: 'This email was sent to the Google Group {group}, which reaches {count} Legends: {names}. Replying only reaches the sender. To write to everyone, {link} and be sure to say who you are.',
  // Admin > Emails: who gets each email — a comma list of
  //   legends (every active Legend), players (signed up for that round), notsigned (not signed up),
  //   duty (on Tee Time Duty that day), proshop (ProShopEmails), admin (AdminEmail),
  //   extra (that email's own extra addresses, e.g. DutyExtraEmails).
  ProShopSendTo: 'proshop,extra,admin',
  DutySendTo: 'duty',
  PlayingSendTo: 'players',
  DailySendTo: 'legends,proshop,extra,admin',
  ClosingSendTo: 'notsigned,admin',
  DutyExtraEmails: '',
  PlayingExtraEmails: '',
  ClosingExtraEmails: '',
  // An optional message near the top of each email, its closing line, and whether it links to the app.
  ProShopMessage: '',
  DutyMessage: '',
  PlayingMessage: '',
  DailyMessage: '',
  ClosingMessage: '',
  ProShopFooterText: 'Any changes after this list will be phoned in to the pro shop. Questions: reply to this email.',
  DutyFooterText: 'Can\'t make it? Use Swap… on the Tee Time Duty tab, or tell an admin.',
  PlayingFooterText: 'Can\'t make it? Remove yourself in the app so the next person on the standby list can take your place. And call the Pro Shop and ask them to replace your name with "Guest".',
  PlayingEmailVersion: '2', // one shared email listing everyone (Oct 2026); see laSettings_
  ClosingFooterText: 'You\'re getting this as a reminder to sign up if you want to play on {weekday}.',
  ProShopAppLink: 'FALSE',
  DutyAppLink: 'TRUE',
  PlayingAppLink: 'TRUE',
  DailyAppLink: 'TRUE',
  ClosingAppLink: 'TRUE',
  // The Nassau pairings ("Larry's Game") email (Tom 2026-10-27: recipients and timing
  // can be set, on Admin > Pairings > Nassau and Admin > Emails). Off = only when an
  // admin clicks Send; On = automatically on the day of play after PairingsHour, once
  // the pairings are made (6 AM) and if nobody has sent it yet.
  // The change emails (Tom 2026-10-28): the combined pro shop list goes first, when
  // sign-ups close. After that, Fun group changes go out as "Changes in Fun Group
  // Pairings" (just the Fun group) and Nassau changes as "Changes to Nassau Pairings"
  // (just the Nassau group), so neither group is emailed about the other's changes.
  // *Resend is each one's On/Off switch; Off = the combined list carries the changes, as before.
  FunPairingsAutoSend: 'FALSE', // no longer used (it only goes after the combined list)
  FunPairingsHour: '',          // no longer used
  FunPairingsResend: 'FALSE',
  FunPairingsSendTo: 'proshop,players,admin',
  FunPairingsExtraEmails: '',
  FunPairingsMessage: '',
  FunPairingsFooterText: 'Questions: reply to this email.',
  FunPairingsAppLink: 'TRUE',
  // "Nassau players for tomorrow" (Tom 2026-10-28): the Nassau players by index the evening
  // before, like the one Tom Gurganus sends by hand. Off to start. In the message,
  // {count} {standby} {pairings} are filled in (see laNassauTomorrowEmail_).
  NassauTomorrowOn: 'FALSE',
  NassauTomorrowHour: '17',
  NassauTomorrowSendTo: 'players,admin',
  NassauTomorrowExtraEmails: '',
  NassauTomorrowMessage: 'We have {count} signed up for tomorrow{standby}.  If you need to drop, please let me know.  The pairings will go out around {pairings}.',
  NassauTomorrowFooterText: '',
  NassauTomorrowAppLink: 'FALSE',
  NassauChangesResend: 'FALSE',
  NassauChangesSendTo: 'proshop,players,admin',
  NassauChangesExtraEmails: '',
  NassauChangesMessage: '',
  NassauChangesFooterText: 'Questions: reply to this email.',
  NassauChangesAppLink: 'TRUE',
  PairingsSendTo: 'legends,admin',
  PairingsExtraEmails: '',
  PairingsMessage: '',
  PairingsAppLink: 'TRUE',
  PairingsAutoSend: 'FALSE',
  PairingsHour: '7',
  // "Moved up from standby" email, sent right away to the first standby player when
  // someone drops out of a full group. Copies (Cc) go to whichever of admin, proshop,
  // extra (StandbyExtraEmails) are listed in StandbyCopyTo. {first}, {name} and {group}
  // in the subject and text become the player's first name, full name and e.g.
  // "Nassau group on Fri, Oct 30".
  StandbyEmailOn: 'FALSE',
  // Emails that used to have no switch (Tom 2026-11-17: nothing goes out unless its switch is On):
  LateDropEmailOn: 'FALSE',    // "Late drop-out" note to the Legends admin
  SwapEmailOn: 'FALSE',        // duty swap request / accepted / declined / cancelled emails to the members
  ListChangeEmailOn: 'FALSE',  // "Legends email list change" note to the Legends admin
  PinResetEmailOn: 'FALSE',    // "Forgot your PIN?" reset code emailed to the member (Tom 2026-11-20)
  StandbyCopyTo: '',
  StandbyExtraEmails: '',
  StandbySubject: "You're in: {group}",
  StandbyText: 'Good news, {first} — a spot opened up and you have moved off the standby list. You are now in the {group}.',
  StandbyAppLink: 'FALSE',
  NewsDays: '7',            // how long a news post stays on the Sign-ups page by default
  TeeOptions: 'Red,Gold/Red,Gold,White/Gold,White,Blue/White,Blue',
  TeeListVersion: '2', // see laSettings_: renames Red/Gold to Gold/Red and adds White (Oct 2026)
  TeeList7: '1', // see laSettings_: seven tees, Red through Blue (2026-10-22)
  // {arrive} = club first tee minus 2 hours; {latest} = minus 90 minutes (the latest to
  // arrive); {call} = club first tee minus 30 minutes. Wording from Tom 2026-11-01.
  DutyInPersonText: 'Request in-person tee times. Arrive at the club by {latest} (preferably {arrive}). PARK IN THE CIRCLE BEHIND THE LAST CAR IN LINE. Request 9 tee times to begin at the earliest available time, two weeks in advance. TEXT THE 1ST TIME TO DC 913-515-5672, RAY 612-220-5830 & BOB D 786-877-0990.',
  DutyPhoneText: 'Call the pro shop at {call} (voicemail? try again, then Ext 102). Confirm all 9 tee times and the first time. TEXT THE 1ST TIME TO DC 913-515-5672, RAY 612-220-5830 & BOB D 786-877-0990.',
  DutyTextVersion: '2', // see laSettings_: the 2026-11-01 wording replaces the old default once
  // Who can do which duty (Tom 2026-11-01), saved from Admin > Tee Time Duty:
  // JSON { PlayerID: { s: 'phone'|'inperson'|'nonmember'|'medical', r: reason } }.
  // Anyone not listed can go in person or phone in. Seeded once by laSeedDutyLists_.
  DutyLists: '',
  // Rounds with heavy demand (e.g. a holiday); the duty day two weeks earlier that books them gets three in person:
  // three people in person; the phone-in person is only a backup.
  // JSON { DateKey: reason } (reason e.g. "Martin Luther King Day"); see laHeavyDays_.
  DutyHeavyDays: '',
  // Who sat out each quarter: JSON { '2027-Q1': [PlayerID, ...] }, worked out when a
  // quarter is saved (laUpdateSitOuts_). Generate uses it so nobody sits out twice
  // before everyone else has sat out once.
  DutySitOuts: '{}',
  // Away weeks (Tom 2026-11-21): members mark the weeks of the next quarter they can't do duty.
  // The box opens 6 weeks before the quarter and is due 3 weeks before, unless a quarter has
  // its own due date here ({ "2027-Q1": "2026-12-14" }, set on Admin › Tee Time Duty).
  DutyAwayDue: '{"2027-Q1":"2026-12-14"}',
  DutyAwayOpen: '{"2027-Q1":"2026-11-15"}',
  DutyAwayEmailOn: 'FALSE', // weekly "please mark your away weeks" email to members who haven't
};

// ---------------- routing ----------------

// Actions that change data (backups run before them; view-only admins can't do them as admin).
const LA_WRITE_ACTIONS_ = ['legendsJoin', 'legendsLeave', 'legendsUpdate', 'legendsSaveClosures', 'legendsSaveNotices',
    'legendsSaveClubTeeTimes', 'legendsSaveDayConfig', 'legendsSaveDuty', 'legendsSaveDutySetup', 'legendsSaveEvents', 'legendsSaveAppSettings',
    'legendsSwapRequest', 'legendsSwapRespond', 'legendsSwapCancel', 'legendsImportSignups', 'legendsProShopSend',
    'legendsFileUpload', 'legendsFilesSave', 'legendsNewsPost', 'legendsNewsSave', 'legendsEmailSendNow',
    'legendsPairingsMake', 'legendsPairingsSave', 'legendsPairingsSend', 'legendsFunMake', 'legendsFunSave', 'legendsAttendanceSave', 'legendsSaveEmailSettings', 'legendsFunAdd', 'legendsFunRemove', 'legendsNassauGamesSave', 'legendsCopyFromLive', 'legendsDutyAwaySave',
    'legendsSaveTournaments', 'legendsTournPairMake', 'legendsTournPairSave', 'legendsTournEmailSend', 'legendsTournSettings', 'legendsTournFormatsSave'];


// Called from handleRequest_ in Code.gs for any action it doesn't know.
// Returns { handled: false } for anything that isn't ours.
function legendsRoute_(ss, p) {
  const a = p.action;
  const write = LA_WRITE_ACTIONS_;
  const handlers = {
    legendsGetBoard: () => laGetBoard_(ss, laViewer_(ss, p)),
    legendsJoin: () => (p.many ? laJoinMany_(ss, laViewer_(ss, p), p) : laJoin_(ss, laViewer_(ss, p), p)),
    legendsLeave: () => laLeave_(ss, laViewer_(ss, p), p),
    legendsUpdate: () => laUpdate_(ss, laViewer_(ss, p), p),
    legendsSaveClosures: () => laAdminReplace_(ss, p, LA.CLOSURES, JSON.parse(p.rows), 'Saved course closures'),
    legendsSaveNotices: () => laAdminReplace_(ss, p, LA.NOTICES, JSON.parse(p.rows), 'Saved date notices'),
    legendsSaveClubTeeTimes: () => laAdminReplace_(ss, p, LA.CLUB_TEE_TIMES, JSON.parse(p.rows), 'Saved club first tee times'),
    legendsSaveEvents: () => laAdminReplace_(ss, p, LA.EVENTS, JSON.parse(p.rows), 'Saved events'),
    legendsSaveDayConfig: () => laSaveDayConfig_(ss, p),
    legendsSaveDuty: () => laSaveDuty_(ss, p),
    legendsSaveDutySetup: () => laSaveDutySetup_(ss, p),
    legendsSaveAppSettings: () => laSaveAppSettings_(ss, p),
    legendsSaveEmailSettings: () => laSaveEmailSettings_(ss, p),
    legendsSwapRequest: () => laSwapRequest_(ss, laViewer_(ss, p), p),
    legendsSwapRespond: () => laSwapRespond_(ss, laViewer_(ss, p), p),
    legendsSwapCancel: () => laSwapCancel_(ss, laViewer_(ss, p), p),
    legendsDutyAwaySave: () => laDutyAwaySave_(ss, p),
    legendsImportSignups: () => laImportSignups_(ss, p),
    legendsProShopPreview: () => { laRequireAdmin_(ss, p); return laEmailPreview_(ss, 'proshop', String(p.dateKey || ''), JSON.parse(p.settings || '{}')); },
    legendsProShopSend: () => laProShopSendAdmin_(ss, p),
    legendsFileGet: () => laFileGet_(ss, laViewer_(ss, p), p),
    legendsFileUpload: () => laFileUpload_(ss, p),
    legendsFilesSave: () => laFilesSave_(ss, p),
    legendsNewsPost: () => laNewsPost_(ss, p),
    legendsNewsSave: () => laNewsSave_(ss, p),
    legendsEmailSendNow: () => laEmailSendNow_(ss, p),
    legendsPairingsGet: () => laPairingsGet_(ss, p),
    legendsFunGet: () => laFunGet_(ss, p),
    legendsFunMake: () => laFunMakeAdmin_(ss, p),
    legendsFunSave: () => laFunSave_(ss, p),
    legendsFunAdd: () => laFunAddAdmin_(ss, p),
    legendsFunRemove: () => laFunRemoveAdmin_(ss, p),
    legendsAttendanceGet: () => laAttendanceGet_(ss, p),
    legendsAttendanceSave: () => laAttendanceSave_(ss, p),
    legendsPairingsMake: () => laPairingsMake_(ss, p),
    legendsPairingsSave: () => laPairingsSave_(ss, p),
    legendsPairingsPreview: () => laPairingsPreview_(ss, p),
    legendsPairingsSend: () => laPairingsSend_(ss, p),
    legendsNassauGamesSave: () => laGamesSave_(ss, p),
    legendsGroupCheck: () => laGroupCheck_(ss, p),
    legendsCopyFromLive: () => laCopyFromLive_(ss, laRequireAdmin_(ss, p)),
    legendsSaveTournaments: () => laTournSave_(ss, p),
    legendsTournPairGet: () => laTournPairGet_(ss, p),
    legendsTournPairMake: () => laTournPairMake_(ss, p),
    legendsTournPairSave: () => laTournPairSave_(ss, p),
    legendsTournEmailPreview: () => laTournEmailPreview_(ss, p),
    legendsTournEmailSend: () => laTournEmailSend_(ss, p),
    legendsTournSettings: () => laTournSettingsSave_(ss, p),
    legendsTournFormatsSave: () => laTournFormatsSave_(ss, p),
    legendsReminderPreview: () => { laRequireAdmin_(ss, p); return laEmailPreview_(ss, String(p.type || ''), String(p.dateKey || ''), JSON.parse(p.settings || '{}')); },
  };
  if (!handlers[a]) return { handled: false };
  if (write.indexOf(a) !== -1) maybeBackup_(ss, false);
  return { handled: true, result: handlers[a]() };
}

// Who is asking: an admin (valid admin PIN) or a signed-in member (token).
function laViewer_(ss, p) {
  if (p.adminPin) {
    const name = findAdminName_(ss, p.adminPin);
    if (name) {
      const member = p.token ? memberFromToken_(ss, p.token) : null;
      // acting: the admin is doing something FOR someone else (adding or
      // removing another player, ignoring the sign-up window). Without
      // asAdmin, an admin signing themselves up follows the normal rules.
      const acting = p.asAdmin === true || p.asAdmin === 'true';
      const role = adminRole_(ss, name);
      if (acting && role === 'View' && REQUEST_IS_WRITE_) throw new Error(VIEW_ONLY_MSG_);
      if (acting && isLimitedRole_(role) && REQUEST_IS_WRITE_) throw new Error(LIMITED_MSG_);
      return { isAdmin: true, acting: acting, adminName: name, member: member, viewOnly: role === 'View' };
    }
  }
  return { isAdmin: false, acting: false, member: requireMember_(ss, p.token) };
}
function laRequireAdmin_(ss, p) { return requireAdmin_(ss, p.adminPin); }

// ---------------- sheet helpers ----------------

const LA_HDR_OK_ = {};
function laSheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const h = LA_HEADERS[name];
    sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    sh.getRange(1, 1, sh.getMaxRows(), h.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  } else if (!LA_HDR_OK_[name]) {
    // A column added later (e.g. SwapRequests.Week, 2026-11-21) gets its heading before anything is written.
    const h = LA_HEADERS[name], have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
    const missing = h.filter((x) => have.indexOf(x) === -1);
    if (missing.length && have.slice(0, h.length - missing.length).join('|') === h.slice(0, h.length - missing.length).join('|')) {
      sh.getRange(1, h.length - missing.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
    }
  }
  LA_HDR_OK_[name] = true;
  return sh;
}
function laKeyOf_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}
// Reads are cached for the rest of this request (one request often needs the
// same sheet several times); any write through these helpers clears it.
let LA_CACHE_ = {};
function laInvalidate_(name) { if (name) delete LA_CACHE_[name]; else LA_CACHE_ = {}; }
function laRead_(ss, name) {
  if (!LA_CACHE_[name]) LA_CACHE_[name] = laReadRaw_(ss, name);
  return LA_CACHE_[name].map((r) => Object.assign({}, r));
}
function laReadRaw_(ss, name) {
  const rows = sheetToObjects_(laSheet_(ss, name), LA_HEADERS[name]);
  return rows.map((r) => {
    if ('DateKey' in r) r.DateKey = laKeyOf_(r.DateKey);
    if (r.Tee === 'Red/Gold') r.Tee = 'Gold/Red'; // renamed Oct 2026
    if ('SignupOpens' in r) r.SignupOpens = laKeyOf_(r.SignupOpens);
    if ('SignupCloses' in r) r.SignupCloses = laKeyOf_(r.SignupCloses);
    if ('EffectiveDate' in r) r.EffectiveDate = laKeyOf_(r.EffectiveDate);
    if ('TargetKey' in r) r.TargetKey = laKeyOf_(r.TargetKey);
    if ('MovedFrom' in r) r.MovedFrom = laKeyOf_(r.MovedFrom);
    if ('FromKey' in r) { r.FromKey = laKeyOf_(r.FromKey); r.ToKey = laKeyOf_(r.ToKey); }
    if ('Weeks' in r) r.Weeks = String(r.Weeks || '').split(',').map((k) => k.trim()).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).join(',');
    return r;
  }).filter((r) => Object.keys(r).some((k) => String(r[k]).trim() !== ''));
}
function laWriteAll_(ss, name, rows) {
  laInvalidate_(name);
  objectsToSheet_(laSheet_(ss, name), LA_HEADERS[name], rows);
}
function laAppend_(ss, name, obj) {
  laInvalidate_(name);
  const sh = laSheet_(ss, name);
  const h = LA_HEADERS[name];
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, h.length);
  range.setNumberFormat('@');
  range.setValues([h.map((k) => (obj[k] === undefined || obj[k] === null ? '' : String(obj[k])))]);
}

function laSettings_(ss) {
  if (LA_CACHE_.__settings && LA_CACHE_[LA.APP_SETTINGS]) return Object.assign({}, LA_CACHE_.__settings);
  const rows = laRead_(ss, LA.APP_SETTINGS);
  const out = {};
  rows.forEach((r) => { if (r.Key) out[r.Key] = String(r.Value); });
  const missing = Object.keys(LA_DEFAULT_SETTINGS).filter((k) => out[k] === undefined);
  if (missing.length) {
    missing.forEach((k) => { out[k] = LA_DEFAULT_SETTINGS[k]; });
    // The "Legends Signups" email used to go to the pro shop list's Cc addresses too;
    // now each email has its own extra addresses, so carry those over once.
    if (missing.indexOf('DailySendTo') !== -1) {
      const have = laEmailList_(out.DailyExtraEmails), lower = have.map((e) => e.toLowerCase());
      out.DailyExtraEmails = have.concat(laEmailList_(out.ProShopExtraEmails).filter((e) => lower.indexOf(e.toLowerCase()) === -1)).join(', ');
    }
    // Tees became Red, Gold/Red, Gold, White/Gold, White (in that order). Red/Gold is
    // now called Gold/Red; older sign-ups are renamed as they're read (laReadRaw_). Runs once.
    // "Playing tomorrow" became one email to everyone playing, with a new closing line.
    if (missing.indexOf('PlayingEmailVersion') !== -1 &&
        out.PlayingFooterText === 'Can\'t make it? Remove yourself in the app and call the pro shop so the next person can play.') {
      out.PlayingFooterText = LA_DEFAULT_SETTINGS.PlayingFooterText;
    }
    if (missing.indexOf('TeeListVersion') !== -1) {
      const extra = String(out.TeeOptions || '').split(',').map((t) => t.trim())
        .filter((t) => t && ['Red', 'Red/Gold', 'Gold/Red', 'Gold', 'White/Gold', 'White'].indexOf(t) === -1);
      out.TeeOptions = ['Red', 'Gold/Red', 'Gold', 'White/Gold', 'White'].concat(extra).join(',');
    }
    // Seven tees, Red through Blue, in that order (no Black/Blue or Black; any other
    // extra tees kept at the end). Runs once.
    if (missing.indexOf('TeeList7') !== -1) {
      const seven = ['Red', 'Gold/Red', 'Gold', 'White/Gold', 'White', 'Blue/White', 'Blue'];
      const extra = String(out.TeeOptions || '').split(',').map((t) => t.trim())
        .filter((t) => t && seven.indexOf(t) === -1 && ['Red/Gold', 'Black/Blue', 'Black'].indexOf(t) === -1);
      out.TeeOptions = seven.concat(extra).join(',');
    }
    if (missing.indexOf('DutyLists') !== -1) out.DutyLists = laSeedDutyLists_(ss);
    // Tom's 2026-11-01 duty wording replaces the old default (not wording an admin wrote).
    if (missing.indexOf('DutyTextVersion') !== -1) {
      if (out.DutyInPersonText === 'Arrive by {arrive} — earlier is better. Park in the circle behind the last car. Request 9 tee times, earliest available, two weeks out. Text the first time and how many you got to DC Colt (913-515-5672) and Ray Schipani (612-220-5830).') out.DutyInPersonText = LA_DEFAULT_SETTINGS.DutyInPersonText;
      if (out.DutyPhoneText === 'Call the pro shop at {call} (voicemail? try again, then Ext 102). Confirm all 9 tee times and the first time, then text them to DC Colt (913-515-5672) and Ray Schipani (612-220-5830).') out.DutyPhoneText = LA_DEFAULT_SETTINGS.DutyPhoneText;
    }
    // An empty read of a tab that has been set up before means it was being rewritten at that
    // moment (or someone emptied it). Never save the starting values over it then: use them for
    // this run only (Tom 2026-11-17: this put every setting back to its starting value and
    // turned the emails back on, with nothing in the Activity log).
    const props = PropertiesService.getScriptProperties();
    if (rows.length || !props.getProperty('LA_SETTINGS_SEEDED')) {
      laWriteAll_(ss, LA.APP_SETTINGS, Object.keys(out).map((k) => ({ Key: k, Value: out[k] })));
      laRead_(ss, LA.APP_SETTINGS);
      props.setProperty('LA_SETTINGS_SEEDED', '1');
      try { logActivity_(ss, 'System', 'Added new settings', missing.length > 12 ? missing.length + ' settings (starting values)' : missing.join(', ')); } catch (err) { /* never stop a read */ }
    } else {
      console.warn('AppSettings read back empty; starting values used for this run only, not saved.');
    }
  }
  LA_CACHE_.__settings = Object.assign({}, out);
  return out;
}
// The settings as they are in the sheet right now, not this run's earlier copy. Every save
// of AppSettings rewrites the whole tab, so it must start from a fresh read taken while
// holding the script lock, or two saves at once (e.g. several email switches clicked in a
// row) can put back each other's old values without anything in the Activity log
// (Tom 2026-11-17: emails came back on with no one turning them on).
function laSettingsFresh_(ss) {
  laInvalidate_(LA.APP_SETTINGS);
  delete LA_CACHE_.__settings;
  return laSettings_(ss);
}
function laNum_(v, d) { const n = parseInt(v, 10); return isNaN(n) ? d : n; }

// ---------------- date / time helpers (keys are YYYY-MM-DD) ----------------

function laTz_() { return Session.getScriptTimeZone(); }
function laTodayKey_() { return Utilities.formatDate(new Date(), laTz_(), 'yyyy-MM-dd'); }
function laAddDays_(key, n) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function laDow_(key) { return new Date(key + 'T12:00:00Z').getUTCDay(); }
function laIsPlayDay_(key) { const d = laDow_(key); return d === 1 || d === 3 || d === 5; }
// "7:10 AM" -> minutes after midnight, or null.
function laParseTime_(s) {
  const m = String(s || '').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m || parseInt(m[1], 10) > 12 || parseInt(m[2], 10) > 59) return null;
  let h = parseInt(m[1], 10) % 12;
  // With no AM/PM, golf hours are assumed: 6:00–11:59 is morning, 12–5 is afternoon.
  const pm = m[3] ? m[3].toUpperCase() === 'PM' : (h >= 1 && h <= 5) || parseInt(m[1], 10) === 12;
  if (pm) h += 12;
  return h * 60 + parseInt(m[2], 10);
}
function laFmtTime_(mins) {
  mins = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(mins / 60), mi = mins % 60;
  return ((h % 12) || 12) + ':' + String(mi).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
}
// Milliseconds for a wall-clock time on a date, in the script's time zone.
function laAt_(key, mins) {
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return Utilities.parseDate(key + ' ' + hh + ':' + mm, laTz_(), 'yyyy-MM-dd HH:mm').getTime();
}
// The round a duty day books for: first Mon/Wed/Fri on or after 14 days
// later (a normal Mon/Wed/Fri duty day books exactly two weeks out; an
// unusual day — like Thursday Dec 24 standing in for Christmas — rolls
// forward to the next play day).
function laDefaultTarget_(key) {
  let t = laAddDays_(key, 14);
  for (let i = 0; i < 7 && !laIsPlayDay_(t); i++) t = laAddDays_(t, 1);
  return t;
}
function laClubFirstTee_(clubTimes, key, st) {
  const eff = clubTimes.filter((r) => r.EffectiveDate && r.EffectiveDate <= key && laParseTime_(r.FirstTeeTime) !== null)
    .sort((a, b) => (a.EffectiveDate < b.EffectiveDate ? -1 : 1));
  return eff.length ? eff[eff.length - 1].FirstTeeTime : st.DefaultClubFirstTee;
}

// ---------------- the board (everything the app shows) ----------------

function laGetBoard_(ss, viewer) {
  const st = laSettings_(ss);
  const today = laTodayKey_();
  const now = Date.now();
  const ahead = laNum_(st.BoardDaysAhead, 15);
  const closures = laRead_(ss, LA.CLOSURES);
  const notices = laRead_(ss, LA.NOTICES);
  const clubTimes = laRead_(ss, LA.CLUB_TEE_TIMES);
  const dayCfg = laRead_(ss, LA.DAY_CONFIG);
  const events = laRead_(ss, LA.EVENTS);
  const lastKey = laAddDays_(today, 400);
  const signups = laRead_(ss, LA.SIGNUPS).filter((s) => s.DateKey >= today && s.DateKey <= lastKey);
  const duty = laRead_(ss, LA.DUTY).filter((d) => d.DateKey >= laAddDays_(today, viewer.isAdmin ? -120 : -1));

  const closedBy = {}; closures.forEach((c) => { if (c.DateKey) closedBy[c.DateKey] = c.Reason || 'Closed'; });
  const noticeBy = {}; notices.forEach((n) => { if (n.DateKey) noticeBy[n.DateKey] = n.Text; });
  const cfgBy = {}; dayCfg.forEach((c) => { if (c.DateKey) cfgBy[c.DateKey] = c; });

  const dates = [];
  for (let i = 0; i <= ahead; i++) {
    const key = laAddDays_(today, i);
    if (!laIsPlayDay_(key)) continue;
    const d = laDayInfo_(key, st, cfgBy[key], closedBy[key], noticeBy[key], clubTimes, now);
    // a tournament that day takes the place of the Fun group (and the Nassau group, if it's for everyone)
    const tr = laTournOnDay_(ss, key);
    d.tournFun = tr.fun; d.tournNassau = tr.nassau; d.tournId = tr.id;
    dates.push(d);
  }

  // PreferredTee: the tee the member chose under My info (or an admin set on Handicaps);
  // new sign-ups start on it. See readHandicaps_ in Code.gs.
  const prefs = typeof readHandicaps_ === 'function' ? readHandicaps_(ss) : {};
  const roster = readRosterFull_(ss).filter((r) => String(r.Name || '').trim()).map((r) => ({
    PlayerID: String(r.PlayerID), Name: r.Name, Tee: r.Tee, Active: memberIsActive_(r) ? 'TRUE' : 'FALSE',
    PreferredTee: (prefs[String(r.PlayerID)] || {}).Tee || '',
    PlayGroup: String(r.PlayGroup || '').trim(), // fun | nassau | both | '' (My info; Tom 2026-11-01)
  }));

  return {
    now: now,
    today: today,
    viewer: { isAdmin: viewer.isAdmin, adminName: viewer.adminName || '', member: viewer.member ? memberPublic_(viewer.member) : null },
    settings: viewer.isAdmin ? st : laPublicSettings_(st),
    dates: dates,
    signups: signups,
    duty: duty.map((d) => Object.assign({}, d, { TargetKey: d.TargetKey || laDefaultTarget_(d.DateKey) })),
    closures: closures,
    notices: notices,
    clubTeeTimes: clubTimes,
    dayConfig: dayCfg,
    events: events.filter((e) => viewer.isAdmin || (laIsTrue_(e.Active, true) && e.DateKey >= today)),
    tournaments: laTournBoard_(ss, st, viewer, today),
    games: viewer.isAdmin ? laGameList_(ss) : [],
    tournFormats: viewer.isAdmin ? laTournFormats_(ss) : [], // Larry's games, offered for a tournament's game
    roster: roster,
    dutyDayInfo: laDutyDayInfo_(duty, st, clubTimes, closedBy, laShopClosedBy_(closures)),
    files: laRead_(ss, LA.FILES).filter((f) => viewer.isAdmin || String(f.Hidden).toUpperCase() !== 'TRUE')
      .map((f) => ({ FileID: f.FileID, Title: f.Title, Description: f.Description, Category: f.Category, FileName: f.FileName, MimeType: f.MimeType, Size: f.Size, SortOrder: f.SortOrder, Hidden: f.Hidden, UploadedAt: f.UploadedAt })),
    news: laRead_(ss, LA.NEWS).filter((n) => viewer.isAdmin || (String(n.Hidden).toUpperCase() !== 'TRUE' && (!n.ShowUntil || n.ShowUntil >= today)))
      .sort((a, b) => (a.PostedAt < b.PostedAt ? 1 : -1)),
    emailForecast: viewer.isAdmin ? laEmailForecast_(ss, st) : null,
    testCopy: viewer.isAdmin ? laIsTestCopy_() : false, // TEST project with LIVE_SPREADSHEET_ID set (Tom 2026-11-17)
    reminderLog: viewer.isAdmin ? laRead_(ss, LA.REMINDER_LOG).filter((r) => r.DateKey >= laAddDays_(today, -14)) : [],
    proShopLog: viewer.isAdmin ? laRead_(ss, LA.PRO_SHOP_LOG).filter((r) => r.DateKey >= laAddDays_(today, -30)) : [],
    dutyAway: laAwayBoard_(ss, viewer, st, duty, today),
    swaps: laRead_(ss, LA.SWAPS).filter((s) => s.Status === 'pending' && (viewer.isAdmin ||
      (viewer.member && (String(s.RequesterID) === String(viewer.member.PlayerID) || String(s.TargetID) === String(viewer.member.PlayerID))))),
  };
}
// An email switch is On only when it says TRUE; blank, missing or anything else is Off
// (Tom 2026-11-17: no email goes out automatically unless its switch is On).
function laOn_(st, k) { return String(st[k] == null ? '' : st[k]).trim().toUpperCase() === 'TRUE'; }
function laIsTrue_(v, dflt) {
  if (v === '' || v === undefined || v === null) return dflt;
  return v === true || String(v).toUpperCase() === 'TRUE';
}

// The club spaces tee times 8 minutes apart but always restarts on the hour:
// ... 8:32, 8:40, 8:48, 9:00, 9:08 ... So the next time after any time is 8
// minutes later, unless that would run past :52, in which case it's the top
// of the next hour.
function laNextTee_(t, iv) {
  const m = t % 60;
  return m + iv > 52 ? t - m + 60 : t + iv;
}
function laTeeSequence_(first, count, iv) {
  const out = [];
  let t = first;
  for (let i = 0; i < count; i++) { out.push(t); t = laNextTee_(t, iv); }
  return out;
}
function laTeeCounts_(st, cfg) {
  cfg = cfg || {};
  return { fun: laNum_(cfg.FunTeeTimes, laNum_(st.FunTeeTimes, 4)), nassau: laNum_(cfg.NassauTeeTimes, laNum_(st.NassauTeeTimes, 5)) };
}
// Slots = tee times x players per tee time, unless an older per-day slot
// override is still on file.
function laSlots_(st, cfg) {
  cfg = cfg || {};
  const n = laTeeCounts_(st, cfg), per = laNum_(st.PlayersPerTeeTime, 4);
  return { fun: laNum_(cfg.FunSlots, n.fun * per), nassau: laNum_(cfg.NassauSlots, n.nassau * per) };
}

function laDayInfo_(key, st, cfg, closedReason, notice, clubTimes, now) {
  cfg = cfg || {};
  const clubFirst = laClubFirstTee_(clubTimes, key, st);
  // The Legends' first tee time depends on who reaches the pro shop first, so
  // there's no guess: until an admin enters it on First Tee Time, times are "TBD".
  const legendsFirst = laParseTime_(cfg.LegendsFirst) !== null ? laFmtTime_(laParseTime_(cfg.LegendsFirst)) : '';
  const iv = laNum_(st.TeeIntervalMin, 8);
  const counts = laTeeCounts_(st, cfg);
  const seq = legendsFirst ? laTeeSequence_(laParseTime_(legendsFirst), counts.fun + counts.nassau, iv) : [];
  const fun = seq.slice(0, counts.fun), nas = seq.slice(counts.fun);
  const range = (a) => (!legendsFirst ? 'times TBD' : a.length ? laFmtTime_(a[0]) + ' - ' + laFmtTime_(a[a.length - 1]) : '');
  const funTimes = cfg.FunTimes || range(fun);
  const nassauTimes = cfg.NassauTimes || range(nas);
  const slots = laSlots_(st, cfg);
  const openMins = laParseTime_(st.SignupOpenTime) === null ? 430 : laParseTime_(st.SignupOpenTime);
  const opensAt = laIsTrue_(cfg.OpenEarly, false) ? 0 : laAt_(laAddDays_(key, -laNum_(st.SignupOpenDaysBefore, 14)), openMins);
  const closesAt = laAt_(laAddDays_(key, -laNum_(st.SignupCloseDaysBefore, 2)), 23 * 60 + 59) + 59999;
  return {
    DateKey: key,
    closed: closedReason || '',
    notice: notice || '',
    clubFirst: clubFirst,
    legendsFirst: legendsFirst,
    funTimes: funTimes,
    nassauTimes: nassauTimes,
    funTeeTimes: counts.fun,
    nassauTeeTimes: counts.nassau,
    funTeeList: fun.map(laFmtTime_),
    nassauTeeList: nas.map(laFmtTime_),
    funSlots: slots.fun,
    nassauSlots: slots.nassau,
    standbySlots: laNum_(st.StandbySlots, 9),
    opensAt: opensAt,
    closesAt: closesAt,
    openEarly: laIsTrue_(cfg.OpenEarly, false),
    state: now < opensAt ? 'notyet' : (now > closesAt ? 'closed' : 'open'),
  };
}

// Arrival / call times and the target round for every duty day in the list.
// Closures where the pro shop is closed too, so no tee times can be requested that day
// (Christmas, snow), as { DateKey: reason }. An outside event day has no Legends play but
// the shop is open, so duty that day stays put (Tom 2026-11-15).
function laShopClosedBy_(closures) {
  const out = {};
  closures.forEach((c) => { if (c.DateKey && String(c.ShopClosed).toUpperCase() === 'TRUE') out[c.DateKey] = c.Reason || 'Closed'; });
  return out;
}
function laDutyDayInfo_(duty, st, clubTimes, closedBy, shopClosedBy) {
  shopClosedBy = shopClosedBy || {};
  const out = {};
  duty.forEach((d) => {
    if (out[d.DateKey]) return;
    const first = laParseTime_(laClubFirstTee_(clubTimes, d.DateKey, st));
    const target = d.TargetKey || laDefaultTarget_(d.DateKey);
    out[d.DateKey] = {
      arrive: laFmtTime_(first - 120),
      latest: laFmtTime_(first - 90),
      call: laFmtTime_(first - 30),
      target: target,
      targetClosed: closedBy[target] || '',
      // Moved earlier because the club is closed on its own day (Tom 2026-11-15)
      movedFrom: d.MovedFrom || '',
      movedWhy: d.MovedFrom ? (closedBy[d.MovedFrom] || 'Closed') : '',
      // Still on a day the pro shop is closed (it couldn't be moved: the days before have passed or are taken)
      dayClosed: shopClosedBy[d.DateKey] || '',
    };
  });
  return out;
}

// ---------------- sign-up rules ----------------

function laGroupLabel_(group, events) {
  if (group === 'fun') return 'Fun group';
  if (group === 'nassau') return 'Nassau group';
  const ev = (events || []).find((e) => laEvMatch_(e, group));
  return ev ? ev.Title : group.indexOf('tourn:') === 0 ? 'tournament' : 'event';
}
function laDateLabel_(key) {
  const d = new Date(key + 'T12:00:00Z');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return days[d.getUTCDay()] + ', ' + mons[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
// Signups for one date+group in sign-up order (row order = the order the
// server accepted them, one at a time under the lock).
function laGroupList_(all, key, group) {
  return all.filter((s) => s.DateKey === key && s.Group === group);
}
// Where the list stops being "in" and starts being standby.
function laCapacity_(ss, st, key, group, events) {
  if (group === 'fun' || group === 'nassau') {
    const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key) || {};
    const s = laSlots_(st, cfg);
    return { slots: group === 'fun' ? s.fun : s.nassau, standby: laNum_(st.StandbySlots, 9) };
  }
  if (group.indexOf('tourn:') === 0) {
    const t = laTournById_(ss, group.slice(6));
    return { slots: t ? laTournSlots_(st, t) : 100000, standby: laNum_(st.StandbySlots, 9) };
  }
  const ev = events.find((e) => 'event:' + e.EventID === group);
  const cap = ev ? laNum_(ev.Capacity, 0) : 0;
  return { slots: cap > 0 ? cap : 100000, standby: cap > 0 ? laNum_(st.StandbySlots, 9) : 0 };
}

function laJoin_(ss, viewer, p) {
  const st = laSettings_(ss);
  const group = String(p.group || '');
  const id = String(p.signupId || '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error('Invalid request id.');
  let who = viewer.member;
  if (viewer.acting && p.playerId) {
    who = readRosterFull_(ss).find((r) => String(r.PlayerID) === String(p.playerId));
    if (!who) throw new Error('Player not found.');
  }
  if (!who) throw new Error('Pick who to sign up.');
  let changed = null; // { key, group } once saved
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const all = laRead_(ss, LA.SIGNUPS);
    if (all.some((s) => s.SignupID === id)) return laGetBoard_(ss, viewer); // a retry that already went through
    const events = laEventsAndTourns_(ss);
    let key = String(p.dateKey || '');
    if (group === 'fun' || group === 'nassau') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !laIsPlayDay_(key)) throw new Error('That is not a Legends play day.');
      if (laRead_(ss, LA.CLOSURES).some((c) => c.DateKey === key)) throw new Error('There are no Legends tee times that day.');
      const tr = laTournOnDay_(ss, key);
      // ...and the other way round: someone in that day's tournament can't also join the Nassau group
      const inT = laTournAll_(ss).find((t) => t.DateKey === key && laTournActive_(t) && all.some((s) => s.Group === laTournGroup_(t) && String(s.PlayerID) === String(who.PlayerID)));
      if (inT) throw new Error(displayName_(who.Name) + ' is already signed up for the ' + laTournTitle_(inT) + ' that day. Remove that sign-up first to play in the ' + (group === 'fun' ? 'Fun group' : 'Nassau group') + '.');
      if (tr[group]) throw new Error(laDateLabel_(key) + ' is the ' + tr[group] + ', which uses the ' + (group === 'fun' ? 'Fun Group' : 'Nassau group') + '\'s tee times. Sign up for the ' + tr[group] + ' instead.');
      if (!viewer.acting) {
        const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key);
        const info = laDayInfo_(key, st, cfg, '', '', laRead_(ss, LA.CLUB_TEE_TIMES), Date.now());
        if (info.state === 'notyet') throw new Error('Sign-ups for ' + laDateLabel_(key) + ' are not open yet.');
        if (info.state === 'closed') throw new Error('Sign-ups for ' + laDateLabel_(key) + ' are closed. Call the pro shop and let the admin know.');
      }
      const mineToday = all.filter((s) => s.DateKey === key && (s.Group === 'fun' || s.Group === 'nassau') && String(s.PlayerID) === String(who.PlayerID));
      const same = mineToday.find((s) => s.Group === group);
      if (same) throw new Error(displayName_(who.Name) + ' is already signed up for the ' + laGroupLabel_(same.Group) + ' that day.');
      // One round a day — except a player on standby in one group may also take a spot in
      // the other (or the other way round). If the standby spot comes through, they're
      // moved over automatically (see laLeave_).
      if (mineToday.length) {
        const other = mineToday[0];
        const oCap = laCapacity_(ss, st, key, other.Group, events);
        const otherIsStandby = laGroupList_(all, key, other.Group).findIndex((s) => s.SignupID === other.SignupID) >= oCap.slots;
        const nCap = laCapacity_(ss, st, key, group, events);
        const newIsStandby = laGroupList_(all, key, group).length >= nCap.slots;
        if (otherIsStandby === newIsStandby) {
          throw new Error(displayName_(who.Name) + ' is already ' + (otherIsStandby ? 'on standby for' : 'signed up for') + ' the ' + laGroupLabel_(other.Group) +
            ' that day. You can be on standby in one group and play in the other, but not ' + (otherIsStandby ? 'on standby in both.' : 'play in both.'));
        }
      }
    } else if (group.indexOf('event:') === 0) {
      const ev = events.find((e) => 'event:' + e.EventID === group);
      if (!ev || !laIsTrue_(ev.Active, true)) throw new Error('That event is not open for sign-ups.');
      key = ev.DateKey;
      if (!viewer.acting && key < laTodayKey_()) throw new Error('That event has already happened.');
      const opens = laEventOpens_(ev);
      if (!viewer.acting && laTodayKey_() < opens) throw new Error('Sign-ups for ' + ev.Title + ' open on ' + laDateLabel_(opens) + '.');
      if (all.some((s) => s.Group === group && String(s.PlayerID) === String(who.PlayerID))) throw new Error(displayName_(who.Name) + ' is already signed up for this event.');
    } else if (group.indexOf('tourn:') === 0) {
      const t = laTournById_(ss, group.slice(6));
      if (!t || !laTournActive_(t)) throw new Error('That tournament is not open for sign-ups.');
      key = t.DateKey;
      const title = laTournTitle_(t);
      if (!viewer.acting) {
        if (key < laTodayKey_()) throw new Error('The ' + title + ' has already been played.');
        if (Date.now() < laTournOpensAt_(st, t)) throw new Error('Sign-ups for the ' + title + ' open on ' + laDateLabel_(laTournOpens_(t)) + '.');
        if (Date.now() > laTournClosesAt_(st, t)) throw new Error('Sign-ups for the ' + title + ' have closed. Ask an admin to add you.');
      }
      // Any member can play (Tom 2026-11-23: My info's group doesn't matter), but one round a day:
      // someone already in the Nassau group that day can't also play the $5 Tournament.
      const other = all.find((s) => s.DateKey === key && (s.Group === 'fun' || s.Group === 'nassau') && String(s.PlayerID) === String(who.PlayerID));
      if (other) throw new Error(displayName_(who.Name) + ' is already signed up for the ' + laGroupLabel_(other.Group) + ' that day. Remove that sign-up first to play in the ' + title + '.');
      if (all.some((s) => s.Group === group && String(s.PlayerID) === String(who.PlayerID))) throw new Error(displayName_(who.Name) + ' is already signed up for the ' + title + '.');
    } else {
      throw new Error('Choose Fun group, Nassau group, a tournament or an event.');
    }
    const cap = laCapacity_(ss, st, key, group, events);
    const count = laGroupList_(all, key, group).length;
    if (!viewer.acting && count >= cap.slots + cap.standby) throw new Error('That list and its standby list are full.');
    const isFun = group === 'fun';
    const isTourn = group.indexOf('tourn:') === 0;
    const tees = isTourn ? laTournTees_(st) : String(st.TeeOptions || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (isTourn && !viewer.acting && !String(p.tee || '')) throw new Error('Choose your tees (' + tees.join(' or ') + ').');
    const hasTee = isFun || group === 'nassau' || isTourn;
    const tee = hasTee ? String(p.tee || '') : '';
    if (hasTee && tee && tees.indexOf(tee) === -1) throw new Error('Choose a tee from the list.');
    const holes = isFun ? (['18', 'F9', 'B9'].indexOf(String(p.holes)) !== -1 ? String(p.holes) : '18') : '';
    const note = String(p.note || '').trim().slice(0, 120);
    laAppend_(ss, LA.SIGNUPS, {
      SignupID: id, DateKey: key, Group: group, PlayerID: who.PlayerID, Name: who.Name,
      Tee: tee, Holes: holes, Riding: (isFun || isTourn) && (p.riding === true || p.riding === 'true') ? 'TRUE' : '',
      Note: note, SignedUpAt: Date.now(), AddedBy: viewer.acting ? ('Admin: ' + viewer.adminName) : 'self',
    });
    changed = { key: key, group: group };
    const position = count + 1;
    logActivity_(ss, viewer.acting ? viewer.adminName : who.Name, 'Signed up',
      (viewer.acting ? displayName_(who.Name) + ' — ' : '') + laGroupLabel_(group, events) + ' ' + laDateLabel_(key) +
      (position > cap.slots ? ' (standby #' + (position - cap.slots) + ')' : ''));
  } finally {
    lock.releaseLock();
  }
  if (changed && !p.skipAfter) laAfterSignupChange_(ss, changed.key, changed.group);
  return p.noBoard ? null : laGetBoard_(ss, viewer);
}

// An admin adds several players in one save (Tom 2026-11-24): p.many = JSON [{ signupId, playerId, tee, holes }].
// Each one goes through the usual laJoin_ checks; pairings and emails are refreshed once at the end.
function laJoinMany_(ss, viewer, p) {
  if (!viewer.acting) throw new Error('Only admins can add several players at once.');
  let list;
  try { list = JSON.parse(String(p.many)); } catch (e) { throw new Error('Invalid list of players.'); }
  if (!Array.isArray(list) || !list.length) throw new Error('Pick at least one player.');
  if (list.length > 40) throw new Error('Add at most 40 players at a time.');
  const added = [], failed = [];
  list.forEach((it) => {
    const q = Object.assign({}, p, { many: '', signupId: it.signupId, playerId: it.playerId, tee: it.tee || '', holes: it.holes || '', riding: it.riding || '', note: '', skipAfter: true, noBoard: true });
    try { laJoin_(ss, viewer, q); added.push(String(it.playerId)); } catch (e) { failed.push({ playerId: String(it.playerId), error: String(e && e.message || e) }); }
  });
  if (!added.length) throw new Error(failed[0].error);
  laAfterSignupChange_(ss, String(p.dateKey || ''), String(p.group || ''));
  const b = laGetBoard_(ss, viewer);
  b.addResult = { added: added, failed: failed };
  return b;
}

function laLeave_(ss, viewer, p) {
  const st = laSettings_(ss);
  const id = String(p.signupId || '');
  let mails = [];
  let heldOut = null, changed = null;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = laSheet_(ss, LA.SIGNUPS);
    const all = laRead_(ss, LA.SIGNUPS);
    const row = all.find((s) => s.SignupID === id);
    if (!row) return p.noBoard ? null : laGetBoard_(ss, viewer); // already gone
    if (!viewer.acting && (!viewer.member || String(row.PlayerID) !== String(viewer.member.PlayerID))) throw new Error('You can only remove yourself.');
    const today = laTodayKey_();
    if (!viewer.acting && row.DateKey < today) throw new Error('That date has passed.');
    const events = laEventsAndTourns_(ss);
    const cap = laCapacity_(ss, st, row.DateKey, row.Group, events);
    const before = laGroupList_(all, row.DateKey, row.Group);
    const wasIn = before.findIndex((s) => s.SignupID === id) < cap.slots;
    const after = before.filter((s) => s.SignupID !== id);
    const promoted = wasIn && after.length >= cap.slots ? after[cap.slots - 1] : null;
    // A promoted player who was also holding a spot in the other group that day gives that spot up.
    const isRoundGroup = row.Group === 'fun' || row.Group === 'nassau';
    const heldElsewhere = promoted && isRoundGroup ? all.find((s) => s.DateKey === row.DateKey && String(s.PlayerID) === String(promoted.PlayerID) &&
      s.SignupID !== promoted.SignupID && (s.Group === 'fun' || s.Group === 'nassau')) : null;

    // Delete by locating the row on the sheet itself.
    const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map((r) => String(r[0]));
    const idx = ids.indexOf(id);
    if (idx !== -1) sh.deleteRow(idx + 2);
    laInvalidate_(LA.SIGNUPS);

    const label = laGroupLabel_(row.Group, events) + ' on ' + laDateLabel_(row.DateKey);
    logActivity_(ss, viewer.acting ? viewer.adminName : row.Name, 'Dropped out',
      (viewer.acting ? displayName_(row.Name) + ' — ' : '') + label + (promoted ? ' (' + displayName_(promoted.Name) + ' moved up from standby)' : ''));

    if (heldElsewhere) heldOut = { id: heldElsewhere.SignupID, toGroup: row.Group };
    const roster = readRosterFull_(ss);
    if (promoted) {
      const pr = roster.find((r) => String(r.PlayerID) === String(promoted.PlayerID)) || { Name: promoted.Name, Email: '' };
      const m = laStandbyMail_(st, pr, label, heldElsewhere ? ' You have been taken off the ' + laGroupLabel_(heldElsewhere.Group) + ' that day, so your spot there goes to the next person.' : '', laSiteUrl_(ss, p));
      if (m) mails.push(m);
    }
    const isRound = row.Group === 'fun' || row.Group === 'nassau';
    if (isRound) changed = { key: row.DateKey, group: row.Group };
    // Remembered so a SignUp Genius import doesn't put him back (not the automatic move to the other group).
    if (isRound && !/^Auto \(moved/.test(String(viewer.adminName || ''))) laSugDropAdd_(row.DateKey, row.PlayerID);
    // ...and so the next email to that group's players also goes to him, as confirmation (Tom 2026-11-06)
    if (isRound && !/^Auto \(moved/.test(String(viewer.adminName || ''))) laDropAdd_(row.DateKey, row.Group, row.PlayerID);
    const late = isRound && Date.now() > laDayInfo_(row.DateKey, st, null, '', '', [], Date.now()).closesAt;
    // a tournament drop-out after its sign-ups closed: the admin hears about it too (pairings may need a change)
    const tLeft = String(row.Group).indexOf('tourn:') === 0 ? laTournById_(ss, String(row.Group).slice(6)) : null;
    const lateT = !!tLeft && wasIn && Date.now() > laTournClosesAt_(st, tLeft);
    // a late drop-out from a spot (not from standby, and not the automatic move to the other group)
    if (late && wasIn && !p.noRecord && !/^Auto/.test(String(viewer.adminName || ''))) laAttendanceAdd_(ss, row, 'late', viewer.acting ? viewer.adminName : 'self');
    if ((late || lateT) && st.AdminEmail && laOn_(st, 'LateDropEmailOn')) {
      mails.push({ to: st.AdminEmail, subject: 'Late drop-out: ' + displayName_(row.Name) + ', ' + label,
        body: displayName_(row.Name) + ' dropped out of the ' + label + ' after sign-ups closed' +
          (viewer.acting ? ' (removed by admin ' + viewer.adminName + ')' : '') + '.\n\n' +
          (promoted ? displayName_(promoted.Name) + ' moved up from the standby list' + (laOn_(st, 'StandbyEmailOn') ? ' and has been emailed.\n\n' : '. The "Moved up from standby" email is switched off, so nobody has emailed him.\n\n') : 'Nobody was on standby to move up.\n\n') +
          (lateT ? 'The tournament pairings may need a change (Admin › Setup › Tournaments), and the pro shop may need to be told.' : 'The pro shop may need to be told.') });
    }
  } finally {
    lock.releaseLock();
  }
  mails.forEach((m) => laMail_(ss, m.to, m.subject, m.body, m.cc));
  if (changed) laAfterSignupChange_(ss, changed.key, changed.group);
  if (heldOut) {
    // Their spot in the other group is freed the normal way (next standby moves up, late drop-out email).
    laLeave_(ss, { acting: true, adminName: 'Auto (moved to ' + laGroupLabel_(heldOut.toGroup) + ')' }, { signupId: heldOut.id, noBoard: true });
  }
  return p.noBoard ? null : laGetBoard_(ss, viewer);
}

function laUpdate_(ss, viewer, p) {
  const st = laSettings_(ss);
  const id = String(p.signupId || '');
  let changed = null;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = laSheet_(ss, LA.SIGNUPS);
    const ids = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().map((r) => String(r[0]));
    const idx = ids.indexOf(id);
    if (idx === -1) throw new Error('That sign-up was not found — it may have been removed.');
    const row = laRead_(ss, LA.SIGNUPS).find((s) => s.SignupID === id);
    if (!viewer.acting && (!viewer.member || String(row.PlayerID) !== String(viewer.member.PlayerID))) throw new Error('You can only change your own sign-up.');
    if (!viewer.acting && (row.Group === 'fun' || row.Group === 'nassau') &&
        Date.now() > laDayInfo_(row.DateKey, st, null, '', '', [], Date.now()).closesAt) {
      throw new Error('Sign-ups are closed for that date. Call the pro shop and let the admin know.');
    }
    const isTourn = String(row.Group).indexOf('tourn:') === 0;
    if (isTourn && !viewer.acting) {
      const t = laTournById_(ss, String(row.Group).slice(6));
      if (t && Date.now() > laTournClosesAt_(st, t)) throw new Error('Sign-ups for the ' + laTournTitle_(t) + ' have closed. Ask an admin to make the change.');
    }
    if (row.Group === 'fun' || row.Group === 'nassau' || isTourn) {
      const tees = isTourn ? laTournTees_(st) : String(st.TeeOptions || '').split(',').map((t) => t.trim()).filter(Boolean);
      if (p.tee !== undefined) { if (p.tee && tees.indexOf(p.tee) === -1) throw new Error('Choose a tee from the list.'); row.Tee = p.tee; }
    }
    if (row.Group === 'fun') {
      if (p.holes !== undefined) row.Holes = ['18', 'F9', 'B9'].indexOf(String(p.holes)) !== -1 ? String(p.holes) : '18';
    }
    if ((row.Group === 'fun' || isTourn) && p.riding !== undefined) row.Riding = (p.riding === true || p.riding === 'true') ? 'TRUE' : '';
    if (p.note !== undefined) row.Note = String(p.note || '').trim().slice(0, 120);
    changed = { key: row.DateKey, group: row.Group };
    const h = LA_HEADERS.Signups;
    const range = sh.getRange(idx + 2, 1, 1, h.length);
    range.setNumberFormat('@');
    range.setValues([h.map((k) => (row[k] === undefined ? '' : String(row[k])))]);
    laInvalidate_(LA.SIGNUPS);
  } finally {
    lock.releaseLock();
  }
  if (changed) laAfterSignupChange_(ss, changed.key, changed.group);
  return laGetBoard_(ss, viewer);
}

// ---------------- admin saves ----------------

// Event sign-ups open on SignupOpens; if that's blank, two weeks before the event.
function laEventOpens_(ev) { return ev.SignupOpens || laAddDays_(ev.DateKey, -14); }
function laAdminReplace_(ss, p, sheetName, rows, logLabel) {
  const admin = laRequireAdmin_(ss, p);
  const h = LA_HEADERS[sheetName];
  const clean = (rows || []).map((r) => {
    const o = {};
    h.forEach((k) => { o[k] = r[k] === undefined || r[k] === null ? '' : String(r[k]).trim(); });
    return o;
  }).filter((o) => h.some((k) => o[k] !== ''));
  clean.forEach((o) => {
    ['DateKey', 'EffectiveDate'].forEach((k) => {
      if (k in o && o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Error('"' + o[k] + '" is not a date.');
    });
    if ('FirstTeeTime' in o && laParseTime_(o.FirstTeeTime) === null) throw new Error('Enter times like 8:00 AM.');
  });
  if (sheetName === LA.EVENTS) {
    clean.forEach((o) => {
      if (!o.Title) throw new Error('Every event needs a title.');
      if (!o.DateKey) throw new Error(o.Title + ': choose a date.');
      if (o.SignupOpens && !/^\d{4}-\d{2}-\d{2}$/.test(o.SignupOpens)) throw new Error(o.Title + ': the sign-up date is not a date.');
      if (o.SignupOpens && o.SignupOpens > o.DateKey) throw new Error(o.Title + ': sign-ups have to open on or before the event date.');
      if (!o.EventID) o.EventID = 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    });
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let moved = null;
  try {
    laWriteAll_(ss, sheetName, clean);
    if (sheetName === LA.CLOSURES) moved = laMoveDutyForClosures_(ss, admin); // duty day closed: move it earlier (Tom 2026-11-15)
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, logLabel, clean.length + ' row' + (clean.length === 1 ? '' : 's'));
  const board = laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
  if (moved) board.dutyMoves = moved;
  return board;
}

function laSaveDayConfig_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const r = JSON.parse(p.row || '{}');
  const key = String(r.DateKey || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a date.');
  if (r.LegendsFirst && laParseTime_(r.LegendsFirst) === null) throw new Error('Enter the first Legends time like 8:40 AM.');
  if (r.LegendsFirst) {
    // Must be one of the club's times: on the hour, then every interval until the 12-minute step.
    const iv = laNum_(laSettings_(ss).TeeIntervalMin, 8), m = laParseTime_(r.LegendsFirst) % 60;
    if (m % iv !== 0 || m > 52) throw new Error(r.LegendsFirst + " isn't a club tee time (they run :00, :08, :16 ... :48).");
    const club = laClubFirstTee_(laRead_(ss, LA.CLUB_TEE_TIMES), key, laSettings_(ss));
    if (laParseTime_(club) !== null && laParseTime_(r.LegendsFirst) < laParseTime_(club)) throw new Error("The Legends can't start before the club's first tee time (" + club + ').');
  }
  ['FunTeeTimes', 'NassauTeeTimes'].forEach((k) => {
    const v = r[k] === undefined || r[k] === null ? '' : String(r[k]).trim();
    if (v !== '' && !/^\d{1,2}$/.test(v)) throw new Error('Tee time counts must be whole numbers.');
  });
  // At most 9 tee times a day in all, split as entered (Tom 2026-11-07); blank = the usual number.
  const dst = laSettings_(ss), cnt = (k, d) => (r[k] === undefined || r[k] === null || String(r[k]).trim() === '' ? laNum_(dst[k], d) : Number(r[k]));
  if (cnt('FunTeeTimes', 4) + cnt('NassauTeeTimes', 5) > LA_MAX_TEE_TIMES_) throw new Error('At most ' + LA_MAX_TEE_TIMES_ + ' tee times a day in all (Fun + Nassau).');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = laRead_(ss, LA.DAY_CONFIG).filter((c) => c.DateKey !== key);
    const o = {};
    LA_HEADERS.DayConfig.forEach((k) => { o[k] = r[k] === undefined || r[k] === null ? '' : String(r[k]).trim(); });
    if (o.OpenEarly && o.OpenEarly !== 'TRUE') o.OpenEarly = '';
    if (LA_HEADERS.DayConfig.some((k) => k !== 'DateKey' && o[k] !== '')) rows.push(o);
    rows.sort((a, b) => (a.DateKey < b.DateKey ? -1 : 1));
    laWriteAll_(ss, LA.DAY_CONFIG, rows);
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Changed first tee time', laDateLabel_(key));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}

// Replaces every duty row whose DateKey is within [fromKey, toKey] with
// `rows` (each { DateKey, Role: 'inperson'|'phone', PlayerID, TargetKey? }).
function laSaveDuty_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const fromKey = String(p.fromKey || ''), toKey = String(p.toKey || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey) || fromKey > toKey) throw new Error('Choose a valid date range.');
  let moved = null;
  const incoming = JSON.parse(p.rows || '[]');
  const roster = readRosterFull_(ss);
  const byId = {}; roster.forEach((r) => { byId[String(r.PlayerID)] = r; });
  const clean = incoming.map((r) => {
    const key = String(r.DateKey || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < fromKey || key > toKey) throw new Error('Duty date ' + key + ' is outside the range being saved.');
    if (r.Role !== 'inperson' && r.Role !== 'phone') throw new Error('Unknown duty type.');
    const pl = byId[String(r.PlayerID)];
    if (!pl) throw new Error('A duty assignment names a player who is not on the roster.');
    const target = String(r.TargetKey || ''), from = String(r.MovedFrom || '');
    return { DateKey: key, Role: r.Role, PlayerID: String(pl.PlayerID), Name: pl.Name, TargetKey: target && target !== laDefaultTarget_(key) ? target : '',
      MovedFrom: /^\d{4}-\d{2}-\d{2}$/.test(from) && from > key ? from : '' };
  });
  const perDay = {};
  clean.forEach((r) => {
    const list = perDay[r.DateKey] = perDay[r.DateKey] || [];
    if (list.indexOf(r.PlayerID) !== -1) throw new Error(displayName_(r.Name) + ' is listed twice on ' + laDateLabel_(r.DateKey) + '.');
    list.push(r.PlayerID);
    const sameRole = clean.filter((x) => x.DateKey === r.DateKey && x.Role === r.Role).length;
    if (r.Role === 'inperson' && sameRole > 3) throw new Error(laDateLabel_(r.DateKey) + ' has more than three people in person.');
    if (r.Role === 'phone' && sameRole > 1) throw new Error(laDateLabel_(r.DateKey) + ' has more than one phone-in person.');
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const keep = laRead_(ss, LA.DUTY).filter((d) => d.DateKey < fromKey || d.DateKey > toKey);
    const all = keep.concat(clean).sort((a, b) => (a.DateKey < b.DateKey ? -1 : a.DateKey > b.DateKey ? 1 : (a.Role < b.Role ? -1 : 1)));
    laWriteAll_(ss, LA.DUTY, all);
    laUpdateSitOuts_(ss, all, roster, fromKey, toKey);
    moved = laMoveDutyForClosures_(ss, admin);
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Saved tee time duty', laDateLabel_(fromKey) + ' – ' + laDateLabel_(toKey) + ': ' + clean.length + ' assignment' + (clean.length === 1 ? '' : 's'));
  const board = laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
  if (moved) board.dutyMoves = moved;
  return board;
}

// ---------------- duty on a day the club is closed (Tom 2026-11-15) ----------------
// When the club is closed on a duty day itself (Christmas Day, a snow day), the club lets us
// request that round's tee times early: e.g. on Thu Dec 24 for Fri Jan 8 instead of on
// Fri Dec 25. So duty rows (today or later) on a day in Closures with "Pro shop closed too"
// ticked (ShopClosed; on an outside event day the shop is open, so duty stays) move to the closest earlier
// day that is open, has no other duty and hasn't passed. They keep the round they book
// (TargetKey) and remember their own day (MovedFrom). If that closure is taken off again
// before the duty, they go back to their own day. Runs after closures or duty are saved,
// after a SignUp Genius import adds closures, and every hour. The caller holds the lock.
// Returns { moved: [{ from, to, back }], stuck: [dateKey] } or null when nothing changed.
function laMoveDutyForClosures_(ss, who) {
  const today = laTodayKey_();
  const closedBy = laShopClosedBy_(laRead_(ss, LA.CLOSURES));
  const duty = laRead_(ss, LA.DUTY);
  const has = (k) => duty.some((d) => d.DateKey === k);
  const targetOf = (d) => d.TargetKey || laDefaultTarget_(d.DateKey);
  const put = (d, key, from) => { const t = targetOf(d); d.DateKey = key; d.TargetKey = t !== laDefaultTarget_(key) ? t : ''; d.MovedFrom = from; };
  const groupBy = (rows) => { const g = {}; rows.forEach((d) => { (g[d.DateKey] = g[d.DateKey] || []).push(d); }); return g; };
  const moved = [], stuck = [];
  // 1. Club open again on a moved duty's own day: move it back, if that day is still free.
  const back = groupBy(duty.filter((d) => d.MovedFrom && d.DateKey >= today && !closedBy[d.MovedFrom]));
  Object.keys(back).sort().forEach((key) => {
    const home = back[key][0].MovedFrom;
    if (has(home)) return;
    back[key].forEach((d) => put(d, home, ''));
    moved.push({ from: key, to: home, back: true });
  });
  // 2. Duty on a closed day: move it to the closest earlier open, free, not-past day.
  const off = groupBy(duty.filter((d) => d.DateKey >= today && closedBy[d.DateKey]));
  Object.keys(off).sort().forEach((key) => {
    let to = '';
    for (let i = 1; i <= 7; i++) {
      const k = laAddDays_(key, -i);
      if (k < today) break;
      if (closedBy[k] || has(k)) continue;
      to = k; break;
    }
    if (!to) { stuck.push(key); return; }
    off[key].forEach((d) => put(d, to, d.MovedFrom || key));
    moved.push({ from: key, to: to, back: false });
  });
  if (!moved.length) return stuck.length ? { moved: [], stuck: stuck } : null;
  laWriteAll_(ss, LA.DUTY, duty.sort((a, b) => (a.DateKey < b.DateKey ? -1 : a.DateKey > b.DateKey ? 1 : (a.Role < b.Role ? -1 : 1))));
  // Open swap requests follow the duty to its new day.
  const swaps = laRead_(ss, LA.SWAPS);
  let swapsChanged = false;
  moved.forEach((m) => swaps.forEach((x) => {
    if (x.Status !== 'pending') return;
    if (x.FromKey === m.from) { x.FromKey = m.to; swapsChanged = true; }
    if (x.ToKey === m.from) { x.ToKey = m.to; swapsChanged = true; }
  }));
  if (swapsChanged) laWriteAll_(ss, LA.SWAPS, swaps);
  moved.forEach((m) => logActivity_(ss, who || 'System', m.back ? 'Moved tee time duty back' : 'Moved tee time duty earlier',
    laDateLabel_(m.from) + ' → ' + laDateLabel_(m.to) + (m.back ? ' (club open again)' : ' (club closed ' + laDateLabel_(m.from) + ')')));
  return { moved: moved, stuck: stuck };
}

// ---------------- tee time duty: who does which duty, heavy days, quarters (Tom 2026-11-01) ----------------

const LA_DUTY_STATUSES_ = ['phone', 'inperson', 'nonmember', 'medical'];
// Tom's lists of 2026-11-01, matched to the roster once by last name (and first
// initial where given; "a|b" = either spelling). After that they're edited in the app.
const LA_DUTY_SEED_ = [
  ['Alston', '', 'phone', 'Drive time to HGC over 15 min'], ['Colt', '', 'phone', 'SUG Administrator'],
  ['Davis', 'L', 'phone', 'Sign-ups Manager'], ['DeLisle', '', 'phone', 'Drive time to HGC over 15 min'],
  ['Dillion|Dillon', '', 'phone', 'Drive time to HGC over 15 min'], ['Dunbar', '', 'phone', 'Tee Times Manager'],
  ['Hood', '', 'phone', 'Drive time to HGC over 15 min'], ['Kalloway', '', 'phone', 'Drive time to HGC over 15 min'],
  ['Kloepfer', '', 'phone', 'Drive time to HGC over 15 min'], ['Roane', '', 'phone', 'Drive time to HGC over 15 min'],
  ['Rowinski', '', 'phone', 'Drive time to HGC over 15 min'], ['Schipani', '', 'phone', 'SUG Administrator'],
  ['Taylor', '', 'phone', 'Drive time to HGC over 15 min'], ['Visser', '', 'phone', 'Drive time to HGC over 15 min'],
  ['Aiello', '', 'nonmember', ''], ['Houseworth', '', 'nonmember', ''], ['Sullivan', '', 'nonmember', ''],
  ['Gurganus', '', 'inperson', ''], ['Swinson', '', 'inperson', ''], ['McGuffin', '', 'inperson', ''],
];
function laSeedDutyLists_(ss) {
  const roster = readRosterFull_(ss);
  const out = {};
  LA_DUTY_SEED_.forEach(([last, init, s, r]) => {
    const lasts = last.toLowerCase().split('|');
    const hits = roster.filter((p) => {
      const parts = String(p.Name || '').split(',');
      return lasts.indexOf(parts[0].trim().toLowerCase()) !== -1 && (!init || String(parts[1] || '').trim().charAt(0).toUpperCase() === init);
    });
    if (hits.length === 1) out[String(hits[0].PlayerID)] = { s: s, r: r };
  });
  return JSON.stringify(out);
}
function laJson_(v, dflt) {
  try { const x = JSON.parse(v || ''); return x && typeof x === 'object' ? x : dflt; } catch (e) { return dflt; }
}
// Quarters run Monday to Friday: each starts on the Monday of the week holding
// Jan 1, Apr 1, Jul 1 or Oct 1 (Q1 2027 = Mon Dec 28, 2026 to Fri Mar 26, 2027).
function laQuarterStart_(year, q) {
  const first = year + '-' + String(3 * q - 2).padStart(2, '0') + '-01';
  return laAddDays_(first, -((laDow_(first) + 6) % 7));
}
function laQuarterOf_(key) {
  const y = Number(key.slice(0, 4));
  for (let yy = y + 1; yy >= y - 1; yy--) {
    for (let q = 4; q >= 1; q--) {
      const start = laQuarterStart_(yy, q);
      if (start > key) continue;
      const next = q === 4 ? laQuarterStart_(yy + 1, 1) : laQuarterStart_(yy, q + 1);
      return { id: yy + '-Q' + q, start: start, end: laAddDays_(next, -3) };
    }
  }
  return null;
}
// After a duty save: for each quarter the save touched, record who sat out (eligible
// members with no duty that quarter). A quarter with a week left empty isn't finished
// (or was deleted), so it has no record. Caller holds the script lock.
function laUpdateSitOuts_(ss, duty, roster, fromKey, toKey) {
  const st = laSettingsFresh_(ss);
  const lists = laJson_(st.DutyLists, {});
  const sitOuts = laJson_(st.DutySitOuts, {});
  const eligible = roster.filter((r) => String(r.Name || '').trim() && memberIsActive_(r))
    .map((r) => String(r.PlayerID)).filter((id) => ['nonmember', 'medical'].indexOf((lists[id] || {}).s) === -1);
  for (let qt = laQuarterOf_(fromKey); qt && qt.start <= toKey; qt = laQuarterOf_(laAddDays_(qt.end, 3))) {
    const rows = duty.filter((d) => d.DateKey >= qt.start && d.DateKey <= qt.end);
    let full = true;
    for (let mon = qt.start; mon <= qt.end; mon = laAddDays_(mon, 7)) {
      if (!rows.some((d) => d.DateKey >= mon && d.DateKey <= laAddDays_(mon, 4))) full = false;
    }
    if (full) {
      const on = {}; rows.forEach((d) => { on[String(d.PlayerID)] = true; });
      sitOuts[qt.id] = eligible.filter((id) => !on[id]);
    } else {
      delete sitOuts[qt.id];
    }
  }
  const v = JSON.stringify(sitOuts);
  if (v !== st.DutySitOuts) { st.DutySitOuts = v; laWriteSettings_(ss, st); }
}
function laWriteSettings_(ss, st) {
  laWriteAll_(ss, LA.APP_SETTINGS, Object.keys(st).map((k) => ({ Key: k, Value: st[k] })));
}
// Saves the duty lists (p.lists, JSON as in DutyLists) and/or heavy days (p.heavy,
// comma-separated keys). A separate action so a limited admin with the Tee Time Duty
// page can save them (LIMITED_PAGES_ in Code.gs).
function laSaveDutySetup_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const byId = {}; readRosterFull_(ss).forEach((r) => { byId[String(r.PlayerID)] = r; });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  const what = [];
  try {
    const st = laSettingsFresh_(ss);
    if (p.lists !== undefined) {
      const inLists = laJson_(p.lists, {}), clean = {};
      Object.keys(inLists).forEach((id) => {
        const x = inLists[id] || {};
        if (byId[id] && LA_DUTY_STATUSES_.indexOf(x.s) !== -1) clean[id] = { s: x.s, r: String(x.r || '').trim().slice(0, 80) };
      });
      st.DutyLists = JSON.stringify(clean);
      what.push('duty lists');
    }
    if (p.heavy !== undefined) {
      const inHeavy = laJson_(p.heavy, {}), clean = {};
      Object.keys(inHeavy).sort().forEach((k) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error('Not a date: ' + k);
        clean[k] = String(inHeavy[k] || '').trim().slice(0, 60);
      });
      st.DutyHeavyDays = JSON.stringify(clean);
      what.push('heavy-demand days');
    }
    if (p.awayDue !== undefined) {
      const inDue = laJson_(p.awayDue, {}), clean = {};
      Object.keys(inDue).sort().forEach((q) => {
        const k = String(inDue[q] || '');
        if (!/^\d{4}-Q[1-4]$/.test(q)) return;
        if (k && !/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error('Not a date: ' + k);
        if (k) clean[q] = k;
      });
      st.DutyAwayDue = JSON.stringify(clean);
      what.push('away weeks due date');
    }
    if (p.awayOpen !== undefined) { // the day the box opens for members, per quarter (Tom 2026-11-22)
      const inOpen = laJson_(p.awayOpen, {}), clean = {};
      Object.keys(inOpen).sort().forEach((q) => {
        const k = String(inOpen[q] || '');
        if (!/^\d{4}-Q[1-4]$/.test(q)) return;
        if (k && !/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error('Not a date: ' + k);
        if (k) clean[q] = k;
      });
      st.DutyAwayOpen = JSON.stringify(clean);
      what.push('away weeks start date');
    }
    laWriteSettings_(ss, st);
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Saved tee time duty setup', what.join(' and '));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}
// Heavy-demand days as { DateKey: reason }. (Briefly a plain comma-separated list of keys.)
function laHeavyDays_(st) {
  const v = String(st.DutyHeavyDays || '').trim();
  if (v.charAt(0) === '{') return laJson_(v, {});
  const out = {}; v.split(',').filter(Boolean).forEach((k) => { out[k.trim()] = ''; });
  return out;
}
// Settings members see: the duty lists (medical leave, reasons) and sit-out history are admin-only.
function laPublicSettings_(st) {
  const out = Object.assign({}, st);
  delete out.DutyLists; delete out.DutySitOuts;
  return out;
}

function laSaveAppSettings_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const patch = JSON.parse(p.settings || '{}');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const changed = [];
  try {
  const st = laSettingsFresh_(ss);
  Object.keys(patch).forEach((k) => {
    if (!(k in LA_DEFAULT_SETTINGS)) return;
    const v = String(patch[k] == null ? '' : patch[k]).trim();
    if (st[k] !== v) { st[k] = v; changed.push(k); }
  });
  ['SignupOpenTime', 'DefaultClubFirstTee'].forEach((k) => { if (laParseTime_(st[k]) === null) throw new Error(k + ': enter a time like 7:10 AM.'); });
  // DailyGroupMembers: one line per group, "group@googlegroups.com: a@aol.com, b@nc.rr.com"
  st.DailyGroupMembers = String(st.DailyGroupMembers || '').split(/\n/).map((line) => {
    const m = line.match(/^\s*([^:\s,]+@[^:\s,]+)\s*:(.*)$/);
    const list = laEmailList_(m ? m[2] : line), bad = list.concat(m ? [m[1]] : []).filter((e) => !isValidEmail_(e));
    if (bad.length) throw new Error('Not a valid email address: ' + bad.join(', '));
    return list.length ? (m ? m[1] + ': ' : '') + list.join(', ') : '';
  }).filter(Boolean).join('\n');
  ['ProShopEmails', 'ProShopExtraEmails', 'DailyExtraEmails', 'DutyExtraEmails', 'PlayingExtraEmails', 'ClosingExtraEmails', 'DailyGroupEmail', 'StandbyExtraEmails', 'PairingsExtraEmails', 'FunPairingsExtraEmails', 'NassauChangesExtraEmails', 'NassauTomorrowExtraEmails', 'TournEmailExtraEmails'].forEach((k) => {
    const bad = laEmailList_(st[k]).filter((e) => !isValidEmail_(e));
    if (bad.length) throw new Error('Not a valid email address: ' + bad.join(', '));
    st[k] = laEmailList_(st[k]).join(', ');
  });
  if (!laEmailList_(st.ProShopEmails).length) throw new Error('Enter at least one pro shop email address.');
  ['ProShopAutoSend', 'ProShopResend', 'StandbyEmailOn', 'FunPairingsResend', 'NassauChangesResend', 'LateDropEmailOn', 'SwapEmailOn', 'ListChangeEmailOn', 'PinResetEmailOn', 'DutyAwayEmailOn', 'TournEmailOn', 'TournEmailProShop'].forEach((k) => { st[k] = laOn_(st, k) ? 'TRUE' : 'FALSE'; });
  ['RemindDuty', 'RemindPlaying', 'RemindClosing', 'RemindDaily', 'StandbyAppLink', 'PairingsAutoSend', 'FunPairingsAutoSend', 'NassauTomorrowOn'].forEach((k) => { st[k] = String(st[k]).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE'; });
  st.StandbyCopyTo = String(st.StandbyCopyTo || '').split(/[,\s]+/).filter((a, i, arr) => ['admin', 'proshop', 'extra'].indexOf(a) !== -1 && arr.indexOf(a) === i).join(',');
  if (!String(st.StandbySubject).trim()) st.StandbySubject = LA_DEFAULT_SETTINGS.StandbySubject;
  if (!String(st.StandbyText).trim()) st.StandbyText = LA_DEFAULT_SETTINGS.StandbyText;
  st.TournEmailSendTo = laTournSendTo_(st).join(',');
  Object.keys(LA_EMAIL_PREFIX_).forEach((t) => {
    const pre = LA_EMAIL_PREFIX_[t];
    st[pre + 'SendTo'] = laSendTo_(st, t).join(',');
    st[pre + 'AppLink'] = String(st[pre + 'AppLink']).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE';
  });
  ['ProShopHour', 'FunPairingsHour'].forEach((k) => { st[k] = /^\d{1,2}$/.test(String(st[k])) && Number(st[k]) <= 23 ? String(Number(st[k])) : ''; });
  ['ReminderHour', 'ClosingReminderHour', 'DailyHour', 'PairingsHour', 'NassauTomorrowHour', 'TournEmailHour'].forEach((k) => { const h = parseInt(st[k], 10); if (isNaN(h) || h < 0 || h > 23) throw new Error('Reminder times must be an hour from 0 to 23.'); st[k] = String(h); });
  if (st.SiteUrl && !/^https:\/\//.test(st.SiteUrl)) throw new Error('The app link must start with https://');
  ['NewsDays', 'EmailDailyLimit', 'PlayersPerTeeTime', 'StandbySlots', 'SignupOpenDaysBefore', 'SignupCloseDaysBefore', 'TeeIntervalMin', 'FunTeeTimes', 'NassauTeeTimes', 'BoardDaysAhead', 'TournCloseDaysBefore']
    .forEach((k) => { if (!/^\d+$/.test(st[k])) throw new Error(k + ' must be a whole number.'); });
  { const all = String(st.TeeOptions || '').split(',').map((t) => t.trim()); const tt = String(st.TournTees || '').split(',').map((t) => t.trim()).filter(Boolean);
    const bad = tt.filter((t) => all.indexOf(t) === -1); if (bad.length) throw new Error('Tournament tees must be on the tee list: ' + bad.join(', ') + ' is not.');
    if (!tt.length) throw new Error('Choose at least one tee for tournaments.'); st.TournTees = tt.join(','); }
  if (Number(st.FunTeeTimes) + Number(st.NassauTeeTimes) > LA_MAX_TEE_TIMES_) throw new Error('The usual Fun + Nassau tee times can be at most ' + LA_MAX_TEE_TIMES_ + ' in all.');
    laWriteAll_(ss, LA.APP_SETTINGS, Object.keys(st).map((k) => ({ Key: k, Value: st[k] })));
  } finally {
    lock.releaseLock();
  }
  if (changed.length) logActivity_(ss, admin, 'Changed sign-up settings', changed.map((k) => k + ' = ' + String(patch[k] == null ? '' : patch[k]).trim().slice(0, 40)).join(', '));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}

// One email's settings, from its panel on the page it belongs to (Tom 2026-10-27):
// Nassau pairings on Admin > Pairings > Nassau, the pro shop list on Fun Group, the
// duty reminder on Tee Time Duty. Only that email's own settings are saved, so a
// limited admin with that page (LIMITED_PAGES_ in Code.gs) can change them and nothing else.
const LA_EMAIL_OWN_KEYS_ = { funpairings: [], nassauchanges: [], nassautomorrow: [], pairings: ['PairingsAutoSend', 'PairingsHour'], proshop: ['ProShopAutoSend', 'ProShopResend', 'ProShopEmails', 'ProShopHour'], duty: ['RemindDuty', 'ReminderHour'] };
function laSaveEmailSettings_(ss, p) {
  const type = String(p.type || '');
  if (!LA_EMAIL_OWN_KEYS_[type]) throw new Error('Unknown email.');
  const pre = LA_EMAIL_PREFIX_[type], own = LA_EMAIL_OWN_KEYS_[type];
  const patch = JSON.parse(p.settings || '{}'), keep = {};
  Object.keys(patch).forEach((k) => { if ((k.indexOf(pre) === 0 && /^[A-Z]/.test(k.slice(pre.length))) || own.indexOf(k) !== -1) keep[k] = patch[k]; });
  return laSaveAppSettings_(ss, Object.assign({}, p, { settings: JSON.stringify(keep) }));
}

// ---------------- email ----------------

function laMail_(ss, to, subject, body, cc) {
  try {
    if (MailApp.getRemainingDailyQuota() < 2) return;
    const st = laSettings_(ss);
    laSendEmail_({ to: to, cc: cc || undefined, subject: subject, body: body, name: 'Heritage Legends Golf', replyTo: st.AdminEmail || undefined });
  } catch (err) {
    Logger.log('Email skipped: ' + err.message); // never fail a sign-up over email
  }
}

// The "Moved up from standby" email for player pr (a roster row), per the Standby* settings.
// extra is appended to the text; null when the email is off or would go to nobody.
function laStandbyMail_(st, pr, label, extra, siteUrl) {
  if (!laOn_(st, 'StandbyEmailOn')) return null;
  const copyTo = String(st.StandbyCopyTo || '').split(/[,\s]+/);
  const cc = [];
  if (copyTo.indexOf('admin') !== -1 && st.AdminEmail) cc.push(st.AdminEmail);
  if (copyTo.indexOf('proshop') !== -1) laEmailList_(st.ProShopEmails).forEach((e) => cc.push(e));
  if (copyTo.indexOf('extra') !== -1) laEmailList_(st.StandbyExtraEmails).forEach((e) => cc.push(e));
  const own = String(pr.Email || '').trim();
  const copies = cc.filter((e, i) => cc.indexOf(e) === i && e.toLowerCase() !== own.toLowerCase());
  if (!own && !copies.length) return null;
  const name = displayName_(pr.Name);
  const fill = (t) => String(t || '').replace(/\{first\}/g, name.split(' ')[0]).replace(/\{name\}/g, name).replace(/\{group\}/g, label);
  const link = String(st.StandbyAppLink).toUpperCase() === 'TRUE' && siteUrl ? '\n\nOpen the Legends app: ' + siteUrl : '';
  return { to: own || copies.join(', '), cc: own ? copies.join(', ') : '', subject: fill(st.StandbySubject || LA_DEFAULT_SETTINGS.StandbySubject),
    body: fill(st.StandbyText || LA_DEFAULT_SETTINGS.StandbyText) + (extra || '') + link + '\n\nHeritage Legends Golf' };
}

function displayName_(name) {
  const s = String(name || '');
  const i = s.indexOf(',');
  return i === -1 ? s.trim() : (s.slice(i + 1).trim() + ' ' + s.slice(0, i).trim()).trim();
}


// ---------------- away weeks for tee time duty (Tom 2026-11-21) ----------------
// Each member ticks the weeks of the next quarter they can't do duty, and can add a note.
// Members see only their own; admins see everyone's and can enter them for anyone (for
// Q1 2027 the admins canvass people and type them in). Generate assignments never uses a
// marked week. Anyone with duty in the last month of a quarter (e.g. December) is
// treated as away for the weeks of the next quarter's first month (Dec 28 to Jan 25 for
// Q1 2027), so nobody has duty two months running; they're only asked about the rest.
// The box opens LA_AWAY_OPEN_DAYS_ before the quarter and is due LA_AWAY_DUE_DAYS_ before,
// unless DutyAwayOpen / DutyAwayDue give that quarter its own dates (set on the admin Away weeks
// card). Members only see the box while it's open (Tom 2026-11-22); after that only admins change it.
const LA_AWAY_OPEN_DAYS_ = 42, LA_AWAY_DUE_DAYS_ = 21, LA_AWAY_REMIND_HOUR_ = 9;
const LA_MONTHS_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function laQuarterLabel_(qt) { return 'Q' + qt.id.slice(-1) + ' ' + qt.id.slice(0, 4); }
function laQuarterWeeks_(qt) { const out = []; for (let m = qt.start; m <= qt.end; m = laAddDays_(m, 7)) out.push(m); return out; }
// The quarter the box is about: the first one that hasn't started yet.
function laAwayQuarter_(st, today) {
  let qt = laQuarterOf_(today);
  if (qt.start <= today) qt = laQuarterOf_(laAddDays_(qt.end, 3));
  const due = laJson_(st.DutyAwayDue, {})[qt.id] || laAddDays_(qt.start, -LA_AWAY_DUE_DAYS_);
  let opens = laJson_(st.DutyAwayOpen, {})[qt.id] || laAddDays_(qt.start, -LA_AWAY_OPEN_DAYS_);
  if (opens > due) opens = laAddDays_(due, -7);
  return { id: qt.id, label: laQuarterLabel_(qt), start: qt.start, end: qt.end, opens: opens, due: due,
    state: today < opens ? 'before' : today <= due ? 'open' : 'closed', weeks: laQuarterWeeks_(qt) };
}
// { PlayerID: [Mondays] } of qt blocked because that person had duty in the month before it.
function laAwayBlocked_(duty, qt) {
  const y = Number(qt.id.slice(0, 4)), q = Number(qt.id.slice(-1));
  const firstMonth = 3 * q - 2;
  const prev = firstMonth === 1 ? (y - 1) + '-12' : y + '-' + String(firstMonth - 1).padStart(2, '0');
  const secondStart = y + '-' + String(firstMonth + 1).padStart(2, '0') + '-01';
  const weeks = laQuarterWeeks_(qt).filter((m) => m < secondStart);
  const out = {};
  duty.forEach((d) => { if (String(d.DateKey).slice(0, 7) === prev) out[String(d.PlayerID)] = weeks; });
  return { weeks: weeks, prevMonth: LA_MONTHS_[Number(prev.slice(5)) - 1], firstMonth: LA_MONTHS_[firstMonth - 1], by: out };
}
function laAwayEntry_(rows, qid, pid) { return rows.find((r) => r.Quarter === qid && String(r.PlayerID) === String(pid)); }
function laAwayEligible_(st, roster) {
  const lists = laJson_(st.DutyLists, {});
  return roster.filter((r) => String(r.Name || '').trim() && memberIsActive_(r) && ['nonmember', 'medical'].indexOf((lists[String(r.PlayerID)] || {}).s) === -1);
}
// What the board carries: the quarter, the member's own entry, and for admins everyone's
// (every quarter not yet over) plus the due dates.
function laAwayBoard_(ss, viewer, st, duty, today) {
  const qt = laAwayQuarter_(st, today);
  const rows = laRead_(ss, LA.DUTY_AWAY);
  const bl = laAwayBlocked_(laRead_(ss, LA.DUTY), qt); // all duty: last month's may already be past
  const out = { quarter: qt, blockedMonth: { prev: bl.prevMonth, first: bl.firstMonth } };
  if (viewer.member) {
    const pid = String(viewer.member.PlayerID), e = laAwayEntry_(rows, qt.id, pid) || {};
    const lists = laJson_(st.DutyLists, {}), s = (lists[pid] || {}).s || '';
    out.mine = { weeks: e.Weeks ? e.Weeks.split(',') : [], note: e.Note || '', done: String(e.Done).toUpperCase() === 'TRUE',
      updatedAt: e.UpdatedAt || '', blocked: bl.by[pid] || [], noDuty: s === 'nonmember' || s === 'medical',
      // every week I can't do from now on (this quarter's too), for the swap warnings
      allWeeks: rows.filter((r) => String(r.PlayerID) === pid && r.Quarter >= laQuarterOf_(today).id).reduce((acc, r) => acc.concat(r.Weeks ? r.Weeks.split(',') : []), []).concat(bl.by[pid] || []) };
  }
  if (viewer.isAdmin) {
    const cur = laQuarterOf_(today).id;
    out.all = rows.filter((r) => r.Quarter >= cur).map((r) => ({ Quarter: r.Quarter, PlayerID: String(r.PlayerID), Weeks: r.Weeks, Note: r.Note,
      Done: String(r.Done).toUpperCase() === 'TRUE' ? 'TRUE' : '', UpdatedAt: r.UpdatedAt, UpdatedBy: r.UpdatedBy }));
    out.due = laJson_(st.DutyAwayDue, {});
    out.open = laJson_(st.DutyAwayOpen, {});
  }
  return out;
}
// Saves one person's away weeks for one quarter. A member saves their own while the box is
// open; an admin (asAdmin, with playerId) saves anyone's at any time before the quarter ends.
function laDutyAwaySave_(ss, p) {
  if (p.batch) return laDutyAwayBatch_(ss, p);
  const st = laSettings_(ss), today = laTodayKey_();
  const asAdmin = (p.asAdmin === true || p.asAdmin === 'true') && p.playerId;
  let who, pid, by;
  const roster = readRosterFull_(ss);
  if (asAdmin) {
    who = laRequireAdmin_(ss, p);
    pid = String(p.playerId);
    by = who;
  } else {
    const m = requireMember_(ss, p.token);
    pid = String(m.PlayerID); who = m.Name; by = 'member';
  }
  const pr = roster.find((r) => String(r.PlayerID) === pid);
  if (!pr) throw new Error('That person is not on the roster.');
  const q = String(p.quarter || '');
  const box = laAwayQuarter_(st, today);
  let qt;
  if (!asAdmin) {
    if (q !== box.id) throw new Error('The away weeks box is for ' + box.label + '. Refresh the page and try again.');
    if (box.state === 'before') throw new Error('The away weeks box for ' + box.label + ' opens on ' + laDateLabel_(box.opens) + '.');
    if (box.state === 'closed') throw new Error('The away weeks for ' + box.label + ' were due ' + laDateLabel_(box.due) + '. Ask a Tee Time Duty admin to change them, or swap after duty is drawn.');
    qt = box;
  } else {
    const found = /^\d{4}-Q[1-4]$/.test(q) ? laQuarterOf_(laQuarterStart_(Number(q.slice(0, 4)), Number(q.slice(-1)))) : null;
    if (!found || found.end < today) throw new Error('Choose a quarter that has not ended.');
    qt = { id: found.id, start: found.start, end: found.end, weeks: laQuarterWeeks_(found), label: laQuarterLabel_(found) };
  }
  const blocked = laAwayBlocked_(laRead_(ss, LA.DUTY), qt).by[pid] || [];
  const weeks = String(p.weeks || '').split(',').map((k) => k.trim()).filter((k, i, all) => qt.weeks.indexOf(k) !== -1 && all.indexOf(k) === i && blocked.indexOf(k) === -1).sort();
  const note = String(p.note || '').trim().slice(0, 120);
  const done = asAdmin ? !(p.done === false || p.done === 'false') : true;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = laRead_(ss, LA.DUTY_AWAY);
    let e = laAwayEntry_(rows, qt.id, pid);
    if (!e) { e = { Quarter: qt.id, PlayerID: pid }; rows.push(e); }
    Object.assign(e, { Name: pr.Name, Weeks: weeks.join(','), Note: note, Done: done ? 'TRUE' : '', UpdatedAt: new Date().toISOString(), UpdatedBy: by });
    laWriteAll_(ss, LA.DUTY_AWAY, rows.sort((a, b) => (a.Quarter < b.Quarter ? -1 : a.Quarter > b.Quarter ? 1 : String(a.Name).localeCompare(String(b.Name)))));
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, who, asAdmin ? 'Saved away weeks for ' + displayName_(pr.Name) : 'Saved my away weeks',
    qt.label + ': ' + (weeks.length ? weeks.map((k) => 'week of ' + laDateLabel_(k)).join(', ') : 'available every week') + (note ? ' (' + note + ')' : ''));
  if (!asAdmin) return laGetBoard_(ss, laViewer_(ss, p));
  return laGetBoard_(ss, { isAdmin: true, adminName: who, member: p.token ? memberFromToken_(ss, p.token) : null });
}
// Admins: many people at once, from the paste box ([{ playerId, weeks, note }]). Each
// person's weeks are added to what they already have; everyone listed counts as answered.
function laDutyAwayBatch_(ss, p) {
  const admin = laRequireAdmin_(ss, p), today = laTodayKey_();
  const q = String(p.quarter || '');
  const found = /^\d{4}-Q[1-4]$/.test(q) ? laQuarterOf_(laQuarterStart_(Number(q.slice(0, 4)), Number(q.slice(-1)))) : null;
  if (!found || found.end < today) throw new Error('Choose a quarter that has not ended.');
  const weeksOk = laQuarterWeeks_(found);
  const roster = readRosterFull_(ss), byId = {}; roster.forEach((r) => { byId[String(r.PlayerID)] = r; });
  const items = laJson_(p.batch, []);
  if (!Array.isArray(items) || !items.length) throw new Error('Nothing to save.');
  const blocked = laAwayBlocked_(laRead_(ss, LA.DUTY), found).by;
  let n = 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const rows = laRead_(ss, LA.DUTY_AWAY);
    items.forEach((it) => {
      const pid = String(it.playerId || ''), pr = byId[pid];
      if (!pr) return;
      let e = laAwayEntry_(rows, found.id, pid);
      if (!e) { e = { Quarter: found.id, PlayerID: pid, Weeks: '', Note: '' }; rows.push(e); }
      const have = e.Weeks ? e.Weeks.split(',') : [];
      const add = String(it.weeks || '').split(',').map((k) => k.trim()).filter((k) => weeksOk.indexOf(k) !== -1 && (blocked[pid] || []).indexOf(k) === -1);
      const note = String(it.note || '').trim().slice(0, 120);
      Object.assign(e, { Name: pr.Name, Weeks: have.concat(add).filter((k, i, all) => all.indexOf(k) === i).sort().join(','), Note: note || e.Note || '',
        Done: 'TRUE', UpdatedAt: new Date().toISOString(), UpdatedBy: admin });
      n++;
    });
    laWriteAll_(ss, LA.DUTY_AWAY, rows.sort((a, b) => (a.Quarter < b.Quarter ? -1 : a.Quarter > b.Quarter ? 1 : String(a.Name).localeCompare(String(b.Name)))));
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Filled in away weeks from a list', laQuarterLabel_(found) + ': ' + n + ' member' + (n === 1 ? '' : 's'));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: p.token ? memberFromToken_(ss, p.token) : null });
}
// "Please mark your away weeks" (switch DutyAwayEmailOn, Off by default): on the day the box
// opens, then every 7 days, and 2 days before it's due, at 9 AM, to every member who does
// duty, has an email, and hasn't saved theirs yet.
function laDutyAwayDueToday_(qt, today) {
  if (qt.state !== 'open' || today < qt.opens) return false;
  const since = Math.round((new Date(today + 'T12:00:00Z') - new Date(qt.opens + 'T12:00:00Z')) / 864e5);
  return since % 7 === 0 || today === laAddDays_(qt.due, -2);
}
function laDutyAwayHourly_(ss) {
  const st = laSettings_(ss);
  if (!laOn_(st, 'DutyAwayEmailOn')) return;
  if (Number(Utilities.formatDate(new Date(), laTz_(), 'H')) < LA_AWAY_REMIND_HOUR_) return;
  const today = laTodayKey_(), qt = laAwayQuarter_(st, today);
  if (!laDutyAwayDueToday_(qt, today)) return;
  if (laRead_(ss, LA.REMINDER_LOG).some((r) => r.Type === 'dutyaway' && r.DateKey === today)) return;
  const rows = laRead_(ss, LA.DUTY_AWAY), bl = laAwayBlocked_(laRead_(ss, LA.DUTY), qt);
  const url = st.SiteUrl;
  let n = 0;
  laAwayEligible_(st, readRosterFull_(ss)).forEach((r) => {
    const e = laAwayEntry_(rows, qt.id, r.PlayerID), email = String(r.Email || '').trim();
    if ((e && String(e.Done).toUpperCase() === 'TRUE') || !email) return;
    if (MailApp.getRemainingDailyQuota() < 10) return;
    const blk = bl.by[String(r.PlayerID)];
    laMail_(ss, email, 'Tee Time Duty: which weeks can\'t you do in ' + qt.label + '?',
      'Hi ' + displayName_(r.Name).split(' ')[0] + ',\n\n' +
      'Tee time duty for ' + qt.label + ' (' + laDateLabel_(qt.start) + ' to ' + laDateLabel_(qt.end) + ') will be drawn soon. ' +
      'Please sign in to SUN, open the Tee Time Duty tab, tick any weeks you can\'t do, and click Save. If you can do any week, just click Save so we know.\n\n' +
      (blk ? 'You had duty in ' + bl.prevMonth + ', so you won\'t be given a ' + bl.firstMonth + ' week; only the later weeks need an answer.\n\n' : '') +
      'Please answer by ' + laDateLabel_(qt.due) + '.' + (url ? '\n\nOpen SUN: ' + url : '') + '\n\nHeritage Legends Golf');
    n++;
  });
  laAppend_(ss, LA.REMINDER_LOG, { Type: 'dutyaway', DateKey: today, SentAt: new Date().toISOString(), Recipients: String(n) });
  if (n) logActivity_(ss, 'Automatic', 'Sent away weeks reminders', qt.label + ' — ' + n + ' member' + (n === 1 ? '' : 's'));
}

// ---------------- tee time duty swaps ----------------
// A member with duty on FromKey asks a member with duty on ToKey to trade.
// When the other member accepts, the two people trade places and each keeps
// the role (in person / phone in) of the slot they move into.

// The page sends its own address so TEST emails link to TEST; anything that
// isn't the Legends GitHub Pages site falls back to the SiteUrl setting.
function laSiteUrl_(ss, p) {
  const u = String((p && p.siteUrl) || '');
  return /^https:\/\/heritagelegendsgolf\.github\.io\/[A-Za-z0-9_\/.-]*$/.test(u) ? u : laSettings_(ss).SiteUrl;
}
function laSwapNotify_(ss, playerId, subject, body, url) {
  if (!laOn_(laSettings_(ss), 'SwapEmailOn')) return; // the request still shows in the app
  const pr = readRosterFull_(ss).find((r) => String(r.PlayerID) === String(playerId));
  const email = pr && String(pr.Email || '').trim();
  if (email) laMail_(ss, email, subject, body + (url ? '\n\nOpen the Legends app: ' + url : '') + '\n\nHeritage Legends Golf');
}

function laDutyRow_(duty, key, playerId) {
  return duty.find((d) => d.DateKey === key && String(d.PlayerID) === String(playerId));
}
// Whole-week swaps (Tom 2026-11-21): someone's duty rows in the Monday–Sunday week holding key.
function laMondayOf_(key) { return laAddDays_(key, -((laDow_(key) + 6) % 7)); }
function laWeekRows_(duty, key, playerId) {
  const m = laMondayOf_(key), e = laAddDays_(m, 6);
  return duty.filter((d) => d.DateKey >= m && d.DateKey <= e && String(d.PlayerID) === String(playerId));
}
function laSwapWhat_(x) { return x.Week === 'TRUE' ? 'week of ' + laDateLabel_(laMondayOf_(x.FromKey)) + ' ⇄ week of ' + laDateLabel_(laMondayOf_(x.ToKey)) : laDateLabel_(x.FromKey) + ' ⇄ ' + laDateLabel_(x.ToKey); }

function laSwapRequest_(ss, viewer, p) {
  if (!viewer.member) throw new Error('Sign in as a member to request a swap.');
  const me = viewer.member;
  const fromKey = String(p.fromKey || ''), toKey = String(p.toKey || ''), targetId = String(p.targetId || '');
  const today = laTodayKey_();
  if (fromKey < today || toKey < today) throw new Error('Both dates must be today or later.');
  if (fromKey === toKey) throw new Error('Pick a different date to swap with.');
  if (targetId === String(me.PlayerID)) throw new Error('Pick someone else to swap with.');
  const week = p.week === true || p.week === 'true';
  if (week && laMondayOf_(fromKey) === laMondayOf_(toKey)) throw new Error('Pick a different week to swap with.');
  let swapRow, target;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const duty = laRead_(ss, LA.DUTY);
    if (!laDutyRow_(duty, fromKey, me.PlayerID)) throw new Error('You are not on tee time duty on ' + laDateLabel_(fromKey) + '.');
    target = laDutyRow_(duty, toKey, targetId);
    if (!target) throw new Error('That person is not on duty on ' + laDateLabel_(toKey) + '.');
    if (week) {
      if (laWeekRows_(duty, toKey, me.PlayerID).length) throw new Error('You already have duty in the week of ' + laDateLabel_(laMondayOf_(toKey)) + '.');
      if (laWeekRows_(duty, fromKey, targetId).length) throw new Error(displayName_(target.Name) + ' already has duty in the week of ' + laDateLabel_(laMondayOf_(fromKey)) + '.');
      if (laWeekRows_(duty, fromKey, me.PlayerID).some((d) => d.DateKey < today) || laWeekRows_(duty, toKey, targetId).some((d) => d.DateKey < today)) throw new Error('One of those weeks has started; swap single days instead.');
    } else {
      if (laDutyRow_(duty, toKey, me.PlayerID)) throw new Error('You are already on duty on ' + laDateLabel_(toKey) + '.');
      if (laDutyRow_(duty, fromKey, targetId)) throw new Error(displayName_(target.Name) + ' is already on duty on ' + laDateLabel_(fromKey) + '.');
    }
    const swaps = laRead_(ss, LA.SWAPS);
    if (swaps.some((x) => x.Status === 'pending' && x.FromKey === fromKey && String(x.RequesterID) === String(me.PlayerID) &&
      x.ToKey === toKey && String(x.TargetID) === targetId && (x.Week === 'TRUE') === week)) throw new Error('You already asked for that swap.');
    swapRow = { SwapID: Utilities.getUuid().slice(0, 12), FromKey: fromKey, RequesterID: String(me.PlayerID), RequesterName: me.Name,
      ToKey: toKey, TargetID: targetId, TargetName: target.Name, Status: 'pending', CreatedAt: new Date().toISOString(), ResolvedAt: '', Week: week ? 'TRUE' : '' };
    laAppend_(ss, LA.SWAPS, swapRow);
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, me.Name, 'Asked for a duty swap', week ? 'week of ' + laDateLabel_(laMondayOf_(fromKey)) + ' ⇄ ' + displayName_(target.Name) + ', week of ' + laDateLabel_(laMondayOf_(toKey)) : laDateLabel_(fromKey) + ' ⇄ ' + displayName_(target.Name) + ', ' + laDateLabel_(toKey));
  if (week) laSwapNotify_(ss, targetId, 'Tee time duty week swap request from ' + displayName_(me.Name),
    displayName_(me.Name) + ' has tee time duty in the week of ' + laDateLabel_(laMondayOf_(fromKey)) + ' and would like to trade whole weeks with your week of ' + laDateLabel_(laMondayOf_(toKey)) + '.\n\n' +
    'Sign in to the Legends app and open the Tee Time Duty tab to accept or decline.', laSiteUrl_(ss, p));
  else laSwapNotify_(ss, targetId, 'Tee time duty swap request from ' + displayName_(me.Name),
    displayName_(me.Name) + ' has tee time duty on ' + laDateLabel_(fromKey) + ' and would like to swap with your duty on ' + laDateLabel_(toKey) + '.\n\n' +
    'If you accept, you would take ' + laDateLabel_(fromKey) + ' and ' + displayName_(me.Name).split(' ')[0] + ' would take ' + laDateLabel_(toKey) + '.\n\n' +
    'Sign in to the Legends app and open the Tee Time Duty tab to accept or decline.', laSiteUrl_(ss, p));
  return laGetBoard_(ss, viewer);
}

function laSwapRespond_(ss, viewer, p) {
  if (!viewer.member) throw new Error('Sign in as a member to answer a swap.');
  const me = viewer.member;
  const id = String(p.swapId || ''), accept = p.accept === true || p.accept === 'true';
  let row, cancelled = [];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const swaps = laRead_(ss, LA.SWAPS);
    row = swaps.find((x) => x.SwapID === id);
    if (!row || row.Status !== 'pending') throw new Error('That swap request is no longer open.');
    if (String(row.TargetID) !== String(me.PlayerID)) throw new Error('That swap request was sent to someone else.');
    const now = new Date().toISOString();
    if (!accept) {
      row.Status = 'declined'; row.ResolvedAt = now;
    } else {
      if (row.FromKey < laTodayKey_() || row.ToKey < laTodayKey_()) throw new Error('One of those dates has already passed.');
      const duty = laRead_(ss, LA.DUTY);
      const wk = row.Week === 'TRUE';
      const aa = wk ? laWeekRows_(duty, row.FromKey, row.RequesterID) : [laDutyRow_(duty, row.FromKey, row.RequesterID)].filter(Boolean);
      const bb = wk ? laWeekRows_(duty, row.ToKey, row.TargetID) : [laDutyRow_(duty, row.ToKey, row.TargetID)].filter(Boolean);
      if (!aa.length || !bb.length) { row.Status = 'cancelled'; row.ResolvedAt = now; laWriteAll_(ss, LA.SWAPS, swaps);
        throw new Error('The duty schedule changed since this request was made, so it has been cancelled.'); }
      if (wk ? (laWeekRows_(duty, row.FromKey, row.TargetID).length || laWeekRows_(duty, row.ToKey, row.RequesterID).length)
        : (laDutyRow_(duty, row.FromKey, row.TargetID) || laDutyRow_(duty, row.ToKey, row.RequesterID))) throw new Error(wk ? 'One of you already has duty in the other week.' : 'One of you is already on duty on the other date.');
      const aName = aa[0].Name, bName = bb[0].Name;
      aa.forEach((a) => { a.PlayerID = String(row.TargetID); a.Name = bName; });
      bb.forEach((b) => { b.PlayerID = String(row.RequesterID); b.Name = aName; });
      laWriteAll_(ss, LA.DUTY, duty);
      row.Status = 'accepted'; row.ResolvedAt = now;
      // Any other open request touching either of these two duty slots is now stale.
      swaps.forEach((x) => {
        if (x === row || x.Status !== 'pending') return;
        const same = (k1, k2) => (wk || x.Week === 'TRUE') ? laMondayOf_(k1) === laMondayOf_(k2) : k1 === k2;
        const touches = (k, pid) => (same(x.FromKey, k) && String(x.RequesterID) === String(pid)) || (same(x.ToKey, k) && String(x.TargetID) === String(pid));
        if (touches(row.FromKey, row.RequesterID) || touches(row.ToKey, row.TargetID)) { x.Status = 'cancelled'; x.ResolvedAt = now; cancelled.push(x); }
      });
    }
    laWriteAll_(ss, LA.SWAPS, swaps);
  } finally {
    lock.releaseLock();
  }
  const detail = laSwapWhat_(row);
  logActivity_(ss, me.Name, accept ? 'Accepted a duty swap' : 'Declined a duty swap', displayName_(row.RequesterName) + ': ' + detail);
  laSwapNotify_(ss, row.RequesterID, 'Tee time duty swap ' + (accept ? 'accepted' : 'declined'),
    displayName_(me.Name) + (accept
      ? (row.Week === 'TRUE' ? ' accepted your week swap. You now have tee time duty in the week of ' + laDateLabel_(laMondayOf_(row.ToKey)) + ' instead of the week of ' + laDateLabel_(laMondayOf_(row.FromKey)) + '.'
        : ' accepted your swap. You now have tee time duty on ' + laDateLabel_(row.ToKey) + ' instead of ' + laDateLabel_(row.FromKey) + '.')
      : ' declined your request to swap ' + laSwapWhat_(row).replace(' ⇄ ', ' for ') + '.'), laSiteUrl_(ss, p));
  cancelled.forEach((x) => laSwapNotify_(ss, x.RequesterID, 'Tee time duty swap request cancelled',
    'Your request to swap ' + laSwapWhat_(x).replace(' ⇄ ', ' for ') + ' was cancelled because the duty schedule for one of those dates changed.', laSiteUrl_(ss, p)));
  return laGetBoard_(ss, viewer);
}

function laSwapCancel_(ss, viewer, p) {
  const id = String(p.swapId || '');
  let row;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const swaps = laRead_(ss, LA.SWAPS);
    row = swaps.find((x) => x.SwapID === id);
    if (!row || row.Status !== 'pending') return laGetBoard_(ss, viewer);
    if (!viewer.acting && (!viewer.member || String(row.RequesterID) !== String(viewer.member.PlayerID))) throw new Error('Only the person who asked can cancel this request.');
    row.Status = 'cancelled'; row.ResolvedAt = new Date().toISOString();
    laWriteAll_(ss, LA.SWAPS, swaps);
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, viewer.acting ? viewer.adminName : row.RequesterName, 'Cancelled a duty swap request', laSwapWhat_(row));
  return laGetBoard_(ss, viewer);
}


// ---------------- SignUp Genius import (admin, one-time cutover) ----------------
// (Tom 2026-11-04) Anyone who drops out of a day's Fun or Nassau group in the app is
// remembered (script property SUG_DROPS = { DateKey: [PlayerID, ...] }, past dates pruned),
// so an import that only adds people doesn't sign him up again from SignUp Genius, which
// closes two days ahead and can't show late changes.
function laSugDrops_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SUG_DROPS') || '{}') || {}; } catch (e) { return {}; }
}
function laSugDropsSave_(m) {
  const today = laTodayKey_(), out = {};
  Object.keys(m).forEach((k) => { if (k >= today && (m[k] || []).length) out[k] = m[k]; });
  PropertiesService.getScriptProperties().setProperty('SUG_DROPS', JSON.stringify(out));
}
// Players who dropped out of a round, by group, until the next email to that group's players
// has gone to them too (Tom 2026-11-06: "so they get confirmation"). DR_LIST_<date> =
// { fun: [PlayerID], nassau: [PlayerID] }.
function laDrops_(key) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('DR_LIST_' + key) || '{}') || {}; } catch (e) { return {}; }
}
function laDropAdd_(key, group, pid) {
  try {
    const m = laDrops_(key), l = m[group] || (m[group] = []);
    if (l.indexOf(String(pid)) === -1) l.push(String(pid));
    PropertiesService.getScriptProperties().setProperty('DR_LIST_' + key, JSON.stringify(m));
  } catch (e) { Logger.log('Drop not remembered for confirmation: ' + e.message); }
}
// After an email reached a group's players (c from laComposeEmails_), its drop-outs have had it.
function laDropsClear_(key, groups, c) {
  if (c && !(c.groups || []).some((g) => g.id === 'players')) return;
  const m = laDrops_(key);
  if (!groups.some((g) => (m[g] || []).length)) return;
  groups.forEach((g) => { delete m[g]; });
  PropertiesService.getScriptProperties().setProperty('DR_LIST_' + key, JSON.stringify(m));
}
// Which drop-out groups each email's "Players" also reaches.
const LA_DROP_GROUPS_ = { proshop: ['fun', 'nassau'], funpairings: ['fun'], nassauchanges: ['nassau'], playing: ['fun'], nassautomorrow: ['nassau'] };
function laSugDropAdd_(key, pid) {
  try {
    const m = laSugDrops_(), l = m[key] || (m[key] = []);
    if (l.indexOf(String(pid)) === -1) l.push(String(pid));
    laSugDropsSave_(m);
  } catch (e) { Logger.log('Drop not remembered for the SignUp Genius import: ' + e.message); }
}
// p.days = [{ DateKey, signups: [{ Group, PlayerID, Tee, Holes, Riding, Note }] (in
// sign-up order, standby last), dayConfig: { LegendsFirst, FunTeeTimes, NassauTeeTimes,
// FunTimes, NassauTimes } | null, closure: 'reason' | '' }]. p.replace = 'true' clears
// the Fun/Nassau sign-ups already in the app for those dates first; otherwise anyone
// already signed up that day is left alone and skipped, and so is anyone who dropped out
// of that day in the app (laSugDrops_). With replace, the app matches SignUp Genius
// exactly and those dates' remembered drops are cleared.
function laImportSignups_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const st = laSettings_(ss);
  const days = JSON.parse(p.days || '[]');
  const replace = p.replace === true || p.replace === 'true';
  const tees = String(st.TeeOptions || '').split(',').map((t) => t.trim()).filter(Boolean);
  const byId = {}; readRosterFull_(ss).forEach((r) => { byId[String(r.PlayerID)] = r; });
  days.forEach((d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.DateKey || ''))) throw new Error('A date in the import could not be read.');
    (d.signups || []).forEach((x) => {
      if (x.Group !== 'fun' && x.Group !== 'nassau') throw new Error('Unknown group in the import.');
      if (!byId[String(x.PlayerID)]) throw new Error('The import names a player who is not on the roster.');
    });
  });
  let added = 0, skipped = 0, dropped = 0, closuresAdded = 0, daysSet = 0;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const keys = {}; days.forEach((d) => { keys[d.DateKey] = true; });
    let all = laRead_(ss, LA.SIGNUPS);
    if (replace) all = all.filter((s) => !(keys[s.DateKey] && (s.Group === 'fun' || s.Group === 'nassau')));
    const drops = laSugDrops_();
    if (replace) { Object.keys(keys).forEach((k) => { delete drops[k]; }); laSugDropsSave_(drops); }
    const t0 = Date.now();
    days.forEach((d) => {
      const taken = {};
      all.forEach((s) => { if (s.DateKey === d.DateKey && (s.Group === 'fun' || s.Group === 'nassau')) taken[String(s.PlayerID)] = true; });
      const gone = replace ? [] : (drops[d.DateKey] || []);
      (d.signups || []).forEach((x) => {
        const pid = String(x.PlayerID);
        if (taken[pid]) { skipped++; return; }
        if (gone.indexOf(pid) !== -1) { dropped++; return; }
        taken[pid] = true;
        const isFun = x.Group === 'fun';
        const holes = String(x.Holes || '18');
        all.push({
          SignupID: 'sug' + Utilities.getUuid().replace(/-/g, '').slice(0, 14), DateKey: d.DateKey, Group: x.Group,
          PlayerID: pid, Name: byId[pid].Name,
          Tee: (isFun || x.Group === 'nassau') && tees.indexOf(String(x.Tee || '')) !== -1 ? String(x.Tee) : '',
          Holes: isFun ? (['18', 'F9', 'B9'].indexOf(holes) !== -1 ? holes : '18') : '',
          Riding: isFun && (x.Riding === true || x.Riding === 'TRUE' || x.Riding === 'true') ? 'TRUE' : '',
          Note: String(x.Note || '').trim().slice(0, 120),
          SignedUpAt: t0 + added, AddedBy: 'SignUp Genius import',
        });
        added++;
      });
    });
    laWriteAll_(ss, LA.SIGNUPS, all);

    const cfgs = laRead_(ss, LA.DAY_CONFIG);
    days.filter((d) => d.dayConfig).forEach((d) => {
      let row = cfgs.find((c) => c.DateKey === d.DateKey);
      if (!row) { row = { DateKey: d.DateKey }; cfgs.push(row); }
      ['LegendsFirst', 'FunTeeTimes', 'NassauTeeTimes', 'FunTimes', 'NassauTimes'].forEach((k) => { row[k] = String(d.dayConfig[k] == null ? '' : d.dayConfig[k]).trim(); });
      if (row.LegendsFirst && laParseTime_(row.LegendsFirst) === null) row.LegendsFirst = '';
      row.FunSlots = ''; row.NassauSlots = '';
      daysSet++;
    });
    if (daysSet) laWriteAll_(ss, LA.DAY_CONFIG, cfgs.sort((a, b) => (a.DateKey < b.DateKey ? -1 : 1)));

    const closures = laRead_(ss, LA.CLOSURES);
    days.filter((d) => d.closure).forEach((d) => {
      if (closures.some((c) => c.DateKey === d.DateKey)) return;
      closures.push({ DateKey: d.DateKey, Reason: String(d.closure).slice(0, 80) });
      closuresAdded++;
    });
    if (closuresAdded) { laWriteAll_(ss, LA.CLOSURES, closures.sort((a, b) => (a.DateKey < b.DateKey ? -1 : 1))); laMoveDutyForClosures_(ss, admin); }
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Imported from SignUp Genius', added + ' sign-ups' + (skipped ? ', ' + skipped + ' already in' : '') + (dropped ? ', ' + dropped + ' dropped out in the app' : '') +
    (daysSet ? ', ' + daysSet + ' first tee times' : '') + (closuresAdded ? ', ' + closuresAdded + ' closures' : '') + (replace ? ' (replaced)' : ''));
  const board = laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
  board.importSummary = { added: added, skipped: skipped, dropped: dropped, closuresAdded: closuresAdded, daysSet: daysSet };
  return board;
}


// ---------------- pro shop players list ----------------
// When a round's sign-ups close (11:59 PM two days before), the list of who is
// playing goes to the pro shop — the same email someone used to send by hand
// from the SignUp Genius list — copied to the extra recipients and the Legends
// admin address. Later changes are still phoned in to the pro shop.

function laEmailList_(s) {
  return String(s || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
}
function laEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function laLongDate_(key) {
  const d = new Date(key + 'T12:00:00Z');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const mons = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return days[d.getUTCDay()] + ', ' + mons[d.getUTCMonth()] + ' ' + d.getUTCDate();
}
function laDetail_(s) {
  if (s.Group === 'nassau') return s.Tee || '';
  if (s.Group !== 'fun') return '';
  const holes = s.Holes === 'F9' ? 'Front 9' : s.Holes === 'B9' ? 'Back 9' : '18';
  return [s.Tee, holes, s.Riding === 'TRUE' ? 'Riding' : 'Walking'].filter(Boolean).join(', ');
}
// Builds the email for one date: { dateKey, subject, html, text, players, closed }.
// `st` may carry unsaved wording from the admin page (preview).
function laProShopEmail_(ss, key, st) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a date.');
  st = st || laSettings_(ss);
  const closure = laRead_(ss, LA.CLOSURES).find((c) => c.DateKey === key);
  const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key) || {};
  const info = laDayInfo_(key, st, cfg, closure ? closure.Reason : '', '', laRead_(ss, LA.CLUB_TEE_TIMES), Date.now());
  const all = laRead_(ss, LA.SIGNUPS);
  const groups = [
    { label: 'Fun group', times: info.funTimes, slots: info.funSlots, list: laGroupList_(all, key, 'fun') },
    { label: 'Nassau group', times: info.nassauTimes, slots: info.nassauSlots, list: laGroupList_(all, key, 'nassau') },
  ];
  const dateText = laLongDate_(key);
  // Before the groups are made (when sign-ups close), a preview shows draft groups made
  // on the spot (Tom 2026-10-27: the preview should show the groups); a real send makes
  // and saves them first (laProShopSend_).
  let funRec = laPairRead_(ss, key, 'fun'), draft = false;
  if (!funRec && st.__funDraft) {
    const pl = laPairPlayers_(ss, key, 'fun').playing;
    if (pl.length >= 2) {
      const byIdD = {}; pl.forEach((x) => { byIdD[x.PlayerID] = x; });
      funRec = { teams: laFunOrder_(laFunMake_(pl, laFunHistory_(ss, key), 10).teams, byIdD) };
      draft = true;
    }
  }
  let players = 0;
  const html = [], text = [], sig = [], names = { fun: [], nassau: [] };
  html.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">');
  html.push('<p>Hello — here are the Heritage Legends players for <b>' + laEsc_(dateText) + '</b>.</p>');
  text.push('Heritage Legends players for ' + dateText, '');
  if (String(st.ProShopMessage || '').trim()) { html.push(laMsg_(st.ProShopMessage)); text.push(String(st.ProShopMessage).trim(), ''); }
  groups.forEach((g) => {
    // who's playing is decided by sign-up order; the pro shop gets them alphabetical by last name
    // (names are stored "Last, First"). Standby stays in order, since that's the order they move up.
    const playing = g.list.slice(0, g.slots).sort((a, b) => String(a.Name).localeCompare(String(b.Name), 'en', { sensitivity: 'base' })), standby = g.list.slice(g.slots);
    players += playing.length;
    const riders = playing.filter((s) => s.Riding === 'TRUE').length;
    html.push('<h3 style="margin:18px 0 4px;color:#1e5b3a;">' + laEsc_(g.label) + ' — ' + laEsc_(g.times) + ' (' + playing.length + ' player' + (playing.length === 1 ? '' : 's') + ')</h3>');
    text.push(g.label + ' — ' + g.times + ' (' + playing.length + ')');
    const isFun = g.label === 'Fun group';
    const line = (s) => {
      const det = laDetail_(s);
      (isFun ? names.fun : names.nassau).push(displayName_(s.Name));
      sig.push(g.label + ':' + s.PlayerID + ':' + det + ':' + (s.Note || ''));
      text.push('  ' + displayName_(s.Name) + (det ? ' — ' + det : '') + (s.Note ? ' (' + s.Note + ')' : ''));
      return '<li>' + laEsc_(displayName_(s.Name)) + (det ? ' <span style="color:#555;">— ' + laEsc_(det) + '</span>' : '') + (s.Note ? ' <i style="color:#555;">(' + laEsc_(s.Note) + ')</i>' : '') + '</li>';
    };
    if (!playing.length) { html.push('<p style="color:#777;margin:4px 0;">No one signed up.</p>'); text.push('  (no one)'); }
    else if (isFun && funRec && (funRec.teams || []).length) {
      // the Fun group in its groups, one per tee time
      const byId = {}; playing.forEach((s) => { byId[String(s.PlayerID)] = s; });
      const used = {};
      if (draft) html.push('<p style="margin:4px 0;color:#9a6b00;"><i>Draft groups (preview only) — the real groups are made when sign-ups close, and may differ.</i></p>');
      funRec.teams.map((t) => t.map(String).filter((pid) => byId[pid])).filter((t) => t.length).forEach((t, i) => {
        const time = (info.funTeeList || [])[i] || 'Group ' + (i + 1);
        html.push('<p style="margin:8px 0 2px;"><b>' + laEsc_(time) + '</b></p><ul style="margin:0;padding-left:24px;">');
        text.push('  ' + time + ':');
        sig.push('group ' + i);
        t.forEach((pid) => { used[pid] = true; html.push(line(byId[pid])); });
        html.push('</ul>');
      });
      const rest = playing.filter((s) => !used[String(s.PlayerID)]);
      if (rest.length) {
        html.push('<p style="margin:8px 0 2px;"><b>Not in a group yet</b></p><ul style="margin:0;padding-left:24px;">');
        text.push('  Not in a group yet:');
        rest.forEach((s) => html.push(line(s)));
        html.push('</ul>');
      }
      const riders = playing.filter((s) => s.Riding === 'TRUE').length;
      html.push('<p style="margin:6px 0 2px;color:#555;">Riding: ' + riders + ' · Walking: ' + (playing.length - riders) + '</p>');
      text.push('  Riding: ' + riders + ', Walking: ' + (playing.length - riders));
    } else {
      html.push('<ol style="margin:4px 0;padding-left:24px;">');
      playing.forEach((s) => html.push(line(s)));
      html.push('</ol>');
      if (isFun) { html.push('<p style="margin:2px 0;color:#555;">Riding: ' + riders + ' · Walking: ' + (playing.length - riders) + '</p>'); text.push('  Riding: ' + riders + ', Walking: ' + (playing.length - riders)); }
    }
    if (standby.length) {
      html.push('<p style="margin:6px 0 2px;color:#9a6b00;"><b>Standby</b> (not playing unless a spot opens):</p><ol style="margin:0;padding-left:24px;color:#777;">');
      standby.forEach((s) => html.push('<li>' + laEsc_(displayName_(s.Name)) + '</li>'));
      html.push('</ol>');
      text.push('  Standby: ' + standby.map((s) => displayName_(s.Name)).join(', '));
    }
    text.push('');
  });
  html.push('<p style="margin-top:16px;"><b>Total playing: ' + players + '</b></p>');
  text.push('Total playing: ' + players);
  if (String(st.ProShopFooterText || '').trim()) { html.push(laMsg_(st.ProShopFooterText, 'color:#555;')); text.push('', String(st.ProShopFooterText).trim()); }
  if (st.SiteUrl && String(st.ProShopAppLink).toUpperCase() === 'TRUE') { html.push('<p><a href="' + laEsc_(st.SiteUrl) + '">Open the Legends app</a></p>'); text.push('', 'Legends app: ' + st.SiteUrl); }
  html.push('<p>Thank you,<br>Heritage Legends Golf</p></div>');
  text.push('', 'Thank you,', 'Heritage Legends Golf');
  return {
    dateKey: key, closed: closure ? (closure.Reason || 'closed') : '', players: players,
    subject: 'Heritage Legends players — ' + dateText, html: html.join(''), text: text.join('\n'),
    closesAt: info.closesAt, sig: laHash_(sig.join('|')), names: names,
  };
}
// The "Fun Group Pairings" email for one date (Tom 2026-10-28): the Fun group in its
// groups by tee time, with each player's tees, holes, riding and note; anyone not in a
// group yet; riding/walking counts; the standby list. Before the groups are made, a
// preview shows draft groups (st.__funDraft) and a real send makes them first.
// { subject, html, text, closed, players, sig, names }
function laFunPairingsEmail_(ss, key, st) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a date.');
  st = st || laSettings_(ss);
  const closure = laRead_(ss, LA.CLOSURES).find((c) => c.DateKey === key);
  const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key) || {};
  const info = laDayInfo_(key, st, cfg, closure ? closure.Reason : '', '', laRead_(ss, LA.CLUB_TEE_TIMES), Date.now());
  const list = laGroupList_(laRead_(ss, LA.SIGNUPS), key, 'fun');
  const playing = list.slice(0, info.funSlots), standby = list.slice(info.funSlots);
  const dateText = laLongDate_(key);
  let rec = laPairRead_(ss, key, 'fun'), draft = false;
  if (!rec && st.__funDraft && playing.length >= 2) {
    const pl = laPairPlayers_(ss, key, 'fun').playing, by = {};
    pl.forEach((x) => { by[x.PlayerID] = x; });
    rec = { teams: laFunOrder_(laFunMake_(pl, laFunHistory_(ss, key), 10).teams, by) };
    draft = true;
  }
  const byId = {}; playing.forEach((x) => { byId[String(x.PlayerID)] = x; });
  const html = [], text = [], sig = [], names = [];
  const line = (x) => {
    const det = laDetail_(x);
    names.push(displayName_(x.Name));
    sig.push(x.PlayerID + ':' + det + ':' + (x.Note || ''));
    text.push('    ' + displayName_(x.Name) + (det ? ' — ' + det : '') + (x.Note ? ' (' + x.Note + ')' : ''));
    return '<li>' + laEsc_(displayName_(x.Name)) + (det ? ' <span style="color:#555;">— ' + laEsc_(det) + '</span>' : '') + (x.Note ? ' <i style="color:#555;">(' + laEsc_(x.Note) + ')</i>' : '') + '</li>';
  };
  html.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">');
  html.push('<p>Hello — the Heritage Legends <b>Fun group</b> pairings for <b>' + laEsc_(dateText) + '</b>' + (info.funTimes ? ' (' + laEsc_(info.funTimes) + ')' : '') + ' have changed since the list sent earlier. Here they are now.</p>');
  text.push('Changes in the Heritage Legends Fun group pairings for ' + dateText, '');
  const changeAt = html.length; // where the "what changed" note goes, once the list is known
  if (String(st.FunPairingsMessage || '').trim()) { html.push(laMsg_(st.FunPairingsMessage)); text.push(String(st.FunPairingsMessage).trim(), ''); }
  if (draft) html.push('<p style="color:#9a6b00;"><i>Draft groups (preview only) — the real groups are made when sign-ups close, and may differ.</i></p>');
  const used = {};
  if (!playing.length) { html.push('<p style="color:#777;">No one signed up.</p>'); text.push('(no one)'); }
  (rec && rec.teams || []).map((t) => t.map(String).filter((id) => byId[id])).filter((t) => t.length).forEach((t, i) => {
    const time = (info.funTeeList || [])[i] || 'Group ' + (i + 1);
    html.push('<p style="margin:10px 0 2px;"><b>' + laEsc_(time) + '</b></p><ul style="margin:0;padding-left:24px;">');
    text.push('  ' + time + ':');
    sig.push('group ' + i);
    t.forEach((id) => { used[id] = true; html.push(line(byId[id])); });
    html.push('</ul>');
  });
  const rest = playing.filter((x) => !used[String(x.PlayerID)]);
  if (rest.length) {
    html.push('<p style="margin:10px 0 2px;"><b>' + (rec ? 'Not in a group yet' : 'Playing (groups not made yet)') + '</b></p><ul style="margin:0;padding-left:24px;">');
    text.push('  ' + (rec ? 'Not in a group yet' : 'Playing') + ':');
    rest.forEach((x) => html.push(line(x)));
    html.push('</ul>');
  }
  const riders = playing.filter((x) => x.Riding === 'TRUE').length;
  if (playing.length) { html.push('<p style="margin:8px 0 2px;color:#555;">' + playing.length + ' playing · Riding: ' + riders + ' · Walking: ' + (playing.length - riders) + '</p>'); text.push('', playing.length + ' playing. Riding: ' + riders + ', Walking: ' + (playing.length - riders)); }
  if (standby.length) {
    html.push('<p style="margin:6px 0 2px;color:#9a6b00;"><b>Standby</b> (not playing unless a spot opens):</p><ol style="margin:0;padding-left:24px;color:#777;">');
    standby.forEach((x) => html.push('<li>' + laEsc_(displayName_(x.Name)) + '</li>'));
    html.push('</ol>');
    text.push('Standby: ' + standby.map((x) => displayName_(x.Name)).join(', '));
    sig.push('sb:' + standby.map((x) => x.PlayerID).join(','));
  }
  if (String(st.FunPairingsFooterText || '').trim()) { html.push(laMsg_(st.FunPairingsFooterText, 'color:#555;')); text.push('', String(st.FunPairingsFooterText).trim()); }
  if (st.SiteUrl && String(st.FunPairingsAppLink).toUpperCase() === 'TRUE') { html.push('<p><a href="' + laEsc_(st.SiteUrl) + '">Open the Legends app</a></p>'); text.push('', 'Legends app: ' + st.SiteUrl); }
  html.push('<p>Thank you,<br>Heritage Legends Golf</p></div>');
  text.push('', 'Thank you,', 'Heritage Legends Golf');
  const note = laChangeNote_(laFunEmailLast_(key), names, null, laSentFor_(ss, LA.PRO_SHOP_LOG, key));
  html.splice(changeAt, 0, note.html); text.splice(2, 0, note.text, '');
  return { dateKey: key, closed: closure ? (closure.Reason || 'closed') : '', players: playing.length,
    subject: 'Changes in Fun group pairings — ' + dateText, html: html.join(''), text: text.join('\n'), sig: laHash_(sig.join('|')), names: names };
}
// Whether the combined pro shop list has gone for a date (the change emails only go after it).
function laSentFor_(ss, sheet, key) { return laRead_(ss, sheet).some((r) => r.DateKey === key); }
// The "what changed" note at the top of a change email, against what the last email said
// (last = { names, pairSig }). pairSig/pairNow: the Nassau pairings, when they count.
function laChangeNote_(last, names, pairNow, listSent) {
  const red = (inner) => '<p style="color:#b3261e;">' + inner + '</p>';
  if (!listSent) return { html: red('<i>Preview — nothing to send yet: this only goes after the combined list has gone to the pro shop when sign-ups close.</i>'), text: '(Preview — this only goes after the combined list.)' };
  if (!last) return { html: '', text: '' };
  const diff = [];
  const out = (last.names || []).filter((n) => names.indexOf(n) === -1), inn = names.filter((n) => (last.names || []).indexOf(n) === -1);
  if (out.length) diff.push('No longer playing: ' + out.join(', '));
  if (inn.length) diff.push('Now playing: ' + inn.join(', '));
  if (pairNow !== null && pairNow !== undefined && last.pairSig !== undefined && last.pairSig !== pairNow) diff.push('The pairings changed.');
  if (!diff.length) diff.push('The groups or someone\'s details changed.');
  return { html: red('<b>What changed:</b><br>' + diff.map(laEsc_).join('<br>')), text: 'What changed:\n' + diff.join('\n') };
}
// What the last Fun Group Pairings email for a date said: { sig, names } (Script Properties).
function laFunEmailLast_(key) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('FP_LIST_' + key) || 'null'); } catch (e) { return null; }
}
function laFunEmailSentFor_(ss, key) { return laRead_(ss, LA.REMINDER_LOG).filter((r) => r.Type === 'funpairings' && r.DateKey === key).sort((a, b) => (a.SentAt < b.SentAt ? 1 : -1))[0] || null; }
function laFunEmailChanged_(ss, key) {
  const last = laFunEmailLast_(key);
  return !!last && last.sig !== laFunPairingsEmail_(ss, key).sig;
}
// What the combined list just told everyone, so the change emails start from it.
function laChangeBaselines_(ss, key) {
  const props = PropertiesService.getScriptProperties();
  try { const f = laFunPairingsEmail_(ss, key); props.setProperty('FP_LIST_' + key, JSON.stringify({ sig: f.sig, names: f.names })); } catch (err) { Logger.log('Fun baseline: ' + err.message); }
  try { laNassauBaseline_(ss, key); } catch (err) { Logger.log('Nassau baseline: ' + err.message); }
  laSetPlayersLast_(ss, 'fun', key); laSetPlayersLast_(ss, 'nassau', key);
}
// What the PLAYERS of a group last heard (Tom 2026-11-05), apart from what the pro shop heard:
// { sig, names } in FQ_LIST_<date> / NQ_LIST_<date>, from the change email's own fingerprint.
// Set when the combined list goes, and whenever a change email or the evening "players for
// tomorrow" email reaches the players.
function laPlayersLast_(g, key) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty((g === 'fun' ? 'FQ_LIST_' : 'NQ_LIST_') + key) || 'null'); } catch (e) { return null; }
}
function laPlayersNow_(ss, g, key, st) { return g === 'fun' ? laFunPairingsEmail_(ss, key, st) : laNassauChangesEmail_(ss, key, st); }
function laSetPlayersLast_(ss, g, key, st) {
  try { const m = laPlayersNow_(ss, g, key, st); PropertiesService.getScriptProperties().setProperty((g === 'fun' ? 'FQ_LIST_' : 'NQ_LIST_') + key, JSON.stringify({ sig: m.sig, names: m.names })); }
  catch (err) { Logger.log('Players baseline (' + g + '): ' + err.message); }
}
// Whether the group's evening "players for tomorrow" email is on.
function laEveningOn_(st, g) { return String(g === 'fun' ? st.RemindPlaying : st.NassauTomorrowOn).toUpperCase() === 'TRUE'; }
// Whether a change email should leave out the group's players: the day before play, while
// that group's evening email is still to come, it carries the changes instead; and players
// who already have the latest (from the evening email) aren't sent it again.
function laSkipPlayers_(ss, st, g, key) {
  const evening = g === 'fun' ? 'playing' : 'nassautomorrow';
  if (laEveningOn_(st, g) && key === laAddDays_(laTodayKey_(), 1) && !laRead_(ss, LA.REMINDER_LOG).some((r) => r.Type === evening && r.DateKey === key)) return true;
  const last = laPlayersLast_(g, key);
  return !!last && last.sig === laPlayersNow_(ss, g, key, st).sig;
}
// "What changed" for the evening email: who is out and who is in since the players last heard.
function laPlayersChangeNote_(ss, g, key, st) {
  if (!laSentFor_(ss, LA.PRO_SHOP_LOG, key)) return '';
  const last = laPlayersLast_(g, key);
  if (!last) return '';
  const names = laPlayersNow_(ss, g, key, st).names;
  const out = (last.names || []).filter((n) => names.indexOf(n) === -1), inn = names.filter((n) => (last.names || []).indexOf(n) === -1);
  const diff = [];
  if (out.length) diff.push('No longer playing: ' + out.join(', '));
  if (inn.length) diff.push('Now playing: ' + inn.join(', '));
  return diff.length ? '<p style="font-family:Arial,sans-serif;font-size:14px;color:#b3261e;"><b>What changed:</b><br>' + diff.map(laEsc_).join('<br>') + '</p>' : '';
}
// Sends "Changes in Fun Group Pairings" for one date (caller holds the lock).
function laFunEmailSend_(ss, key, who) {
  const st = laSettings_(ss);
  if (!laSentFor_(ss, LA.PRO_SHOP_LOG, key)) throw new Error('The combined list for ' + laDateLabel_(key) + ' hasn\'t gone yet — this only goes after it, with any changes.');
  if (!laPairRead_(ss, key, 'fun') && laPairPlayers_(ss, key, 'fun').playing.length >= 2) {
    laFunGenerate_(ss, key, who);
    logActivity_(ss, who, 'Made Fun group pairings', laDateLabel_(key) + ' — for the Fun Group Pairings email');
  }
  const c = laComposeEmails_(ss, 'funpairings', key, st);
  if (c.closed) throw new Error('No Legends tee times on ' + laDateLabel_(key) + ' (' + c.closed + ') — nothing to send.');
  if (!c.mails.length) throw new Error('Nobody would get this email — check who is ticked.');
  const total = c.mails.reduce((a, m) => a + laMailCount_(m), 0);
  if (MailApp.getRemainingDailyQuota() < total + 1) throw new Error('The daily email limit has been reached — try again tomorrow.');
  const now = laFunPairingsEmail_(ss, key, st);
  const n = laSendMails_(st, c.mails);
  laDropsClear_(key, ['fun'], c);
  PropertiesService.getScriptProperties().setProperty('FP_LIST_' + key, JSON.stringify({ sig: now.sig, names: now.names }));
  if (c.groups.some((g) => g.id === 'players' || g.id === 'legends')) laSetPlayersLast_(ss, 'fun', key, st);
  laAppend_(ss, LA.REMINDER_LOG, { Type: 'funpairings', DateKey: key, SentAt: new Date().toISOString(), Recipients: String(n) });
  logActivity_(ss, who, 'Sent Changes in Fun Group Pairings email', laDateLabel_(key) + ' — ' + n + ' recipient' + (n === 1 ? '' : 's'));
}
// After a Fun group change: once the combined list has gone, if the Fun group no longer
// matches what was last sent, send "Changes in Fun Group Pairings".
function laFunEmailResendIfChanged_(ss, key) {
  if (key < laTodayKey_() || !laSentFor_(ss, LA.PRO_SHOP_LOG, key) || !laFunEmailChanged_(ss, key)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { laFunEmailSend_(ss, key, 'Automatic (update)'); } finally { lock.releaseLock(); }
}
// When changes go out (Tom 2026-11-05): changes are gathered and sent once each morning at
// 5 AM (laProShopMorning_). Only on the day of play, from 5 AM on, do the change emails go
// as each change happens, and then not to the pro shop (they know who is at the club).
function laPlayDayLive_(key) {
  return key === laTodayKey_() && Number(Utilities.formatDate(new Date(), laTz_(), 'H')) >= LA_PS_UPDATE_HOUR_;
}
let LA_MORNING_RUN_ = false; // true while the 5 AM run sends, so the pro shop is included then
// After any Fun group change: "Changes in Fun Group Pairings" carries it (once the combined
// list has gone). Switched off, or for a list sent before this existed, the combined list does
// (at 5 AM only).
function laAfterFunChange_(ss, key) {
  if (!laPlayDayLive_(key)) return; // the 5 AM run sends it
  if (laOn_(laSettings_(ss), 'FunPairingsResend') && laFunEmailLast_(key)) {
    try { laFunEmailResendIfChanged_(ss, key); } catch (err) { Logger.log('Changes in Fun Group Pairings not sent: ' + err.message); }
  }
}
// The same for the Nassau group: "Changes to Nassau Pairings" (Tom 2026-10-28).
function laAfterNassauChange_(ss, key, pairingsOnly) {
  if (!laPlayDayLive_(key)) return; // the 5 AM run sends it
  if (laOn_(laSettings_(ss), 'NassauChangesResend') && laNassauLast_(key)) {
    try { laNassauResendIfChanged_(ss, key); } catch (err) { Logger.log('Changes to Nassau Pairings not sent: ' + err.message); }
  }
}

// The players by Handicap Index in two columns (number, name, Tees, Index, Handicap), as
// used in Larry's Game and "Nassau players for tomorrow" (Tom 2026-11-04: tees in their own
// column, written out in full, instead of codes after the name).
function laIdxTable_(list, name, chTxt) {
  const half = Math.ceil(list.length / 2);
  const pd = 'padding:3px 8px;';
  const row = (x, n) => x ? '<td style="' + pd + 'color:#888;">' + n + '</td><td style="' + pd + 'white-space:nowrap;">' + name(x) + '</td><td style="' + pd + 'white-space:nowrap;">' + laEsc_(x.Tee || '') + '</td>' +
    '<td style="' + pd + 'text-align:right;">' + laEsc_(x.HI || '–') + '</td><td style="' + pd + 'text-align:right;">' + chTxt(x) + (x.Extra ? ' <span style="color:#888;font-size:11px;">(+' + x.Extra + ')</span>' : '') + '</td>' : '<td colspan="5"></td>';
  let rows = '';
  for (let i = 0; i < half; i++) rows += '<tr>' + row(list[i], i + 1) + '<td style="width:24px;border-right:2px solid #333;"></td><td style="width:16px;"></td>' + row(list[half + i], half + i + 1) + '</tr>';
  const h = '<th></th><th></th><th style="' + pd + 'font-size:11px;text-align:left;">Tees</th><th style="' + pd + 'font-size:11px;">Index</th><th style="' + pd + 'font-size:11px;">Handicap</th>';
  return '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin-top:16px;"><tr>' + h + '<th style="border-right:2px solid #333;"></th><th></th>' + h + '</tr>' + rows + '</table>';
}

// ---------------- "Nassau players for tomorrow" ----------------
// (Tom 2026-10-28) The email Tom Gurganus sends the Nassau players by hand the evening
// before: the tee time, how many are signed up and who is on standby, the tee key, and
// everyone by Handicap Index with his tees and course handicap. (Tom 2026-11-04: no more
// colour-coded names and suffixes; a Tees column names the actual tees instead.)
function laNassauTomorrowEmail_(ss, key, st) {
  st = st || laSettings_(ss);
  const v = laPairView_(ss, key);
  const lastOf = (n) => String(n || '').split(',')[0].trim();
  const all = v.players.concat(v.standby);
  const lastCount = {}; all.forEach((x) => { const l = lastOf(x.Name).toLowerCase(); lastCount[l] = (lastCount[l] || 0) + 1; });
  const short = (x) => { const l = lastOf(x.Name), f = String(x.Name).split(',').slice(1).join(',').trim(); return lastCount[l.toLowerCase()] > 1 && f ? l + ' ' + f[0] : l; };
  const d = new Date(key + 'T12:00:00Z');
  const dayTxt = ['Sun', 'Mon', 'Tues', 'Wed', 'Thurs', 'Fri', 'Sat'][d.getUTCDay()] + '., ' + (d.getUTCMonth() + 1) + '/' + d.getUTCDate();
  const n = v.players.length, sb = v.standby.map(short);
  const sbTxt = !sb.length ? '' : ' with ' + (sb.length === 1 ? sb[0] : sb.slice(0, -1).join(', ') + ' and ' + sb[sb.length - 1]) + ' on standby';
  const ph = laNum_(st.PairingsHour, 7);
  const pairTxt = (ph % 12 || 12) + ':00 ' + (ph < 12 ? 'AM' : 'PM');
  const msg = String(st.NassauTomorrowMessage || '').replace(/\{count\}/g, String(n)).replace(/\{standby\}/g, sbTxt).replace(/\{pairings\}/g, pairTxt);
  // (Tom 2026-11-04) Laid out like the Larry's Game email: the header box, the STANDBY
  // box, then everyone by index with a Tees column.
  const chTxt = (x) => (x.CH === null || x.CH === undefined ? '–' : x.CH < 0 ? '+' + (-x.CH) : String(x.CH));
  const byIdx = v.players.slice().sort((a, b) => laIdxSort_(a.HI) - laIdxSort_(b.HI));
  const dateTxt = (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
  const yellow = 'background:#fff3a0;', hb = 'border:1px solid #333;padding:6px 10px;';
  const head = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">' +
    '<tr><td style="' + hb + 'font-weight:700;color:#2e5d34;font-size:16px;white-space:nowrap;">Nassau Group</td>' +
    '<td style="' + hb + yellow + 'font-weight:700;text-align:center;min-width:180px;">' + n + ' Player' + (n === 1 ? '' : 's') + ' signed up</td>' +
    '<td style="' + hb + yellow + 'color:#b0127f;font-weight:700;white-space:nowrap;">Tee time: ' + laEsc_(v.teeTime) + '</td></tr>' +
    '<tr><td style="' + hb + 'color:#6b2fa0;font-weight:700;">' + dateTxt + '</td>' +
    '<td colspan="2" style="' + hb + yellow + 'text-align:center;font-weight:700;">Larry\'s Game pairings at ' + pairTxt + '</td></tr></table>';
  const notes = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin-top:14px;border:1px solid #333;"><tr>' +
    '<td style="border:1px solid #333;padding:6px 10px;' + yellow + '"><b>STANDBY:</b> ' + (sb.length ? sb.map(laEsc_).join(', ') : 'None') + '</td></tr></table>';
  const html = '<div>' + laMsg_(msg, 'font-family:Arial,sans-serif;font-size:14px;') + laPlayersChangeNote_(ss, 'nassau', key, st) + head + notes + laIdxTable_(byIdx, (x) => laEsc_(short(x)), chTxt) +
    laMsg_(st.NassauTomorrowFooterText, 'font-family:Arial,sans-serif;font-size:13px;color:#555;margin-top:16px;') +
    (st.SiteUrl && String(st.NassauTomorrowAppLink).toUpperCase() === 'TRUE' ? '<p style="font-family:Arial,sans-serif;font-size:13px;margin-top:16px;"><a href="' + laEsc_(st.SiteUrl) + '">Open the Legends app</a></p>' : '') + '</div>';
  const text = ['TEE TIME IS ' + v.teeTime, '', msg, '', 'Standby: ' + (sb.length ? sb.join(', ') : 'None'), '']
    .concat(byIdx.map((x, i) => (i + 1) + '. ' + short(x) + '  ' + (x.Tee || '') + '  ' + (x.HI || '–') + '  ' + chTxt(x)))
    .concat(String(st.NassauTomorrowFooterText || '').trim() ? ['', String(st.NassauTomorrowFooterText).trim()] : []).join('\n');
  return { dateKey: key, closed: v.closed || '', players: n, subject: 'Nassau signed up for ' + dayTxt + ' TEE TIME IS ' + v.teeTime, html: html, text: text };
}

// ---------------- "Changes to Nassau Pairings" ----------------
// (Tom 2026-10-28) Only after the combined list has gone: the Nassau players (and, once
// Larry's Game has gone, the pairings) when they change, to the pro shop and the Nassau
// players, so the Fun group isn't emailed about Nassau changes.
function laNassauLast_(key) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('NP_LIST_' + key) || 'null'); } catch (e) { return null; }
}
function laNassauSentFor_(ss, key) { return laRead_(ss, LA.REMINDER_LOG).filter((r) => r.Type === 'nassauchanges' && r.DateKey === key).sort((a, b) => (a.SentAt < b.SentAt ? 1 : -1))[0] || null; }
function laNassauBaseline_(ss, key) {
  const m = laNassauChangesEmail_(ss, key);
  PropertiesService.getScriptProperties().setProperty('NP_LIST_' + key, JSON.stringify({ sig: m.sig, names: m.names, pairSig: m.pairSig }));
}
function laNassauChanged_(ss, key) {
  const last = laNassauLast_(key);
  return !!last && last.sig !== laNassauChangesEmail_(ss, key).sig;
}
// { subject, html, text, closed, players, sig, names, pairSig }
function laNassauChangesEmail_(ss, key, st) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a date.');
  st = st || laSettings_(ss);
  const closure = laRead_(ss, LA.CLOSURES).find((c) => c.DateKey === key);
  const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key) || {};
  const info = laDayInfo_(key, st, cfg, closure ? closure.Reason : '', '', laRead_(ss, LA.CLUB_TEE_TIMES), Date.now());
  const list = laGroupList_(laRead_(ss, LA.SIGNUPS), key, 'nassau');
  const playing = list.slice(0, info.nassauSlots).sort((a, b) => String(a.Name).localeCompare(String(b.Name), 'en', { sensitivity: 'base' })), standby = list.slice(info.nassauSlots);
  const dateText = laLongDate_(key);
  const html = [], text = [], sig = [], names = [];
  html.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">');
  html.push('<p>Hello — the Heritage Legends <b>Nassau group</b> for <b>' + laEsc_(dateText) + '</b>' + (info.nassauTimes ? ' (' + laEsc_(info.nassauTimes) + ')' : '') + ' has changed since the list sent earlier. Here it is now.</p>');
  text.push('Changes to the Heritage Legends Nassau group for ' + dateText, '');
  const changeAt = html.length;
  if (String(st.NassauChangesMessage || '').trim()) { html.push(laMsg_(st.NassauChangesMessage)); text.push(String(st.NassauChangesMessage).trim(), ''); }
  html.push('<p style="margin:10px 0 2px;"><b>Playing (' + playing.length + ')</b></p>');
  text.push('Playing (' + playing.length + '):');
  if (!playing.length) { html.push('<p style="color:#777;">No one signed up.</p>'); text.push('  (no one)'); }
  else {
    html.push('<ol style="margin:0;padding-left:24px;">');
    playing.forEach((x) => {
      names.push(displayName_(x.Name));
      sig.push(x.PlayerID + ':' + (x.Note || ''));
      text.push('  ' + displayName_(x.Name) + (x.Note ? ' (' + x.Note + ')' : ''));
      html.push('<li>' + laEsc_(displayName_(x.Name)) + (x.Note ? ' <i style="color:#555;">(' + laEsc_(x.Note) + ')</i>' : '') + '</li>');
    });
    html.push('</ol>');
  }
  if (standby.length) {
    html.push('<p style="margin:6px 0 2px;color:#9a6b00;"><b>Standby</b> (not playing unless a spot opens):</p><ol style="margin:0;padding-left:24px;color:#777;">');
    standby.forEach((x) => html.push('<li>' + laEsc_(displayName_(x.Name)) + '</li>'));
    html.push('</ol>');
    text.push('Standby: ' + standby.map((x) => displayName_(x.Name)).join(', '));
    sig.push('sb:' + standby.map((x) => x.PlayerID).join(','));
  }
  // the pairings, once Larry's Game has gone with them
  const rec = laPairRead_(ss, key, 'nassau');
  let pairSig = null;
  if (rec && rec.EmailSentAt && (rec.teams || []).length) {
    const nameOf = {}; list.forEach((x) => { nameOf[String(x.PlayerID)] = displayName_(x.Name); });
    const signedUp = Object.assign({}, nameOf); // (Tom 2026-11-04) leave out anyone who has dropped out
    readRosterFull_(ss).forEach((r) => { if (!nameOf[String(r.PlayerID)]) nameOf[String(r.PlayerID)] = displayName_(r.Name); });
    const ps = [];
    html.push('<p style="margin:12px 0 2px;"><b>Pairings</b></p><ul style="margin:0;padding-left:24px;">');
    text.push('', 'Pairings:');
    rec.teams.forEach((t0, i) => {
      const t = t0.filter((id) => signedUp[String(id)]);
      if (!t.length) return;
      const bl = (rec.blinds || []).filter((b) => b.team === i && signedUp[String(b.playerId)]).map((b) => nameOf[b.playerId] || '?');
      const who = t.map((id) => nameOf[id] || '?').join(', ') + (bl.length ? ' · Blind: ' + bl.join(', ') : '');
      ps.push(i + ':' + t.join(',') + '/' + (rec.blinds || []).filter((b) => b.team === i && signedUp[String(b.playerId)]).map((b) => b.playerId).join(','));
      html.push('<li><b>' + laEsc_(LA_PAIR_NAMES_[i] || LA_PAIR_ORDER_[i]) + ':</b> ' + laEsc_(who) + '</li>');
      text.push('  ' + (LA_PAIR_NAMES_[i] || LA_PAIR_ORDER_[i]) + ': ' + who);
    });
    const nib = (rec.notInBet || []).filter((id) => signedUp[String(id)]).map((id) => nameOf[id]).filter(Boolean);
    if (nib.length) { html.push('<li>Not in the bet: ' + laEsc_(nib.join(', ')) + '</li>'); text.push('  Not in the bet: ' + nib.join(', ')); ps.push('nib:' + rec.notInBet.join(',')); }
    html.push('</ul>');
    if (rec.game) { html.push('<p style="margin:4px 0;color:#555;">Game: ' + laEsc_(rec.game) + '</p>'); text.push('  Game: ' + rec.game); ps.push('g:' + rec.game); }
    pairSig = laHash_(ps.join('|'));
    sig.push('pairs:' + pairSig);
  }
  if (String(st.NassauChangesFooterText || '').trim()) { html.push(laMsg_(st.NassauChangesFooterText, 'color:#555;')); text.push('', String(st.NassauChangesFooterText).trim()); }
  if (st.SiteUrl && String(st.NassauChangesAppLink).toUpperCase() === 'TRUE') { html.push('<p><a href="' + laEsc_(st.SiteUrl) + '">Open the Legends app</a></p>'); text.push('', 'Legends app: ' + st.SiteUrl); }
  html.push('<p>Thank you,<br>Heritage Legends Golf</p></div>');
  text.push('', 'Thank you,', 'Heritage Legends Golf');
  const note = laChangeNote_(laNassauLast_(key), names, pairSig, laSentFor_(ss, LA.PRO_SHOP_LOG, key));
  html.splice(changeAt, 0, note.html); text.splice(2, 0, note.text, '');
  return { dateKey: key, closed: closure ? (closure.Reason || 'closed') : '', players: playing.length,
    subject: 'Changes to Nassau pairings — ' + dateText, html: html.join(''), text: text.join('\n'), sig: laHash_(sig.join('|')), names: names, pairSig: pairSig };
}
// Sends "Changes to Nassau Pairings" for one date (caller holds the lock).
function laNassauEmailSend_(ss, key, who) {
  const st = laSettings_(ss);
  if (!laSentFor_(ss, LA.PRO_SHOP_LOG, key)) throw new Error('The combined list for ' + laDateLabel_(key) + ' hasn\'t gone yet — this only goes after it, with any changes.');
  const c = laComposeEmails_(ss, 'nassauchanges', key, st);
  if (c.closed) throw new Error('No Legends tee times on ' + laDateLabel_(key) + ' (' + c.closed + ') — nothing to send.');
  if (!c.mails.length) throw new Error('Nobody would get this email — check who is ticked.');
  const total = c.mails.reduce((a, m) => a + laMailCount_(m), 0);
  if (MailApp.getRemainingDailyQuota() < total + 1) throw new Error('The daily email limit has been reached — try again tomorrow.');
  const n = laSendMails_(st, c.mails);
  laDropsClear_(key, ['nassau'], c);
  laNassauBaseline_(ss, key);
  if (c.groups.some((g) => g.id === 'players' || g.id === 'legends')) laSetPlayersLast_(ss, 'nassau', key, st);
  laAppend_(ss, LA.REMINDER_LOG, { Type: 'nassauchanges', DateKey: key, SentAt: new Date().toISOString(), Recipients: String(n) });
  logActivity_(ss, who, 'Sent Changes to Nassau Pairings email', laDateLabel_(key) + ' — ' + n + ' recipient' + (n === 1 ? '' : 's'));
}
function laNassauResendIfChanged_(ss, key) {
  if (key < laTodayKey_() || !laSentFor_(ss, LA.PRO_SHOP_LOG, key) || !laNassauChanged_(ss, key)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { laNassauEmailSend_(ss, key, 'Automatic (update)'); } finally { lock.releaseLock(); }
}
// A short fingerprint of a string (to tell whether a list has changed).
function laHash_(s) { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + '.' + s.length; }
// What the last list sent for a date said: { sig, names } (kept in Script Properties).
function laProShopLast_(key) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PS_LIST_' + key) || 'null'); } catch (e) { return null; }
}
// True when the players (or the Fun groups) are no longer what the last list sent said.
function laProShopChanged_(ss, key) {
  const last = laProShopLast_(key);
  if (!last) return false; // sent before lists were remembered: can't tell
  return last.sig !== laProShopEmail_(ss, key).sig;
}
// After a change: if that round's list has gone out and no longer matches, send an updated
// one (unless Admin > Setup > Emails says not to).
function laProShopResendIfChanged_(ss, key) {
  const st = laSettings_(ss);
  if (!laOn_(st, 'ProShopAutoSend') || !laOn_(st, 'ProShopResend') || key < laTodayKey_()) return;
  if (!laRead_(ss, LA.PRO_SHOP_LOG).some((r) => r.DateKey === key) || !laProShopChanged_(ss, key)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { laProShopSend_(ss, key, 'Automatic (update)'); } finally { lock.releaseLock(); }
}
// Sends the list for one date and records it. `who` is the admin's name, or 'Automatic'.
function laProShopSend_(ss, key, who) {
  const st = laSettings_(ss);
  // the list shows the Fun group's groups, so make them first if they aren't yet
  if (!laPairRead_(ss, key, 'fun') && laPairPlayers_(ss, key, 'fun').playing.length >= 2) {
    laFunGenerate_(ss, key, who);
    logActivity_(ss, who, 'Made Fun group pairings', laDateLabel_(key) + ' — for the pro shop list');
  }
  const c = laComposeEmails_(ss, 'proshop', key, st);
  if (c.closed) throw new Error('No Legends tee times on ' + laDateLabel_(key) + ' (' + c.closed + ') — nothing to send.');
  if (laSendTo_(st, 'proshop').indexOf('proshop') !== -1 && !laEmailList_(st.ProShopEmails).length) throw new Error('No pro shop email address is set.');
  if (!c.mails.length) throw new Error('Nobody is ticked to get the players list.');
  const total = c.mails.reduce((a, m) => a + laMailCount_(m), 0);
  if (MailApp.getRemainingDailyQuota() < total + 1) throw new Error('The daily email limit has been reached — try again tomorrow.');
  // A list for a date that already had one is an update: say so, and what changed.
  const last = laRead_(ss, LA.PRO_SHOP_LOG).some((r) => r.DateKey === key) ? laProShopLast_(key) : null;
  const now = laProShopEmail_(ss, key, st);
  if (last || laRead_(ss, LA.PRO_SHOP_LOG).some((r) => r.DateKey === key)) {
    const diff = [];
    if (last) {
      [['fun', 'Fun group'], ['nassau', 'Nassau group']].forEach(([g, label]) => {
        const out = (last.names[g] || []).filter((n) => now.names[g].indexOf(n) === -1), inn = now.names[g].filter((n) => (last.names[g] || []).indexOf(n) === -1);
        if (out.length) diff.push(label + ' — no longer playing: ' + out.join(', '));
        if (inn.length) diff.push(label + ' — now playing: ' + inn.join(', '));
      });
      if (!diff.length) diff.push('The Fun group groups or someone\'s details changed.');
    }
    const note = '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#b3261e;"><b>UPDATED LIST</b> — this replaces the one sent earlier.' +
      (diff.length ? '<br>' + diff.map(laEsc_).join('<br>') : '') + '</p>';
    c.mails.forEach((m) => {
      m.subject = 'UPDATED: ' + m.subject;
      m.html = note + m.html;
      m.text = 'UPDATED LIST — this replaces the one sent earlier.\n' + diff.join('\n') + '\n\n' + (m.text || '');
    });
  }
  laSendMails_(st, c.mails);
  laDropsClear_(key, ['fun', 'nassau'], c);
  PropertiesService.getScriptProperties().setProperty('PS_LIST_' + key, JSON.stringify({ sig: now.sig, names: now.names }));
  laChangeBaselines_(ss, key); // the change emails start from what this list said
  const first = c.mails[0];
  laAppend_(ss, LA.PRO_SHOP_LOG, { DateKey: key, SentAt: new Date().toISOString(), SentBy: who, To: first.to.join(', '), Cc: first.cc.join(', '), Players: String(c.players) });
  logActivity_(ss, who, 'Sent players list to pro shop', laDateLabel_(key) + ' — ' + c.players + ' players');
  return c;
}
function laProShopSendAdmin_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const key = String(p.dateKey || '');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { laProShopSend_(ss, key, admin); } finally { lock.releaseLock(); }
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}
// Hourly (see installLegendsTriggers): any round whose sign-ups have closed and
// whose list hasn't gone yet is sent — normally just after midnight, two days
// before play becomes one day before.
function legendsHourly() {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  // Before the reminders, so a duty moved off a closed day gets its reminder the day before its new day.
  try {
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    try { laMoveDutyForClosures_(ss, 'Automatic'); } finally { lock.releaseLock(); }
  } catch (err) { Logger.log('Duty on closed days: ' + err.message); }
  try { laSendReminders_(ss); } catch (err) { Logger.log('Reminders: ' + err.message); }
  try { laDutyAwayHourly_(ss); } catch (err) { Logger.log('Away weeks reminders: ' + err.message); }
  try { laFunHourly_(ss); } catch (err) { Logger.log('Fun pairings: ' + err.message); }
  laProShopHourly_(ss);
  try { laProShopMorning_(ss); } catch (err) { Logger.log('Updated pro shop lists: ' + err.message); }
  try { laPairingsHourly_(ss); } catch (err) { Logger.log('Pairings: ' + err.message); }
  try { laTournHourly_(ss); } catch (err) { Logger.log('Tournaments: ' + err.message); }
  maybeBackup_(ss, false, BACKUP_MIN_INTERVAL_MIN);
  try { removeOldBackupTabs(25); } catch (err) { Logger.log('Old backup tabs: ' + err.message); }
}
// When the list goes: as soon as sign-ups close (11:59 PM), or with ProShopHour set,
// at that hour the next morning (sign-ups close at 11:59 PM, so midnight + hours).
function laProShopDue_(st, closesAt) {
  return String(st.ProShopHour) === '' ? closesAt : closesAt + 60000 + Number(st.ProShopHour) * 3600000;
}
// Changes after the list has gone (Tom 2026-11-05): instead of after every change, once each
// morning at LA_PS_UPDATE_HOUR_ (5 AM), for every upcoming round: "Changes in Fun Group
// Pairings" and "Changes to Nassau Pairings" if their group changed (and they're on), then an
// UPDATED combined list if a group whose own change email is off (or never started) changed.
const LA_PS_UPDATE_HOUR_ = 5;
function laProShopMorning_(ss) {
  const today = laTodayKey_(), props = PropertiesService.getScriptProperties();
  if (Number(Utilities.formatDate(new Date(), laTz_(), 'H')) < LA_PS_UPDATE_HOUR_ || props.getProperty('PS_MORNING') === today) return;
  props.setProperty('PS_MORNING', today);
  const st = laSettings_(ss);
  LA_MORNING_RUN_ = true;
  try {
    for (let i = 0; i <= 7; i++) {
      const key = laAddDays_(today, i);
      const funOwn = laOn_(st, 'FunPairingsResend') && laFunEmailLast_(key);
      const nasOwn = laOn_(st, 'NassauChangesResend') && laNassauLast_(key);
      if (funOwn) try { laFunEmailResendIfChanged_(ss, key); } catch (err) { Logger.log('Changes in Fun Group Pairings for ' + key + ' not sent: ' + err.message); }
      if (nasOwn) try { laNassauResendIfChanged_(ss, key); } catch (err) { Logger.log('Changes to Nassau Pairings for ' + key + ' not sent: ' + err.message); }
      if (funOwn && nasOwn || !laOn_(st, 'ProShopAutoSend') || !laOn_(st, 'ProShopResend')) continue;
      try { laProShopResendIfChanged_(ss, key); } catch (err) { Logger.log('Updated pro shop list for ' + key + ' not sent: ' + err.message); }
    }
  } finally { LA_MORNING_RUN_ = false; }
}
function laProShopHourly_(ss) {
  // forget what old lists said (kept only to spot changes before play)
  const props = PropertiesService.getScriptProperties(), old = laAddDays_(laTodayKey_(), -7);
  Object.keys(props.getProperties()).forEach((k) => { if (/^(PS|FP|NP|FQ|NQ|DR)_LIST_\d{4}-\d{2}-\d{2}$/.test(k) && k.slice(8) < old) props.deleteProperty(k); });
  const st = laSettings_(ss);
  if (!laOn_(st, 'ProShopAutoSend')) return;
  const today = laTodayKey_();
  const sent = {}; laRead_(ss, LA.PRO_SHOP_LOG).forEach((r) => { sent[r.DateKey] = true; });
  const closed = {}; laRead_(ss, LA.CLOSURES).forEach((c) => { closed[c.DateKey] = true; });
  const cfgs = laRead_(ss, LA.DAY_CONFIG), clubTimes = laRead_(ss, LA.CLUB_TEE_TIMES);
  for (let i = 0; i <= 7; i++) {
    const key = laAddDays_(today, i);
    if (!laIsPlayDay_(key) || closed[key] || sent[key] || laTournOnDay_(ss, key).all) continue; // a tournament for everyone has its own email
    const info = laDayInfo_(key, st, cfgs.find((c) => c.DateKey === key), '', '', clubTimes, Date.now());
    if (Date.now() <= laProShopDue_(st, info.closesAt)) continue;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return;
    try {
      if (laRead_(ss, LA.PRO_SHOP_LOG).some((r) => r.DateKey === key)) continue; // sent meanwhile
      laProShopSend_(ss, key, 'Automatic');
    } catch (err) {
      Logger.log('Pro shop list for ' + key + ' not sent: ' + err.message);
    } finally {
      lock.releaseLock();
    }
  }
}


// ---------------- Related Files ----------------
// Files live in a private Google Drive folder ("Heritage Legends Files") owned by
// the account that runs the script; nobody gets a Drive link. Members open them
// through the app, which checks they're signed in, so the roster's phone numbers
// and emails stay among the Legends.
const LA_MAX_FILE_BYTES = 20 * 1024 * 1024;
function laFilesFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LEGENDS_FILES_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (err) { /* deleted — make a new one */ } }
  const folder = DriveApp.createFolder('Heritage Legends Files');
  props.setProperty('LEGENDS_FILES_FOLDER_ID', folder.getId());
  return folder;
}
function laCleanName_(s) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'file'; }
function laFileUpload_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const data = String(p.data || '');
  if (!data) throw new Error('Choose a file to upload.');
  const bytes = Utilities.base64Decode(data);
  if (bytes.length > LA_MAX_FILE_BYTES) throw new Error('That file is larger than 20 MB — please make it smaller first.');
  const fileName = laCleanName_(p.fileName);
  const mime = String(p.mimeType || '') || 'application/octet-stream';
  const blob = Utilities.newBlob(bytes, mime, fileName);
  const driveFile = laFilesFolder_().createFile(blob);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row;
  try {
    const rows = laRead_(ss, LA.FILES);
    const replaceId = String(p.replaceId || '');
    row = replaceId ? rows.find((r) => r.FileID === replaceId) : null;
    if (replaceId && !row) throw new Error('The file being replaced was not found.');
    const oldDrive = row ? row.DriveID : '';
    if (!row) {
      row = { FileID: 'f' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), Hidden: '',
        SortOrder: String(rows.reduce((m, r) => Math.max(m, Number(r.SortOrder) || 0), 0) + 1) };
      rows.push(row);
    }
    row.DriveID = driveFile.getId();
    row.Title = String(p.title || '').trim().slice(0, 120) || row.Title || fileName.replace(/\.[^.]+$/, '');
    if (p.description !== undefined) row.Description = String(p.description || '').trim().slice(0, 300);
    if (p.category !== undefined) row.Category = String(p.category || '').trim().slice(0, 60);
    row.FileName = fileName; row.MimeType = mime; row.Size = String(bytes.length);
    row.UploadedAt = new Date().toISOString(); row.UploadedBy = admin;
    laWriteAll_(ss, LA.FILES, rows);
    if (oldDrive) { try { DriveApp.getFileById(oldDrive).setTrashed(true); } catch (err) { Logger.log('Old file not trashed: ' + err.message); } }
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, p.replaceId ? 'Replaced a related file' : 'Uploaded a related file', row.Title + ' (' + fileName + ')');
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}
// Saves titles, descriptions, categories, order and hidden flags; any file left
// out of `rows` is removed (moved to the Drive trash, so it can be recovered for 30 days).
function laFilesSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const incoming = JSON.parse(p.rows || '[]');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const removed = [];
  try {
    const rows = laRead_(ss, LA.FILES);
    const byId = {}; rows.forEach((r) => { byId[r.FileID] = r; });
    const keep = [];
    incoming.forEach((x, i) => {
      const r = byId[String(x.FileID)];
      if (!r) return;
      r.Title = String(x.Title || '').trim().slice(0, 120) || r.Title;
      r.Description = String(x.Description || '').trim().slice(0, 300);
      r.Category = String(x.Category || '').trim().slice(0, 60);
      r.Hidden = String(x.Hidden).toUpperCase() === 'TRUE' ? 'TRUE' : '';
      r.SortOrder = String(i + 1);
      keep.push(r);
    });
    rows.filter((r) => keep.indexOf(r) === -1).forEach((r) => {
      removed.push(r.Title);
      try { DriveApp.getFileById(r.DriveID).setTrashed(true); } catch (err) { Logger.log('Not trashed: ' + err.message); }
    });
    laWriteAll_(ss, LA.FILES, keep);
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Saved related files', removed.length ? 'Removed: ' + removed.join(', ') : 'Titles / order updated');
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}
// Returns one file's contents to a signed-in member (or admin).
function laFileGet_(ss, viewer, p) {
  const r = laRead_(ss, LA.FILES).find((x) => x.FileID === String(p.fileId || ''));
  if (!r || (!viewer.isAdmin && String(r.Hidden).toUpperCase() === 'TRUE')) throw new Error('That file is no longer available.');
  const blob = DriveApp.getFileById(r.DriveID).getBlob();
  return { fileName: r.FileName, mimeType: r.MimeType || blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}


// ---------------- News (and photos) ----------------
// An admin posts a short news item — "Hole in one! Ray Schipani, #7" — with an
// optional photo. It shows at the top of Sign-ups until ShowUntil; the photo is
// also kept in Related Files under "Photos", so it stays in the gallery after.
function laNewsPost_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const st = laSettings_(ss);
  const title = String(p.title || '').trim().slice(0, 120);
  const body = String(p.body || '').trim().slice(0, 1500);
  if (!title) throw new Error('Give the news a headline.');
  let photoId = '';
  if (p.photoData) {
    laFileUpload_(ss, { adminPin: p.adminPin, data: p.photoData, fileName: p.photoName || 'photo.jpg', mimeType: p.photoType || 'image/jpeg',
      title: title, description: body.slice(0, 300), category: 'Photos' });
    const files = laRead_(ss, LA.FILES);
    photoId = files.length ? files.reduce((a, b) => (a.UploadedAt > b.UploadedAt ? a : b)).FileID : '';
  }
  const days = Math.max(1, Math.min(365, parseInt(p.days, 10) || laNum_(st.NewsDays, 7)));
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    laAppend_(ss, LA.NEWS, { NewsID: 'n' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), Title: title, Body: body, PhotoID: photoId,
      PostedAt: new Date().toISOString(), PostedBy: admin, ShowUntil: laAddDays_(laTodayKey_(), days - 1), Hidden: '' });
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Posted news', title + (photoId ? ' (with photo)' : ''));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}
// Edits / hides / removes news posts (photos stay in Related Files).
function laNewsSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const incoming = JSON.parse(p.rows || '[]');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const byId = {}; laRead_(ss, LA.NEWS).forEach((n) => { byId[n.NewsID] = n; });
    const keep = [];
    incoming.forEach((x) => {
      const n = byId[String(x.NewsID)];
      if (!n) return;
      n.Title = String(x.Title || '').trim().slice(0, 120) || n.Title;
      n.Body = String(x.Body || '').trim().slice(0, 1500);
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(x.ShowUntil || ''))) n.ShowUntil = x.ShowUntil;
      n.Hidden = String(x.Hidden).toUpperCase() === 'TRUE' ? 'TRUE' : '';
      keep.push(n);
    });
    laWriteAll_(ss, LA.NEWS, keep.sort((a, b) => (a.PostedAt < b.PostedAt ? -1 : 1)));
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, admin, 'Saved news', incoming.length + ' post' + (incoming.length === 1 ? '' : 's'));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}

// ---------------- Reminder emails ----------------
// All four run from the hourly job and are each sent once per date (ReminderLog).
// Who gets each one is set on Admin > Emails (see laComposeEmails_).
//  duty    — evening before a duty day, to each person on duty, with their instructions
//  playing — evening before a round, one email to everyone signed up, listing them all
//  closing — morning of the last sign-up day, one email (Bcc) to active members not signed up
function laReminderWrap_(st, lines, type) {
  const link = st.SiteUrl && String(st[LA_EMAIL_PREFIX_[type] + 'AppLink']).toUpperCase() === 'TRUE';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">' + lines.join('') +
    (link ? '<p><a href="' + laEsc_(st.SiteUrl) + '">Open the Legends app</a></p>' : '') +
    '<p style="color:#777;font-size:12px;">Heritage Legends Golf</p></div>';
  return html;
}
// An admin-written paragraph (blank → nothing). Line breaks are kept.
// Google Group members (Tom 2026-11-05). The app reads the group (it's owned by the account
// the script runs as), but Google only shows members with a Google account, so addresses
// like aol.com or nc.rr.com are listed by hand in DailyGroupMembers. Lower-case emails, or
// null if the group can't be read. Kept 30 minutes in the script cache.
function laGroupFromGoogle_(addr, fresh) {
  const cache = CacheService.getScriptCache(), ck = 'GRP_' + String(addr).toLowerCase();
  if (!fresh) { const c = cache.get(ck); if (c) return JSON.parse(c); }
  try {
    const list = GroupsApp.getGroupByEmail(addr).getUsers().map((u) => String(u.getEmail() || '').trim().toLowerCase()).filter(Boolean);
    cache.put(ck, JSON.stringify(list), 1800);
    return list;
  } catch (err) { Logger.log('Group ' + addr + ' not readable: ' + err.message); return null; }
}
// Is this address a Google Group? Any @googlegroups.com address, or the Legends group address.
function laIsGroupAddr_(st, e) {
  e = String(e || '').trim().toLowerCase();
  return /@googlegroups\.com$/.test(e) || laEmailList_(st.DailyGroupEmail).map((x) => x.toLowerCase()).indexOf(e) !== -1;
}
// Hand-listed members Google can't show (DailyGroupMembers), for one group. One line per group:
// "group@googlegroups.com: a@aol.com, b@nc.rr.com"; a line with no "group:" counts for every group.
function laGroupExtras_(st, addr) {
  addr = String(addr).toLowerCase();
  const out = [];
  String(st.DailyGroupMembers || '').split(/\n/).forEach((line) => {
    const m = line.match(/^\s*([^:\s,]+@[^:\s,]+)\s*:(.*)$/);
    if (m && m[1].toLowerCase() !== addr) return;
    laEmailList_(m ? m[2] : line).forEach((e) => { e = e.toLowerCase(); if (!laIsGroupAddr_(st, e) && out.indexOf(e) === -1) out.push(e); });
  });
  return out;
}
// A group's members as roster rows (or { Name: email, Email: email } when not in the roster),
// leaving out the sending account. If Google can't show the group: the hand-listed addresses,
// or for the Legends group address with none listed, every active Legend.
function laGroupMembers_(st, roster, addr, fresh) {
  const g = laGroupFromGoogle_(addr, fresh);
  const extra = laGroupExtras_(st, addr);
  let me = ''; try { me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (!g && !extra.length) return laEmailList_(st.DailyGroupEmail).map((x) => x.toLowerCase()).indexOf(String(addr).toLowerCase()) !== -1 ? roster.filter((r) => memberIsActive_(r) && String(r.Email || '').trim()) : [];
  const emails = (g || []).concat(extra).filter((e, i, a) => e !== me && a.indexOf(e) === i);
  return emails.map((e) => roster.find((r) => String(r.Email || '').trim().toLowerCase() === e) || { Name: e, Email: e });
}
// Admin › Emails "Check the group": for each group address in the email settings, who the app
// sees in it and how that differs from the active Legends in the roster.
function laGroupCheck_(ss, p) {
  laRequireAdmin_(ss, p);
  const st = laSettings_(ss), roster = readRosterFull_(ss);
  const addrs = [];
  Object.keys(st).filter((k) => /GroupEmail$|ExtraEmails$/.test(k)).forEach((k) => laEmailList_(st[k]).forEach((e) => { e = e.toLowerCase(); if (laIsGroupAddr_(st, e) && addrs.indexOf(e) === -1) addrs.push(e); }));
  const active = roster.filter((r) => memberIsActive_(r) && String(r.Email || '').trim());
  const activeSet = {}; active.forEach((r) => { activeSet[String(r.Email).trim().toLowerCase()] = true; });
  return { groups: addrs.map((addr) => {
    const g = laGroupFromGoogle_(addr, true);
    const members = laGroupMembers_(st, roster, addr, false);
    const inGroup = {}; members.forEach((m) => { inGroup[String(m.Email).trim().toLowerCase()] = true; });
    return {
      address: addr, readable: !!g, fromGoogle: g ? g.length : 0, handListed: laGroupExtras_(st, addr).length,
      members: members.map((m) => displayName_(m.Name)),
      notInGroup: active.filter((r) => !inGroup[String(r.Email).trim().toLowerCase()]).map((r) => displayName_(r.Name)),
      notInRoster: members.filter((m) => !activeSet[String(m.Email).trim().toLowerCase()]).map((m) => String(m.Email)),
    };
  }) };
}
// The note for an email sent to a group address (see DailyGroupNoteText). members: roster rows.
function laGroupNote_(st, group, members) {
  const t = String(st.DailyGroupNoteText || '').trim();
  if (!t || !members.length) return { html: '', text: '' };
  const last = (n) => String(n || '').split(',')[0].trim();
  const list = members.slice().sort((a, b) => last(a.Name).localeCompare(last(b.Name)) || String(a.Name).localeCompare(String(b.Name)));
  const names = list.map((r) => displayName_(r.Name)).join(', ');
  const mailto = 'mailto:' + list.map((r) => String(r.Email).trim()).join(',');
  const fill = (x, link) => x.replace(/\{group\}/g, group).replace(/\{count\}/g, String(list.length)).replace(/\{names\}/g, names).replace(/\{link\}/g, link);
  const html = '<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#666;border-top:1px solid #ddd;padding-top:8px;margin-top:16px;">' +
    fill(laEsc_(t), '<a href="' + laEsc_(mailto) + '">click here</a>').replace(/\n/g, '<br>') + '</p>';
  return { html: html, text: fill(t, 'email: ' + list.map((r) => String(r.Email).trim()).join(', ')) };
}
function laMsg_(text, style) {
  const s = String(text || '').trim();
  return s ? '<p' + (style ? ' style="' + style + '"' : '') + '>' + laEsc_(s).replace(/\n/g, '<br>') + '</p>' : '';
}
function laHtmlToText_(html) { return html.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|li|h3)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim(); }
// "a day" / "2 days" between a moved duty day and its own (closed) day.
function laEarlyWords_(key, from) {
  const n = Math.round((new Date(from + 'T12:00:00Z') - new Date(key + 'T12:00:00Z')) / 86400000);
  return n === 1 ? 'a day' : n + ' days';
}
function laFill_(tpl, info) { return String(tpl || '').replace(/\{arrive\}/g, info.arrive || '').replace(/\{latest\}/g, info.latest || '').replace(/\{call\}/g, info.call || ''); }
// The wording of one reminder for one date. duty: one personal email per person
// [{ to, name, subject, html }]; playing / daily / closing: one shared [{ subject, html }].
// Who else gets them is worked out in laComposeEmails_.
function laBuildReminders_(ss, type, key, st, roster) {
  const byId = {}; roster.forEach((r) => { byId[String(r.PlayerID)] = r; });
  const email = (pid) => { const r = byId[String(pid)]; return r && memberIsActive_(r) ? String(r.Email || '').trim() : ''; };
  const first = (name) => displayName_(name).split(' ')[0];
  const closures = laRead_(ss, LA.CLOSURES), clubTimes = laRead_(ss, LA.CLUB_TEE_TIMES);
  const closure = closures.find((c) => c.DateKey === key);
  const out = [];
  if (type === 'duty') {
    const rows = laRead_(ss, LA.DUTY).filter((d) => d.DateKey === key);
    if (!rows.length) return out;
    const closedBy = {}; closures.forEach((c) => { closedBy[c.DateKey] = c.Reason || 'closed'; });
    const info = laDutyDayInfo_(rows, st, clubTimes, closedBy, laShopClosedBy_(closures))[key] || {};
    rows.forEach((r) => {
      const to = email(r.PlayerID);
      if (!to) return;
      const others = rows.filter((x) => x !== r).map((x) => displayName_(x.Name) + (x.Role === 'phone' ? ' (phone)' : ' (in person)'));
      const lines = ['<p>Hi ' + laEsc_(first(r.Name)) + ',</p>', laMsg_(st.DutyMessage)];
      if (info.movedFrom && !info.targetClosed) { // Tom 2026-11-15: the club lets us request early when it's closed on the duty day
        const why = String(info.movedWhy || '').trim();
        lines.push('<p><b>Note the day: this is ' + laEsc_(laEarlyWords_(key, info.movedFrom)) + ' early.</b> The club is closed on ' + laEsc_(laDateLabel_(info.movedFrom)) +
          (why && why.toLowerCase() !== 'closed' ? ' (' + laEsc_(why) + ')' : '') + ', so it is letting us request these tee times on ' + laEsc_(laDateLabel_(key)) + ' instead.</p>');
      } else if (info.dayClosed && !info.targetClosed) {
        const why = String(info.dayClosed || '').trim();
        lines.push('<p><b>Note:</b> the club is closed on ' + laEsc_(laDateLabel_(key)) + (why && why.toLowerCase() !== 'closed' ? ' (' + laEsc_(why) + ')' : '') +
          '. Please check with the Tee Times Manager about when to request these tee times.</p>');
      }
      if (info.targetClosed) {
        const why = String(info.targetClosed || '').trim();
        lines.push('<p><b>No need to get tee times tomorrow, ' + laEsc_(laDateLabel_(key)) + '.</b> Club closed in two weeks, ' + laEsc_(laDateLabel_(info.target)) +
          (why && why.toLowerCase() !== 'closed' ? ', for ' + laEsc_(why) : '') + '. Enjoy the morning off!</p>');
      } else {
        lines.push('<p><b>Tomorrow, ' + laEsc_(laDateLabel_(key)) + ':</b> ' + (r.Role === 'phone' ? 'phone in at <b>' + laEsc_(info.call) + '</b>' : 'in person — arrive by <b>' + laEsc_(info.latest) + '</b> (preferably ' + laEsc_(info.arrive) + ')') +
          ', requesting tee times for <b>' + laEsc_(laDateLabel_(info.target)) + '</b>.</p>');
        lines.push('<p style="color:#444;">' + laEsc_(laFill_(r.Role === 'phone' ? st.DutyPhoneText : st.DutyInPersonText, info)) + '</p>');
        const heavyWhy = laHeavyDays_(st)[info.target]; // heavy days are the busy rounds (Tom 2026-11-01)
        if (heavyWhy !== undefined) {
          lines.push('<p><b>Heavy demand expected</b> for that round' + (heavyWhy ? ' (' + laEsc_(heavyWhy) + ')' : '') + ', so three people are going in person' +
            (r.Role === 'phone' ? '; you\'re the backup, phoning in at ' + laEsc_(info.call) + '.' : '.') + '</p>');
        }
      }
      if (others.length) lines.push('<p>Also on duty: ' + laEsc_(others.join(', ')) + '.</p>');
      lines.push(laMsg_(st.DutyFooterText, 'color:#666;'));
      out.push({ to: to, name: displayName_(r.Name), subject: info.targetClosed ? 'Tee Time Duty tomorrow — no need to get tee times'
        : 'Tee Time Duty tomorrow (' + laDateLabel_(key) + ')' + (info.movedFrom ? ' — ' + laEarlyWords_(key, info.movedFrom) + ' early, club closed ' + laDateLabel_(info.movedFrom) : ''), html: laReminderWrap_(st, lines, 'duty') });
    });
  } else if (type === 'playing') {
    if (closure) return out;
    const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key);
    const info = laDayInfo_(key, st, cfg, '', '', clubTimes, Date.now());
    const all = laRead_(ss, LA.SIGNUPS);
    // Date, then the "Can't make it?" line (PlayingFooterText) right under it, then the list.
    const cant = String(st.PlayingFooterText || '').trim();
    // Each is its own paragraph, so there's a blank line above and below the "Can't make it?" line.
    const gap = ' style="margin:0 0 16px;"';
    const lines = [laMsg_(st.PlayingMessage), '<p' + gap + '><b>Golf tomorrow, ' + laEsc_(laLongDate_(key)) + '.</b></p>', laPlayersChangeNote_(ss, 'fun', key, st),
      cant ? '<p' + gap + '>' + laEsc_(cant).replace(/\n/g, '<br>') + '</p>' : '', '<p' + gap + '>Here is everyone signed up in the Fun group:</p>'];
    let count = 0;
    // Fun group only (Tom 2026-10-28): the Nassau players have "Nassau players for tomorrow"
    ['fun'].forEach((g) => {
      const list = laGroupList_(all, key, g), slots = g === 'fun' ? info.funSlots : info.nassauSlots, times = g === 'fun' ? info.funTimes : info.nassauTimes;
      if (!list.length) return;
      count += list.length;
      const item = (s) => '<li>' + laEsc_(displayName_(s.Name)) + (laDetail_(s) || s.Note ? ' <span style="color:#555;">— ' + laEsc_([laDetail_(s), s.Note].filter(Boolean).join(', ')) + '</span>' : '') + '</li>';
      const playing = list.slice(0, slots), standby = list.slice(slots);
      lines.push('<h3 style="margin:16px 0 4px;color:#1e5b3a;">' + (g === 'fun' ? 'Fun group' : 'Nassau group') + ' — ' + laEsc_(times) + '</h3>');
      if (playing.length) lines.push('<ol style="margin:4px 0;padding-left:24px;">' + playing.map(item).join('') + '</ol>');
      if (standby.length) lines.push('<p style="margin:6px 0 2px;color:#9a6b00;"><b>Standby</b>, in order (playing only if a spot opens):</p><ol style="margin:0;padding-left:24px;color:#777;">' + standby.map(item).join('') + '</ol>');
    });
    if (!count) return out;
    out.push({ subject: 'Golf tomorrow, ' + laDateLabel_(key) + ': who\'s playing', html: laReminderWrap_(st, lines, 'playing') });
  } else if (type === 'daily') {
    if (closure) return out;
    out.push(laDailyEmail_(ss, st, key, roster, closures, clubTimes));
  } else if (type === 'closing') {
    if (closure) return out;
    const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key);
    const info = laDayInfo_(key, st, cfg, '', '', clubTimes, Date.now());
    const all = laRead_(ss, LA.SIGNUPS);
    const f = laGroupList_(all, key, 'fun').length, n = laGroupList_(all, key, 'nassau').length;
    // {weekday} (e.g. Monday) and {date} (e.g. Mon, Nov 9) in the wording (Tom 2026-11-05)
    const wd = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(key + 'T12:00:00Z').getUTCDay()];
    const fill = (t) => String(t || '').replace(/\{weekday\}/gi, wd).replace(/\{date\}/gi, laDateLabel_(key));
    // (Tom 2026-11-06) "There is still time…", then the open slots, then when sign-ups close.
    const fo = Math.max(0, info.funSlots - f), no = Math.max(0, info.nassauSlots - n);
    if (!fo && !no) return out; // both groups full: nothing to remind anyone about (Tom 2026-11-06)
    const open = (k, g) => (k ? k + ' slot' + (k === 1 ? '' : 's') + ' open in the ' + g : 'no slots open in the ' + g + ' (you can still join its standby list)');
    const lines = [laMsg_(fill(st.ClosingMessage)),
      '<p>There is still time to sign up to play on <b>' + laEsc_(laDateLabel_(key)) + '</b>!</p>',
      '<p>There ' + (fo === 1 ? 'is ' : 'are ') + open(fo, 'Fun group') + ' and ' + open(no, 'Nassau group') + '.</p>',
      '<p>Sign-ups for <b>' + laEsc_(laLongDate_(key)) + '</b> close <b>tonight at 11:59 PM</b>.</p>',
      laMsg_(fill(st.ClosingFooterText), 'color:#666;')];
    out.push({ subject: 'Last day to sign up for ' + laDateLabel_(key), html: laReminderWrap_(st, lines, 'closing') });
  }
  return out;
}

// ---------------- who gets each email ----------------
const LA_EMAIL_PREFIX_ = { proshop: 'ProShop', duty: 'Duty', playing: 'Playing', daily: 'Daily', closing: 'Closing', pairings: 'Pairings', funpairings: 'FunPairings', nassauchanges: 'NassauChanges', nassautomorrow: 'NassauTomorrow' };
// The audiences each email offers on Admin > Emails (see the *SendTo settings).
const LA_EMAIL_AUDIENCES_ = {
  proshop: ['proshop', 'extra', 'admin', 'players', 'legends'],
  duty: ['duty', 'admin', 'proshop', 'extra'],
  playing: ['players', 'admin', 'extra'],
  daily: ['legends', 'players', 'proshop', 'extra', 'admin'],
  closing: ['notsigned', 'legends', 'admin', 'extra'],
  pairings: ['legends', 'players', 'proshop', 'admin', 'extra'],
  funpairings: ['proshop', 'players', 'admin', 'extra', 'legends'],
  nassauchanges: ['proshop', 'players', 'admin', 'extra', 'legends'],
  nassautomorrow: ['players', 'admin', 'proshop', 'extra'],
};
// The audiences ticked for one email (only ones that email offers).
function laSendTo_(st, type) {
  const allowed = LA_EMAIL_AUDIENCES_[type] || [];
  return String(st[LA_EMAIL_PREFIX_[type] + 'SendTo'] || '').split(/[,\s]+/).filter((a, i, arr) => allowed.indexOf(a) !== -1 && arr.indexOf(a) === i);
}
// The addresses in one audience for one date.
function laAudience_(ss, st, type, id, key, roster) {
  const active = roster.filter((r) => memberIsActive_(r) && String(r.Email || '').trim());
  const addr = (r) => String(r.Email).trim();
  // with a Legends Google Group, "All Legends" is that one address on every email (Tom 2026-11-06)
  if (id === 'legends') return laEmailList_(st.DailyGroupEmail).length ? laEmailList_(st.DailyGroupEmail) : active.map(addr);
  if (id === 'players' || id === 'notsigned') {
    const signed = {}; laRead_(ss, LA.SIGNUPS).forEach((s) => { if (s.DateKey === key && (type === 'funpairings' ? s.Group === 'fun' : (type === 'nassauchanges' || type === 'nassautomorrow') ? s.Group === 'nassau' : (type !== 'playing' || s.Group === 'fun'))) signed[String(s.PlayerID)] = true; });
    // (Tom 2026-11-06: "Last day to sign up" goes to everyone not signed up, whatever their
    // usual group, since someone may switch groups to take an open slot.)
    const dropped = {};
    if (id === 'players') (LA_DROP_GROUPS_[type] || []).forEach((g) => (laDrops_(key)[g] || []).forEach((pid) => { dropped[String(pid)] = true; }));
    return active.filter((r) => (!!signed[String(r.PlayerID)] === (id === 'players')) || (id === 'players' && dropped[String(r.PlayerID)])).map(addr);
  }
  if (id === 'duty') {
    const on = {}; laRead_(ss, LA.DUTY).forEach((d) => { if (d.DateKey === key) on[String(d.PlayerID)] = true; });
    return active.filter((r) => on[String(r.PlayerID)]).map(addr);
  }
  if (id === 'proshop') return laEmailList_(st.ProShopEmails);
  if (id === 'admin') return laEmailList_(st.AdminEmail);
  if (id === 'extra') return laEmailList_(st[LA_EMAIL_PREFIX_[type] + 'ExtraEmails']);
  return [];
}
// Where an audience goes on a shared email. Legends lists are Bcc'd, except on the
// "Legends Signups" email, where everyone is listed openly so reply-all works.
// "Playing tomorrow" also lists the players openly, as one email to all of them.
function laSlot_(type, id, st) {
  if (id === 'legends' && laEmailList_(st.DailyGroupEmail).length) return 'to'; // the group address, openly
  if (type === 'nassautomorrow') return id === 'players' ? 'to' : 'cc';
  if (type === 'funpairings' || type === 'nassauchanges') return id === 'legends' ? 'bcc' : id === 'admin' || id === 'extra' ? 'cc' : 'to';
  if (type === 'pairings') return id === 'legends' ? (laEmailList_(st.DailyGroupEmail).length ? 'to' : 'bcc') : id === 'players' ? 'bcc' : id === 'proshop' ? 'to' : 'cc';
  if (type === 'daily' || id === 'proshop') return 'to';
  if (type === 'playing') return id === 'players' ? 'to' : 'cc';
  if (id === 'admin' || id === 'extra') return type === 'proshop' ? 'cc' : 'to';
  return 'bcc';
}
// Apps Script puts at most 50 addresses on one email; spreads a longer list over
// several. Extra parts go To the Legends address with the rest in Bcc.
function laPackMail_(st, to, cc, bcc) {
  const LIMIT = 50, self = laEmailList_(st.AdminEmail).slice(0, 1);
  if (!to.length) { to = cc; cc = []; }
  if (!to.length) to = self;
  if (to.length + cc.length + bcc.length <= LIMIT) return [{ to: to, cc: cc, bcc: bcc }];
  const out = [];
  const parts = Math.ceil(to.length / LIMIT), size = Math.ceil(to.length / parts);
  for (let i = 0; i < to.length; i += size) out.push({ to: to.slice(i, i + size), cc: [], bcc: [] });
  const room = (m) => LIMIT - m.to.length - m.cc.length - m.bcc.length;
  if (cc.length <= room(out[0])) out[0].cc = cc; else bcc = cc.concat(bcc);
  bcc.forEach((e) => {
    let m = out.find((x) => room(x) > 0);
    if (!m) { m = { to: self.slice(), cc: [], bcc: [] }; out.push(m); }
    m.bcc.push(e);
  });
  return out;
}
function laMailCount_(m) { return m.to.length + m.cc.length + m.bcc.length; }
function laSendMails_(st, mails) {
  let n = 0;
  mails.forEach((m) => {
    laSendEmail_({ to: m.to.join(','), cc: m.cc.length ? m.cc.join(',') : undefined, bcc: m.bcc.length ? m.bcc.join(',') : undefined,
      subject: m.subject, htmlBody: m.html, body: m.text || laHtmlToText_(m.html), name: 'Heritage Legends Golf', replyTo: st.AdminEmail || undefined });
    n += laMailCount_(m);
  });
  return n;
}
// Every email of one kind for one date, ready to send:
// { mails: [{ to: [], cc: [], bcc: [], subject, html }], groups: [{ id, count }], personal, closed, players }.
// Tee Time Duty is personal (one email per person); anyone else ticked gets a
// single copy with all of them in it. Every other email is one shared email.
function laComposeEmails_(ss, type, key, st) {
  if (!LA_EMAIL_PREFIX_[type]) throw new Error('Unknown email.');
  const roster = LA_CACHE_.__roster || readRosterFull_(ss); // laEmailForecast_ reads it once for many dates
  let sendTo = laSendTo_(st, type);
  // on the day of play after 5 AM, change emails skip the pro shop (Tom 2026-11-05)
  if ((type === 'funpairings' || type === 'nassauchanges') && !LA_MORNING_RUN_ && laPlayDayLive_(key)) sendTo = sendTo.filter((id) => id !== 'proshop');
  // the day before play the evening email tells the players instead (Tom 2026-11-05), see laSkipPlayers_
  if ((type === 'funpairings' || type === 'nassauchanges') && laSentFor_(ss, LA.PRO_SHOP_LOG, key) && laSkipPlayers_(ss, st, type === 'funpairings' ? 'fun' : 'nassau', key)) sendTo = sendTo.filter((id) => id !== 'players' && id !== 'legends');
  const groups = sendTo.map((id) => ({ id: id, emails: laAudience_(ss, st, type, id, key, roster) }));
  const closure = laRead_(ss, LA.CLOSURES).find((c) => c.DateKey === key);
  const res = { mails: [], groups: groups.map((g) => ({ id: g.id, count: g.emails.length })), personal: 0, closed: '', players: 0 };
  // A tournament that day takes the place of regular play (Tom 2026-11-23): no regular round emails
  // when it's for everyone, and no Fun Group ones when it's for the Fun Group. It has its own email.
  if (type !== 'duty') {
    const tr = laTournOnDay_(ss, key);
    const trClosed = tr.all || (tr.fun && (type === 'playing' || type === 'funpairings') ? tr.fun : '');
    if (trClosed) { res.closed = trClosed; return res; }
  }
  const seen = {};
  const uniq = (list) => list.filter((e) => { const k = e.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; });
  const slots = { to: [], cc: [], bcc: [] };
  const personalId = type === 'duty' ? 'duty' : '';
  if (personalId) {
    const own = sendTo.indexOf(personalId) !== -1;
    const personal = laBuildReminders_(ss, type, key, st, roster);
    if (own) personal.forEach((m) => { if (uniq([m.to]).length) res.mails.push({ to: [m.to], cc: [], bcc: [], subject: m.subject, html: m.html }); });
    res.personal = own ? res.mails.length : 0;
    groups.filter((g) => g.id !== personalId).forEach((g) => { slots[laSlot_(type, g.id, st)] = slots[laSlot_(type, g.id, st)].concat(uniq(g.emails)); });
    if (personal.length && laMailCount_(slots)) {
      const what = 'Tee Time Duty reminders';
      const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;"><p style="color:#666;">A copy of the ' + personal.length + ' ' + what + ' for ' +
        laEsc_(laDateLabel_(key)) + (own ? '' : ' (not sent to the people themselves — they aren\'t ticked)') + '.</p>' +
        personal.map((m) => '<hr><p style="color:#666;font-size:12px;">To ' + laEsc_(m.name) + ' — ' + laEsc_(m.subject) + '</p>' + m.html).join('') + '</div>';
      laPackMail_(st, slots.to, slots.cc, slots.bcc).forEach((r) => res.mails.push(Object.assign(r, { subject: 'Copy: ' + what + ' — ' + laDateLabel_(key), html: html })));
    }
    return res;
  }
  let body;
  if (type === 'proshop') {
    const m = laProShopEmail_(ss, key, st);
    res.closed = m.closed; res.players = m.players;
    body = m;
  } else if (type === 'nassautomorrow') {
    const m = laNassauTomorrowEmail_(ss, key, st);
    res.closed = m.closed; res.players = m.players;
    body = m.players ? m : null; // nobody signed up: nothing to send
  } else if (type === 'funpairings' || type === 'nassauchanges') {
    const m = type === 'funpairings' ? laFunPairingsEmail_(ss, key, st) : laNassauChangesEmail_(ss, key, st);
    res.closed = m.closed; res.players = m.players;
    body = m;
  } else if (type === 'pairings') {
    res.closed = closure ? (closure.Reason || 'closed') : '';
    // before the pairings are made there's no email yet, but the recipients still count (forecast)
    body = res.closed ? null : laPairBody_(ss, key, st);
    if (body && body.none) res.noPairings = true;
  } else {
    res.closed = closure ? (closure.Reason || 'closed') : '';
    body = res.closed ? null : laBuildReminders_(ss, type, key, st, roster)[0];
  }
  if (res.closed || !body) return res;
  groups.forEach((g) => { slots[laSlot_(type, g.id, st)] = slots[laSlot_(type, g.id, st)].concat(uniq(g.emails)); });
  // No double copies (Tom 2026-11-06): when a Google Group is among the recipients, members of
  // it aren't also sent their own copy.
  const grpAddrs = slots.to.concat(slots.cc, slots.bcc).filter((e) => laIsGroupAddr_(st, e));
  if (grpAddrs.length) {
    const inGrp = {};
    // only members the app actually knows of (read from Google, or hand-listed): if the group
    // can't be read, nobody is assumed to be in it, so a spare copy beats a missed email
    grpAddrs.forEach((a) => (laGroupFromGoogle_(a) || []).concat(laGroupExtras_(st, a)).forEach((e) => { inGrp[e] = true; }));
    ['to', 'cc', 'bcc'].forEach((k) => { slots[k] = slots[k].filter((e) => laIsGroupAddr_(st, e) || !inGrp[String(e).trim().toLowerCase()]); });
  }
  // "Last day to sign up" is only worth sending when there's someone left to remind.
  if (type === 'closing' && groups.some((g) => laSlot_(type, g.id, st) === 'bcc') && !slots.bcc.length) return res;
  if (!laMailCount_(slots)) return res;
  // sent to a Google Group (the Legends group address, or any @googlegroups.com address among
  // the recipients): say so, and how to write to everyone (Tom 2026-11-05)
  let html = body.html, text = body.text;
  slots.to.concat(slots.cc, slots.bcc).map((e) => String(e).trim().toLowerCase()).filter((e, i, a) => laIsGroupAddr_(st, e) && a.indexOf(e) === i).forEach((addr) => {
    const note = laGroupNote_(st, addr, laGroupMembers_(st, roster, addr));
    html += note.html; if (text && note.text) text += '\n\n' + note.text;
  });
  laPackMail_(st, slots.to, slots.cc, slots.bcc).forEach((r) => res.mails.push(Object.assign(r, { subject: body.subject, html: html, text: text })));
  return res;
}
function laReminderDue_(st, type, now) {
  const hour = parseInt(Utilities.formatDate(now, laTz_(), 'H'), 10);
  const today = Utilities.formatDate(now, laTz_(), 'yyyy-MM-dd');
  if (type === 'duty') return String(st.RemindDuty).toUpperCase() === 'TRUE' && hour >= laNum_(st.ReminderHour, 17) ? laAddDays_(today, 1) : '';
  if (type === 'playing') return String(st.RemindPlaying).toUpperCase() === 'TRUE' && hour >= laNum_(st.ReminderHour, 17) ? laAddDays_(today, 1) : '';
  if (type === 'daily') {
    if (String(st.RemindDaily).toUpperCase() !== 'TRUE' || hour < laNum_(st.DailyHour, 8)) return '';
    const key = laAddDays_(today, 1);
    return laIsPlayDay_(key) ? key : '';
  }
  if (type === 'nassautomorrow') {
    if (String(st.NassauTomorrowOn).toUpperCase() !== 'TRUE' || hour < laNum_(st.NassauTomorrowHour, 17)) return '';
    const key = laAddDays_(today, 1);
    return laIsPlayDay_(key) ? key : '';
  }
  if (type === 'closing') {
    if (String(st.RemindClosing).toUpperCase() !== 'TRUE' || hour < laNum_(st.ClosingReminderHour, 9)) return '';
    const key = laAddDays_(today, laNum_(st.SignupCloseDaysBefore, 2));
    return laIsPlayDay_(key) ? key : '';
  }
  return '';
}
function laSendReminders_(ss) {
  const st = laSettings_(ss);
  const now = new Date();
  ['duty', 'playing', 'closing', 'daily', 'nassautomorrow'].forEach((type) => {
    const key = laReminderDue_(st, type, now);
    if (!key) return;
    if (laRead_(ss, LA.REMINDER_LOG).some((r) => r.Type === type && r.DateKey === key)) return;
    let n = 0;
    const cm = laComposeEmails_(ss, type, key, st);
    cm.mails.forEach((m) => {
      if (MailApp.getRemainingDailyQuota() < laMailCount_(m) + 5) { Logger.log('Email quota low — ' + type + ' reminder skipped'); return; }
      try { n += laSendMails_(st, [m]); } catch (err) { Logger.log('Reminder to ' + m.to.join(', ') + ' failed: ' + err.message); }
    });
    // Logged even when nobody needed one, so it isn't retried every hour.
    laAppend_(ss, LA.REMINDER_LOG, { Type: type, DateKey: key, SentAt: now.toISOString(), Recipients: String(n) });
    if (n && (type === 'playing' || type === 'nassautomorrow')) { laSetPlayersLast_(ss, type === 'playing' ? 'fun' : 'nassau', key, st); laDropsClear_(key, LA_DROP_GROUPS_[type], cm); }
    if (n) logActivity_(ss, 'Automatic', 'Sent ' + type + ' reminders', laDateLabel_(key) + ' — ' + n + ' recipient' + (n === 1 ? '' : 's'));
  });
}
// Admin preview of one email for one date. `overrides` is the admin page's unsaved
// wording and recipients, so changes can be tried before saving.
function laEmailPreview_(ss, type, key, overrides) {
  if (!LA_EMAIL_PREFIX_[type]) throw new Error('Unknown email.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a date.');
  const st = laSettings_(ss);
  Object.keys(overrides || {}).forEach((k) => { if (k in LA_DEFAULT_SETTINGS) st[k] = String(overrides[k] == null ? '' : overrides[k]); });
  st.__funDraft = true; // the pro shop list shows draft Fun groups if they aren't made yet
  const c = laComposeEmails_(ss, type, key, st);
  if (c.noPairings) throw new Error('No Nassau pairings for ' + laDateLabel_(key) + ' yet — make them on Admin › Pairings › Nassau to preview this.');
  const m = c.mails[0];
  return { type: type, dateKey: key, closed: c.closed, groups: c.groups, personal: c.personal, emails: c.mails.length,
    total: c.mails.reduce((a, x) => a + laMailCount_(x), 0),
    sample: m ? { to: laShortList_(m.to), cc: laShortList_(m.cc), bccCount: m.bcc.length, subject: m.subject, html: m.html } : null };
}
// Admin > Emails "Send now": sends one reminder for one date right away, with the
// saved wording and recipients. It's recorded in ReminderLog, so the hourly job
// won't send the same one for that date again.
function laEmailSendNow_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const type = String(p.type || ''), key = String(p.dateKey || '');
  if (['duty', 'playing', 'daily', 'closing', 'funpairings', 'nassauchanges', 'nassautomorrow'].indexOf(type) === -1) throw new Error('Unknown email.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a date.');
  if (type === 'funpairings' || type === 'nassauchanges') {
    const lk = LockService.getScriptLock();
    lk.waitLock(20000);
    try { (type === 'funpairings' ? laFunEmailSend_ : laNassauEmailSend_)(ss, key, admin); } finally { lk.releaseLock(); }
    return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
  }
  const st = laSettings_(ss);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const c = laComposeEmails_(ss, type, key, st);
    if (c.closed) throw new Error('No Legends tee times on ' + laDateLabel_(key) + ' (' + c.closed + ') — nothing to send.');
    if (!c.mails.length) throw new Error('Nobody would get this email for ' + laDateLabel_(key) + ' — check who is ticked.');
    const total = c.mails.reduce((a, m) => a + laMailCount_(m), 0);
    if (MailApp.getRemainingDailyQuota() < total + 1) throw new Error('Sending this needs ' + total + ' recipients, and the daily email limit doesn\'t have that many left — try again tomorrow.');
    const n = laSendMails_(st, c.mails);
    laAppend_(ss, LA.REMINDER_LOG, { Type: type, DateKey: key, SentAt: new Date().toISOString(), Recipients: String(n) });
    if (n && (type === 'playing' || type === 'nassautomorrow')) { laSetPlayersLast_(ss, type === 'playing' ? 'fun' : 'nassau', key, st); laDropsClear_(key, LA_DROP_GROUPS_[type], c); }
    logActivity_(ss, admin, 'Sent ' + type + ' email now', laDateLabel_(key) + ' — ' + n + ' recipient' + (n === 1 ? '' : 's'));
  } finally {
    lock.releaseLock();
  }
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}
function laShortList_(list) {
  return list.length <= 4 ? list.join(', ') : list.slice(0, 3).join(', ') + ' and ' + (list.length - 3) + ' more';
}

// ---------------- daily email limit ----------------
// How many recipients the automatic emails will use on each of the next 14 days,
// from today's sign-ups, duty and settings, so Admin can warn before a day goes
// over Gmail's limit (EmailDailyLimit). Emails already sent aren't counted again;
// for today the limit is what Gmail says is left. One-off emails (a standby
// moving up, swap requests, Send now) aren't included.
// { limit, days: [{ day, total, limit, over, items: [{ type, key, count }] }] }
const LA_FORECAST_DAYS_ = 14;
function laEmailForecast_(ss, st) {
  const limit = laNum_(st.EmailDailyLimit, 100);
  const out = { limit: limit, days: [] };
  try {
    const today = laTodayKey_(), closeDays = laNum_(st.SignupCloseDaysBefore, 2);
    const on = (k) => String(st[k]).toUpperCase() === 'TRUE';
    const done = {};
    laRead_(ss, LA.REMINDER_LOG).forEach((r) => { done[r.Type + '|' + r.DateKey] = true; });
    laRead_(ss, LA.PRO_SHOP_LOG).forEach((r) => { done['proshop|' + r.DateKey] = true; });
    laRead_(ss, LA.PAIRINGS).forEach((r) => { if (r.Group === 'nassau' && r.EmailSentAt) done['pairings|' + r.DateKey] = true; });
    let left = limit;
    try { left = MailApp.getRemainingDailyQuota(); } catch (err) { /* not authorized yet */ }
    LA_CACHE_.__roster = readRosterFull_(ss);
    for (let i = 0; i < LA_FORECAST_DAYS_; i++) {
      const day = laAddDays_(today, i), next = laAddDays_(day, 1), closing = laAddDays_(day, closeDays);
      // When each email goes (see laReminderDue_ and laProShopHourly_): duty, playing and the
      // Legends Signups email the day before; "last day" on the closing day; the pro shop
      // list just after midnight once sign-ups close.
      const due = [];
      if (on('RemindDuty')) due.push(['duty', next]);
      if (on('RemindPlaying')) due.push(['playing', next]);
      if (on('NassauTomorrowOn') && laIsPlayDay_(next)) due.push(['nassautomorrow', next]);
      if (on('RemindDaily') && laIsPlayDay_(next)) due.push(['daily', next]);
      if (on('RemindClosing') && laIsPlayDay_(closing)) due.push(['closing', closing]);
      if (on('ProShopAutoSend') && laIsPlayDay_(laAddDays_(closing, -1))) due.push(['proshop', laAddDays_(closing, -1)]);
      if (on('PairingsAutoSend') && laIsPlayDay_(day)) due.push(['pairings', day]);
      const items = [];
      due.forEach(([type, key]) => {
        if (done[type + '|' + key]) return;
        try {
          const count = laComposeEmails_(ss, type, key, st).mails.reduce((a, m) => a + laMailCount_(m), 0);
          if (count) items.push({ type: type, key: key, count: count });
        } catch (err) { Logger.log('Email forecast ' + type + ' ' + key + ': ' + err.message); }
      });
      const total = items.reduce((a, x) => a + x.count, 0), dayLimit = i === 0 ? left : limit;
      out.days.push({ day: day, total: total, limit: dayLimit, over: total > dayLimit, items: items });
    }
  } catch (err) {
    Logger.log('Email forecast: ' + err.message); // never fail the board over this
  } finally {
    delete LA_CACHE_.__roster;
  }
  return out;
}

// The "Sign-up summary for Wednesday October 7 2026" email (called "Legends Signups" until Tom renamed it 2026-10-27) — the same layout
// the Legends have been sending by hand: open slots and standby for each
// group, who to text, cancellations, tomorrow's Tee Time Duty, and the full
// list of who signed up. One email, with everyone ticked on Admin > Emails
// listed openly.
function laDailyEmail_(ss, st, key, roster, closures, clubTimes) {
  const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key);
  const info = laDayInfo_(key, st, cfg, '', '', clubTimes, Date.now());
  const all = laRead_(ss, LA.SIGNUPS);
  const d = new Date(key + 'T12:00:00Z');
  const dateText = laLongDate_(key) + ' ' + d.getUTCFullYear();
  const lastName = (n) => String(n || '').split(',')[0].trim();
  const join = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const firstTime = (times) => (/TBD/.test(String(times)) ? '' : String(times || '').split(/\s*-\s*/)[0].replace(/\s*(AM|PM)$/i, (m, ap) => ap.toLowerCase()).replace(' ', ''));
  const lines = [];
  const groupPara = (label, list, slots, times, extraText) => {
    const playing = list.slice(0, slots), standby = list.slice(slots), open = Math.max(0, slots - list.length);
    lines.push('<h3 style="margin:16px 0 4px;color:#1e5b3a;">' + label.toUpperCase() + '</h3><p style="margin:0 0 6px;">' +
      (open ? 'There ' + (open === 1 ? 'is 1 slot' : 'are ' + open + ' slots') + ' open.' : 'There are no slots open.') +
      (standby.length ? ' ' + laEsc_(join(standby.map((s) => lastName(s.Name)))) + (standby.length === 1 ? ' is' : ' are') + ' on standby.' : '') +
      (firstTime(times) ? ' The first ' + label + ' tee time is ' + laEsc_(firstTime(times)) + '.' : ' Tee times to be confirmed.') + '</p>' + (extraText ? '<p style="margin:0 0 6px;">' + laEsc_(extraText) + '</p>' : ''));
    return playing;
  };
  lines.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">');
  lines.push('<h2 style="color:#1e5b3a;margin:0 0 8px;">Sign-up summary for ' + laEsc_(dateText) + '</h2>');
  lines.push(laMsg_(st.DailyMessage));
  const fun = laGroupList_(all, key, 'fun'), nas = laGroupList_(all, key, 'nassau');
  groupPara('Fun Group', fun, info.funSlots, info.funTimes, st.DailyFunText);
  groupPara('Nassau Group', nas, info.nassauSlots, info.nassauTimes, st.DailyNassauText);
  if (st.DailyCancelText) lines.push('<h3 style="margin:16px 0 4px;color:#1e5b3a;">TEE TIME CANCELATIONS</h3><p style="margin:0;">' + laEsc_(st.DailyCancelText) + '</p>');
  // Tee Time Duty for that same morning.
  const duty = laRead_(ss, LA.DUTY).filter((x) => x.DateKey === key);
  if (duty.length) {
    const closedBy = {}; closures.forEach((c) => { closedBy[c.DateKey] = c.Reason || 'closed'; });
    const dinfo = laDutyDayInfo_(duty, st, clubTimes, closedBy)[key] || {};
    lines.push('<h3 style="margin:16px 0 4px;color:#1e5b3a;">TEE TIME DUTY</h3>');
    if (dinfo.targetClosed) {
      lines.push('<p>' + laEsc_(join(duty.map((x) => lastName(x.Name)))) + ': no need to make tee times — no Legends tee times on ' + laEsc_(laLongDate_(dinfo.target)) + ' (' + laEsc_(dinfo.targetClosed) + ').</p>');
    } else {
      const ip = duty.filter((x) => x.Role !== 'phone'), ph = duty.filter((x) => x.Role === 'phone');
      if (ip.length) lines.push('<p><b>' + laEsc_(join(ip.map((x) => lastName(x.Name)))) + ':</b> ' + laEsc_(laFill_(st.DutyInPersonText, dinfo)) + '</p>');
      if (ph.length) lines.push('<p><b>' + laEsc_(join(ph.map((x) => lastName(x.Name)))) + ':</b> ' + laEsc_(laFill_(st.DutyPhoneText, dinfo)) + '</p>');
    }
  }
  // Full list, like the SignUp Genius export.
  const td = 'style="padding:3px 8px;border-bottom:1px solid #e5e5e5;"';
  // Each group gets its own two-line green banner: name and times, then the column headings.
  const th = 'style="padding:3px 8px;text-align:left;"';
  const rowsFor = (label, list, slots, times) => '<tr style="background:#1e5b3a;color:#fff;"><th colspan="3" ' + th + '>' + laEsc_(label + ' ' + times) + '</th></tr>' +
    '<tr style="background:#1e5b3a;color:#fff;"><th ' + th + '>#</th><th ' + th + '>Name</th><th ' + th + '>Comment</th></tr>' +
    list.map((s, i) => {
      const sb = i >= slots;
      const comment = [laDetail_(s), s.Note].filter(Boolean).join(' — ');
      return '<tr' + (sb ? ' style="color:#9a6b00;"' : '') + '><td ' + td + '>' + (sb ? 'Standby' : (i + 1)) + '</td><td ' + td + '>' +
        laEsc_(displayName_(s.Name)) + '</td><td ' + td + '>' + laEsc_(comment) + '</td></tr>';
    }).join('');
  lines.push('<table style="border-collapse:collapse;margin-top:16px;font-size:13px;">' +
    rowsFor('Fun Group', fun, info.funSlots, info.funTimes) + '<tr><td colspan="3" style="height:10px;"></td></tr>' + rowsFor('Nassau Group', nas, info.nassauSlots, info.nassauTimes) + '</table>');
  if (st.SiteUrl && String(st.DailyAppLink).toUpperCase() === 'TRUE') lines.push('<p><a href="' + laEsc_(st.SiteUrl) + '">Open the Legends app</a> to sign up or drop out.</p>');
  lines.push('<p style="color:#777;font-size:12px;">Heritage Legends Golf</p></div>');
  // Who gets it (listed openly, so reply-all works) is worked out in laComposeEmails_.
  return { subject: 'Sign-up summary for ' + dateText, html: lines.join('') };
}

// ---------------- Pairings (Admin > Pairings > Nassau) ----------------
// Each round's Nassau players are split into pairings (Aces, Kings, Queens, Jacks,
// Tens, Nines), balanced by Handicap Index: players are ranked A/B/C/D by index and
// each pairing gets one of each. A pairing that's a man short borrows a "blind" — a
// player from the next pairing whose score also counts for them — and tees off first.
// With three short pairings (13 or 17 players: the Aces, Kings and Queens) it's
// Stableford with no blinds. Made automatically at 6 AM on
// the day of play (legendsHourly), or by an admin at any time; admins can then move
// players, pick blinds, add extra strokes, and send the "Larry's Game" email.
// Saved in the Pairings tab: one row per date + group, the details as JSON in Data:
// { teams: [[PlayerID...]...], blinds: [{ playerId, team }], notInBet: [PlayerID], playsWith: {PlayerID: team},
//   game, madeAt, madeBy, prevKey }.
// Not in bet (Tom 2026-10-26): someone who plays but isn't part of the bet. He isn't in a
// pairing's betting team; he plays with the pairing in playsWith, or by default the first
// one that is short on the course (see laPairPlaceNib_), and that pairing needs a blind.
const LA_PAIR_NAMES_ = ['Aces', 'Kings', 'Queens', 'Jacks', 'Tens', 'Nines', 'Eights', 'Sevens', 'Sixes'];
const LA_PAIR_ORDER_ = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6'];
// Players -> pairing sizes (Aces first), blinds needed, Stableford. As many pairings as it
// takes (Tom 2026-11-07: up to the day's Nassau tee times, at most 9 tee times a day in all):
// foursomes, with the short pairings (threesomes) first. One or two short = that many blinds;
// three short = Stableford, no blinds; all short = equal threesomes, no blinds.
// Avoid blinds where we can (Tom 2026-11-04): when the players split into equal threesomes
// that fit the day's tee times, use them instead of foursomes with blinds (15 = five threesomes).
// Version of this file; Code.gs reports it beside BACKEND_VERSION so a missed paste shows on the page.
const LA_VERSION = '2026-11-24b';
const LA_MAX_TEE_TIMES_ = 9; // Fun + Nassau tee times in a day (Tom 2026-11-07)
function laPairBase_(n, maxGroups) {
  if (n < 6 || n > maxGroups * 4) return null;
  const g = Math.ceil(n / 4), short = 4 * g - n;
  const threes = (k) => ({ sizes: Array.from({ length: k }, () => 3), blinds: 0, stableford: false });
  if (short === g) return threes(g);
  const sizes = []; for (let i = 0; i < g; i++) sizes.push(i < short ? 3 : 4);
  const blinds = short === 1 || short === 2 ? short : 0;
  if (blinds && n % 3 === 0 && n / 3 <= maxGroups) return threes(n / 3);
  return { sizes: sizes, blinds: blinds, stableford: short === 3 };
}
// How many Nassau pairings a day can have: its Nassau tee times (at most LA_MAX_TEE_TIMES_).
function laNassauMaxGroups_(ss, key) {
  const st = laSettings_(ss), cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key);
  return Math.min(LA_MAX_TEE_TIMES_, laTeeCounts_(st, cfg).nassau || LA_MAX_TEE_TIMES_);
}
// An index for sorting (no index sorts last).
function laIdxSort_(hi) { const n = hcpIndexNum_(hi); return n === null ? 99 : n; }
const LA_TEE_ABBR_ = { 'Red': 'R', 'Gold/Red': 'G/R', 'Gold': 'G', 'White/Gold': 'W/G', 'White': 'W', 'Blue/White': 'B/W', 'Blue': 'B' };
function laPairLayout_(n, notInBet, maxGroups) {
  const mg = maxGroups || LA_MAX_TEE_TIMES_;
  const lay = laPairBase_(n, mg);
  // Players not in the bet (Tom 2026-10-26) fill the empty seats in short pairings. If
  // there aren't enough seats (e.g. 17 playing, 16 in the bet = four foursomes), add a
  // pairing: the bettors are spread over enough groups for everyone on the course, the
  // short pairings first, and with mixed sizes it's Stableford with no blinds (17 playing
  // = four threesomes and a foursome, and the extra man joins a threesome).
  const k = notInBet || 0;
  if (n + k > mg * 4) return null;
  if (!lay || !k || lay.sizes.reduce((a, s) => a + 4 - s, 0) >= k) return lay;
  const g = Math.ceil((n + k) / 4), base = Math.floor(n / g), rem = n % g;
  if (g > mg || base < 2) return lay;
  const sizes = [];
  for (let i = 0; i < g; i++) sizes.push(i < g - rem ? base : base + 1);
  return { sizes: sizes, blinds: 0, stableford: rem !== 0, extraGroup: true };
}
function laPairRead_(ss, key, group) {
  const r = laRead_(ss, LA.PAIRINGS).find((x) => x.DateKey === key && x.Group === group);
  if (!r) return null;
  let rec;
  try { rec = Object.assign(JSON.parse(r.Data || '{}'), { EmailSentAt: r.EmailSentAt || '', UpdatedAt: r.UpdatedAt || '', UpdatedBy: r.UpdatedBy || '' }); } catch (e) { return null; }
  // Nassau pairings made with no game (e.g. before Larry's Game picks, 2026-11-01) use the
  // day's pick shown on the Pairings page (Tom 2026-11-01), or Stableford if the layout needs it.
  if (group === 'nassau' && !String(rec.game || '').trim() && key >= laTodayKey_()) {
    const pl = laPairPlayers_(ss, key), nib = rec.notInBet || [];
    const betting = pl.playing.filter((x) => nib.indexOf(x.PlayerID) === -1).length;
    const lay = laPairLayout_(betting, pl.playing.length - betting, laNassauMaxGroups_(ss, key));
    rec.game = lay && lay.stableford ? 'Stableford' : laGameFor_(ss, key);
  }
  return rec;
}
function laPairWrite_(ss, key, group, data, who, emailSentAt) {
  const all = laRead_(ss, LA.PAIRINGS).filter((x) => !(x.DateKey === key && x.Group === group));
  const keep = {}; ['teams', 'blinds', 'notInBet', 'playsWith', 'game', 'madeAt', 'madeBy', 'prevKey', 'edited'].forEach((k) => { if (data[k] !== undefined) keep[k] = data[k]; });
  all.push({ DateKey: key, Group: group, Data: JSON.stringify(keep), UpdatedAt: new Date().toISOString(), UpdatedBy: who || '', EmailSentAt: emailSentAt || '' });
  laWriteAll_(ss, LA.PAIRINGS, all.filter((x) => x.DateKey >= laAddDays_(laTodayKey_(), -60))); // keep two months
}
// The round's Nassau (or Fun group) players (in the slots, in sign-up order) and its
// standby list, each with their tee for the day, index, extra strokes and course handicap.
function laPairPlayers_(ss, key, group) {
  group = group || 'nassau';
  const st = laSettings_(ss);
  const cap = laCapacity_(ss, st, key, group, []);
  const list = laGroupList_(laRead_(ss, LA.SIGNUPS), key, group);
  const hc = readHandicaps_(ss), usual = signupTees_(ss);
  const info = (s) => {
    const h = hc[String(s.PlayerID)] || {};
    const tee = HCP_TEES_.indexOf(s.Tee) !== -1 ? s.Tee : (HCP_TEES_.indexOf(h.Tee) !== -1 ? h.Tee : (usual[String(s.PlayerID)] || 'Gold'));
    const extra = parseInt(h.ExtraStrokes, 10) || 0;
    const ch = courseHandicap_(h.HandicapIndex, tee);
    const o = { PlayerID: String(s.PlayerID), Name: s.Name, Tee: tee, HI: h.HandicapIndex || '', Extra: extra, CH: ch === null ? null : ch + extra };
    if (group === 'fun') { o.Holes = s.Holes || ''; o.Riding = s.Riding || ''; o.Comment = s.Note || ''; }
    return o;
  };
  return { playing: list.slice(0, cap.slots).map(info), standby: list.slice(cap.slots).map(info) };
}
// The most recent Nassau pairings before this date (to avoid the same partners twice running).
function laPairPrev_(ss, key) {
  const rows = laRead_(ss, LA.PAIRINGS).filter((x) => x.Group === 'nassau' && x.DateKey < key).sort((a, b) => (a.DateKey < b.DateKey ? 1 : -1));
  if (!rows.length) return null;
  try { return { key: rows[0].DateKey, teams: JSON.parse(rows[0].Data || '{}').teams || [] }; } catch (e) { return null; }
}
// Players who were a blind in any of the last four Nassau rounds before this date
// (so no one is a blind more than once in five rounds).
function laPairRecentBlinds_(ss, key) {
  const n = {};
  laRead_(ss, LA.PAIRINGS).filter((x) => x.Group === 'nassau' && x.DateKey < key).sort((a, b) => (a.DateKey < b.DateKey ? 1 : -1)).slice(0, 4).forEach((r) => {
    try { (JSON.parse(r.Data || '{}').blinds || []).forEach((b) => { n[b.playerId] = true; }); } catch (e) {}
  });
  return n;
}
// Builds balanced pairings for the players: many random tries, keeping the one with
// no blind who was a blind in the last four rounds, then the fewest repeat partners
// from last time, then the closest average indexes.
function laPairMake_(players, prevTeams, tries, recentBlinds, notInBet, maxGroups) {
  const lay = laPairLayout_(players.length, notInBet, maxGroups);
  if (!lay) throw new Error(players.length < 6 ? 'Pairings need at least 6 players in the bet (' + players.length + ').' : 'Pairings handle at most ' + ((maxGroups || LA_MAX_TEE_TIMES_) * 4) + ' players on the course (' + (maxGroups || LA_MAX_TEE_TIMES_) + ' Nassau tee times): ' + (players.length + (notInBet || 0)) + ' are playing.');
  const idx = (p) => { const n = hcpIndexNum_(p.HI); return n === null ? 99 : n; }; // no index: ranked last
  const ranked = players.slice().sort((a, b) => idx(a) - idx(b) || String(a.Name).localeCompare(String(b.Name)));
  const before = {};
  (prevTeams || []).forEach((t) => t.forEach((a) => t.forEach((b) => { if (a !== b) before[a + '|' + b] = true; })));
  const byId = {}; players.forEach((p) => { byId[p.PlayerID] = p; });
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const shortTeams = lay.blinds ? lay.sizes.map((s, i) => (s === 3 ? i : -1)).filter((i) => i !== -1) : [];
  const rb = recentBlinds || {};
  let best = null;
  for (let n = 0; n < (tries || 3000); n++) {
    // Columns A-D are bands by index: column k holds the k-th best player of each pairing.
    // A pairing that's a man short has one open column; with blinds (Tom 2026-10-27) no
    // two short pairings have the same open column, and the blind is the player right
    // below the open slot: the next pairing's player in that column (he tees off next and
    // passes his scores along). So each column and each pairing has at most one blind.
    // Without blinds (equal threesomes, Stableford) the threesomes have no D player.
    const open = lay.sizes.map((s) => (s === 4 ? -1 : 3));
    if (shortTeams.length) { const cols = shuffle([0, 1, 2, 3]); shortTeams.forEach((t, i) => { open[t] = cols[i]; }); }
    const slots = lay.sizes.map((s, t) => [0, 1, 2, 3].map((k) => (s === 4 || (s === 3 && k !== open[t]) || (s < 3 && k < s) ? '' : null)));
    let at = 0;
    for (let k = 0; k < 4; k++) {
      const ts = slots.map((sl, t) => (sl[k] === '' ? t : -1)).filter((t) => t !== -1);
      const who = shuffle(ranked.slice(at, at + ts.length)); at += ts.length;
      ts.forEach((t, j) => { slots[t][k] = who[j].PlayerID; });
    }
    const teams = slots.map((sl) => sl.filter((id) => id !== null));
    const blinds = shortTeams.map((t) => ({ playerId: slots[t + 1][open[t]], team: t }));
    const turns = blinds.filter((b) => rb[b.playerId]).length;
    let repeats = 0;
    teams.forEach((t) => t.forEach((a, i) => t.slice(i + 1).forEach((b) => { if (before[a + '|' + b]) repeats++; })));
    const means = teams.map((t, i) => {
      const ids = t.concat(blinds.filter((b) => b.team === i).map((b) => b.playerId));
      return ids.reduce((s, id) => s + Math.min(idx(byId[id]), 40), 0) / ids.length;
    });
    const spread = Math.max.apply(null, means) - Math.min.apply(null, means);
    const score = turns * 10000 + repeats * 1000 + spread;
    if (!best || score < best.score) best = { score: score, teams: teams, blinds: blinds, repeats: repeats, spread: spread };
  }
  return { teams: best.teams, blinds: best.blinds, repeats: best.repeats, layout: lay };
}
// Which pairing each Not-in-bet player plays with: { PlayerID: team index }. Their pick
// in playsWith if it's a pairing with players, otherwise the pairing with the fewest on
// the course (the earliest if tied), as long as it has fewer than four. Only players still signed up (ids in `playing`) are placed.
function laPairPlaceNib_(teams, notInBet, playsWith, playing) {
  const size = teams.map((t) => t.length), out = {};
  const ok = (i) => teams[i] && teams[i].length;
  const live = (notInBet || []).filter((id) => !playing || playing[id]);
  live.forEach((id) => { const w = (playsWith || {})[id]; if (w !== undefined && ok(Number(w))) { out[id] = Number(w); size[Number(w)]++; } });
  live.forEach((id) => {
    if (out[id] !== undefined) return;
    let i = -1;
    size.forEach((n, k) => { if (ok(k) && n < 4 && (i === -1 || n < size[i])) i = k; }); // the smallest group, earliest first
    if (i !== -1) { out[id] = i; size[i]++; }
  });
  return out;
}
function laPairGenerate_(ss, key, who) {
  const pl = laPairPlayers_(ss, key);
  const prev = laPairPrev_(ss, key);
  const old = laPairRead_(ss, key, 'nassau');
  // players marked Not in bet stay that way; pairings are made from the betting players
  const playingIds = {}; pl.playing.forEach((x) => { playingIds[x.PlayerID] = true; });
  const nib = ((old && old.notInBet) || []).filter((id) => playingIds[id]);
  const made = laPairMake_(pl.playing.filter((x) => nib.indexOf(x.PlayerID) === -1), prev ? prev.teams : [], 0, laPairRecentBlinds_(ss, key), nib.length, laNassauMaxGroups_(ss, key));
  // Larry's Game: Stableford when the layout needs it, otherwise the day's pick (random or forced)
  const game = made.layout.stableford ? 'Stableford' : laGameFor_(ss, key);
  laPairWrite_(ss, key, 'nassau', { teams: made.teams, blinds: made.blinds, notInBet: nib, playsWith: {}, game: game, madeAt: new Date().toISOString(), madeBy: who, prevKey: prev ? prev.key : '' }, who, '');
  return made;
}
// ---------------- Larry's Game (Tom 2026-11-01) ----------------
// Every upcoming play day gets a game picked at random from the game list (the
// NassauGameList tab, first filled from "Larrys Nassau games.pdf": the foursome games
// played 2024-2026). A random pick avoids the games picked for the nearby play days.
// Admins can pick a new random game or force one (Admin > Pairings > Nassau, or by typing
// a game on the day's pairings). Picks are kept in the NassauGames tab (Forced TRUE =
// set by an admin). If the day's sign-ups need Stableford (13, 17 or 21 in the bet, or
// mixed group sizes, see laPairLayout_), the game is Stableford whatever was picked.
const LA_GAMES_DEFAULT_ = [
  'Best ball', 'Best 2 net', '1 net, 1 gross', 'Best 22 net scores per 9 holes', 'AB, AC, AD 3 holes',
  'Best 3 on par 3\'s, best 2 on others', 'Best 2 on par 3\'s, best ball on others', '1, 2, 3', '1, 2, 3 repeat',
  '2, 2, 3', '2, 2, 3 repeat', '3, 2, 2', '2, 3, 2', 'Best ball on odd holes, best 2 on even holes',
  'Best 2 on odd holes, best 3 on even holes', '1 net on odd holes, 2 net on even holes', 'AD best ball plus BC best ball',
  '1 on par 3\'s, 2 on par 4\'s, 3 on par 5\'s', 'Par 5\'s best ball, par 4\'s best 2, par 3\'s best 3',
  'Front 9: 1, 2, 3; back 9: best 22 net', 'Front 9: AB, AC, AD 3 holes; back 9: best 22 net', 'Stableford',
];
const LA_GAME_SPREAD_ = 12; // a random pick isn't a game picked within 12 days either side (about 5 play days)
function laGameList_(ss) {
  let list = laRead_(ss, LA.GAME_LIST).map((r) => String(r.Game || '').trim()).filter(Boolean);
  if (!list.length) { list = LA_GAMES_DEFAULT_.slice(); laWriteAll_(ss, LA.GAME_LIST, list.map((g) => ({ Game: g }))); }
  return list.filter((g, i) => list.findIndex((x) => x.toLowerCase() === g.toLowerCase()) === i);
}
// Upcoming open play days, the same days as the board.
function laGameDays_(ss) {
  const st = laSettings_(ss), today = laTodayKey_(), ahead = laNum_(st.BoardDaysAhead, 15);
  const closed = {}; laRead_(ss, LA.CLOSURES).forEach((c) => { if (c.DateKey) closed[c.DateKey] = true; });
  const out = [];
  for (let i = 0; i <= ahead; i++) { const k = laAddDays_(today, i); if (laIsPlayDay_(k) && !closed[k]) out.push(k); }
  return out;
}
// A random game for key that isn't picked for a nearby day (nor `avoid`, the game it replaces).
function laGameRandom_(list, picks, key, avoid) {
  const t = new Date(key + 'T12:00:00Z').getTime();
  const near = picks.filter((r) => r.DateKey !== key && r.Game && Math.abs(new Date(r.DateKey + 'T12:00:00Z').getTime() - t) <= LA_GAME_SPREAD_ * 86400000)
    .map((r) => String(r.Game).toLowerCase());
  if (avoid) near.push(String(avoid).toLowerCase());
  let pool = list.filter((g) => near.indexOf(g.toLowerCase()) === -1);
  if (!pool.length) pool = list.filter((g) => g.toLowerCase() !== String(avoid || '').toLowerCase());
  if (!pool.length) pool = list;
  return pool[Math.floor(Math.random() * pool.length)];
}
function laGameWrite_(ss, picks) {
  const from = laAddDays_(laTodayKey_(), -60); // keep two months
  laWriteAll_(ss, LA.GAME_PICKS, picks.filter((r) => r.DateKey >= from).sort((a, b) => (a.DateKey < b.DateKey ? -1 : 1)));
}
// The picks, after giving every upcoming play day (and any extra keys) a random game if it has none.
function laGamePicks_(ss, extraKeys) {
  let picks = laRead_(ss, LA.GAME_PICKS);
  const keys = laGameDays_(ss).concat(extraKeys || []).filter((k, i, a) => a.indexOf(k) === i).sort();
  const todo = keys.filter((k) => !picks.some((r) => r.DateKey === k && String(r.Game).trim()));
  if (!todo.length) return picks;
  const list = laGameList_(ss);
  todo.forEach((k) => {
    picks = picks.filter((r) => r.DateKey !== k);
    picks.push({ DateKey: k, Game: laGameRandom_(list, picks, k), Forced: '', SetAt: new Date().toISOString(), SetBy: 'Random' });
  });
  laGameWrite_(ss, picks);
  return picks;
}
function laGameFor_(ss, key) { const r = laGamePicks_(ss, [key]).find((x) => x.DateKey === key); return r ? String(r.Game) : ''; }
// Sets key's game (forced = an admin chose it). If the day's pairings are made and don't
// need Stableford, their game changes too (returns true then).
function laGameSet_(ss, key, game, forced, who) {
  const picks = laGamePicks_(ss, [key]).filter((r) => r.DateKey !== key);
  picks.push({ DateKey: key, Game: game, Forced: forced ? 'TRUE' : '', SetAt: new Date().toISOString(), SetBy: who || '' });
  laGameWrite_(ss, picks);
  const rec = laPairRead_(ss, key, 'nassau');
  if (!rec || rec.game === game) return false;
  const pl = laPairPlayers_(ss, key), nib = rec.notInBet || [];
  const betting = pl.playing.filter((x) => nib.indexOf(x.PlayerID) === -1).length;
  const lay = laPairLayout_(betting, pl.playing.length - betting, laNassauMaxGroups_(ss, key));
  if (lay && lay.stableford && /^stableford$/i.test(rec.game || '')) return false;
  laPairWrite_(ss, key, 'nassau', Object.assign({}, rec, { game: game }), rec.UpdatedBy, rec.EmailSentAt);
  return true;
}
function laGameView_(ss) {
  const picks = laGamePicks_(ss);
  return { list: laGameList_(ss), days: laGameDays_(ss).map((k) => {
    const r = picks.find((x) => x.DateKey === k) || {};
    return { key: k, game: String(r.Game || ''), forced: laIsTrue_(r.Forced, false), setBy: String(r.SetBy || ''), setAt: String(r.SetAt || '') };
  }) };
}
// p.op: 'force' (p.dateKey, p.game), 'random' (p.dateKey: a new random game), 'list' (p.list, one game per line).
// Returns the pairings view for p.viewKey.
function laGamesSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  let key = '', touched = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (p.op === 'list') {
      const raw = String(p.list || '').split(/\r?\n/).map((g) => g.trim().slice(0, 80)).filter(Boolean);
      const list = raw.filter((g, i) => raw.findIndex((x) => x.toLowerCase() === g.toLowerCase()) === i);
      if (list.length < 2) throw new Error('The game list needs at least two games.');
      laWriteAll_(ss, LA.GAME_LIST, list.map((g) => ({ Game: g })));
      logActivity_(ss, admin, 'Changed the Larry\'s Game list', list.length + ' games');
    } else if (p.op === 'force' || p.op === 'random') {
      key = laPairCheckKey_(p);
      let game;
      if (p.op === 'force') {
        game = String(p.game || '').trim().slice(0, 80);
        if (!game) throw new Error('Choose a game.');
      } else {
        const old = laGamePicks_(ss, [key]).find((r) => r.DateKey === key) || {};
        game = laGameRandom_(laGameList_(ss), laRead_(ss, LA.GAME_PICKS), key, old.Game);
      }
      touched = laGameSet_(ss, key, game, p.op === 'force', p.op === 'force' ? admin : 'Random (' + admin + ')');
      logActivity_(ss, admin, p.op === 'force' ? 'Set Larry\'s Game' : 'Picked a new random Larry\'s Game', laDateLabel_(key) + ' — ' + game);
    } else throw new Error('Unknown change.');
  } finally { lock.releaseLock(); }
  if (touched) laAfterNassauChange_(ss, key, true);
  const view = /^\d{4}-\d{2}-\d{2}$/.test(String(p.viewKey || '')) ? String(p.viewKey) : key || laTodayKey_();
  return laPairView_(ss, view);
}
// Everything the admin page shows for one date.
function laPairView_(ss, key) {
  const st = laSettings_(ss);
  const pl = laPairPlayers_(ss, key);
  const rec = laPairRead_(ss, key, 'nassau');
  const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key);
  const closure = laRead_(ss, LA.CLOSURES).find((c) => c.DateKey === key);
  const day = laDayInfo_(key, st, cfg, closure ? closure.Reason : '', '', laRead_(ss, LA.CLUB_TEE_TIMES), Date.now());
  const nibIds = rec ? rec.notInBet || [] : [];
  const betting = pl.playing.filter((x) => nibIds.indexOf(x.PlayerID) === -1).length;
  // anyone in the saved pairings who has since dropped out still needs a name
  const known = {}; pl.playing.concat(pl.standby).forEach((p) => { known[p.PlayerID] = p; });
  const roster = readRosterFull_(ss);
  const extra = [];
  const hc = rec ? readHandicaps_(ss) : {}, usual = rec ? signupTees_(ss) : {};
  if (rec) [].concat.apply([], (rec.teams || []).concat([rec.notInBet || []])).forEach((id) => {
    if (known[id]) return;
    const r = roster.find((x) => String(x.PlayerID) === String(id));
    // (2026-11-04) still show his tee, index and handicap, from the Handicaps tab
    const h = hc[String(id)] || {};
    const tee = HCP_TEES_.indexOf(h.Tee) !== -1 ? h.Tee : (usual[String(id)] || 'Gold');
    const ex = parseInt(h.ExtraStrokes, 10) || 0, ch = courseHandicap_(h.HandicapIndex, tee);
    known[id] = { PlayerID: String(id), Name: r ? r.Name : '(removed)', Tee: tee, HI: h.HandicapIndex || '', Extra: ex, CH: ch === null ? null : ch + ex, gone: true };
    extra.push(known[id]);
  });
  return { dateKey: key, closed: day.closed, teeTime: day.nassauTeeList[0] || (day.nassauTimes && day.nassauTimes !== 'times TBD' ? String(day.nassauTimes).split(' - ')[0] : 'TBD'),
    names: LA_PAIR_NAMES_, order: LA_PAIR_ORDER_, players: pl.playing, standby: pl.standby, gone: extra,
    betting: betting, layout: laPairLayout_(betting, pl.playing.length - betting, laNassauMaxGroups_(ss, key)), pairings: rec, prev: laPairPrev_(ss, key),
    games: laGameView_(ss),
    nassauEmail: laSentFor_(ss, LA.PRO_SHOP_LOG, key) ? { sentAt: (laNassauSentFor_(ss, key) || {}).SentAt || '', changed: laNassauChanged_(ss, key), tracked: !!laNassauLast_(key) } : null };
}
function laPairCheckKey_(p) {
  const key = String(p.dateKey || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Choose a date.');
  return key;
}
function laPairingsGet_(ss, p) { laRequireAdmin_(ss, p); return laPairView_(ss, laPairCheckKey_(p)); }
// ---------------- Fun Group pairings ----------------
// (Tom 2026-10-26) Made automatically when the round's sign-ups close, just before the
// pro shop list goes so the list shows the groups, or with "Make pairings". Groups are
// 4s and 3s, as even as possible, fuller groups first. Each try is scored, lower is better:
//  - nobody alone on a nine: a group where only one player is on the front nine (its
//    18-hole and front-9 players) or on the back nine costs 100000 for that nine;
//  - same tees: 40 for each step between the group's furthest-apart tees (HCP_TEES_ order);
//  - playing together often: each pair who were in the same group (Fun or Nassau) in the
//    last LA_FUN_HISTORY_ rounds costs 300 for the latest round, less for older ones;
//  - nine-hole players (Tom 2026-10-27): at most one in a foursome (each extra one costs
//    20000), and none in a threesome unless it's all nine-hole players (20000 each: the
//    18-hole players would be left as a twosome after the turn);
//  - carts (Tom 2026-10-27): a foursome of three riders and one walker costs 250;
//  - tee order wishes: someone asking for the first group with someone asking for the
//    last costs 500, and a nine-hole player with someone asking for the last group 60.
//  (Handicap is deliberately NOT a rule: mixing high and low handicappers is fine in the
//  Fun group. The similar-handicaps rule of 2026-10-28 was removed 2026-11-15.)
// Then the groups are put in tee order (laFunOrder_): a group with someone who asked for
// the last group goes last, one who asked for the first group goes first, and otherwise
// groups with nine-hole players go out first (Tom 2026-10-27). Players ask in their
// sign-up note ("last group please"), read by laFunWish_.
// Saved in Pairings with Group 'fun': { teams, madeAt, madeBy, edited }. edited = an
// admin changed them by hand.
const LA_FUN_HISTORY_ = 8;
const LA_FUN_ALONE_ = 100000;
// Handicap Index as a number (a plus index is below zero), or null if there isn't one.
function laFunHi_(p) {
  const t = String((p && p.HI) || '').trim();
  if (!t) return null;
  const n = parseFloat(t.replace('+', ''));
  return isNaN(n) ? null : (t[0] === '+' ? -n : n);
}
function laFunSizes_(n) {
  if (!n) return [];
  const g = Math.ceil(n / 4), base = Math.floor(n / g), rem = n % g, out = [];
  for (let i = 0; i < g; i++) out.push(i < rem ? base + 1 : base);
  return out;
}
function laFunNine_(p) { return p && (p.Holes === 'F9' || p.Holes === 'B9') ? p.Holes : '18'; }
// 'first', 'last' or '' from the player's sign-up note, e.g. "last group please",
// "early tee time if possible", "first group".
function laFunWish_(p) {
  const t = String((p && p.Comment) || '').toLowerCase();
  if (/\b(last|latest|later|late)\b[\w\s]{0,15}\b(group|tee|time|off|foursome)\b|\bgo(ing)? (out )?last\b/.test(t)) return 'last';
  if (/\b(first|earliest|earlier|early)\b[\w\s]{0,15}\b(group|tee|time|off|foursome)\b|\bgo(ing)? (out )?first\b/.test(t)) return 'first';
  return '';
}
// Tee order: last-group wishes last, first-group wishes first, then nine-hole players first.
function laFunOrder_(teams, byId) {
  const key = (t) => {
    const ps = t.map((id) => byId[id]).filter(Boolean);
    const w = ps.map(laFunWish_);
    return (w.indexOf('last') !== -1 ? 1000 : 0) - (w.indexOf('first') !== -1 ? 100 : 0) - ps.filter((p) => laFunNine_(p) !== '18').length;
  };
  return teams.map((t, i) => ({ t: t, k: key(t), i: i })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.t);
}
function laFunPairKey_(a, b) { a = String(a); b = String(b); return a < b ? a + '|' + b : b + '|' + a; }
// { 'a|b': { cost, last } } for pairs who were in the same group in recent rounds.
function laFunHistory_(ss, key) {
  const rows = laRead_(ss, LA.PAIRINGS).filter((x) => x.DateKey < key);
  const dates = rows.map((x) => x.DateKey).filter((d, i, a) => a.indexOf(d) === i).sort().reverse().slice(0, LA_FUN_HISTORY_);
  const out = {};
  rows.forEach((x) => {
    const r = dates.indexOf(x.DateKey);
    if (r === -1) return;
    let d;
    try { d = JSON.parse(x.Data || '{}'); } catch (e) { return; }
    const w = Math.round(300 * (LA_FUN_HISTORY_ - r) / LA_FUN_HISTORY_);
    (d.teams || []).forEach((t) => t.forEach((a, i) => t.slice(i + 1).forEach((b) => {
      const k = laFunPairKey_(a, b);
      const o = out[k] || (out[k] = { cost: 0, last: '' });
      o.cost += w;
      if (x.DateKey > o.last) o.last = x.DateKey;
    })));
  });
  return out;
}
// aloneOnly: count only players left alone on a nine (to fix that with the fewest moves).
function laFunTeamScore_(t, byId, hist, aloneOnly) {
  const ps = t.map((id) => byId[id]).filter(Boolean);
  if (!ps.length) return 0;
  let s = 0;
  const n18 = ps.filter((p) => laFunNine_(p) === '18').length;
  const front = n18 + ps.filter((p) => laFunNine_(p) === 'F9').length;
  const back = n18 + ps.filter((p) => laFunNine_(p) === 'B9').length;
  if (ps.length > 1) { if (front === 1) s += LA_FUN_ALONE_; if (back === 1) s += LA_FUN_ALONE_; }
  if (aloneOnly) return s;
  const nines = ps.length - n18;
  if (ps.length === 4 && nines > 1) s += 20000 * (nines - 1);
  if (ps.length === 3 && nines > 0 && nines < 3) s += 20000 * nines; // the others would finish as a twosome
  const ti = ps.map((p) => Math.max(0, HCP_TEES_.indexOf(p.Tee)));
  s += 40 * (Math.max.apply(null, ti) - Math.min.apply(null, ti));
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) { const h = hist[laFunPairKey_(t[i], t[j])]; if (h) s += h.cost; }
  if (ps.length === 4 && ps.filter((p) => p.Riding === 'TRUE').length === 3) s += 250;
  const w = ps.map(laFunWish_);
  if (w.indexOf('last') !== -1) { if (w.indexOf('first') !== -1) s += 500; s += 60 * ps.filter((p) => laFunNine_(p) !== '18').length; }
  return s;
}
function laFunScore_(teams, byId, hist) { return teams.reduce((a, t) => a + laFunTeamScore_(t, byId, hist), 0); }
// Swaps players between groups while that lowers the score (changes `teams` in place).
function laFunImprove_(teams, byId, hist, aloneOnly) {
  const ts = teams.map((t) => laFunTeamScore_(t, byId, hist, aloneOnly));
  let better = true;
  for (let pass = 0; better && pass < 20; pass++) {
    better = false;
    for (let a = 0; a < teams.length; a++) for (let b = a + 1; b < teams.length; b++) {
      for (let i = 0; i < teams[a].length; i++) for (let j = 0; j < teams[b].length; j++) {
        const x = teams[a][i];
        teams[a][i] = teams[b][j]; teams[b][j] = x;
        const sa = laFunTeamScore_(teams[a], byId, hist, aloneOnly), sb = laFunTeamScore_(teams[b], byId, hist, aloneOnly);
        if (sa + sb < ts[a] + ts[b]) { ts[a] = sa; ts[b] = sb; better = true; } else { teams[b][j] = teams[a][i]; teams[a][i] = x; }
      }
    }
  }
  return ts.reduce((s, x) => s + x, 0);
}
// Random starts, each improved by swapping players between groups while that helps.
function laFunMake_(players, hist, restarts) {
  const byId = {}; players.forEach((p) => { byId[p.PlayerID] = p; });
  const sizes = laFunSizes_(players.length);
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  let best = null;
  for (let r = 0; r < (restarts || 30); r++) {
    const ids = shuffle(players.map((p) => p.PlayerID));
    const teams = [];
    let at = 0;
    sizes.forEach((n) => { teams.push(ids.slice(at, at + n)); at += n; });
    const score = laFunImprove_(teams, byId, hist);
    if (!best || score < best.score) best = { teams: teams.map((t) => t.slice()), score: score };
  }
  return best || { teams: [], score: 0 };
}
function laFunGenerate_(ss, key, who) {
  const pl = laPairPlayers_(ss, key, 'fun').playing;
  const made = laFunMake_(pl, laFunHistory_(ss, key));
  const byId = {}; pl.forEach((p) => { byId[p.PlayerID] = p; });
  made.teams = laFunOrder_(made.teams, byId);
  const old = laPairRead_(ss, key, 'fun');
  laPairWrite_(ss, key, 'fun', { teams: made.teams, madeAt: new Date().toISOString(), madeBy: who, edited: false }, who, old ? old.EmailSentAt : '');
  return made;
}
// After someone drops out of, joins or changes their Fun group sign-up. Pairings nobody
// has changed by hand, for a round whose pro shop list hasn't gone, are made again from
// scratch. Otherwise as few people as possible move: whoever left is taken out and a
// newcomer goes in the group that suits him best. If that leaves someone alone on a nine,
// players are swapped until it's fixed; if it still isn't (or a group is down to one),
// they're made again after all.
function laFunRefresh_(ss, key) {
  if (key < laTodayKey_()) return;
  const rec = laPairRead_(ss, key, 'fun');
  if (!rec) return;
  const pl = laPairPlayers_(ss, key, 'fun').playing;
  const byId = {}; pl.forEach((p) => { byId[p.PlayerID] = p; });
  const hist = laFunHistory_(ss, key);
  const was = [].concat.apply([], rec.teams || []).map(String);
  const same = was.length === pl.length && was.every((id) => byId[id]);
  if (same && laFunScore_(rec.teams, byId, hist) < LA_FUN_ALONE_) return; // nothing that matters changed
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const sent = laRead_(ss, LA.PRO_SHOP_LOG).some((r) => r.DateKey === key);
    if (!pl.length) { laPairWrite_(ss, key, 'fun', Object.assign({}, rec, { teams: [] }), 'Automatic', rec.EmailSentAt); return; }
    if (!rec.edited && !sent) {
      laFunGenerate_(ss, key, 'Automatic');
      logActivity_(ss, 'System', 'Remade Fun group pairings', laDateLabel_(key) + ' — the sign-ups changed');
      return;
    }
    const teams = (rec.teams || []).map((t) => t.map(String).filter((id) => byId[id])).filter((t) => t.length);
    const placed = {}; teams.forEach((t) => t.forEach((id) => { placed[id] = true; }));
    pl.filter((p) => !placed[p.PlayerID]).forEach((p) => {
      let bi = -1, bs = 0;
      teams.forEach((t, i) => {
        if (t.length >= 4) return;
        t.push(p.PlayerID);
        const s = laFunScore_(teams, byId, hist);
        t.pop();
        if (bi === -1 || s < bs) { bi = i; bs = s; }
      });
      if (bi === -1) teams.push([p.PlayerID]); else teams[bi].push(p.PlayerID);
    });
    if (laFunScore_(teams, byId, hist) >= LA_FUN_ALONE_) {
      // fix it with the fewest moves: only swaps that stop someone being alone
      const plain = teams.map((t) => t.slice());
      if (laFunImprove_(plain, byId, hist, true) < LA_FUN_ALONE_) plain.forEach((t, i) => { teams[i] = t; });
    }
    if ((pl.length > 1 && teams.some((t) => t.length === 1)) || laFunScore_(teams, byId, hist) >= LA_FUN_ALONE_) {
      laFunGenerate_(ss, key, 'Automatic');
      logActivity_(ss, 'System', 'Remade Fun group pairings', laDateLabel_(key) + ' — the sign-ups changed and the groups no longer worked');
      return;
    }
    laPairWrite_(ss, key, 'fun', Object.assign({}, rec, { teams: teams }), 'Automatic', rec.EmailSentAt);
    logActivity_(ss, 'System', 'Updated Fun group pairings', laDateLabel_(key) + ' — the sign-ups changed');
  } finally { lock.releaseLock(); }
}
// Admin > Pairings > Fun Group: who is signed up, the groups, and whether the pro shop
// list still matches them.
function laFunView_(ss, key) {
  const st = laSettings_(ss);
  const pl = laPairPlayers_(ss, key, 'fun');
  const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === key);
  const closure = laRead_(ss, LA.CLOSURES).find((c) => c.DateKey === key);
  const day = laDayInfo_(key, st, cfg, closure ? closure.Reason : '', '', laRead_(ss, LA.CLUB_TEE_TIMES), Date.now());
  const rec = laPairRead_(ss, key, 'fun');
  const hist = laFunHistory_(ss, key);
  // pairs in the same group who played together recently, for the page to point out
  const together = {};
  if (rec) (rec.teams || []).forEach((t) => t.forEach((a, i) => t.slice(i + 1).forEach((b) => { const h = hist[laFunPairKey_(a, b)]; if (h) together[laFunPairKey_(a, b)] = h.last; })));
  const log = laRead_(ss, LA.PRO_SHOP_LOG).filter((r) => r.DateKey === key).sort((a, b) => (a.SentAt < b.SentAt ? 1 : -1));
  return { dateKey: key, closed: day.closed, times: day.funTimes, teeList: day.funTeeList, slots: day.funSlots, closesAt: day.closesAt,
    players: pl.playing, standby: pl.standby, pairings: rec, together: together, recent: hist,
    proShop: log.length ? { sentAt: log[0].SentAt, sentBy: log[0].SentBy, changed: laProShopChanged_(ss, key) } : null,
    funEmail: log.length ? { sentAt: (laFunEmailSentFor_(ss, key) || {}).SentAt || '', changed: laFunEmailChanged_(ss, key), tracked: !!laFunEmailLast_(key) } : null };
}
function laFunGet_(ss, p) { laRequireAdmin_(ss, p); return laFunView_(ss, laPairCheckKey_(p)); }
function laFunMakeAdmin_(ss, p) {
  const admin = laRequireAdmin_(ss, p), key = laPairCheckKey_(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const made = laFunGenerate_(ss, key, admin);
    logActivity_(ss, admin, 'Made Fun group pairings', laDateLabel_(key) + ' — ' + made.teams.length + ' groups');
  } finally { lock.releaseLock(); }
  return laFunView_(ss, key);
}
// p.teams [[PlayerID...]] in tee order.
function laFunSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p), key = laPairCheckKey_(p);
  const teams = JSON.parse(p.teams || '[]');
  if (!Array.isArray(teams) || teams.length > 8) throw new Error('At most eight groups.');
  const seen = {};
  teams.forEach((t) => {
    if (!Array.isArray(t)) throw new Error('Bad groups.');
    if (t.length > 4) throw new Error('A group can have at most 4 players.');
    t.forEach((id) => { if (seen[id]) throw new Error('A player is in two groups — check the swap table.'); seen[id] = true; });
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const old = laPairRead_(ss, key, 'fun') || {};
    laPairWrite_(ss, key, 'fun', { teams: teams.map((t) => t.map(String)).filter((t) => t.length), madeAt: old.madeAt || new Date().toISOString(), madeBy: old.madeBy || admin, edited: true }, admin, old.EmailSentAt);
    logActivity_(ss, admin, 'Changed Fun group pairings', laDateLabel_(key));
  } finally { lock.releaseLock(); }
  laAfterFunChange_(ss, key);
  return laFunView_(ss, key);
}
// Admin adds a Legend to the Fun group (Tom 2026-10-27: someone on the range deciding at
// the last minute), even after sign-ups close, into a group with room (p.team, or the
// best one). Only while the Fun group has a free spot, so nobody on standby is passed over.
function laFunAddAdmin_(ss, p) {
  const admin = laRequireAdmin_(ss, p), key = laPairCheckKey_(p);
  const st = laSettings_(ss);
  const pl = laPairPlayers_(ss, key, 'fun');
  const cap = laCapacity_(ss, st, key, 'fun', []);
  if (pl.playing.length >= cap.slots) throw new Error('The Fun group is full (' + cap.slots + ' spots). Remove someone first, or move someone up from standby.');
  const want = p.team === 'new' ? -1 : (p.team !== undefined && p.team !== '' ? Number(p.team) : NaN);
  const before = laPairRead_(ss, key, 'fun');
  if (before && !isNaN(want) && want >= 0) {
    const ids = {}; pl.playing.forEach((x) => { ids[x.PlayerID] = true; });
    const t = (before.teams || [])[want];
    if (!t || t.map(String).filter((x) => ids[x]).length >= 4) throw new Error('That group is full — pick another.');
  }
  const viewer = { isAdmin: true, acting: true, adminName: admin, member: null };
  laJoin_(ss, viewer, { group: 'fun', dateKey: key, playerId: p.playerId, signupId: 'fa' + Utilities.getUuid().replace(/-/g, '').slice(0, 20),
    tee: p.tee || '', holes: p.holes || '18', riding: p.riding, note: p.note || '', skipAfter: true, noBoard: true });
  const id = String(p.playerId);
  const rec = laPairRead_(ss, key, 'fun');
  if (rec && (rec.teams || []).length) {
    const now = laPairPlayers_(ss, key, 'fun').playing;
    const byId = {}; now.forEach((x) => { byId[x.PlayerID] = x; });
    const teams = rec.teams.map((t) => t.map(String).filter((x) => byId[x] && x !== id)).filter((t) => t.length);
    let at = want;
    if (!isNaN(at) && at >= 0 && (!teams[at] || teams[at].length >= 4)) at = NaN; // changed meanwhile: best group instead
    if (isNaN(at)) { // the group that suits him best
      const hist = laFunHistory_(ss, key);
      let bs = 0; at = -1;
      teams.forEach((t, i) => { if (t.length >= 4) return; t.push(id); const sc = laFunScore_(teams, byId, hist); t.pop(); if (at === -1 || sc < bs) { at = i; bs = sc; } });
    }
    if (at === -1) teams.push([id]); else teams[at].push(id);
    laPairWrite_(ss, key, 'fun', Object.assign({}, rec, { teams: teams, edited: true }), admin, rec.EmailSentAt);
  }
  logActivity_(ss, admin, 'Added to Fun group pairings', laDateLabel_(key));
  laAfterFunChange_(ss, key);
  return laFunView_(ss, key);
}
// Admin takes a player off the Fun group (Tom 2026-10-27: a no-show, a medical emergency…),
// even after sign-ups close. p.record: 'late' (the usual late drop-out record), 'noshow',
// or 'none'. The first on standby moves up and is emailed, as when anyone drops out.
function laFunRemoveAdmin_(ss, p) {
  const admin = laRequireAdmin_(ss, p), key = laPairCheckKey_(p);
  const row = laRead_(ss, LA.SIGNUPS).find((s) => s.DateKey === key && s.Group === 'fun' && String(s.PlayerID) === String(p.playerId));
  if (!row) throw new Error('That player isn\'t signed up for the Fun group that day.');
  const rec = String(p.record || 'late');
  laLeave_(ss, { isAdmin: true, acting: true, adminName: admin, member: null }, { signupId: row.SignupID, noBoard: true, noRecord: rec !== 'late' });
  if (rec === 'noshow') laAttendanceAdd_(ss, row, 'noshow', admin);
  return laFunView_(ss, key);
}
// Hourly: once a round's sign-ups have closed, make its Fun group pairings if there are
// none yet (runs before the pro shop list, so the list shows the groups).
function laFunHourly_(ss) {
  const st = laSettings_(ss), today = laTodayKey_();
  const closed = {}; laRead_(ss, LA.CLOSURES).forEach((c) => { closed[c.DateKey] = true; });
  const cfgs = laRead_(ss, LA.DAY_CONFIG), clubTimes = laRead_(ss, LA.CLUB_TEE_TIMES);
  for (let i = 0; i <= 7; i++) {
    const key = laAddDays_(today, i);
    if (!laIsPlayDay_(key) || closed[key] || laPairRead_(ss, key, 'fun')) continue;
    const info = laDayInfo_(key, st, cfgs.find((c) => c.DateKey === key), '', '', clubTimes, Date.now());
    if (Date.now() <= info.closesAt) continue;
    if (laPairPlayers_(ss, key, 'fun').playing.length < 2) continue;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return;
    try {
      if (laPairRead_(ss, key, 'fun')) continue;
      const made = laFunGenerate_(ss, key, 'Automatic');
      logActivity_(ss, 'System', 'Made Fun group pairings', laDateLabel_(key) + ' — ' + made.teams.length + ' groups (automatic, sign-ups closed)');
    } finally { lock.releaseLock(); }
  }
}

// ---------------- after a sign-up changes ----------------
// Called once a join, drop-out or change for a Fun or Nassau round has been saved.
function laAfterSignupChange_(ss, key, group) {
  if (group !== 'fun' && group !== 'nassau') return;
  if (group === 'fun') {
    try { laFunRefresh_(ss, key); } catch (err) { Logger.log('Fun pairings not updated: ' + err.message); }
    laAfterFunChange_(ss, key); // Fun group changes don't go to the Nassau group (Tom 2026-10-28)
    return;
  }
  laAfterNassauChange_(ss, key); // and Nassau changes don't go to the Fun group
}

// ---------------- late drop-outs and no-shows ----------------
// (Tom 2026-10-26) Late drop-outs are recorded automatically: anyone who leaves a round
// they had a spot in after its sign-ups closed. No-shows are ticked by an admin on
// Admin > Pairings > No-shows. Both go in the Attendance tab.
function laAttendanceAdd_(ss, row, kind, by) {
  laAppend_(ss, LA.ATTENDANCE, { RecordID: Utilities.getUuid(), DateKey: row.DateKey, Group: row.Group, PlayerID: row.PlayerID, Name: row.Name,
    Kind: kind, RecordedAt: new Date().toISOString(), RecordedBy: by });
}
function laAttendanceView_(ss) {
  const today = laTodayKey_(), from = laAddDays_(today, -28);
  const st = laSettings_(ss), signups = laRead_(ss, LA.SIGNUPS), rec = laRead_(ss, LA.ATTENDANCE);
  const closed = {}; laRead_(ss, LA.CLOSURES).forEach((c) => { closed[c.DateKey] = true; });
  const dates = [];
  for (let k = today; k >= from; k = laAddDays_(k, -1)) {
    if (!laIsPlayDay_(k) || closed[k]) continue;
    const players = [];
    ['fun', 'nassau'].forEach((g) => {
      const cap = laCapacity_(ss, st, k, g, []);
      laGroupList_(signups, k, g).slice(0, cap.slots).forEach((s) => players.push({ PlayerID: String(s.PlayerID), Name: s.Name, Group: g }));
    });
    if (players.length) dates.push({ dateKey: k, players: players });
  }
  return { dates: dates, records: rec.filter((r) => r.DateKey >= laAddDays_(today, -400)).sort((a, b) => (a.DateKey < b.DateKey ? 1 : -1)) };
}
function laAttendanceGet_(ss, p) { laRequireAdmin_(ss, p); return laAttendanceView_(ss); }
// p.dateKey + p.noShows [PlayerID] replaces that day's no-shows; p.remove [RecordID] deletes records.
function laAttendanceSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let all = laRead_(ss, LA.ATTENDANCE);
    const remove = JSON.parse(p.remove || '[]');
    if (remove.length) {
      const gone = all.filter((r) => remove.indexOf(r.RecordID) !== -1);
      all = all.filter((r) => remove.indexOf(r.RecordID) === -1);
      gone.forEach((r) => logActivity_(ss, admin, 'Removed attendance record', displayName_(r.Name) + ' — ' + (r.Kind === 'noshow' ? 'no-show' : 'late drop-out') + ', ' + laDateLabel_(r.DateKey)));
    }
    if (p.dateKey) {
      const key = laPairCheckKey_(p);
      if (key > laTodayKey_()) throw new Error('No-shows can only be marked once the day has come.');
      const ids = JSON.parse(p.noShows || '[]').map(String);
      const day = (laAttendanceView_(ss).dates.find((d) => d.dateKey === key) || { players: [] }).players;
      const before = all.filter((r) => r.DateKey === key && r.Kind === 'noshow').map((r) => String(r.PlayerID));
      all = all.filter((r) => !(r.DateKey === key && r.Kind === 'noshow'));
      ids.forEach((id) => {
        const pl = day.find((x) => x.PlayerID === id);
        if (!pl) return;
        all.push({ RecordID: Utilities.getUuid(), DateKey: key, Group: pl.Group, PlayerID: id, Name: pl.Name, Kind: 'noshow', RecordedAt: new Date().toISOString(), RecordedBy: admin });
      });
      const added = ids.filter((id) => before.indexOf(id) === -1), dropped = before.filter((id) => ids.indexOf(id) === -1);
      if (added.length || dropped.length) logActivity_(ss, admin, 'Marked no-shows', laDateLabel_(key) + ' — ' + ids.length + ' no-show' + (ids.length === 1 ? '' : 's'));
    }
    laWriteAll_(ss, LA.ATTENDANCE, all);
  } finally { lock.releaseLock(); }
  return laAttendanceView_(ss);
}

function laPairingsMake_(ss, p) {
  const admin = laRequireAdmin_(ss, p), key = laPairCheckKey_(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const made = laPairGenerate_(ss, key, admin);
    logActivity_(ss, admin, 'Made Nassau pairings', laDateLabel_(key) + ' — ' + made.teams.length + ' pairings' + (made.repeats ? ', ' + made.repeats + ' repeat partner pair(s)' : ''));
  } finally { lock.releaseLock(); }
  laAfterNassauChange_(ss, key, true);
  return laPairView_(ss, key);
}
// p.teams [[ids]], p.blinds [{playerId, team}], p.notInBet [ids], p.game, p.extra {id: strokes}
function laPairingsSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p), key = laPairCheckKey_(p);
  const teams = JSON.parse(p.teams || '[]'), blinds = JSON.parse(p.blinds || '[]'), notInBet = JSON.parse(p.notInBet || '[]');
  const extra = JSON.parse(p.extra || '{}'), playsWithIn = JSON.parse(p.playsWith || '{}');
  if (!Array.isArray(teams) || teams.length > 6) throw new Error('At most six pairings.');
  const playsWith = {};
  notInBet.forEach((id) => { const w = Number(playsWithIn[id]); if (playsWithIn[id] !== undefined && playsWithIn[id] !== '' && teams[w] && teams[w].length) playsWith[String(id)] = w; });
  const seen = {};
  teams.concat([notInBet]).forEach((t) => t.forEach((id) => { if (seen[id]) throw new Error('A player is in two places — check the swap table.'); seen[id] = true; }));
  teams.forEach((t) => { if (t.length > 4) throw new Error('A pairing can have at most 4 players.'); });
  blinds.forEach((b) => {
    if (!teams[b.team]) throw new Error('A blind is set for a pairing that has no players.');
    if (teams[b.team].indexOf(String(b.playerId)) !== -1) throw new Error('A blind must come from a different pairing.');
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const old = laPairRead_(ss, key, 'nassau') || {};
    const game = String(p.game || '').trim().slice(0, 80);
    laPairWrite_(ss, key, 'nassau', Object.assign({}, old, { teams: teams.map((t) => t.map(String)), blinds: blinds.map((b) => ({ playerId: String(b.playerId), team: Number(b.team) })),
      notInBet: notInBet.map(String), playsWith: playsWith, game: game }), admin, old.EmailSentAt);
    // a game typed here becomes the day's Larry's Game (kept if the pairings are redone)
    if (game && game !== (old.game || '') && !/^stableford$/i.test(game)) laGameSet_(ss, key, game, true, admin);
    const ids = Object.keys(extra);
    if (ids.length) {
      const hc = readHandicaps_(ss);
      let changed = false;
      ids.forEach((id) => {
        const n = parseInt(extra[id], 10);
        const v = isNaN(n) || n <= 0 ? '' : String(Math.min(n, 18));
        const cur = hc[id] || { HandicapIndex: '', Tee: '', ExtraStrokes: '' };
        if (String(cur.ExtraStrokes || '') !== v) { hc[id] = Object.assign({}, cur, { ExtraStrokes: v }); changed = true; }
      });
      if (changed) objectsToSheet_(ensureHandicapsSheet_(ss), HANDICAP_HEADERS, Object.keys(hc).map((k) => Object.assign({ PlayerID: k }, hc[k])));
    }
    logActivity_(ss, admin, 'Changed Nassau pairings', laDateLabel_(key));
  } finally { lock.releaseLock(); }
  laAfterNassauChange_(ss, key, true);
  return laPairView_(ss, key);
}
// The "Larry's Game" email for one date, with its recipients from the Pairings* settings:
// { subject, html, to, cc, bccCount, mails, total, sentAt }.
function laPairEmail_(ss, key, st) {
  st = st || laSettings_(ss);
  const c = laComposeEmails_(ss, 'pairings', key, st);
  if (c.closed) throw new Error('No Legends tee times on ' + laDateLabel_(key) + ' (' + c.closed + ').');
  if (c.noPairings) throw new Error('Make the pairings first.');
  if (!c.mails.length) throw new Error('Nobody would get this email — tick who gets it under Email settings.');
  const m0 = c.mails[0], rec = laPairRead_(ss, key, 'nassau');
  return { subject: m0.subject, html: m0.html, mails: c.mails, to: laShortList_(m0.to), cc: laShortList_(m0.cc), bccCount: m0.bcc.length,
    total: c.mails.reduce((a, x) => a + laMailCount_(x), 0), sentAt: (rec && rec.EmailSentAt) || '' };
}
// The email itself: { subject, html }, or { none: true } before the pairings are made.
function laPairBody_(ss, key, st) {
  const v = laPairView_(ss, key);
  const rec = v.pairings;
  if (!rec || !(rec.teams || []).length) return { none: true, subject: '', html: '' };
  const byId = {}; v.players.concat(v.standby, v.gone).forEach((x) => { byId[x.PlayerID] = x; });
  const lastOf = (n) => String(n || '').split(',')[0].trim();
  const lastCount = {}; v.players.forEach((x) => { const l = lastOf(x.Name).toLowerCase(); lastCount[l] = (lastCount[l] || 0) + 1; });
  const short = (x) => { const l = lastOf(x.Name), f = String(x.Name).split(',').slice(1).join(',').trim(); return lastCount[l.toLowerCase()] > 1 && f ? l + ' ' + f[0] : l; };
  const label = (x) => laEsc_(short(x)) + (x.Tee ? ' <span style="color:#666;font-size:12px;">(' + laEsc_(LA_TEE_ABBR_[x.Tee] || x.Tee) + ')</span>' : '');
  const chTxt = (x) => (x.CH === null || x.CH === undefined ? '–' : x.CH < 0 ? '+' + (-x.CH) : String(x.CH));
  // (Tom 2026-11-04) Anyone who has dropped out since the pairings were made is left out.
  const playingIds = {}; v.players.forEach((x) => { playingIds[x.PlayerID] = true; });
  const T = rec.teams.map((t) => t.filter((id) => playingIds[id]));
  const blinds = (rec.blinds || []).filter((b) => playingIds[b.playerId]);
  const teams = T.filter((t) => t.length);
  const inPlay = [].concat.apply([], teams).map((id) => byId[id]).filter(Boolean);
  const nBlinds = blinds.length;
  const place = laPairPlaceNib_(T, rec.notInBet, rec.playsWith, playingIds);
  const nibAll = (rec.notInBet || []).filter((id) => playingIds[id] && byId[id]).length;
  const allFour = teams.every((t) => t.length === 4);
  const cell = 'padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap;';
  const rows = T.map((t, i) => {
    if (!t.length) return '';
    // the pairing's players and its blind by index, so the blind sits in the open column
    const bl = {}; blinds.filter((b) => b.team === i).forEach((b) => { bl[b.playerId] = true; });
    const ids = t.concat(Object.keys(bl)).sort((a, b) => laIdxSort_((byId[a] || {}).HI) - laIdxSort_((byId[b] || {}).HI));
    // [name, handicap] per entry; past four, extras share the last cell so the grid lines up
    const ent = ids.filter((id) => byId[id]).map((id) => { const x = byId[id]; return bl[id] ? ['<i>Blind: ' + label(x) + '</i>', '<i>' + chTxt(x) + '</i>'] : [label(x), '<b>' + chTxt(x) + '</b>']; });
    Object.keys(place).filter((id) => place[id] === i && byId[id]).forEach((id) => ent.push([label(byId[id]) + ' <i style="color:#666;">(not in bet)</i>', '<span style="color:#666;">' + chTxt(byId[id]) + '</span>']));
    while (ent.length > 4) { const x = ent.pop(); ent[3] = [ent[3][0] + '<br>' + x[0], ent[3][1] + '<br>' + x[1]]; }
    while (ent.length < 4) ent.push(['', '']);
    const cells = ent.map((x) => '<td style="' + cell + '">' + x[0] + '</td><td style="' + cell + 'text-align:right;">' + x[1] + '</td>');
    return '<tr>' + cells.join('') + '<td style="' + cell + 'text-align:center;font-weight:700;">' + LA_PAIR_ORDER_[i] + '</td></tr>';
  }).join('');
  const d = new Date(key + 'T12:00:00Z');
  const dateTxt = (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '/' + d.getUTCFullYear();
  const yellow = 'background:#fff3a0;';
  // One table, so the Tee Order box always sits right above the A/K/Q/J/10/9 column.
  const hb = 'border:1px solid #333;padding:6px 10px;';
  const head = '<tr><td colspan="2" style="' + hb + 'font-weight:700;color:#2e5d34;font-size:16px;white-space:nowrap;">Larry\'s Game</td>' +
    '<td colspan="4" style="' + hb + yellow + 'font-weight:700;text-align:center;">' + laEsc_(rec.game || '') + '</td>' +
    '<td colspan="2" style="' + hb + yellow + 'color:#b0127f;font-weight:700;white-space:nowrap;">Tee time: ' + laEsc_(v.teeTime) + '</td>' +
    '<td rowspan="2" style="' + hb + 'text-align:center;font-size:12px;">Tee<br>Order</td></tr>' +
    '<tr><td colspan="2" style="' + hb + 'color:#6b2fa0;font-weight:700;">' + dateTxt + '</td>' +
    '<td colspan="6" style="' + hb + yellow + 'text-align:center;font-weight:700;">' + (inPlay.length + nibAll) + ' Players' + (nibAll ? ', ' + inPlay.length + ' in the bet,' : '') + ' ' + teams.length + (allFour ? ' foursomes' : ' pairings') + (nBlinds ? ' (' + nBlinds + ' blind' + (nBlinds === 1 ? '' : 's') + ')' : '') + '</td></tr>' +
    '<tr><td colspan="9" style="height:8px;"></td></tr>';
  const sb = v.standby.length ? v.standby.map((x) => laEsc_(short(x))).join(', ') : 'None';
  const nib = (rec.notInBet || []).filter((id) => playingIds[id]).map((id) => byId[id]).filter(Boolean);
  const nibLoose = nib.filter((x) => place[x.PlayerID] === undefined);
  // STANDBY on its own row above the tees key, in the same table as the pairings so both
  // reach its full width (Tom 2026-11-05, 2026-11-06).
  const grid = '<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">' + head + rows +
    '<tr><td colspan="9" style="height:14px;"></td></tr>' +
    '<tr><td colspan="9" style="border:1px solid #333;padding:6px 10px;font-size:13px;' + yellow + '"><b>STANDBY:</b> ' + sb + '</td></tr>' +
    '<tr><td colspan="9" style="border:1px solid #333;padding:6px 10px;font-size:13px;">Tees: R = Red, G/R = Gold/Red, G = Gold, W/G = White/Gold, W = White, B/W = Blue/White, B = Blue</td></tr></table>';
  const notes = (nibLoose.length ? '<p style="font-family:Arial,sans-serif;font-size:13px;">Playing, not in the bet: ' + nibLoose.map((x) => laEsc_(short(x))).join(', ') + '</p>' : '');
  const byIdx = inPlay.concat(nib).sort((a, b) => laIdxSort_(a.HI) - laIdxSort_(b.HI));
  const idxTable = laIdxTable_(byIdx, (x) => laEsc_(short(x)), chTxt);
  const html = '<div>' + laMsg_(st.PairingsMessage, 'font-family:Arial,sans-serif;font-size:14px;') + grid + notes + idxTable +
    (laIsTrue_(st.PairingsAppLink, true) && st.SiteUrl ? '<p style="font-family:Arial,sans-serif;font-size:13px;margin-top:16px;"><a href="' + laEsc_(st.SiteUrl) + '">Open the Legends app</a></p>' : '') + '</div>';
  return { subject: 'Nassau Game-day Pairings and Larry\'s Game for ' + laLongDate_(key), html: html }; // Tom 2026-11-20
}
function laPairingsPreview_(ss, p) {
  laRequireAdmin_(ss, p);
  const e = laPairEmail_(ss, laPairCheckKey_(p));
  delete e.mails;
  return e;
}
function laPairingsSend_(ss, p) {
  const admin = laRequireAdmin_(ss, p), key = laPairCheckKey_(p);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { laPairSendNow_(ss, key, admin); } finally { lock.releaseLock(); }
  return laPairView_(ss, key);
}
// Sends the pairings email for key and marks it sent (caller holds the lock).
function laPairSendNow_(ss, key, who) {
  const st = laSettings_(ss);
  const e = laPairEmail_(ss, key, st);
  if (MailApp.getRemainingDailyQuota() < e.total + 1) throw new Error('Sending this needs ' + e.total + ' recipients, and the daily email limit doesn\'t have that many left.');
  laSendMails_(st, e.mails);
  const rec = laPairRead_(ss, key, 'nassau');
  laPairWrite_(ss, key, 'nassau', rec, rec.UpdatedBy, new Date().toISOString());
  if (laNassauLast_(key)) laNassauBaseline_(ss, key); // changes after this are against these pairings
  logActivity_(ss, who, 'Sent Nassau pairings email', laDateLabel_(key) + ' — ' + e.total + ' recipient' + (e.total === 1 ? '' : 's'));
}
// Hourly: from 6 AM on a play day, make that day's Nassau pairings once if no one has yet.
function laPairingsHourly_(ss) {
  const key = laTodayKey_();
  if (!laIsPlayDay_(key) || Number(Utilities.formatDate(new Date(), laTz_(), 'H')) < 6) return;
  if (laRead_(ss, LA.CLOSURES).some((c) => c.DateKey === key)) return;
  if (!laPairRead_(ss, key, 'nassau')) {
    const n = laPairPlayers_(ss, key).playing.length;
    if (!laPairLayout_(n, 0, laNassauMaxGroups_(ss, key))) return;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return;
    try {
      if (!laPairRead_(ss, key, 'nassau')) {
        laPairGenerate_(ss, key, 'Automatic');
        logActivity_(ss, 'System', 'Made Nassau pairings', laDateLabel_(key) + ' — ' + n + ' players (automatic, 6 AM)');
      }
    } finally { lock.releaseLock(); }
  }
  // the email, if it's set to go automatically and nobody has sent it yet
  const st = laSettings_(ss);
  if (String(st.PairingsAutoSend).toUpperCase() !== 'TRUE' || Number(Utilities.formatDate(new Date(), laTz_(), 'H')) < laNum_(st.PairingsHour, 7)) return;
  const rec = laPairRead_(ss, key, 'nassau');
  if (!rec || rec.EmailSentAt || !(rec.teams || []).length) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const again = laPairRead_(ss, key, 'nassau');
    if (again && !again.EmailSentAt) laPairSendNow_(ss, key, 'Automatic');
  } catch (err) { Logger.log('Pairings email: ' + err.message); } finally { lock.releaseLock(); }
}


// ---------------- Tournaments: $10, $5 and the Annual Tournament (Tom 2026-11-23) ----------------
// Rounds of golf that members sign up for like regular play, shown under Sign-ups (not Events).
// Set up on Admin > Setup > Tournaments (one row each in the Tournaments tab). Sign-ups go in the
// Signups tab with Group "tourn:<TournID>" and follow the event rules (sign-up order, standby).
//  - $10 Tournament: all 9 Legends tee times, Fun and Nassau players alike, 18-hole net, teams
//    balanced A/B/C/D by Handicap Index. Last Wednesday of April to August.
//  - Five Dollar Tournament: second Wednesday of May to September (Tom 2026-11-23), 4 tee times in the
//    Fun Group's place (Nassau plays as usual), same team balancing. Any member can play.
//  - Annual Tournament: sign-ups open on a date the admin chooses.
// On the tournament's date it takes the place of regular play: Who = all replaces the Fun and
// Nassau groups, Who = fun replaces the Fun Group only (the Nassau group plays as usual).
// Sign-ups open SignupOpens (blank = two weeks before) at the usual opening time and close at
// 11:59 PM on SignupCloses (blank = TournCloseDaysBefore before). Pairings are made when sign-ups
// close (if none yet); the "Tournament pairings" email goes the next morning at TournEmailHour,
// only with its switch TournEmailOn (default Off), to the players and the pro shop.
const LA_TOURN_KINDS_ = {
  ten: { title: 'Ten Dollar Tournament', teeTimes: 9, who: 'all' },
  five: { title: 'Five Dollar Tournament', teeTimes: 4, who: 'fun' },
  annual: { title: 'Annual Tournament', teeTimes: 9, who: 'all' },
};
const LA_TOURN_TEAM_NAMES_ = ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6', 'Team 7', 'Team 8', 'Team 9'];
// Which kind of tournament a teams/email request is about (for the limited-admin rights in Code.gs).
function laTournReqKind_(ss, p) {
  if (['legendsTournPairMake', 'legendsTournPairSave', 'legendsTournEmailSend'].indexOf(String(p.action)) === -1) return '';
  const t = laTournById_(ss, String(p.id || ''));
  return t ? (LA_TOURN_KINDS_[t.Kind] ? t.Kind : 'ten') : 'none';
}
// The kinds an admin may change: all for a Full admin; for a limited one, the tournaments ticked for them.
function laTournKindsFor_(ss, admin) {
  const role = adminRole_(ss, admin);
  if (!isLimitedRole_(role)) return Object.keys(LA_TOURN_KINDS_);
  return String(role).slice(6).split(',').filter((k) => /^tourn/.test(k)).map((k) => k.slice(5)).filter((k) => LA_TOURN_KINDS_[k]);
}
// Tournament formats (Tom 2026-11-23), from the committee's write-ups. Edited on Admin › Setup › Tournaments.
const LA_TOURN_FORMATS_DEFAULT_ = [
  { Name: "Four Man Captain's Choice", Description: "Teams of 4 (3 in a pinch), teeing off from their usual tees, without handicaps. Each player hits his drive and the Captain decides which drive to use. Each player then hits from that spot for the second shot, and the same for the third shot and so on until the team holes out. The team's GROSS score for each hole is posted; the team with the lowest total for the 18 holes wins." },
  { Name: "AB-CD Alternate Shot", Description: "Played by 2 rotating teams of 2 players each (4 on the course), teeing off from their usual tees, without handicaps. Holes 1-6: A and B play together, and C and D play together, as two separate teams. Both players hit drives; the team leader picks one, the player whose drive was not picked hits the next shot, and they alternate shots until the hole is complete. The score posted for the hole is the lower of the two teams' GROSS scores (not combined). Holes 7-12: new teams A-C and B-D. Holes 13-18: A-D and B-C. The sum of the lowest GROSS score for each of the 18 holes is the team's score." },
  { Name: "Up or Back", Description: "The best 2 net scores of the 4-man team count on each hole. Players move up or back a tee box based on their score on the previous hole." },
  { Name: "Red, White, Blue & Brave", Description: "Teams of 4 (3 in a pinch). Each player tees off on 12 Red tees, 3 White tees (holes 3, 10, 17) and 3 Blue tees (holes 8, 13, 16), and plays his own ball from tee to hole out. Net scores. On selected holes there is a BRAVE option: tee off from a longer tee box and start the hole at minus 2. Details from the committee by the event date." },
  { Name: "Five Club Challenge", Description: "Teams of 4 (3 in a pinch). Each player picks any four clubs and one putter; no other clubs are allowed in the bag, and teams may not share clubs. Handicaps are 125% of GHIN. The team score for each hole is the 2 lowest NET scores, summed over all 18 holes." },
  { Name: "The 1-2-3 Game", Description: "Net-score team competition, teams of four, using GHIN handicaps at an 85% allowance. Each player plays his own ball from tee to green, and the most any player can count on a hole is a net double bogey. The team counts its lowest net scores on each hole: one score on each of the four par 5s, two scores on each of the ten par 4s, and three scores on each of the four par 3s." },
];
function laTournFormats_(ss) {
  let rows = laRead_(ss, LA.TOURN_FORMATS).filter((r) => String(r.Name || '').trim());
  if (!rows.length && !PropertiesService.getScriptProperties().getProperty('LA_TOURN_FORMATS_SEEDED')) {
    rows = LA_TOURN_FORMATS_DEFAULT_.map((r) => Object.assign({}, r));
    laWriteAll_(ss, LA.TOURN_FORMATS, rows);
    PropertiesService.getScriptProperties().setProperty('LA_TOURN_FORMATS_SEEDED', '1');
  }
  return rows.map((r) => ({ Name: String(r.Name).trim(), Description: String(r.Description || '').trim() }));
}
function laTournFormatsSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const rows = JSON.parse(p.rows || '[]').map((r) => ({ Name: String(r.Name || '').trim().slice(0, 80), Description: String(r.Description || '').trim().slice(0, 3000) })).filter((r) => r.Name || r.Description);
  rows.forEach((r) => { if (!r.Name) throw new Error('Every format needs a name.'); });
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try { laWriteAll_(ss, LA.TOURN_FORMATS, rows); PropertiesService.getScriptProperties().setProperty('LA_TOURN_FORMATS_SEEDED', '1'); } finally { lock.releaseLock(); }
  logActivity_(ss, admin, 'Saved tournament formats', rows.length + ' format' + (rows.length === 1 ? '' : 's'));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}
// The tees a tournament player can choose (TournTees, a subset of TeeOptions).
function laTournTees_(st) {
  const all = String(st.TeeOptions || '').split(',').map((t) => t.trim()).filter(Boolean);
  const t = String(st.TournTees || '').split(',').map((x) => x.trim()).filter((x) => all.indexOf(x) !== -1);
  return t.length ? t : all;
}
function laTournAll_(ss) { return laRead_(ss, LA.TOURNAMENTS); }
function laTournById_(ss, id) { return laTournAll_(ss).find((t) => String(t.TournID) === String(id)) || null; }
function laTournKind_(t) { return LA_TOURN_KINDS_[t.Kind] || LA_TOURN_KINDS_.ten; }
function laTournTitle_(t) { return String(t.Title || '').trim() || laTournKind_(t).title; }
function laTournGroup_(t) { return 'tourn:' + t.TournID; }
function laTournWho_(t) { const w = String(t.Who || '').trim().toLowerCase(); return w === 'fun' || w === 'all' ? w : laTournKind_(t).who; }
function laTournTeeCount_(t) { return Math.max(1, Math.min(LA_MAX_TEE_TIMES_, laNum_(t.TeeTimes, laTournKind_(t).teeTimes))); }
function laTournSlots_(st, t) { return laTournTeeCount_(t) * laNum_(st.PlayersPerTeeTime, 4); }
function laTournOpens_(t) { return t.SignupOpens || laAddDays_(t.DateKey, -14); }
function laTournCloses_(st, t) { return t.SignupCloses || laAddDays_(t.DateKey, -laNum_(st.TournCloseDaysBefore, 3)); }
function laTournOpensAt_(st, t) { const m = laParseTime_(st.SignupOpenTime); return laAt_(laTournOpens_(t), m === null ? 430 : m); }
function laTournClosesAt_(st, t) { return laAt_(laTournCloses_(st, t), 23 * 60 + 59) + 59999; }
function laTournActive_(t) { return laIsTrue_(t.Active, true) && /^\d{4}-\d{2}-\d{2}$/.test(String(t.DateKey || '')); }
// What a tournament takes over on its date: { fun, nassau, all } (titles, '' when not).
function laTournOnDay_(ss, key) {
  const out = { fun: '', nassau: '', all: '', id: '' };
  laTournAll_(ss).filter((t) => t.DateKey === key && laTournActive_(t)).forEach((t) => {
    const title = laTournTitle_(t);
    out.fun = out.fun || title; out.id = out.id || String(t.TournID);
    if (laTournWho_(t) === 'all') out.nassau = out.nassau || title;
  });
  out.all = out.fun && out.nassau ? out.fun : '';
  return out;
}
// The tournament's tee times: from its own First tee time, else the day's Legends first tee time
// (Admin > Setup > First Tee Time). [] until one of them is set.
function laTournTeeList_(ss, st, t) {
  let first = laParseTime_(t.FirstTee);
  if (first === null) {
    const cfg = laRead_(ss, LA.DAY_CONFIG).find((c) => c.DateKey === t.DateKey) || {};
    first = laParseTime_(cfg.LegendsFirst);
  }
  return first === null ? [] : laTeeSequence_(first, laTournTeeCount_(t), laNum_(st.TeeIntervalMin, 8)).map(laFmtTime_);
}
// Tournaments as "event-like" rows, so the event sign-up rules (labels, capacity) work for them.
function laEventsAndTourns_(ss) {
  const st = laSettings_(ss);
  return laRead_(ss, LA.EVENTS).concat(laTournAll_(ss).map((t) => ({ _group: laTournGroup_(t), EventID: '', Title: laTournTitle_(t), DateKey: t.DateKey,
    Capacity: String(laTournSlots_(st, t)), Active: t.Active, SignupOpens: laTournOpens_(t) })));
}
function laEvMatch_(e, group) { return e._group ? e._group === group : 'event:' + e.EventID === group; }

// What the app shows for each tournament (members: shown ones from today on; admins: also the last 60 days).
function laTournBoard_(ss, st, viewer, today) {
  const from = viewer.isAdmin ? laAddDays_(today, -60) : today;
  return laTournAll_(ss).filter((t) => t.DateKey >= from && (viewer.isAdmin || laTournActive_(t))).map((t) => {
    const rec = laPairRead_(ss, t.DateKey, laTournGroup_(t));
    return Object.assign({}, t, {
      group: laTournGroup_(t), title: laTournTitle_(t), who: laTournWho_(t), teeTimes: laTournTeeCount_(t),
      slots: laTournSlots_(st, t), standbySlots: laNum_(st.StandbySlots, 9),
      opens: laTournOpens_(t), closes: laTournCloses_(st, t), opensAt: laTournOpensAt_(st, t), closesAt: laTournClosesAt_(st, t),
      teeList: laTournTeeList_(ss, st, t),
      pairings: rec && (rec.teams || []).length ? { teams: rec.teams, madeAt: rec.madeAt || '', edited: !!rec.edited } : null,
    });
  }).sort((a, b) => (a.DateKey < b.DateKey ? -1 : a.DateKey > b.DateKey ? 1 : 0));
}

// Admin > Setup > Tournaments: save the list.
function laTournSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const h = LA_HEADERS.Tournaments;
  let rows = JSON.parse(p.rows || '[]').map((r) => { const o = {}; h.forEach((k) => { o[k] = r[k] === undefined || r[k] === null ? '' : String(r[k]).trim(); }); return o; })
    .filter((o) => o.DateKey || o.Title || o.Description);
  // A limited admin changes only their own tournaments; everyone else's rows are kept as they are.
  const kinds = laTournKindsFor_(ss, admin), mineKind = (k) => kinds.indexOf(LA_TOURN_KINDS_[k] ? k : 'ten') !== -1;
  const others = laTournAll_(ss).filter((t) => !mineKind(t.Kind));
  const otherIds = {}; others.forEach((t) => { otherIds[t.TournID] = true; });
  rows = rows.filter((o) => !otherIds[o.TournID]);
  rows.forEach((o) => { if (!mineKind(o.Kind)) throw new Error('Your admin rights don\'t cover the ' + (LA_TOURN_KINDS_[o.Kind] || LA_TOURN_KINDS_.ten).title + '.'); });
  const isKey = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  rows.forEach((o) => {
    if (!LA_TOURN_KINDS_[o.Kind]) o.Kind = 'ten';
    const name = o.Title || LA_TOURN_KINDS_[o.Kind].title;
    if (!isKey(o.DateKey)) throw new Error(name + ': choose the tournament date.');
    if (o.SignupOpens && !isKey(o.SignupOpens)) throw new Error(name + ': "Sign-ups open" is not a date.');
    if (o.SignupCloses && !isKey(o.SignupCloses)) throw new Error(name + ': "Sign-ups close" is not a date.');
    if (o.SignupOpens && o.SignupOpens > o.DateKey) throw new Error(name + ': sign-ups have to open on or before the tournament.');
    if (o.SignupCloses && o.SignupCloses > o.DateKey) throw new Error(name + ': sign-ups have to close on or before the tournament.');
    if (o.SignupOpens && o.SignupCloses && o.SignupCloses < o.SignupOpens) throw new Error(name + ': sign-ups have to close after they open.');
    if (o.TeeTimes && (!/^\d+$/.test(o.TeeTimes) || Number(o.TeeTimes) < 1 || Number(o.TeeTimes) > LA_MAX_TEE_TIMES_)) throw new Error(name + ': tee times must be 1 to ' + LA_MAX_TEE_TIMES_ + '.');
    if (!o.TeeTimes) o.TeeTimes = String(LA_TOURN_KINDS_[o.Kind].teeTimes);
    if (o.FirstTee) { const m = laParseTime_(o.FirstTee); if (m === null) throw new Error(name + ': enter the first tee time like 8:16 AM, or leave it blank.'); o.FirstTee = laFmtTime_(m); }
    o.Who = o.Who === 'fun' || o.Who === 'all' ? o.Who : LA_TOURN_KINDS_[o.Kind].who;
    o.Active = String(o.Active).toUpperCase() === 'FALSE' ? 'FALSE' : 'TRUE';
    if (!o.TournID) o.TournID = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // A tournament with sign-ups can't just disappear (its players would be lost): hide it instead.
    const keep = {}; rows.concat(others).forEach((o) => { keep[o.TournID] = true; });
    const signups = laRead_(ss, LA.SIGNUPS);
    laTournAll_(ss).forEach((t) => {
      if (keep[t.TournID] || t.DateKey < laTodayKey_()) return;
      const n = signups.filter((s) => s.Group === laTournGroup_(t)).length;
      if (n) throw new Error(laTournTitle_(t) + ' on ' + laDateLabel_(t.DateKey) + ' has ' + n + ' sign-up' + (n === 1 ? '' : 's') + '. Untick Show to hide it, or remove the players first.');
    });
    // past tournaments older than the list shows (60 days) are kept as they are
    const old = laTournAll_(ss).filter((t) => !keep[t.TournID] && t.DateKey < laAddDays_(laTodayKey_(), -60));
    laWriteAll_(ss, LA.TOURNAMENTS, old.concat(others, rows));
  } finally { lock.releaseLock(); }
  logActivity_(ss, admin, 'Saved tournaments', rows.length + ' row' + (rows.length === 1 ? '' : 's'));
  return laGetBoard_(ss, { isAdmin: true, adminName: admin, member: null });
}

// Teams balanced by Handicap Index (A/B/C/D players): players ranked by index into four bands,
// each team gets one player from each band. As many teams as it takes (foursomes, threesomes
// first when it doesn't divide by 4, never more than the tee times); many random tries, keeping
// the closest team averages, then the fewest partners from the last tournament.
function laTournMake_(players, maxTeams, prevTeams, tries) {
  const n = players.length;
  if (n < 2) throw new Error('Pairings need at least 2 players (' + n + ' signed up).');
  let g = Math.ceil(n / 4);
  if (g > maxTeams) throw new Error(n + ' players won\'t fit in ' + maxTeams + ' tee times.');
  const sizes = []; const short = 4 * g - n;
  for (let i = 0; i < g; i++) sizes.push(i < short ? 3 : 4);
  const idx = (p) => { const v = hcpIndexNum_(p.HI); return v === null ? 99 : v; }; // no index: ranked last (D)
  const ranked = players.slice().sort((a, b) => idx(a) - idx(b) || String(a.Name).localeCompare(String(b.Name)));
  const before = {}; (prevTeams || []).forEach((t) => t.forEach((a) => t.forEach((b) => { if (a !== b) before[a + '|' + b] = true; })));
  const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  let best = null;
  for (let r = 0; r < (tries || 3000); r++) {
    // band k = the k-th best player of each team; a threesome has no D player
    const teams = sizes.map(() => []);
    let at = 0;
    for (let k = 0; k < 4; k++) {
      const ts = sizes.map((s, t) => (s > k ? t : -1)).filter((t) => t !== -1);
      const who = shuffle(ranked.slice(at, at + ts.length)); at += ts.length;
      ts.forEach((t, j) => { if (who[j]) teams[t].push(who[j]); });
    }
    const means = teams.map((t) => t.reduce((s, p) => s + Math.min(idx(p), 40), 0) / t.length);
    const spread = Math.max.apply(null, means) - Math.min.apply(null, means);
    let repeats = 0;
    teams.forEach((t) => t.forEach((a, i) => t.slice(i + 1).forEach((b) => { if (before[a.PlayerID + '|' + b.PlayerID]) repeats++; })));
    const score = spread + repeats * 0.5;
    if (!best || score < best.score) best = { score: score, teams: teams.map((t) => t.map((p) => p.PlayerID)), spread: spread };
  }
  return best;
}
// The last tournament's teams before this one (to mix partners up).
function laTournPrevTeams_(ss, t) {
  const rows = laRead_(ss, LA.PAIRINGS).filter((x) => String(x.Group).indexOf('tourn:') === 0 && x.DateKey < t.DateKey).sort((a, b) => (a.DateKey < b.DateKey ? 1 : -1));
  try { return rows.length ? JSON.parse(rows[0].Data || '{}').teams || [] : []; } catch (e) { return []; }
}
function laTournView_(ss, t) {
  const st = laSettings_(ss), group = laTournGroup_(t);
  const pl = laPairPlayers_(ss, t.DateKey, group);
  const rec = laPairRead_(ss, t.DateKey, group);
  const inIds = {}; pl.playing.forEach((x) => { inIds[x.PlayerID] = true; });
  const teams = rec ? (rec.teams || []).map((tm) => tm.filter((id) => inIds[id])) : [];
  const placed = {}; teams.forEach((tm) => tm.forEach((id) => { placed[id] = true; }));
  const gone = rec ? [].concat.apply([], rec.teams || []).filter((id) => !inIds[id]) : [];
  const names = {}; laRead_(ss, LA.SIGNUPS).filter((s) => s.Group === group).forEach((s) => { names[s.PlayerID] = s.Name; });
  return {
    tourn: laTournBoard_(ss, st, { isAdmin: true }, laTodayKey_()).find((x) => x.TournID === t.TournID) || null,
    players: pl.playing, standby: pl.standby,
    teams: teams, unplaced: pl.playing.filter((x) => !placed[x.PlayerID]).map((x) => x.PlayerID),
    gone: gone.map((id) => ({ PlayerID: id, Name: names[id] || '' })),
    madeAt: rec ? rec.madeAt || '' : '', madeBy: rec ? rec.madeBy || '' : '', edited: rec ? !!rec.edited : false,
    emailSent: laRead_(ss, LA.REMINDER_LOG).filter((r) => r.Type === group).map((r) => r.SentAt).sort().pop() || '',
    games: laGameList_(ss),
  };
}
function laTournFromP_(ss, p) {
  const t = laTournById_(ss, String(p.id || ''));
  if (!t) throw new Error('That tournament was not found. It may have been removed.');
  return t;
}
function laTournGenerate_(ss, t, who) {
  const group = laTournGroup_(t);
  const pl = laPairPlayers_(ss, t.DateKey, group);
  const made = laTournMake_(pl.playing, laTournTeeCount_(t), laTournPrevTeams_(ss, t));
  laPairWrite_(ss, t.DateKey, group, { teams: made.teams, madeAt: new Date().toISOString(), madeBy: who, edited: false }, who, '');
  return made;
}
function laTournPairGet_(ss, p) { laRequireAdmin_(ss, p); return laTournView_(ss, laTournFromP_(ss, p)); }
function laTournPairMake_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const t = laTournFromP_(ss, p);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let made;
  try { made = laTournGenerate_(ss, t, admin); } finally { lock.releaseLock(); }
  logActivity_(ss, admin, 'Made tournament pairings', laTournTitle_(t) + ' ' + laDateLabel_(t.DateKey) + ' — ' + made.teams.length + ' teams');
  return laTournView_(ss, t);
}
// Admin moved players between teams: teams = [[PlayerID...]...] (only players signed up are kept).
function laTournPairSave_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const t = laTournFromP_(ss, p), group = laTournGroup_(t);
  const raw = JSON.parse(p.teams || '[]');
  const pl = laPairPlayers_(ss, t.DateKey, group);
  const inIds = {}; pl.playing.forEach((x) => { inIds[x.PlayerID] = true; });
  const seen = {};
  const teams = raw.map((tm) => (tm || []).map(String).filter((id) => { if (!inIds[id] || seen[id]) return false; seen[id] = true; return true; })).filter((tm) => tm.length);
  if (teams.length > laTournTeeCount_(t)) throw new Error('That is ' + teams.length + ' teams, but the tournament has ' + laTournTeeCount_(t) + ' tee times.');
  if (teams.some((tm) => tm.length > 5)) throw new Error('A team can have at most 5 players.');
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const old = laPairRead_(ss, t.DateKey, group) || {};
    laPairWrite_(ss, t.DateKey, group, { teams: teams, madeAt: old.madeAt || new Date().toISOString(), madeBy: old.madeBy || admin, edited: true }, admin, '');
  } finally { lock.releaseLock(); }
  logActivity_(ss, admin, 'Changed tournament pairings', laTournTitle_(t) + ' ' + laDateLabel_(t.DateKey));
  return laTournView_(ss, t);
}

// The "Tournament pairings" email: to the players signed up (and standby), the pro shop and the admin.
function laTournEmail_(ss, t, st) {
  const v = laTournView_(ss, t), tr = v.tourn, title = laTournTitle_(t);
  const byId = {}; v.players.concat(v.standby).forEach((x) => { byId[x.PlayerID] = x; });
  const f = 'font-family:Arial,Helvetica,sans-serif;';
  const cell = 'padding:5px 9px;border:1px solid #ccc;white-space:nowrap;font-size:14px;';
  const hi = (x) => (x.HI ? ' <span style="color:#666;font-size:12px;">(' + laEsc_(x.HI) + ')</span>' : '');
  const nm = (x) => laEsc_(displayName_(x.Name)) + hi(x);
  const band = ['A', 'B', 'C', 'D'];
  const teams = v.teams.filter((tm) => tm.length);
  let table = '';
  if (teams.length) {
    const widest = Math.max(4, Math.max.apply(null, teams.map((tm) => tm.length)));
    const head = '<tr><th style="' + cell + 'background:#2e5d34;color:#fff;">Tee time</th><th style="' + cell + 'background:#2e5d34;color:#fff;">Team</th>' +
      Array.from({ length: widest }, (_, k) => '<th style="' + cell + 'background:#2e5d34;color:#fff;">' + (band[k] || '') + '</th>').join('') + '</tr>';
    const body = teams.map((tm, i) => {
      const ids = tm.slice().sort((a, b) => laIdxSort_((byId[a] || {}).HI) - laIdxSort_((byId[b] || {}).HI));
      const cells = Array.from({ length: widest }, (_, k) => '<td style="' + cell + '">' + (ids[k] && byId[ids[k]] ? nm(byId[ids[k]]) : '') + '</td>').join('');
      return '<tr><td style="' + cell + 'font-weight:700;">' + laEsc_(tr.teeList[i] || 'TBD') + '</td><td style="' + cell + '">' + LA_TOURN_TEAM_NAMES_[i] + '</td>' + cells + '</tr>';
    }).join('');
    table = '<table style="border-collapse:collapse;' + f + '">' + head + body + '</table>' +
      '<p style="' + f + 'font-size:12px;color:#666;">Each team has an A, B, C and D player, ranked by Handicap Index (shown in brackets), so the teams come out about even.</p>';
  }
  const unplaced = v.unplaced.map((id) => byId[id]).filter(Boolean);
  const list = (arr) => arr.map((x) => nm(x)).join(', ');
  const facts = [
    ['Date', laLongDate_(t.DateKey)],
    ['Tee times', tr.teeList.length ? tr.teeList[0] + ' – ' + tr.teeList[tr.teeList.length - 1] + ' (' + tr.teeTimes + ' tee times)' : 'to be confirmed (' + tr.teeTimes + ' tee times)'],
    ['Players', v.players.length + (tr.who === 'fun' ? ' (Fun Group)' : '')],
    t.Game ? ['Game', t.Game] : null,
    t.Prizes ? ['Prizes', t.Prizes] : null,
  ].filter(Boolean);
  const factsHtml = '<table style="' + f + 'font-size:14px;margin:8px 0 14px;">' + facts.map(([k, val]) => '<tr><td style="padding:2px 12px 2px 0;color:#666;">' + k + '</td><td style="padding:2px 0;"><b>' + laEsc_(val) + '</b></td></tr>').join('') + '</table>';
  const html = '<div style="' + f + 'color:#222;">' +
    '<h2 style="' + f + 'color:#2e5d34;margin:0 0 4px;">' + laEsc_(title) + '</h2>' +
    laMsg_(st.TournEmailMessage, f + 'font-size:14px;') +
    factsHtml +
    (t.Description ? '<p style="' + f + 'font-size:14px;white-space:pre-line;">' + laEsc_(t.Description) + '</p>' : '') +
    (table || (v.players.length ? '<p style="' + f + 'font-size:14px;"><b>Signed up:</b> ' + list(v.players) + '</p>' : '<p style="' + f + 'font-size:14px;">No one is signed up yet.</p>')) +
    (table && unplaced.length ? '<p style="' + f + 'font-size:14px;"><b>Signed up, not on a team yet:</b> ' + list(unplaced) + '</p>' : '') +
    '<p style="' + f + 'font-size:14px;"><b>Standby:</b> ' + (v.standby.length ? list(v.standby) : 'None') + '</p>' +
    '<p style="' + f + 'font-size:13px;color:#444;">' + laEsc_(st.TournEmailFooterText || '') + '</p>' +
    (st.SiteUrl ? '<p style="' + f + 'font-size:13px;"><a href="' + laEsc_(st.SiteUrl) + '">Open SUN</a></p>' : '') + '</div>';
  const roster = readRosterFull_(ss), mail = {}; roster.forEach((r) => { if (memberIsActive_(r) && String(r.Email || '').trim()) mail[String(r.PlayerID)] = String(r.Email).trim(); });
  const sendTo = laTournSendTo_(st), groupAddr = laEmailList_(st.DailyGroupEmail);
  const useGroup = sendTo.indexOf('legends') !== -1 && groupAddr.length > 0;
  let players = (sendTo.indexOf('players') !== -1 || (sendTo.indexOf('legends') !== -1 && !useGroup)) ? v.players.concat(v.standby).map((x) => mail[x.PlayerID]).filter(Boolean) : [];
  let note = '';
  if (useGroup) {
    // players the app knows are in the group don't get a second copy (as on the other emails)
    const inGrp = {};
    groupAddr.forEach((a) => (laGroupFromGoogle_(a) || []).concat(laGroupExtras_(st, a)).forEach((e) => { inGrp[String(e).toLowerCase()] = true; }));
    players = players.filter((e) => !inGrp[e.toLowerCase()]);
    groupAddr.forEach((a) => { note += laGroupNote_(st, a, laGroupMembers_(st, roster, a)).html; });
  }
  const to = (useGroup ? groupAddr : []).concat(players);
  const cc = [].concat(sendTo.indexOf('proshop') !== -1 ? laEmailList_(st.ProShopEmails) : [], sendTo.indexOf('admin') !== -1 ? laEmailList_(st.AdminEmail) : [],
    sendTo.indexOf('extra') !== -1 ? laEmailList_(st.TournEmailExtraEmails) : []);
  const seen = {}; const uniq = (l) => l.filter((e) => { const k = e.toLowerCase(); if (seen[k]) return false; seen[k] = true; return true; });
  return { subject: title + ' pairings and tee times — ' + laLongDate_(t.DateKey), html: html + note, to: uniq(to), cc: uniq(cc), players: v.players.length, teams: teams.length, viaGroup: useGroup ? groupAddr.join(', ') : '' };
}
const LA_TOURN_AUDIENCES_ = ['legends', 'players', 'proshop', 'admin', 'extra'];
function laTournSendTo_(st) {
  return String(st.TournEmailSendTo == null ? LA_DEFAULT_SETTINGS.TournEmailSendTo : st.TournEmailSendTo).split(/[,\s]+/).filter((a, i, arr) => LA_TOURN_AUDIENCES_.indexOf(a) !== -1 && arr.indexOf(a) === i);
}
function laTournEmailPreview_(ss, p) {
  laRequireAdmin_(ss, p);
  const t = laTournFromP_(ss, p), st = laSettings_(ss);
  Object.keys(JSON.parse(p.settings || '{}')).forEach((k) => { if (k.indexOf('TournEmail') === 0 && k in LA_DEFAULT_SETTINGS) st[k] = String(JSON.parse(p.settings)[k] || ''); });
  const m = laTournEmail_(ss, t, st);
  return { subject: m.subject, html: m.html, to: laShortList_(m.to), cc: laShortList_(m.cc), total: m.to.length + m.cc.length, viaGroup: m.viaGroup };
}
function laTournEmailSendNow_(ss, t, who) {
  const st = laSettings_(ss), group = laTournGroup_(t);
  const m = laTournEmail_(ss, t, st);
  if (!m.to.length && !m.cc.length) throw new Error('Nobody would get this email.');
  const mails = laPackMail_(st, m.to, m.cc, []);
  const total = mails.reduce((a, x) => a + laMailCount_(x), 0);
  if (MailApp.getRemainingDailyQuota() < total + 1) throw new Error('The daily email limit has been reached — try again tomorrow.');
  const again = laRead_(ss, LA.REMINDER_LOG).some((r) => r.Type === group);
  const subject = (again ? 'UPDATED: ' : '') + m.subject;
  const n = laSendMails_(st, mails.map((x) => Object.assign(x, { subject: subject, html: m.html })));
  laAppend_(ss, LA.REMINDER_LOG, { Type: group, DateKey: t.DateKey, SentAt: new Date().toISOString(), Recipients: String(n) });
  logActivity_(ss, who, 'Sent tournament email', laTournTitle_(t) + ' ' + laDateLabel_(t.DateKey) + ' — ' + n + ' recipient' + (n === 1 ? '' : 's'));
  return n;
}
function laTournEmailSend_(ss, p) {
  const admin = laRequireAdmin_(ss, p);
  const t = laTournFromP_(ss, p);
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { laTournEmailSendNow_(ss, t, admin); } finally { lock.releaseLock(); }
  return laTournView_(ss, t);
}
// Only the tournament email's own settings (so a limited admin with the Tournaments page can save them).
function laTournSettingsSave_(ss, p) {
  const patch = JSON.parse(p.settings || '{}'), keep = {};
  Object.keys(patch).forEach((k) => { if (k.indexOf('TournEmail') === 0 || k === 'TournCloseDaysBefore' || k === 'TournTees') keep[k] = patch[k]; });
  return laSaveAppSettings_(ss, Object.assign({}, p, { settings: JSON.stringify(keep) }));
}
// Hourly: when a tournament's sign-ups close, make its pairings (if none yet); the next morning
// at TournEmailHour, send the email if TournEmailOn and it hasn't gone.
function laTournHourly_(ss) {
  const st = laSettings_(ss), today = laTodayKey_(), now = Date.now();
  const sent = {}; laRead_(ss, LA.REMINDER_LOG).forEach((r) => { if (String(r.Type).indexOf('tourn:') === 0) sent[r.Type] = true; });
  laTournAll_(ss).filter((t) => laTournActive_(t) && t.DateKey >= today).forEach((t) => {
    const group = laTournGroup_(t), closesAt = laTournClosesAt_(st, t);
    if (now <= closesAt) return;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return;
    try {
      if (!laPairRead_(ss, t.DateKey, group) && laPairPlayers_(ss, t.DateKey, group).playing.length >= 2) {
        const made = laTournGenerate_(ss, t, 'Automatic');
        logActivity_(ss, 'System', 'Made tournament pairings', laTournTitle_(t) + ' ' + laDateLabel_(t.DateKey) + ' — ' + made.teams.length + ' teams (automatic, sign-ups closed)');
      }
      const due = closesAt + 60000 + laNum_(st.TournEmailHour, 9) * 3600000;
      if (laOn_(st, 'TournEmailOn') && !sent[group] && now > due && laPairPlayers_(ss, t.DateKey, group).playing.length) laTournEmailSendNow_(ss, t, 'Automatic');
    } catch (err) { Logger.log('Tournament ' + t.TournID + ': ' + err.message); } finally { lock.releaseLock(); }
  });
}

// ---------------- TEST: a copy of the LIVE data (Tom 2026-11-17) ----------------
// Only the TEST Apps Script project has the Script Property LIVE_SPREADSHEET_ID (the LIVE
// sheet's ID). With it set, that project is "TEST":
//   - Admin shows "Copy LIVE data into TEST", which READS the LIVE sheet and replaces the
//     TEST sheet's tabs with it. Nothing ever writes to the LIVE sheet. Never set
//     LIVE_SPREADSHEET_ID in the LIVE project (it refuses if it points at its own sheet).
//   - Every email TEST sends goes only to the account that runs the app (the Legends
//     email), marked [TEST] and listing who it would have gone to, because the copied
//     data has the real members' addresses.
function laLiveId_() { return scriptProp_('LIVE_SPREADSHEET_ID'); }
function laIsTestCopy_() { const id = laLiveId_(); return !!id && id !== scriptProp_('SPREADSHEET_ID'); }
// Settings TEST keeps as they are when it copies LIVE: every email switch, every list of
// addresses and the app link. Everything else (duty lists, tee options, wording...) comes from LIVE.
function laTestKeepsSetting_(k) {
  return /On$|AutoSend$|Resend$|^Remind|Emails$|SendTo$|CopyTo$|^DailyGroup|^AdminEmail$|^SiteUrl$/.test(k);
}
const LA_COPY_SKIP_ = ['ActivityLog']; // TEST keeps its own activity log
function laCopyFromLive_(ss, who) {
  if (!laIsTestCopy_()) throw new Error('This only works on TEST (Script Property LIVE_SPREADSHEET_ID in the TEST Apps Script project).');
  const live = SpreadsheetApp.openById(laLiveId_());
  if (live.getId() === ss.getId()) throw new Error('LIVE_SPREADSHEET_ID is this sheet. Nothing was copied.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const copied = [];
  try {
    maybeBackup_(ss, true); // TEST as it was, in the backups sheet, just in case
    const keep = {};
    laReadRaw_(ss, LA.APP_SETTINGS).forEach((r) => { if (r.Key) keep[r.Key] = String(r.Value); });
    live.getSheets().forEach((src) => {
      const name = src.getName();
      if (LA_COPY_SKIP_.indexOf(name) !== -1) return;
      const dst = ss.getSheetByName(name) || ss.insertSheet(name);
      const nr = src.getLastRow(), nc = src.getLastColumn(), oldR = dst.getLastRow(), oldC = dst.getLastColumn();
      if (nr && nc) {
        const rg = src.getRange(1, 1, nr, nc);
        const out = dst.getRange(1, 1, nr, nc);
        out.setNumberFormats(rg.getNumberFormats());
        out.setValues(rg.getValues());
      }
      if (oldR > nr) dst.getRange(nr + 1, 1, oldR - nr, Math.max(oldC, nc, 1)).clearContent();
      if (oldC > nc && nr) dst.getRange(1, nc + 1, nr, oldC - nc).clearContent();
      if (src.isSheetHidden() && !dst.isSheetHidden()) dst.hideSheet();
      copied.push(name);
    });
    // TEST's own email switches, addresses and app link go back in
    laInvalidate_();
    const st = laSettingsFresh_(ss);
    Object.keys(st).forEach((k) => { if (laTestKeepsSetting_(k)) st[k] = k in keep ? keep[k] : (k in LA_DEFAULT_SETTINGS ? LA_DEFAULT_SETTINGS[k] : st[k]); });
    laWriteSettings_(ss, st);
    // members added on TEST get new IDs above LIVE's
    let top = 0; readRosterFull_(ss).forEach((r) => { const n = parseInt(r.PlayerID, 10); if (n > top) top = n; });
    const props = PropertiesService.getScriptProperties();
    if (top > (parseInt(props.getProperty('ROSTER_MAX_ID'), 10) || 0)) props.setProperty('ROSTER_MAX_ID', String(top));
    laInvalidate_();
  } finally {
    lock.releaseLock();
  }
  logActivity_(ss, who, 'Copied LIVE data into TEST', copied.length + ' tabs: ' + copied.join(', ').slice(0, 400));
  return { tabs: copied, liveName: live.getName() };
}
// Run by hand from the TEST Apps Script editor (Run menu) if the button can't be used.
function copyLiveToTest() {
  const r = laCopyFromLive_(openSpreadsheet_(), 'Apps Script (by hand)');
  Logger.log('Copied ' + r.tabs.length + ' tabs from "' + r.liveName + '": ' + r.tabs.join(', '));
}
// Every email the app sends goes through here. On TEST it goes only to the account that
// runs the app, so testing never emails members or the pro shop.
function laSendEmail_(o) {
  if (laIsTestCopy_()) {
    const me = Session.getEffectiveUser().getEmail();
    const who = ['To: ' + (o.to || ''), o.cc ? 'Cc: ' + o.cc : '', o.bcc ? 'Bcc: ' + o.bcc : ''].filter(Boolean).join('\n');
    const note = 'TEST site: this email was NOT sent to the people below, only to you.\n' + who;
    o = Object.assign({}, o, { to: me, cc: undefined, bcc: undefined, subject: '[TEST] ' + o.subject,
      body: note + '\n\n' + (o.body || ''),
      htmlBody: o.htmlBody ? '<div style="background:#fff3cd;border:1px solid #e0c36b;padding:8px 10px;margin-bottom:12px;font-family:Arial,sans-serif;font-size:13px;white-space:pre-line;">' + laEsc_(note) + '</div>' + o.htmlBody : undefined });
  }
  MailApp.sendEmail(o);
}
