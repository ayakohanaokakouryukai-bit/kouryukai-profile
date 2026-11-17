// Web app entry points and trigger setup.

function buildDeps() {
  var config = getConfig();
  var now = function () { return new Date(); };
  return {
    config: config,
    now: now,
    newToken: newToken_,
    withLock: withLock_,
    store: makeStore_(config),
    mail: makeMail_(),
    photo: makePhoto_(config, now),
    cache: makeCache_(),
    alerts: makeAlerts_(now),
  };
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    res = handleRequest(req, buildDeps());
  } catch (err) {
    console.error('doPost failed: ' + (err && err.message));
    res = { ok: false, error: 'server_error' };
  }
  return jsonOutput_(res);
}

function doGet() {
  return jsonOutput_({ ok: true });
}

// Hourly trigger: resend pending link mails. Skips silently when another request holds the lock.
function processPendingTrigger() {
  try {
    withLock_(function () { return processPending(buildDeps()); });
  } catch (err) {
    console.error('processPendingTrigger failed: ' + (err && err.message));
  }
}

// Run from the editor after marking someone in the キャンセル column, to apply it immediately
// instead of within AUTH_CACHE_TTL_ (5 minutes). Also drops the cached participant list.
function applyCancellationsNow() {
  makeCache_().invalidate();
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processPendingTrigger') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processPendingTrigger').timeBased().everyHours(1).create();
}
