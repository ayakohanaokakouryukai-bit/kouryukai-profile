import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGas } from './gas-harness.js';

const ctx = loadGas();
const { buildLinkMail, buildQuotaAlertMail } = ctx;

test('link mail contains url, no-share warning and expiry', () => {
  const m = buildLinkMail('https://x.github.io/app/me.html#t=abc', '2027年5月6日');
  assert.equal(m.subject, '【100人交流会】あなた専用のプロフィールページ');
  assert.match(m.body, /me\.html#t=abc/);
  assert.match(m.body, /人に教えないでください/);
  assert.match(m.body, /2027年5月6日/);
});

test('link mail body matches the fixed text exactly', () => {
  const m = buildLinkMail('https://x.github.io/app/me.html#t=abc', '2027年5月6日');
  const expected = [
    '100人交流会にお申し込みいただき、ありがとうございます。',
    'あなた専用のプロフィールページのURLをお送りします。',
    '',
    'https://x.github.io/app/me.html#t=abc',
    '',
    'このページで、プロフィールの登録・編集と、参加者一覧の閲覧ができます。',
    '・このURLは、あなた専用の合鍵です。人に教えないでください。',
    '・URLをなくした場合は、登録ページでもう一度メールアドレスを入力すると再送されます（1日1回まで）。',
    '・このURLは 2027年5月6日 まで使えます。その後、登録内容は削除します。',
    '',
    '※混み合っている場合、このメールが届くまで時間がかかることがあります。',
    '※心当たりがない場合は、このメールを破棄してください。',
    '',
    '100人交流会 運営事務局',
    'ayako.hanaoka.kouryukai@gmail.com',
  ].join('\n');
  assert.equal(m.body, expected);
});

test('quota alert mail has the fixed subject and states both numbers', () => {
  const m = buildQuotaAlertMail(7, 12);
  assert.equal(m.subject, '【参加者アプリ】メール送信の残りが少なくなっています');
  assert.match(m.body, /7/);
  assert.match(m.body, /12/);
  assert.match(m.body, /1時間ごと|毎時/);
});
