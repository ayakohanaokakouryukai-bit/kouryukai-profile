// Request handling. Everything external comes in through `deps` so Node can test it.

var ALERT_THRESHOLD = 10;
var MAX_PHOTO_BASE64_CHARS = 2000000;

function handleRequest(req, deps) {
  try {
    req = req || {};
    switch (req.action) {
      case 'requestLink': return deps.withLock(function () { return requestLink_(req, deps); });
      case 'getMe': return getMe_(req, deps);
      case 'saveProfile': return deps.withLock(function () { return saveProfile_(req, deps); });
      case 'uploadPhoto': return deps.withLock(function () { return uploadPhoto_(req, deps); });
      case 'deletePhoto': return deps.withLock(function () { return deletePhoto_(req, deps); });
      case 'withdrawConsent': return deps.withLock(function () { return withdrawConsent_(req, deps); });
      case 'getList': return getList_(req, deps);
      default: return { ok: false, error: 'server_error' };
    }
  } catch (err) {
    console.error('handleRequest failed: ' + (err && err.message));
    return { ok: false, error: 'server_error' };
  }
}

function fail_(error) {
  return { ok: false, error: error };
}

// token -> row -> still eligible -> not expired. Returns {ok:true, email} or an error response.
function authorize_(token, deps) {
  if (typeof token !== 'string' || token.trim() === '') return fail_('invalid_token');
  var row = deps.store.getTokenRowByToken(token);
  if (!row) return fail_('invalid_token');
  if (!isEligible(deps.store.readApplicants(), row.email)) return fail_('invalid_token');
  if (isExpired(deps.now(), deps.config.expiresAt)) return fail_('expired');
  return { ok: true, email: normalizeEmail(row.email) };
}

// The URL is built at send time so a changed APP_BASE_URL takes effect; row.url is refreshed to match.
function sendLinkMail_(row, deps) {
  row.url = deps.config.appBaseUrl + '/me.html#t=' + row.token;
  var mail = buildLinkMail(row.url, formatJstDateLabel(deps.config.expiresAt));
  deps.mail.send(row.email, mail);
}

function maybeAlertOrganizer_(deps) {
  var remaining = deps.mail.remaining();
  if (remaining < ALERT_THRESHOLD && remaining > 0 && !deps.alerts.alreadySentToday()) {
    var pendingCount = deps.store.listPendingTokenRows().length;
    deps.mail.send(deps.config.organizerEmail, buildQuotaAlertMail(remaining, pendingCount));
    deps.alerts.markSentToday();
  }
}

// Always {ok:true}: a failure on the applicant-only path must not reveal who is an applicant.
function requestLink_(req, deps) {
  try {
    requestLinkWork_(req, deps);
  } catch (err) {
    console.error('requestLink failed: ' + (err && err.message));
  }
  return { ok: true };
}

function requestLinkWork_(req, deps) {
  var email = normalizeEmail(req.email);
  var now = deps.now();
  if (!email || !isEligible(deps.store.readApplicants(), email) || isExpired(now, deps.config.expiresAt)) return;
  var row = deps.store.getTokenRowByEmail(email) || { email: email, token: '', url: '', issuedAt: '', lastSentDate: '', pending: false };
  if (!row.token) {
    row.token = deps.newToken();
    row.url = deps.config.appBaseUrl + '/me.html#t=' + row.token;
    row.issuedAt = now.toISOString();
    deps.store.upsertTokenRow(row); // persist the token before any mail carries it
  }
  if (canSendToday(row.lastSentDate, now)) {
    if (deps.mail.remaining() > 0) {
      sendLinkMail_(row, deps);
      row.lastSentDate = jstDate(now);
      row.pending = false;
    } else {
      row.pending = true;
    }
    deps.store.upsertTokenRow(row);
  }
  maybeAlertOrganizer_(deps);
}

function getMe_(req, deps) {
  var auth = authorize_(req.token, deps);
  if (!auth.ok) return auth;
  var row = deps.store.getProfileRow(auth.email);
  return {
    ok: true,
    profile: row && row.profile ? row.profile : null,
    consent: !!(row && row.consent),
    visible: isVisible(row),
    expiresAt: deps.config.expiresAt,
  };
}

function emptyProfileRow_(email) {
  return { email: email, profile: null, photoFileId: '', consent: false, consentAt: '', updatedAt: '', staff: '' };
}

function saveProfile_(req, deps) {
  var auth = authorize_(req.token, deps);
  if (!auth.ok) return auth;
  var existing = deps.store.getProfileRow(auth.email);
  if (req.consent !== true && !(existing && existing.consent === true)) return fail_('consent_required');
  var v = validateProfile(req.profile);
  if (!v.ok) return { ok: false, error: 'validation', fieldErrors: v.fieldErrors };
  var row = existing || emptyProfileRow_(auth.email);
  var nowIso = deps.now().toISOString();
  var profile = v.value;
  profile.photoUrl = (existing && existing.profile && existing.profile.photoUrl) || '';
  row.profile = profile;
  row.consent = true;
  row.consentAt = row.consentAt || nowIso;
  row.updatedAt = nowIso;
  deps.store.upsertProfileRow(row);
  deps.cache.invalidate();
  return { ok: true, profile: profile, visible: isVisible(row) };
}

function uploadPhoto_(req, deps) {
  var auth = authorize_(req.token, deps);
  if (!auth.ok) return auth;
  if (req.mimeType !== 'image/jpeg' || typeof req.base64 !== 'string' || req.base64 === '') return fail_('bad_image');
  // JPEG starts FF D8 FF, which is '/9j/' in base64. Cap size to protect Drive and the 6 min limit.
  if (req.base64.length > MAX_PHOTO_BASE64_CHARS || req.base64.indexOf('/9j/') !== 0) return fail_('bad_image');
  var row = deps.store.getProfileRow(auth.email) || emptyProfileRow_(auth.email);
  var saved = deps.photo.save(req.base64, req.mimeType);
  var oldId = row.photoFileId;
  row.photoFileId = saved.fileId;
  row.profile = row.profile || {};
  row.profile.photoUrl = saved.url;
  row.updatedAt = deps.now().toISOString();
  deps.store.upsertProfileRow(row);
  deps.cache.invalidate();
  trashQuietly_(oldId, deps);
  return { ok: true, photoUrl: saved.url };
}

// Trashing the old file is best effort: the row already points away from it.
function trashQuietly_(fileId, deps) {
  if (!fileId) return;
  try {
    deps.photo.trash(fileId);
  } catch (err) {
    console.error('photo.trash failed: ' + (err && err.message));
  }
}

function deletePhoto_(req, deps) {
  var auth = authorize_(req.token, deps);
  if (!auth.ok) return auth;
  var row = deps.store.getProfileRow(auth.email);
  if (row && (row.photoFileId || (row.profile && row.profile.photoUrl))) {
    var oldId = row.photoFileId;
    row.photoFileId = '';
    if (row.profile) row.profile.photoUrl = '';
    row.updatedAt = deps.now().toISOString();
    deps.store.upsertProfileRow(row);
    deps.cache.invalidate();
    trashQuietly_(oldId, deps);
    return { ok: true };
  }
  deps.cache.invalidate();
  return { ok: true };
}

function withdrawConsent_(req, deps) {
  var auth = authorize_(req.token, deps);
  if (!auth.ok) return auth;
  var row = deps.store.getProfileRow(auth.email);
  if (row) {
    row.consent = false;
    row.updatedAt = deps.now().toISOString();
    deps.store.upsertProfileRow(row);
  }
  deps.cache.invalidate();
  return { ok: true };
}

function getList_(req, deps) {
  var auth = authorize_(req.token, deps);
  if (!auth.ok) return auth;
  if (!isVisible(deps.store.getProfileRow(auth.email))) return fail_('not_visible');
  var list = deps.cache.getList();
  if (!list) {
    var gen = deps.cache.generation(); // read BEFORE building: a concurrent invalidate makes putList a no-op
    var applicants = deps.store.readApplicants();
    var rows = deps.store.listProfileRows().filter(function (r) {
      return isVisible(r) && isEligible(applicants, r.email);
    });
    rows.sort(function (a, b) {
      return String(b.consentAt || '') < String(a.consentAt || '') ? -1 : String(b.consentAt || '') > String(a.consentAt || '') ? 1 : 0;
    });
    list = rows.map(function (r) { return toPublicProfile(r); });
    deps.cache.putList(list, gen);
  }
  return { ok: true, participants: list, generatedAt: deps.now().toISOString() };
}

// Called by the hourly trigger (Main.js holds the lock).
function processPending(deps) {
  var now = deps.now();
  var applicants = deps.store.readApplicants();
  var expired = isExpired(now, deps.config.expiresAt);
  var rows = deps.store.listPendingTokenRows();
  var sent = 0;
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    if (deps.mail.remaining() <= 0) break;
    if (!canSendToday(row.lastSentDate, now)) continue; // already sent today: leave pending
    if (!row.token) {
      row.pending = false;
      deps.store.upsertTokenRow(row);
      continue;
    }
    if (!expired && isEligible(applicants, row.email)) {
      try {
        sendLinkMail_(row, deps);
        row.lastSentDate = jstDate(now);
        sent++;
      } catch (err) {
        // One bad address must not block the batch or every later hourly run: drop pending, keep lastSentDate empty.
        console.error('processPending send failed: ' + (err && err.message));
      }
    }
    row.pending = false;
    deps.store.upsertTokenRow(row);
  }
  maybeAlertOrganizer_(deps);
  return { sent: sent, stillPending: deps.store.listPendingTokenRows().length };
}
