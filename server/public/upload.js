const KEY_STORAGE = 'mangdo.accessKey';
const POLL_MS = 5000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const STATUS_LABELS = { pending: '대기', inprogress: '변환 중', success: '완료', failed: '실패' };

const $ = (id) => document.getElementById(id);
let pollTimer = null;

function getKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function setKey(value) {
  try {
    localStorage.setItem(KEY_STORAGE, value);
  } catch {
    // 저장소를 쓸 수 없는 브라우저에서는 이번 세션 동안만 입력값을 쓴다.
  }
}

function showMessage(text, isError = false) {
  const el = $('message');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), 'x-access-key': getKey() || $('accessKey').value.trim() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(res.status === 401 ? '접근키를 확인하세요.' : body.error ?? `요청에 실패했습니다 (${res.status}).`);
  }
  return body;
}

function textCell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function renderRows(drawings) {
  const rows = $('rows');
  rows.replaceChildren();
  $('empty').hidden = drawings.length > 0;

  for (const drawing of drawings) {
    const tr = document.createElement('tr');
    tr.append(textCell(drawing.name));

    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${drawing.status}`;
    badge.textContent = STATUS_LABELS[drawing.status] ?? drawing.status;
    statusTd.append(badge);
    if (drawing.error) {
      const error = document.createElement('div');
      error.className = 'error small';
      error.textContent = drawing.error;
      statusTd.append(error);
    }
    tr.append(statusTd);

    tr.append(textCell(drawing.progress || '-'));
    tr.append(textCell(new Date(drawing.uploadedAt).toLocaleString('ko-KR')));

    const actionTd = document.createElement('td');
    if (drawing.status === 'failed') {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '다시 시도';
      button.addEventListener('click', () => retry(drawing.id, button));
      actionTd.append(button);
    }
    tr.append(actionTd);
    rows.append(tr);
  }
}

async function loadList() {
  clearTimeout(pollTimer);
  try {
    const drawings = await api('/drawings');
    renderRows(drawings);
    if (drawings.some((d) => d.status === 'pending' || d.status === 'inprogress')) {
      pollTimer = setTimeout(loadList, POLL_MS);
    }
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function retry(id, button) {
  button.disabled = true;
  try {
    await api(`/drawings/${id}/retry`, { method: 'POST' });
    showMessage('변환을 다시 요청했습니다.');
    await loadList();
  } catch (err) {
    showMessage(err.message, true);
    button.disabled = false;
  }
}

$('accessKey').value = getKey();

$('saveKey').addEventListener('click', () => {
  setKey($('accessKey').value.trim());
  showMessage('접근키를 저장했습니다.');
  loadList();
});

$('refresh').addEventListener('click', loadList);

$('uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('file').files[0];
  if (!file) return;
  const nameLower = file.name.toLowerCase();
  if (!nameLower.endsWith('.dwg') && !nameLower.endsWith('.dxf')) {
    showMessage('.dwg 또는 .dxf 파일만 업로드할 수 있습니다.', true);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showMessage('파일이 100MB를 넘습니다.', true);
    return;
  }

  const form = new FormData();
  form.append('name', file.name);
  form.append('file', file);

  $('uploadButton').disabled = true;
  showMessage(`업로드 중… (${(file.size / 1024 / 1024).toFixed(1)}MB) APS로 전송하는 동안 잠시 기다려 주세요.`);
  try {
    const record = await api('/drawings', { method: 'POST', body: form });
    showMessage(`업로드 완료: ${record.name} — 변환을 시작했습니다.`);
    $('uploadForm').reset();
    await loadList();
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    $('uploadButton').disabled = false;
  }
});

if (getKey()) {
  loadList();
} else {
  showMessage('먼저 접근키를 입력하고 저장하세요.');
}
