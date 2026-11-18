// SNS icons, link rows and the edit-form block. DOM helpers; the rules live in sns.js.
import { SNS_LIST, snsEntries, validateSns } from './sns.js';
import { SNS_ICON_PATHS } from './snsIcons.js';
import { el } from './meView.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function snsIcon(key) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', SNS_ICON_PATHS[key] || '');
  svg.append(path);
  return svg;
}

// Row of round brand buttons that open each profile in a new tab. withIds adds "@id" labels (detail views).
export function snsLinks(sns, { withIds = false } = {}) {
  const items = snsEntries(sns);
  if (!items.length) return null;
  return el('div', { className: withIds ? 'sns-row sns-row-ids' : 'sns-row' },
    ...items.map((s) => {
      const a = el('a', {
        className: `sns-link sns-${s.key}`, href: s.url, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': `${s.label}（${s.key === 'facebook' ? s.id : '@' + s.id}）を開く`,
      }, el('span', { className: 'sns-badge' }, snsIcon(s.key)));
      if (withIds) a.append(el('span', { className: 'sns-id', text: s.key === 'facebook' ? s.id : '@' + s.id }));
      return a;
    }));
}

// Edit-form block: one row per SNS (icon, "@" prefix, id input). read() returns the raw values.
export function snsFormBlock(sns) {
  const inputs = {};
  const errEls = {};
  const rows = SNS_LIST.map((s) => {
    const id = `sns-${s.key}`;
    const input = el('input', {
      type: 'text', id, value: (sns && sns[s.key]) || '', autocapitalize: 'off', autocomplete: 'off', spellcheck: false,
      placeholder: s.at ? 'ID' : 'ユーザー名', 'aria-describedby': `err-sns_${s.key}`, maxLength: 120,
    });
    inputs[s.key] = input;
    const err = el('p', { className: 'field-error', id: `err-sns_${s.key}`, hidden: true });
    errEls[`sns_${s.key}`] = err;
    return el('div', { className: 'sns-field' },
      el('label', { htmlFor: id, className: 'sns-field-label' },
        el('span', { className: `sns-badge sns-${s.key}` }, snsIcon(s.key)), el('span', { text: s.label })),
      el('div', { className: 'sns-input' }, el('span', { className: s.at ? 'sns-at' : 'sns-at sns-at-none', 'aria-hidden': 'true', text: '@' }), input),
      err);
  });
  const node = el('fieldset', { className: 'field sns-fieldset' },
    el('legend', { text: 'SNS（任意）' }),
    el('p', { className: 'muted', style: 'margin:0 0 8px', text: 'IDだけでOKです。プロフィールのURLを貼っても大丈夫です。' }),
    ...rows);
  return {
    node, inputs, errEls,
    read: () => Object.fromEntries(SNS_LIST.map((s) => [s.key, inputs[s.key].value])),
    validate: (raw) => {
      const r = validateSns(raw);
      if (r.ok) return { value: r.value, errors: {} };
      return { value: null, errors: Object.fromEntries(Object.entries(r.errors).map(([k, v]) => [`sns_${k}`, v])) };
    },
  };
}
