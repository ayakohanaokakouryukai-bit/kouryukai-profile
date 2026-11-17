// Spreadsheet-backed store. Columns are located by header name in row 1 (order independent).
// Sheet-formula injection: the '@' (plain text) number format is applied unconditionally to every
// identifier/user-text column (email, token, url, dates, name, job, ...) before values are written, so
// Sheets never evaluates them. No prefix is added; a cell that still holds a formula is read back as its
// formula text via getFormulas, so reads need no stripping.

var TOKEN_HEADERS_ = ['email', 'token', 'url', 'issuedAt', 'lastSentDate', 'pending'];
var PROFILE_HEADERS_ = ['email', 'name', 'job', 'fields', 'challenge', 'strengths', 'needs', 'link', 'photoFileId', 'photoUrl', 'consent', 'consentAt', 'updatedAt', 'staff'];
var TOKEN_TEXT_COLS_ = ['email', 'token', 'url', 'issuedAt', 'lastSentDate'];
var PROFILE_TEXT_COLS_ = ['email', 'name', 'job', 'fields', 'challenge', 'strengths', 'needs', 'link', 'photoFileId', 'photoUrl', 'consentAt', 'updatedAt'];
var PROFILE_TEXT_KEYS_ = ['name', 'job', 'challenge', 'strengths', 'needs', 'link'];

function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]';
}

function toIso_(v) {
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : v.toISOString();
  return v == null ? '' : String(v);
}

function toJstDateString_(v) {
  if (isDate_(v)) return isNaN(v.getTime()) ? '' : jstDate(v);
  return v == null ? '' : String(v).trim();
}

function toBool_(v) {
  return v === true || String(v).trim().toUpperCase() === 'TRUE';
}

function toStr_(v) {
  return v == null ? '' : String(v);
}

function splitFields_(v) {
  var s = toStr_(v).trim();
  return s === '' ? [] : s.split('、').map(function (x) { return x.trim(); }).filter(function (x) { return x !== ''; });
}

// Reads the whole sheet: { headers, index: name->col (0-based), rows: [{n: sheetRow (1-based), v: values}] }
// For `textCols`, a cell with a formula yields the formula string instead of the computed value.
function readTable_(sheet, textCols) {
  var range = sheet.getDataRange();
  var values = range.getValues();
  var formulas = textCols ? range.getFormulas() : null;
  var headers = (values[0] || []).map(function (h) { return String(h).trim(); });
  var index = {};
  headers.forEach(function (h, i) { if (!(h in index)) index[h] = i; });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var v = values[i].slice();
    if (formulas) {
      for (var c = 0; c < headers.length; c++) {
        var f = formulas[i] && formulas[i][c];
        if (f && textCols.indexOf(headers[c]) >= 0) v[c] = f;
      }
    }
    rows.push({ n: i + 1, v: v });
  }
  return { headers: headers, index: index, rows: rows };
}

function cell_(t, row, name) {
  return name in t.index ? row.v[t.index[name]] : '';
}

function findRowByEmail_(t, email) {
  var target = normalizeEmail(email);
  for (var i = 0; i < t.rows.length; i++) {
    if (normalizeEmail(cell_(t, t.rows[i], 'email')) === target) return t.rows[i];
  }
  return null;
}

// Writes `obj` (header -> value) into the row for `email`, or appends one. Headers absent from obj
// keep their current cell value. `textCols` cells are set to plain text before the values go in.
function writeRow_(sheet, t, existing, obj, textCols) {
  var n = existing ? existing.n : sheet.getLastRow() + 1;
  var out = [];
  for (var c = 0; c < t.headers.length; c++) {
    var h = t.headers[c];
    if (h in obj) out.push(obj[h]);
    else out.push(existing && existing.v[c] != null ? existing.v[c] : '');
    if (h in obj && textCols.indexOf(h) >= 0) sheet.getRange(n, c + 1, 1, 1).setNumberFormat('@');
  }
  sheet.getRange(n, 1, 1, out.length).setValues([out]);
}

function tokenRowFrom_(t, r) {
  return {
    email: toStr_(cell_(t, r, 'email')),
    token: toStr_(cell_(t, r, 'token')),
    url: toStr_(cell_(t, r, 'url')),
    issuedAt: toIso_(cell_(t, r, 'issuedAt')),
    lastSentDate: toJstDateString_(cell_(t, r, 'lastSentDate')),
    pending: toBool_(cell_(t, r, 'pending')),
  };
}

function profileRowFrom_(t, r) {
  var p = {
    name: toStr_(cell_(t, r, 'name')),
    job: toStr_(cell_(t, r, 'job')),
    fields: splitFields_(cell_(t, r, 'fields')),
    challenge: toStr_(cell_(t, r, 'challenge')),
    strengths: toStr_(cell_(t, r, 'strengths')),
    needs: toStr_(cell_(t, r, 'needs')),
    link: toStr_(cell_(t, r, 'link')),
    photoUrl: toStr_(cell_(t, r, 'photoUrl')),
  };
  var empty = p.fields.length === 0 && PROFILE_TEXT_KEYS_.concat(['photoUrl']).every(function (k) { return p[k] === ''; });
  return {
    email: toStr_(cell_(t, r, 'email')),
    profile: empty ? null : p,
    photoFileId: toStr_(cell_(t, r, 'photoFileId')),
    consent: toBool_(cell_(t, r, 'consent')),
    consentAt: toIso_(cell_(t, r, 'consentAt')),
    updatedAt: toIso_(cell_(t, r, 'updatedAt')),
    staff: toStr_(cell_(t, r, 'staff')).trim() !== '',
  };
}

function profileObjFrom_(row) {
  var p = row.profile || {};
  return {
    email: normalizeEmail(row.email),
    name: toStr_(p.name), job: toStr_(p.job),
    fields: (p.fields || []).join('、'),
    challenge: toStr_(p.challenge), strengths: toStr_(p.strengths), needs: toStr_(p.needs),
    link: toStr_(p.link), photoFileId: toStr_(row.photoFileId), photoUrl: toStr_(p.photoUrl),
    consent: row.consent === true, consentAt: toStr_(row.consentAt), updatedAt: toStr_(row.updatedAt),
    // `staff` is deliberately omitted: the organizer edits it by hand and we must not overwrite it.
  };
}

function makeStore_(config) {
  function sheetOf(id, name) {
    var sheet = SpreadsheetApp.openById(id).getSheetByName(name);
    if (!sheet) throw new Error('Sheet not found: ' + name);
    return sheet;
  }
  var tokens = function () { var s = sheetOf(config.dataSheetId, 'tokens'); return { s: s, t: readTable_(s, TOKEN_TEXT_COLS_) }; };
  var profiles = function () { var s = sheetOf(config.dataSheetId, 'profiles'); return { s: s, t: readTable_(s, PROFILE_TEXT_COLS_) }; };
  return {
    readApplicants: function () {
      var t = readTable_(sheetOf(config.formSheetId, config.formSheetName));
      if (!(config.emailHeader in t.index)) throw new Error('Email column not found: ' + config.emailHeader);
      var hasCancel = config.cancelHeader in t.index;
      var out = [];
      t.rows.forEach(function (r) {
        var email = toStr_(cell_(t, r, config.emailHeader)).trim();
        if (email === '') return;
        out.push({ email: email, canceled: hasCancel && toStr_(cell_(t, r, config.cancelHeader)).trim() !== '' });
      });
      return out;
    },
    getTokenRowByEmail: function (email) {
      var d = tokens(); var r = findRowByEmail_(d.t, email);
      return r ? tokenRowFrom_(d.t, r) : null;
    },
    getTokenRowByToken: function (token) {
      if (typeof token !== 'string' || token === '') return null;
      var d = tokens();
      for (var i = 0; i < d.t.rows.length; i++) {
        if (toStr_(cell_(d.t, d.t.rows[i], 'token')) === token) return tokenRowFrom_(d.t, d.t.rows[i]);
      }
      return null;
    },
    upsertTokenRow: function (row) {
      var d = tokens();
      writeRow_(d.s, d.t, findRowByEmail_(d.t, row.email), {
        email: normalizeEmail(row.email), token: toStr_(row.token), url: toStr_(row.url),
        issuedAt: toStr_(row.issuedAt), lastSentDate: toStr_(row.lastSentDate), pending: row.pending === true,
      }, TOKEN_TEXT_COLS_);
    },
    listPendingTokenRows: function () {
      var d = tokens();
      return d.t.rows.map(function (r) { return tokenRowFrom_(d.t, r); }).filter(function (r) { return r.pending; });
    },
    getProfileRow: function (email) {
      var d = profiles(); var r = findRowByEmail_(d.t, email);
      return r ? profileRowFrom_(d.t, r) : null;
    },
    upsertProfileRow: function (row) {
      var d = profiles();
      writeRow_(d.s, d.t, findRowByEmail_(d.t, row.email), profileObjFrom_(row), PROFILE_TEXT_COLS_);
    },
    listProfileRows: function () {
      var d = profiles();
      return d.t.rows.map(function (r) { return profileRowFrom_(d.t, r); });
    },
  };
}

// Creates the `tokens` and `profiles` sheets with headers if absent. Safe to run repeatedly.
function setupDataSheet() {
  var ss = SpreadsheetApp.openById(getConfig().dataSheetId);
  [['tokens', TOKEN_HEADERS_, TOKEN_TEXT_COLS_], ['profiles', PROFILE_HEADERS_, PROFILE_TEXT_COLS_]].forEach(function (def) {
    if (ss.getSheetByName(def[0])) return;
    var sheet = ss.insertSheet(def[0]);
    def[1].forEach(function (h, i) {
      if (def[2].indexOf(h) >= 0) sheet.getRange(1, i + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
    sheet.getRange(1, 1, 1, def[1].length).setValues([def[1]]);
    sheet.setFrozenRows(1);
  });
}
