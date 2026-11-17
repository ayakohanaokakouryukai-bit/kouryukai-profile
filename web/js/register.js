import { callApi } from './api.js';

const SUCCESS_TEXT = '入力されたアドレスがお申し込み済みであれば、専用ページのURLをお送りしました。メールをご確認ください。届かない場合は、迷惑メールフォルダや、お申し込み時に別のアドレスを使っていないかをご確認ください。再送は1日1回までです。';
const NETWORK_TEXT = '通信できませんでした。時間をおいてもう一度お試しください。';

const form = document.getElementById('register-form');
const emailInput = document.getElementById('email');
const button = document.getElementById('submit');
const message = document.getElementById('message');
const area = document.getElementById('form-area');
const statusBar = document.getElementById('status-bar');

function setStatus(text) {
  statusBar.textContent = text;
  statusBar.hidden = !text;
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  emailInput.value = emailInput.value.trim();
  if (!form.reportValidity()) return;
  if (button.disabled) return;

  message.hidden = true;
  message.textContent = '';
  button.disabled = true;
  button.textContent = '送信中…';

  const result = await callApi('requestLink', { email: emailInput.value }, {
    onRetry: () => setStatus('読み込み中…'),
  });
  setStatus('');

  if (result && result.ok) {
    const p = document.createElement('p');
    p.className = 'notice';
    p.setAttribute('role', 'status');
    p.tabIndex = -1;
    p.textContent = SUCCESS_TEXT;
    area.replaceChildren(p);
    p.focus();
  } else {
    message.textContent = NETWORK_TEXT;
    message.hidden = false;
    button.disabled = false;
    button.textContent = 'URLを送る';
  }
});
