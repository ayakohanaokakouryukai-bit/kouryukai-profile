// Mail texts sent by the app. Fixed wording lives here so it can be reviewed in one place.

var MAIL_LINK_SUBJECT = '【100人交流会】あなた専用のプロフィールページ';
var MAIL_QUOTA_SUBJECT = '【参加者アプリ】メール送信の残りが少なくなっています';

// url: the personal profile page URL (including the #t=... token).
// expiresLabel: human-readable expiry date, e.g. '2027年5月6日'.
function buildLinkMail(url, expiresLabel) {
  var body = [
    '100人交流会にお申し込みいただき、ありがとうございます。',
    'あなた専用のプロフィールページのURLをお送りします。',
    '',
    url,
    '',
    'このページで、プロフィールの登録・編集と、参加者一覧の閲覧ができます。',
    '・このURLは、あなた専用の合鍵です。人に教えないでください。',
    '・URLをなくした場合は、登録ページでもう一度メールアドレスを入力すると再送されます（1日1回まで）。',
    '・このURLは ' + expiresLabel + ' まで使えます。その後、登録内容は削除します。',
    '',
    '※混み合っている場合、このメールが届くまで時間がかかることがあります。',
    '※心当たりがない場合は、このメールを破棄してください。',
    '',
    '100人交流会 運営事務局',
    'ayako.hanaoka.kouryukai@gmail.com',
  ].join('\n');
  return { subject: MAIL_LINK_SUBJECT, body: body };
}

// remaining: number of emails that can still be sent today.
// pendingCount: number of emails waiting to be sent.
function buildQuotaAlertMail(remaining, pendingCount) {
  var body = [
    '本日の残りメール送信数が少なくなっています。',
    '',
    '本日の残り送信可能数: ' + remaining + ' 通',
    '送信待ちのメール: ' + pendingCount + ' 通',
    '',
    '送信待ちのメールは、1時間ごとに自動で再送されます。',
  ].join('\n');
  return { subject: MAIL_QUOTA_SUBJECT, body: body };
}
