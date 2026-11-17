import { callApi } from './api.js';
import { resizeToJpegBase64 } from './photo.js';
import { formatJstDateLabel } from './dates.js';

export const KEY_NOTICE = 'このページのURLは、あなた専用の合鍵です。人に教えないでください。';
export const BAD_IMAGE = 'この画像は使えません。別の画像を選んでください。';

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

export function noticeBox(text) {
  return el('p', { className: 'notice', text });
}

export function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

export function consentView(expiresAt, onAgree) {
  const items = [
    '・目的：100人交流会の参加者どうしが、事前・当日・終了後に交流するために使います。',
    '・公開範囲：この交流会の申込者のうち、プロフィールの公開に同意した方だけが見られます。',
    '・公開する項目：名前、今やっていること、分野、今挑戦していること、得意なこと・力になれること、苦手なこと・力を借りたいこと、Web・SNSのリンク、写真。メールアドレスは公開しません。',
    `・期間：${formatJstDateLabel(expiresAt)} まで。その後、登録内容は削除します。`,
    '・同意はいつでも取り消せます。取り消すと一覧から消え、ほかの方のプロフィールも見られなくなります。',
    '・お問い合わせ：ayako.hanaoka.kouryukai@gmail.com',
  ];
  const check = el('input', { type: 'checkbox', id: 'agree' });
  const btn = el('button', { type: 'button', className: 'btn', text: '次へ進む', disabled: true });
  check.addEventListener('change', () => { btn.disabled = !check.checked; });
  btn.addEventListener('click', () => { if (check.checked) onAgree(); });
  return el('section', {},
    el('h2', { text: '参加者プロフィールの公開について' }),
    el('div', { className: 'detail' }, ...items.map((t) => el('p', { text: t }))),
    el('p', {}, el('label', { htmlFor: 'agree', style: 'display:flex;gap:8px;align-items:flex-start;font-weight:600' },
      check, el('span', { text: '上記に同意して、プロフィールを公開します' }))),
    btn);
}

export function photoControl(token, profile) {
  const msg = el('p', { className: 'field-error', role: 'alert', hidden: true });
  const holder = el('div', { className: 'card-head' });
  const input = el('input', { type: 'file', accept: 'image/*', id: 'photo-input' });
  const del = el('button', { type: 'button', className: 'btn secondary', text: '写真を削除' });

  function paint() {
    const url = profile.photoUrl;
    holder.replaceChildren(url
      ? el('img', { className: 'avatar', src: url, alt: 'あなたの写真' })
      : el('div', { className: 'avatar', 'aria-hidden': 'true', text: '👤' }));
    del.hidden = !url;
  }
  function fail(text) { msg.textContent = text; msg.hidden = false; }

  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    msg.hidden = true;
    let base64;
    try { base64 = await resizeToJpegBase64(file); } catch (e) { fail(BAD_IMAGE); input.value = ''; return; }
    const r = await callApi('uploadPhoto', { token, base64, mimeType: 'image/jpeg' });
    input.value = '';
    if (r && r.ok) { profile.photoUrl = r.photoUrl; paint(); }
    else fail(r && r.error === 'bad_image' ? BAD_IMAGE : '写真を送れませんでした。時間をおいてもう一度お試しください。');
  });
  del.addEventListener('click', async () => {
    msg.hidden = true;
    const r = await callApi('deletePhoto', { token });
    if (r && r.ok) { profile.photoUrl = ''; paint(); }
    else fail('写真を削除できませんでした。時間をおいてもう一度お試しください。');
  });
  paint();
  return el('div', { className: 'field' },
    el('label', { htmlFor: 'photo-input', text: '写真（任意）' }), holder, input, del, msg);
}

// Read-only photo for the profile view; uploading and deleting happen only on the edit screen.
function photoDisplay(profile) {
  const url = profile.photoUrl;
  return el('div', { className: 'card-head', style: 'margin-bottom:12px' }, url
    ? el('img', { className: 'avatar', src: url, alt: 'あなたの写真' })
    : el('div', { className: 'avatar', 'aria-hidden': 'true', text: '👤' }));
}

function row(label, node) {
  return [el('dt', { text: label }), el('dd', {}, node)];
}

export function profileView(profile, handlers) {
  const p = profile;
  const link = isHttpUrl(p.link)
    ? el('a', { href: p.link, target: '_blank', rel: 'noopener noreferrer', text: p.link })
    : (p.link ? document.createTextNode(p.link) : null);
  const chips = el('div', { className: 'chips', style: 'margin:0' },
    ...(p.fields || []).map((f) => el('span', { className: 'chip', style: 'cursor:default', text: f })));
  const dl = el('dl', { className: 'detail' },
    ...row('名前', document.createTextNode(p.name || '')),
    ...row('今やっていること', document.createTextNode(p.job || '')),
    ...row('分野', chips),
    ...row('今挑戦していること', document.createTextNode(p.challenge || '')),
    ...row('得意なこと・力になれること', document.createTextNode(p.strengths || '')),
    ...row('苦手なこと・力を借りたいこと', document.createTextNode(p.needs || '')),
    ...(link ? row('Web・SNSのリンク', link) : []));
  return el('section', {},
    handlers.saved ? el('p', { className: 'notice', role: 'status', text: '保存しました' }) : null,
    photoDisplay(p),
    dl,
    el('button', { type: 'button', className: 'btn', text: '編集する', onclick: handlers.onEdit }),
    el('p', {}, el('a', { href: `list.html#t=${handlers.token}`, text: '参加者一覧を見る' })),
    el('p', { className: 'muted', text: KEY_NOTICE }),
    el('p', { className: 'muted', style: 'font-size:0.8rem' },
      el('a', { href: '#', text: '公開をやめる', onclick: (e) => { e.preventDefault(); handlers.onWithdraw(); } })));
}
