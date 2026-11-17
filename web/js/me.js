import { callApi } from './api.js';
import { readToken, clearToken } from './token.js';
import { clearList } from './listCache.js';
import { FIELD_OPTIONS, LIMITS } from './fields.js';
import { el, noticeBox, consentView, profileView, photoControl } from './meView.js';

const app = document.getElementById('app');
const statusBar = document.getElementById('status-bar');
const LABELS = {
  name: '名前', job: '今やっていること（仕事）', fields: '分野', challenge: '今挑戦していること',
  strengths: '得意なこと・力になれること', needs: '苦手なこと・力を借りたいこと', link: 'Web・SNSのリンク（任意）',
};
const REQUIRED = ['name', 'job', 'challenge', 'strengths', 'needs'];
const MULTILINE = new Set(['challenge', 'strengths', 'needs']);

let token = null;
let expiresAt = '';
let profile = {};

function setStatus(text) {
  statusBar.textContent = text;
  statusBar.hidden = !text;
}
function show(...nodes) { app.replaceChildren(...nodes); }
const isRegistered = (consent) => consent === true;

function showInvalid() {
  clearList(localStorage);
  show(el('p', { className: 'notice' }, document.createTextNode('このURLは使えません。登録ページからもう一度メールアドレスを入力してください。')),
    el('p', {}, el('a', { href: 'index.html', text: '登録ページへ' })));
}
function showExpired() {
  clearList(localStorage);
  show(noticeBox('公開期間は終了しました。ご参加ありがとうございました。'));
}
function showNetwork() {
  show(el('p', { className: 'field-error', role: 'alert', text: '通信できませんでした。時間をおいて開き直してください。' }),
    el('button', { type: 'button', className: 'btn secondary', text: '再読み込み', onclick: () => location.reload() }));
}

function showConsent() {
  clearList(localStorage);
  show(consentView(expiresAt, () => showForm()));
}

function showProfile(saved = false) {
  show(profileView(profile, {
    token, saved,
    onEdit: () => showForm(),
    onWithdraw: async () => {
      if (!confirm('プロフィールの公開をやめますか？一覧から消え、ほかの方のプロフィールも見られなくなります。')) return;
      const r = await callApi('withdrawConsent', { token }, { onRetry: () => setStatus('読み込み中…') });
      setStatus('');
      if (r && r.ok) showConsent();
      else handleFailure(r);
    },
  }));
}

function handleFailure(r) {
  if (r && r.error === 'expired') showExpired();
  else if (r && r.error === 'invalid_token') showInvalid();
  else window.alert('通信できませんでした。時間をおいてもう一度お試しください。');
}

function clientValidate(v) {
  const errs = {};
  for (const k of REQUIRED) {
    if (!v[k].trim()) errs[k] = `${LABELS[k].replace('（任意）', '')}を入力してください。`;
    else if (v[k].length > LIMITS[k]) errs[k] = `${LIMITS[k]}文字以内で入力してください。`;
  }
  if (v.fields.length < 1 || v.fields.length > 3) errs.fields = '分野は1〜3個選んでください。';
  if (v.link) {
    if (!/^https?:\/\//i.test(v.link)) errs.link = 'http:// か https:// で始まるURLを入力してください。';
    else if (v.link.length > LIMITS.link) errs.link = `${LIMITS.link}文字以内で入力してください。`;
  }
  return errs;
}

function showForm() {
  const inputs = {};
  const errEls = {};
  const nodes = [];

  for (const key of ['name', 'job']) {
    const input = el('input', { type: 'text', id: key, value: profile[key] || '', maxLength: LIMITS[key], 'aria-describedby': `err-${key}` });
    inputs[key] = input;
    nodes.push(fieldBlock(key, input));
  }
  // 分野
  const boxes = FIELD_OPTIONS.map((opt, i) => el('input', {
    type: 'checkbox', id: `field-${i}`, value: opt, checked: (profile.fields || []).includes(opt),
  }));
  const syncBoxes = () => {
    const n = boxes.filter((b) => b.checked).length;
    for (const b of boxes) b.disabled = n >= 3 && !b.checked;
  };
  boxes.forEach((b) => b.addEventListener('change', syncBoxes));
  syncBoxes();
  const fieldsErr = el('p', { className: 'field-error', id: 'err-fields', hidden: true });
  errEls.fields = fieldsErr;
  nodes.push(el('fieldset', { className: 'field', style: 'border:0;padding:0;margin:0 0 16px', 'aria-describedby': 'err-fields' },
    el('legend', { text: `${LABELS.fields}（1〜3個）`, style: 'font-weight:600;padding:0;margin-bottom:4px' }),
    ...boxes.map((b, i) => el('label', { htmlFor: b.id, style: 'display:flex;gap:8px;align-items:center;font-weight:400;min-height:36px' },
      b, el('span', { text: FIELD_OPTIONS[i] }))),
    fieldsErr));
  for (const key of ['challenge', 'strengths', 'needs']) {
    const ta = el('textarea', { id: key, value: profile[key] || '', maxLength: LIMITS[key], 'aria-describedby': `err-${key}` });
    inputs[key] = ta;
    nodes.push(fieldBlock(key, ta));
  }
  const linkInput = el('input', { type: 'url', id: 'link', value: profile.link || '', maxLength: LIMITS.link, inputMode: 'url', 'aria-describedby': 'err-link' });
  inputs.link = linkInput;
  nodes.push(fieldBlock('link', linkInput));

  function fieldBlock(key, control) {
    const counter = el('p', { className: 'muted', 'aria-hidden': 'true', style: 'margin:2px 0 0;text-align:right' });
    const update = () => { counter.textContent = `${control.value.length} / ${LIMITS[key]}`; };
    control.addEventListener('input', update);
    update();
    const err = el('p', { className: 'field-error', id: `err-${key}`, hidden: true });
    errEls[key] = err;
    return el('div', { className: 'field' },
      el('label', { htmlFor: key, text: LABELS[key] }), control, counter, err);
  }

  const submit = el('button', { type: 'submit', className: 'btn', text: '保存する' });
  const form = el('form', { noValidate: true }, ...nodes, submit);

  function showErrors(errs) {
    let first = null;
    for (const [k, node] of Object.entries(errEls)) {
      const text = errs[k];
      node.textContent = text || '';
      node.hidden = !text;
      const target = k === 'fields' ? boxes[0] : inputs[k];
      if (target) target.setAttribute('aria-invalid', text ? 'true' : 'false');
      if (text && !first) first = target;
    }
    if (first) first.focus();
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    const v = { fields: boxes.filter((b) => b.checked).map((b) => b.value) };
    for (const k of [...REQUIRED, 'link']) v[k] = inputs[k].value;
    v.link = v.link.trim();
    const errs = clientValidate(v);
    showErrors(errs);
    if (Object.keys(errs).length) return;

    submit.disabled = true;
    submit.textContent = '保存中…';
    const r = await callApi('saveProfile', { token, profile: v, consent: true }, { onRetry: () => setStatus('読み込み中…') });
    setStatus('');
    submit.disabled = false;
    submit.textContent = '保存する';
    if (r && r.ok) {
      profile = { ...profile, ...(r.profile || v) };
      showProfile(true);
    } else if (r && r.error === 'validation') {
      showErrors(r.fieldErrors || {});
    } else if (r && r.error === 'consent_required') {
      showConsent();
    } else {
      handleFailure(r);
    }
  });

  show(el('h2', { text: 'プロフィール' }), photoControl(token, profile), form);
}

async function init() {
  token = readToken(location, localStorage);
  if (!token) { showInvalid(); return; }
  const r = await callApi('getMe', { token }, { onRetry: () => setStatus('読み込み中…') });
  setStatus('');
  if (!r || !r.ok) {
    if (r && r.error === 'expired') showExpired();
    else if (r && r.error === 'invalid_token') { clearToken(localStorage); showInvalid(); }
    else showNetwork();
    return;
  }
  expiresAt = r.expiresAt;
  profile = r.profile || {};
  if (isRegistered(r.consent)) showProfile();
  else showConsent();
}

init();
