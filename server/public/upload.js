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

// 산출은 JSON이 아니라 파일이라 별도 함수로 받는다. 접근키는 다른 API와 같은 헤더로 보낸다.
async function download(path, fallbackName) {
  const res = await fetch(`/api${path}`, {
    headers: { 'x-access-key': getKey() || $('accessKey').value.trim() },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(res.status === 401 ? '접근키를 확인하세요.' : body.error ?? `요청에 실패했습니다 (${res.status}).`);
  }
  // 한글 파일명은 RFC 5987 filename*으로 온다.
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // 브라우저가 내려받기를 시작할 시간을 주고 정리한다.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  const warning = res.headers.get('x-mangdo-warning');
  return {
    name,
    skipped: Number(res.headers.get('x-mangdo-skipped') ?? '0'),
    warning: warning ? decodeURIComponent(warning) : '',
  };
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

    const exportTd = document.createElement('td');
    if (drawing.objectKey && drawing.objectKey.toLowerCase().endsWith('.dxf')) {
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.textContent = 'DXF 내려받기';
      exportButton.addEventListener('click', () => exportDxf(drawing, exportButton));
      exportTd.append(exportButton);
    } else {
      exportTd.textContent = 'DXF로 올린 도면만';
    }
    tr.append(exportTd);

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

async function exportDxf(drawing, button) {
  button.disabled = true;
  showMessage('산출 중…');
  try {
    const result = await download(`/drawings/${drawing.id}/export.dxf`, 'damage.dxf');
    const notes = [];
    if (result.skipped > 0) notes.push(`도면 좌표를 구하지 못한 손상 ${result.skipped}개는 빠졌습니다.`);
    if (result.warning) notes.push(result.warning);
    showMessage(`내려받았습니다: ${result.name}${notes.length > 0 ? ` — ${notes.join(' / ')}` : ''}`);
  } catch (err) {
    showMessage(err.message, true);
  } finally {
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
