// Script-property backed configuration. Secrets (sheet/folder IDs) live only in script properties.

var REQUIRED_PROPS_ = [
  ['formSheetId', 'FORM_SHEET_ID'],
  ['formSheetName', 'FORM_SHEET_NAME'],
  ['emailHeader', 'EMAIL_HEADER'],
  ['dataSheetId', 'DATA_SHEET_ID'],
  ['photoFolderId', 'PHOTO_FOLDER_ID'],
  ['appBaseUrl', 'APP_BASE_URL'],
  ['organizerEmail', 'ORGANIZER_EMAIL'],
  ['expiresAt', 'EXPIRES_AT'],
];

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var config = {};
  for (var i = 0; i < REQUIRED_PROPS_.length; i++) {
    var v = props.getProperty(REQUIRED_PROPS_[i][1]);
    if (v == null || String(v).trim() === '') throw new Error('Missing script property: ' + REQUIRED_PROPS_[i][1]);
    config[REQUIRED_PROPS_[i][0]] = String(v).trim();
  }
  // Fail closed: isExpired() would treat an unparsable date as "never expires".
  if (isNaN(new Date(config.expiresAt).getTime())) throw new Error('EXPIRES_AT is not a valid date');
  config.appBaseUrl = config.appBaseUrl.replace(/\/+$/, '');
  var cancel = props.getProperty('CANCEL_HEADER');
  config.cancelHeader = cancel && String(cancel).trim() !== '' ? String(cancel).trim() : 'キャンセル';
  return config;
}
