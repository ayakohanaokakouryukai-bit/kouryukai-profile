import { el, isHttpUrl } from './meView.js';
import { initialOf } from './text.js';
import { snsLinks } from './snsView.js';

function avatar(p, className = 'avatar') {
  const circle = () => el('div', { className, 'aria-hidden': 'true', text: initialOf(p.name) });
  if (!p.photoUrl) return circle();
  const img = el('img', { className, loading: 'lazy', alt: '', src: p.photoUrl });
  img.addEventListener('error', () => img.replaceWith(circle()));
  return img;
}

// The whole card opens the detail (the name button's ::after covers the card); SNS icons sit above it.
export function participantCard(p, onOpen) {
  const btn = el('button', { type: 'button', className: 'card-open' }, document.createTextNode(p.name || ''));
  btn.addEventListener('click', () => onOpen(p, btn));
  return el('article', { className: 'card card-person' },
    el('div', { className: 'card-head' },
      avatar(p),
      el('div', {},
        el('p', { className: 'card-name' }, btn),
        el('div', { className: 'chips card-fields' },
          ...(p.fields || []).map((f) => el('span', { className: 'chip', text: f }))))),
    el('p', { className: 'card-job', text: p.job || '' }),
    el('p', { className: 'card-challenge', text: `挑戦中：${p.challenge || ''}` }),
    snsLinks(p.sns));
}

function row(label, node) {
  return [el('dt', { text: label }), el('dd', {}, node)];
}

export function detailBody(p) {
  const link = isHttpUrl(p.link)
    ? el('a', { href: p.link, target: '_blank', rel: 'noopener noreferrer', text: p.link })
    : (p.link ? document.createTextNode(p.link) : null);
  return [
    el('div', { className: 'card-head' }, avatar(p, 'avatar avatar-lg'),
      el('h2', { className: 'detail-title', tabIndex: -1 }, document.createTextNode(p.name || ''))),
    el('dl', { className: 'detail detail-plain' },
      ...row('今やっていること', document.createTextNode(p.job || '')),
      ...row('分野', el('div', { className: 'chips', style: 'margin:0' },
        ...(p.fields || []).map((f) => el('span', { className: 'chip', style: 'cursor:default', text: f })))),
      ...row('今挑戦していること', document.createTextNode(p.challenge || '')),
      ...row('得意なこと・力になれること', document.createTextNode(p.strengths || '')),
      ...row('苦手なこと・力を借りたいこと', document.createTextNode(p.needs || '')),
      ...(snsLinks(p.sns, { withIds: true }) ? row('SNS', snsLinks(p.sns, { withIds: true })) : []),
      ...(link ? row('その他のURL', link) : [])),
  ];
}

export function openDetail(p, opener) {
  const closeBtn = el('button', { type: 'button', className: 'btn secondary', text: '閉じる' });
  const dlg = el('dialog', { className: 'detail-dialog', 'aria-label': `${p.name || ''}の詳細` }, ...detailBody(p), closeBtn);
  const done = () => { dlg.remove(); if (opener && opener.isConnected) opener.focus(); };
  closeBtn.addEventListener('click', () => { if (dlg.close) dlg.close(); else done(); });
  document.body.append(dlg);
  if (typeof dlg.showModal === 'function') {
    dlg.addEventListener('close', done);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    dlg.showModal();
    const h = dlg.querySelector('h2');
    if (h) h.focus();
  } else {
    dlg.setAttribute('open', '');
    dlg.classList.add('detail-fallback');
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(); });
    const h = dlg.querySelector('h2');
    (h || closeBtn).focus();
  }
}
