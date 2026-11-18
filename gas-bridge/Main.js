// Entry points and trigger setup.

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  if (typeof LockService === 'undefined') return fn();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return undefined; // busy: the next trigger run catches up
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var res;
  try {
    var req = JSON.parse(e.postData.contents);
    res = handleSendLink_(getConfig(), req && typeof req === 'object' ? req : {});
  } catch (err) {
    console.error('doPost failed: ' + (err && err.message));
    res = { ok: false, error: 'server_error' };
  }
  return jsonOutput_(res);
}

function doGet() {
  return jsonOutput_({ ok: true });
}

function pushApplicants() { withLock_(function () { pushApplicantsCore_(getConfig()); }); }
function processResets() { withLock_(function () { processResetsCore_(getConfig()); }); }
function mirror() { withLock_(function () { mirrorCore_(getConfig()); }); }
function resendPending() { withLock_(function () { resendPendingCore_(getConfig()); }); }
function migrateFromOldTabs() { migrateCore_(getConfig()); }

function onFormSubmitTrigger() {
  try { pushApplicants(); } catch (err) { console.error('onFormSubmitTrigger failed: ' + (err && err.message)); }
}

function onEditTrigger(e) {
  try {
    var config = getConfig();
    var sheet = e && e.range && e.range.getSheet();
    if (!sheet) return;
    var name = sheet.getName();
    var id = e.source && e.source.getId();
    if (id === config.formSheetId && name === config.formSheetName) pushApplicants();
    else if (id === config.dataSheetId && name === RESET_TAB) processResets();
  } catch (err) {
    console.error('onEditTrigger failed: ' + (err && err.message));
  }
}

function timerEvery5Min() {
  try { pushApplicants(); } catch (err) { console.error('push failed: ' + (err && err.message)); }
  try { processResets(); } catch (err) { console.error('processResets failed: ' + (err && err.message)); }
  try { mirror(); } catch (err) { console.error('mirror failed: ' + (err && err.message)); }
}

function hourlyResend() {
  try { resendPending(); } catch (err) { console.error('resendPending failed: ' + (err && err.message)); }
}

// Run once from the editor. Removes older copies of our handlers first, so it is safe to re-run.
function setupTriggers() {
  var config = getConfig();
  var ours = ['onFormSubmitTrigger', 'onEditTrigger', 'timerEvery5Min', 'hourlyResend'];
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (ours.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  var form = SpreadsheetApp.openById(config.formSheetId);
  var data = SpreadsheetApp.openById(config.dataSheetId);
  ScriptApp.newTrigger('onFormSubmitTrigger').forSpreadsheet(form).onFormSubmit().create();
  ScriptApp.newTrigger('onEditTrigger').forSpreadsheet(form).onEdit().create();
  if (config.dataSheetId !== config.formSheetId) ScriptApp.newTrigger('onEditTrigger').forSpreadsheet(data).onEdit().create();
  ScriptApp.newTrigger('timerEvery5Min').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('hourlyResend').timeBased().everyHours(1).create();
}

// Creates the reset tab and the two mirror tabs if missing. Safe to re-run.
function setupTabs() {
  var ss = SpreadsheetApp.openById(getConfig().dataSheetId);
  function ensure(name, headers) {
    if (ss.getSheetByName(name)) return;
    var sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setNumberFormat('@');
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  ensure(RESET_TAB, ['メールアドレス', '結果']);
  ensure(MIRROR_KEYS_TAB, MIRROR_KEYS_HEADERS);
  ensure(MIRROR_PROFILES_TAB, MIRROR_PROFILES_HEADERS);
}
