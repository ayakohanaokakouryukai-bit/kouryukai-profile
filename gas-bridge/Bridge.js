// Pure logic and thin Worker/Sheets helpers for the bridge. Pure functions are unit tested in Node.

function jstShifted_(d) {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function jstDate(d) {
  var j = jstShifted_(d);
  return j.getUTCFullYear() + '-' + pad2_(j.getUTCMonth() + 1) + '-' + pad2_(j.getUTCDate());
}

function formatJstDateLabel(iso) {
  var j = jstShifted_(new Date(iso));
  return j.getUTCFullYear() + '年' + (j.getUTCMonth() + 1) + '月' + j.getUTCDate() + '日';
}

function normEmail_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

// A leading apostrophe forces Sheets to keep =, + or - strings as literal text (it strips it on read).
function asLiteral(v) {
  return typeof v === 'string' && /^[=+\-]/.test(v) ? "'" + v : v;
}

function readApplicantsFromTable(headers, rows, emailHeader, cancelHeader) {
  var names = (headers || []).map(function (h) { return String(h).trim(); });
  var ei = names.indexOf(emailHeader);
  if (ei < 0) return [];
  var ci = names.indexOf(cancelHeader);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var email = normEmail_(rows[i][ei]);
    if (!email) continue;
    var canceled = ci >= 0 && String(rows[i][ci] == null ? '' : rows[i][ci]).trim() !== '';
    out.push({ email: email, canceled: canceled });
  }
  return out;
}

var MIRROR_KEYS_HEADERS = ['メールアドレス', '専用URL', '発行日時', '最後に送った日', '送信待ち'];
var MIRROR_PROFILES_HEADERS = ['メールアドレス', '名前', '今やっていること', '分野', '今挑戦していること', '得意なこと', '苦手なこと', 'リンク', '写真あり', '公開の同意', '同意日時', '更新日時'];

function mirrorRows(exportJson) {
  var tokens = (exportJson.tokens || []).map(function (t) {
    return [t.email, t.url, t.issuedAt, t.lastSentDate, t.pending ? '送信待ち' : ''].map(function (v) { return asLiteral(v == null ? '' : v); });
  });
  var profiles = (exportJson.profiles || []).map(function (p) {
    var fields = Array.isArray(p.fields) ? p.fields.join('、') : '';
    return [p.email, p.name, p.job, fields, p.challenge, p.strengths, p.needs, p.link,
      p.hasPhoto ? 'あり' : '', p.consent ? 'はい' : '', p.consentAt, p.updatedAt].map(function (v) { return asLiteral(v == null ? '' : v); });
  });
  return { tokens: tokens, profiles: profiles };
}

// values: whole reset tab incl. header row. Returns rows (1-based) with A filled and B empty.
function pendingResetRows(values) {
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var email = normEmail_(values[i][0]);
    var b = values[i][1];
    if (email && (b == null || String(b).trim() === '')) out.push({ row: i + 1, email: email });
  }
  return out;
}

function formatResult(found, now) {
  if (!found) return '見つかりません';
  var j = jstShifted_(now);
  return '済 ' + jstDate(now) + ' ' + pad2_(j.getUTCHours()) + ':' + pad2_(j.getUTCMinutes());
}

// ---- Worker calls

// Returns { code, json } (json is null when the body is not JSON). Never throws on HTTP errors.
function workerCall_(config, method, path, body) {
  var opts = { method: method, muteHttpExceptions: true, headers: { 'X-Sync-Secret': config.syncSecret } };
  if (method === 'post') {
    opts.contentType = 'application/json';
    opts.payload = JSON.stringify(body || {});
  }
  var res = UrlFetchApp.fetch(config.workerUrl + path, opts);
  var json = null;
  try {
    json = JSON.parse(res.getContentText());
  } catch (err) {
    json = null;
  }
  return { code: res.getResponseCode(), json: json };
}

function callOk_(r) {
  return r.code >= 200 && r.code < 300 && r.json && r.json.ok === true;
}

function alertOnceToday_(propKey, subject, body, config) {
  var props = PropertiesService.getScriptProperties();
  var today = jstDate(new Date());
  if (props.getProperty(propKey) === today) return;
  try {
    MailApp.sendEmail({ to: config.organizerEmail, subject: subject, body: body, name: SENDER_NAME });
    props.setProperty(propKey, today);
  } catch (err) {
    console.error('organizer alert failed: ' + (err && err.message));
  }
}

// ---- Link mail

function maybeQuotaAlert_(config) {
  var remaining = MailApp.getRemainingDailyQuota();
  if (remaining < ALERT_THRESHOLD && remaining > 0) {
    var m = buildQuotaAlertMail(remaining, 0);
    alertOnceToday_('ALERT_SENT_DATE', m.subject, m.body, config);
  }
}

// Returns 'sent' | 'quota' | 'error'.
function sendLinkMail_(config, email, url, expiresAt) {
  if (MailApp.getRemainingDailyQuota() <= 0) return 'quota';
  try {
    var m = buildLinkMail(url, formatJstDateLabel(expiresAt));
    MailApp.sendEmail({ to: email, subject: m.subject, body: m.body, name: SENDER_NAME });
    return 'sent';
  } catch (err) {
    console.error('sendLinkMail failed: ' + (err && err.message));
    return 'error';
  }
}

function handleSendLink_(config, req) {
  if (typeof req.secret !== 'string' || req.secret !== config.syncSecret) return { ok: false, error: 'unauthorized' };
  if (req.action !== 'sendLink') return { ok: false, error: 'bad_request' };
  var email = normEmail_(req.email);
  if (!email || typeof req.url !== 'string' || !req.url) return { ok: false, error: 'bad_request' };
  var r = sendLinkMail_(config, email, req.url, req.expiresAt || config.expiresAt);
  if (r === 'sent') {
    maybeQuotaAlert_(config);
    return { ok: true, sent: true };
  }
  return { ok: true, sent: false, reason: r };
}

// ---- Applicants push

function pushApplicantsCore_(config) {
  var sheet = SpreadsheetApp.openById(config.formSheetId).getSheetByName(config.formSheetName);
  if (!sheet) throw new Error('form sheet not found');
  var values = sheet.getDataRange().getValues();
  var applicants = readApplicantsFromTable(values[0] || [], values.slice(1), config.emailHeader, config.cancelHeader);
  var r = workerCall_(config, 'post', '/admin/applicants', { applicants: applicants });
  if (callOk_(r)) return;
  var reason = r.json && r.json.error === 'suspicious_shrink'
    ? '応募者リストが急に減ったため、更新を止めました（現在 ' + r.json.current + ' 件 → 受信 ' + r.json.received + ' 件）。フォームの回答シートを確認してください。'
    : '応募者リストをWorkerに送れませんでした（HTTP ' + r.code + '）。';
  alertOnceToday_('SYNC_ALERT_DATE', '【参加者アプリ】応募者リストの同期に問題があります', reason, config);
}

// ---- Reset tab

function processResetsCore_(config) {
  var sheet = SpreadsheetApp.openById(config.dataSheetId).getSheetByName(RESET_TAB);
  if (!sheet) return;
  var rows = pendingResetRows(sheet.getDataRange().getValues());
  for (var i = 0; i < rows.length; i++) {
    var r = workerCall_(config, 'post', '/admin/reset-token', { email: rows[i].email });
    if (!callOk_(r)) continue; // leave B empty so it is retried on the next edit
    sheet.getRange(rows[i].row, 2, 1, 1).setValue(formatResult(r.json.found === true, new Date()));
  }
}

// ---- Mirror

function writeMirrorTab_(ss, name, headers, rows) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return;
  var all = [headers].concat(rows);
  sheet.clearContents();
  sheet.getRange(1, 1, all.length, headers.length).setNumberFormat('@'); // text format before values
  sheet.getRange(1, 1, all.length, headers.length).setValues(all);
}

function mirrorCore_(config) {
  var r = workerCall_(config, 'get', '/admin/export');
  if (!callOk_(r)) throw new Error('export failed: HTTP ' + r.code);
  var m = mirrorRows(r.json);
  var ss = SpreadsheetApp.openById(config.dataSheetId);
  writeMirrorTab_(ss, MIRROR_KEYS_TAB, MIRROR_KEYS_HEADERS, m.tokens);
  writeMirrorTab_(ss, MIRROR_PROFILES_TAB, MIRROR_PROFILES_HEADERS, m.profiles);
}

// ---- Hourly resend

function resendPendingCore_(config) {
  var r = workerCall_(config, 'get', '/admin/pending-mails');
  if (!callOk_(r)) throw new Error('pending-mails failed: HTTP ' + r.code);
  var mails = r.json.mails || [];
  for (var i = 0; i < mails.length; i++) {
    var res = sendLinkMail_(config, mails[i].email, mails[i].url, config.expiresAt);
    if (res === 'quota') break; // the rest stay pending for the next run
    workerCall_(config, 'post', '/admin/mail-result', { email: mails[i].email, sent: res === 'sent' });
  }
  maybeQuotaAlert_(config);
}

// ---- Migration from the old tokens / profiles tabs

function tableObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  var headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  return values.slice(1).map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { if (!(h in o)) o[h] = row[i]; });
    return o;
  });
}

function toIsoString_(v) {
  if (v instanceof Date) return v.toISOString();
  return v == null ? '' : String(v).trim();
}

function toJstDateString_(v) {
  if (v instanceof Date) return jstDate(v);
  return v == null ? '' : String(v).trim();
}

function toBool_(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

function migrateCore_(config) {
  var ss = SpreadsheetApp.openById(config.dataSheetId);
  var tokenSheet = ss.getSheetByName('tokens');
  var profileSheet = ss.getSheetByName('profiles');
  var tokens = tokenSheet ? tableObjects_(tokenSheet).filter(function (o) { return normEmail_(o.email) && String(o.token || '').trim(); }).map(function (o) {
    return { email: normEmail_(o.email), token: String(o.token).trim(), issuedAt: toIsoString_(o.issuedAt), lastSentDate: toJstDateString_(o.lastSentDate) };
  }) : [];
  var profiles = [];
  var objs = profileSheet ? tableObjects_(profileSheet) : [];
  for (var i = 0; i < objs.length; i++) {
    var o = objs[i];
    var email = normEmail_(o.email);
    if (!email) continue;
    var fieldsText = String(o.fields == null ? '' : o.fields);
    var p = {
      email: email,
      profile: {
        name: String(o.name == null ? '' : o.name),
        job: String(o.job == null ? '' : o.job),
        fields: fieldsText.split('、').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; }),
        challenge: String(o.challenge == null ? '' : o.challenge),
        strengths: String(o.strengths == null ? '' : o.strengths),
        needs: String(o.needs == null ? '' : o.needs),
        link: String(o.link == null ? '' : o.link),
      },
      consent: toBool_(o.consent),
      consentAt: toIsoString_(o.consentAt),
      updatedAt: toIsoString_(o.updatedAt),
    };
    var fileId = String(o.photoFileId == null ? '' : o.photoFileId).trim();
    if (fileId) {
      try {
        p.photoBase64 = Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes());
      } catch (err) {
        console.warn('photo skipped for ' + email + ': ' + (err && err.message));
      }
    }
    profiles.push(p);
  }
  var r = workerCall_(config, 'post', '/admin/import', { tokens: tokens, profiles: profiles });
  if (!callOk_(r)) throw new Error('import failed: HTTP ' + r.code);
  console.log('migrated tokens=' + r.json.tokens + ' profiles=' + r.json.profiles);
}
