// Pure decision rules (ES module port of gas/Rules.js).
import { validateSns } from '../../web/js/sns.js';

export const FIELD_OPTIONS = [
  'IT・Web', 'デザイン・クリエイティブ', '美容・健康', '飲食', '教育・コーチング',
  '士業・金融', 'コミュニティ運営', '会社員', '学生', 'その他',
];

export const REQUIRED_TEXT_LIMITS = { name: 50, job: 200, challenge: 500, strengths: 500, needs: 500 };
export const LINK_MAX = 300;

export function normalizeEmail(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

export function isEligible(rows, email) {
  var target = normalizeEmail(email);
  if (!target) return false;
  for (var i = 0; i < rows.length; i++) {
    if (normalizeEmail(rows[i].email) === target && !rows[i].canceled) return true;
  }
  return false;
}

export function validateProfile(p) {
  p = p || {};
  var errors = {};
  var value = {};
  var textKeys = ['name', 'job'];
  var i;
  for (i = 0; i < textKeys.length; i++) {
    checkRequiredText_(p, textKeys[i], value, errors);
  }

  var fields = p.fields;
  if (!Array.isArray(fields) || fields.length < 1 || fields.length > 3) {
    errors.fields = '1〜3個選んでください';
  } else {
    var seen = {};
    var bad = false;
    for (i = 0; i < fields.length; i++) {
      if (FIELD_OPTIONS.indexOf(fields[i]) < 0 || seen[fields[i]]) bad = true;
      seen[fields[i]] = true;
    }
    if (bad) errors.fields = '選択肢から重複なく選んでください';
    else value.fields = fields.slice();
  }

  var rest = ['challenge', 'strengths', 'needs'];
  for (i = 0; i < rest.length; i++) {
    checkRequiredText_(p, rest[i], value, errors);
  }

  var link = typeof p.link === 'string' ? p.link.trim() : '';
  if (p.link != null && typeof p.link !== 'string') {
    errors.link = 'http:// か https:// で始まるURLを入力してください';
  } else if (link === '') {
    value.link = '';
  } else if (!/^https?:\/\/\S+$/i.test(link)) {
    errors.link = 'http:// か https:// で始まるURLを入力してください';
  } else if (link.length > LINK_MAX) {
    errors.link = LINK_MAX + '文字以内で入力してください';
  } else {
    value.link = link;
  }

  var sns = validateSns(p.sns);
  if (sns.ok) value.sns = sns.value;
  else for (var k in sns.errors) errors['sns_' + k] = sns.errors[k];

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return { ok: true, value: value };
}

function checkRequiredText_(p, key, value, errors) {
  var v = typeof p[key] === 'string' ? p[key].trim() : '';
  if (v === '') errors[key] = '入力してください';
  else if (v.length > REQUIRED_TEXT_LIMITS[key]) errors[key] = REQUIRED_TEXT_LIMITS[key] + '文字以内で入力してください';
  else value[key] = v;
}

export function isComplete(profile) {
  if (!profile) return false;
  var keys = ['name', 'job', 'challenge', 'strengths', 'needs'];
  for (var i = 0; i < keys.length; i++) {
    var v = profile[keys[i]];
    if (typeof v !== 'string' || v.trim() === '') return false;
  }
  return Array.isArray(profile.fields) && profile.fields.length >= 1;
}

export function isVisible(row) {
  return !!row && row.consent === true && isComplete(row.profile);
}

export function isExpired(now, expiresAtIso) {
  return now.getTime() > new Date(expiresAtIso).getTime();
}

function jstShifted_(d) {
  return new Date(d.getTime() + 9 * 60 * 60 * 1000);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

export function jstDate(d) {
  var j = jstShifted_(d);
  return j.getUTCFullYear() + '-' + pad2_(j.getUTCMonth() + 1) + '-' + pad2_(j.getUTCDate());
}

export function formatJstDateLabel(iso) {
  var j = jstShifted_(new Date(iso));
  return j.getUTCFullYear() + '年' + (j.getUTCMonth() + 1) + '月' + j.getUTCDate() + '日';
}

export function canSendToday(lastSentDate, now) {
  return !lastSentDate || lastSentDate !== jstDate(now);
}

export function toPublicProfile(row) {
  var p = row.profile || {};
  return {
    name: p.name,
    job: p.job,
    fields: p.fields,
    challenge: p.challenge,
    strengths: p.strengths,
    needs: p.needs,
    link: p.link || '',
    sns: p.sns || {},
    photoUrl: p.photoUrl || '',
  };
}
