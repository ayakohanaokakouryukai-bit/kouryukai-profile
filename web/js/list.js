import { callApi } from './api.js';
import { readToken, clearToken } from './token.js';
import { FIELD_OPTIONS } from './fields.js';
import { filterParticipants } from './search.js';
import { loadList, saveList, clearList } from './listCache.js';
import { el, noticeBox } from './meView.js';
import { participantCard, openDetail } from './listView.js';

const app = document.getElementById('app');
const statusBar = document.getElementById('status-bar');

let token = null;
let participants = [];
let query = '';
const selected = new Set();
let listBox = null;
let countEl = null;
let noteEl = null;

function setStatus(text) {
  statusBar.textContent = text;
  statusBar.hidden = !text;
}
function show(...nodes) { app.replaceChildren(...nodes); listBox = null; countEl = null; noteEl = null; }

function showInvalid() {
  clearList(localStorage);
  show(el('p', { className: 'notice' }, document.createTextNode('このURLは使えません。登録ページからもう一度メールアドレスを入力してください。')),
    el('p', {}, el('a', { href: 'index.html', text: '登録ページへ' })));
}
function showExpired() {
  clearList(localStorage);
  show(noticeBox('公開期間は終了しました。ご参加ありがとうございました。'));
}
function showNotVisible() {
  clearList(localStorage);
  show(el('p', { className: 'notice', text: '一覧を見るには、プロフィールを公開してください。' }),
    el('p', {}, el('a', { href: `me.html#t=${token}`, text: 'マイページへ' })));
}
function showNetworkOnly() {
  show(el('p', { className: 'field-error', role: 'alert', text: '通信できませんでした。時間をおいて開き直してください。' }),
    el('button', { type: 'button', className: 'btn secondary', text: '再読み込み', onclick: () => location.reload() }));
}

function renderList() {
  if (!listBox) return;
  const y = window.scrollY;
  const rows = filterParticipants(participants, query, [...selected]);
  countEl.textContent = `${rows.length}人`;
  if (!rows.length) {
    listBox.replaceChildren(el('p', { className: 'muted',
      text: participants.length ? '条件に合う参加者はいません。' : 'まだ公開している参加者はいません。' }));
  } else {
    listBox.replaceChildren(...rows.map((p) => participantCard(p, openDetail)));
  }
  window.scrollTo(0, y);
}

function buildShell() {
  const search = el('input', { type: 'search', id: 'q', placeholder: '名前・キーワードで検索',
    'aria-label': '名前・キーワードで検索', value: query, autocomplete: 'off' });
  search.addEventListener('input', () => { query = search.value; renderList(); });
  const chips = FIELD_OPTIONS.map((f) => {
    const b = el('button', { type: 'button', className: 'chip', text: f, 'aria-pressed': selected.has(f) ? 'true' : 'false' });
    b.addEventListener('click', () => {
      if (selected.has(f)) selected.delete(f); else selected.add(f);
      b.setAttribute('aria-pressed', selected.has(f) ? 'true' : 'false');
      renderList();
    });
    return b;
  });
  countEl = el('p', { className: 'muted list-count', role: 'status' });
  listBox = el('div', { className: 'list' });
  noteEl = el('p', { className: 'notice', style: 'margin-bottom:12px', hidden: true });
  app.replaceChildren(
    noteEl,
    el('div', { className: 'field' }, search),
    el('div', { className: 'chips' }, ...chips),
    countEl, listBox);
  renderList();
}

async function init() {
  token = readToken(location, localStorage);
  if (!token) { showInvalid(); return; }
  const cached = loadList(localStorage);
  if (cached) { participants = cached.participants; buildShell(); }
  else app.replaceChildren(el('p', { className: 'muted', text: '読み込み中…' }));

  const r = await callApi('getList', { token }, { onRetry: () => setStatus('読み込み中…') });
  setStatus('');
  if (r && r.ok) {
    participants = r.participants || [];
    saveList(localStorage, { participants, generatedAt: r.generatedAt });
    if (listBox) renderList(); else buildShell();
    return;
  }
  const err = r && r.error;
  if (err === 'expired') showExpired();
  else if (err === 'not_visible') showNotVisible();
  else if (err === 'invalid_token') { clearToken(localStorage); showInvalid(); }
  else if (cached && noteEl) {
    noteEl.textContent = '最新の一覧を取得できませんでした。保存済みの一覧を表示しています。';
    noteEl.hidden = false;
  }
  else showNetworkOnly();
}

init();
