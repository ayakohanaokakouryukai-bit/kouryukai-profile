// Script-property backed configuration for the bridge. Nothing secret is committed.
// Required: WORKER_URL (no trailing slash), SYNC_SECRET, FORM_SHEET_ID, FORM_SHEET_NAME, EMAIL_HEADER,
// DATA_SHEET_ID, ORGANIZER_EMAIL. Optional: CANCEL_HEADER, EXPIRES_AT.

var ALERT_THRESHOLD = 10;
var DEFAULT_EXPIRES_AT = '2027-05-06T23:59:59+09:00';
var RESET_TAB = 'URL作り直し';
var MIRROR_KEYS_TAB = '写し_合鍵';
var MIRROR_PROFILES_TAB = '写し_プロフィール';
var SENDER_NAME = '100人交流会 運営事務局';

var REQUIRED_PROPS_ = [
  ['workerUrl', 'WORKER_URL'],
  ['syncSecret', 'SYNC_SECRET'],
  ['formSheetId', 'FORM_SHEET_ID'],
  ['formSheetName', 'FORM_SHEET_NAME'],
  ['emailHeader', 'EMAIL_HEADER'],
  ['dataSheetId', 'DATA_SHEET_ID'],
  ['organizerEmail', 'ORGANIZER_EMAIL'],
];

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var config = {};
  for (var i = 0; i < REQUIRED_PROPS_.length; i++) {
    var v = props.getProperty(REQUIRED_PROPS_[i][1]);
    if (v == null || String(v).trim() === '') throw new Error('Missing script property: ' + REQUIRED_PROPS_[i][1]);
    config[REQUIRED_PROPS_[i][0]] = String(v).trim();
  }
  config.workerUrl = config.workerUrl.replace(/\/+$/, '');
  var cancel = props.getProperty('CANCEL_HEADER');
  config.cancelHeader = cancel && String(cancel).trim() !== '' ? String(cancel).trim() : 'キャンセル';
  var exp = props.getProperty('EXPIRES_AT');
  config.expiresAt = exp && String(exp).trim() !== '' ? String(exp).trim() : DEFAULT_EXPIRES_AT;
  return config;
}

var RESET_FAILURE_NOTE = '失敗（5分以内に自動で再試行します）';
