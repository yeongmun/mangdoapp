const KEY_STORAGE = 'mangdo.accessKey';
const PROJECT_STORAGE = 'mangdo.project';
const POLL_MS = 5000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const STATUS_LABELS = { pending: '대기', inprogress: '변환 중', success: '완료', failed: '실패' };

const $ = (id) => document.getElementById(id);
let pollTimer = null;
let projects = [];
let drawings = [];
let selected = getSelectedProject();

function getSelectedProject() {
  try {
    return localStorage.getItem(PROJECT_STORAGE) || 'unfiled';
  } catch {
    return 'unfiled';
  }
}

function setSelectedProject(value) {
  selected = value;
  try {
    localStorage.setItem(PROJECT_STORAGE, value);
  } catch {
    // 저장소를 쓸 수 없는 브라우저에서는 이번 세션 동안만 고른 것을 기억한다.
  }
}

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

    // 사진 zip은 DWG로 올린 도면에서도 된다 — 사진은 도면 파일 형식과 상관이 없다.
    const photoTd = document.createElement('td');
    const photoButton = document.createElement('button');
    photoButton.type = 'button';
    photoButton.textContent = '사진 zip';
    photoButton.addEventListener('click', () => downloadPhotos(drawing, photoButton));
    photoTd.append(photoButton);
    tr.append(photoTd);

    tr.append(moveSelectCell(drawing));

    const actionTd = document.createElement('td');
    if (drawing.status === 'failed') {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '다시 시도';
      button.addEventListener('click', () => retry(drawing.id, button));
      actionTd.append(button);
    }
    // 삭제는 휴지통으로 옮기기다 — 아래 휴지통에서 복구할 수 있다(서버는 영구 삭제하지 않는다).
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger';
    deleteButton.textContent = '삭제';
    deleteButton.addEventListener('click', () => removeDrawing(drawing, deleteButton));
    actionTd.append(deleteButton);
    tr.append(actionTd);
    rows.append(tr);
  }
}

function renderTrash(items) {
  const rows = $('trashRows');
  rows.replaceChildren();
  $('trashSection').hidden = items.length === 0;
  for (const item of items) {
    const tr = document.createElement('tr');
    tr.append(textCell(item.name));
    tr.append(textCell(new Date(item.deletedAt).toLocaleString('ko-KR')));
    const actionTd = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '복구';
    button.addEventListener('click', () => restoreDrawing(item, button));
    actionTd.append(button);
    tr.append(actionTd);
    rows.append(tr);
  }
}

// 프로젝트 카드 -----------------------------------------------------------

// 가리키는 프로젝트가 없어진 projectId(있을 수 없지만 파일을 손으로 고친 경우 등)는
// 미분류로 본다 — server/src/projectTree.ts의 effectiveProjectId와 같은 규칙이다.
function isKnownProject(projectId) {
  return typeof projectId === 'string' && projects.some((p) => p.id === projectId);
}

function unfiledCount() {
  return drawings.filter((d) => !isKnownProject(d.projectId)).length;
}

function visibleDrawings() {
  if (selected === 'unfiled') {
    return drawings.filter((d) => !isKnownProject(d.projectId));
  }
  return drawings.filter((d) => d.projectId === selected);
}

function selectProject(id) {
  setSelectedProject(id);
  renderProjects();
  renderRows(visibleDrawings());
}

// 한 줄은 <li> 안의 <button>이다 — 키보드(Tab·Enter·Space)로 고를 수 있고, 고른 줄은
// aria-current로 보조 기술에 전해진다(검토 Task 4 Important: 클릭만 되는 <li>였다).
function projectRow(id, name, count, isChild) {
  const li = document.createElement('li');
  if (isChild) li.classList.add('child');
  if (id === 'unfiled') li.classList.add('unfiled');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'project-row';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'name';
  nameSpan.textContent = name;
  const countSpan = document.createElement('span');
  countSpan.className = 'count';
  countSpan.textContent = count;
  button.append(nameSpan, countSpan);
  if (id === selected) {
    li.classList.add('selected');
    button.setAttribute('aria-current', 'true');
  }
  button.addEventListener('click', () => selectProject(id));
  li.append(button);
  return li;
}

// 표에는 그 프로젝트에 **바로 든** 도면만 보이므로 줄의 숫자도 그 수다. 하위 프로젝트가 있는
// 최상위는 합계를 함께 적는다(최종 검토 M-3: 줄에는 5인데 표에는 2개만 보여 헷갈렸다).
function countLabel(project) {
  return project.childCount > 0
    ? `${project.drawingCount} · 전체 ${project.totalDrawingCount}`
    : `${project.drawingCount}`;
}

function renderProjects() {
  const list = $('projectList');
  list.replaceChildren();

  for (const project of projects) {
    list.append(projectRow(project.id, project.name, countLabel(project), project.depth === 1));
  }
  list.append(projectRow('unfiled', '미분류', `도면 ${unfiledCount()}`, false));

  const current = projects.find((p) => p.id === selected);
  $('projectMemo').textContent = current ? current.memo : '';
  $('currentTitle').textContent = current ? current.path : '미분류';
  $('uploadTarget').textContent = `올릴 곳: ${current ? current.path : '미분류'}`;

  // 하위 만들기는 최상위 프로젝트를 골랐을 때만 된다(설계 2.1 — 깊이는 2단계까지다).
  $('newChild').disabled = !(current && current.depth === 0);
  $('editProject').disabled = !current;
  $('deleteProject').disabled = !current;
  $('projectPhotos').disabled = !current;
  $('projectExport').disabled = !current;
}

// 프로젝트 카드의 동작이 거절되면 **창으로도** 알린다(2026-09-22 사용자 확인: 같은 이름·비어 있지 않은
// 프로젝트 삭제가 막히긴 하는데 문구가 아래 업로드 카드의 메시지 줄에만 떠서 안 보였다).
function notifyProjectError(err) {
  showMessage(err.message, true);
  window.alert(err.message);
}

// 새 프로젝트(parentId 없음) 또는 하위 프로젝트(parentId 있음)를 만든다. 이름을 취소하면
// 그만두고, 메모를 취소하면 빈 메모로 만든다(고칠 이전 값이 없는 새 프로젝트라서).
async function createProject(parentId) {
  const name = window.prompt('프로젝트 이름을 입력하세요.', '');
  if (name === null) return;
  const memo = window.prompt('메모를 입력하세요. (선택)', '');
  try {
    const created = await api('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, memo: memo ?? '', ...(parentId ? { parentId } : {}) }),
    });
    showMessage(`프로젝트를 만들었습니다: ${created.path}`);
    setSelectedProject(created.id);
    await loadList();
  } catch (err) {
    notifyProjectError(err);
  }
}

async function editSelectedProject() {
  const current = projects.find((p) => p.id === selected);
  if (!current) return;
  const name = window.prompt('프로젝트 이름을 입력하세요.', current.name);
  if (name === null) return;
  const memo = window.prompt('메모를 입력하세요. (선택)', current.memo);
  try {
    await api(`/projects/${current.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, memo: memo === null ? current.memo : memo }),
    });
    showMessage(`프로젝트를 고쳤습니다: ${name}`);
    await loadList();
  } catch (err) {
    notifyProjectError(err);
  }
}

async function deleteSelectedProject() {
  const current = projects.find((p) => p.id === selected);
  if (!current) return;
  const ok = window.confirm(`"${current.path}" 프로젝트를 삭제할까요?\n\n비어 있는 프로젝트만 삭제됩니다.`);
  if (!ok) return;
  try {
    await api(`/projects/${current.id}`, { method: 'DELETE' });
    showMessage(`프로젝트를 삭제했습니다: ${current.path}`);
    setSelectedProject('unfiled');
    await loadList();
  } catch (err) {
    notifyProjectError(err);
  }
}

async function downloadProjectPhotos() {
  const current = projects.find((p) => p.id === selected);
  if (!current) return;
  $('projectPhotos').disabled = true;
  showMessage('사진을 모으는 중…');
  try {
    const result = await download(`/projects/${current.id}/photos.zip`, `${current.name}_사진.zip`);
    showMessage(`내려받았습니다: ${result.name}`);
  } catch (err) {
    notifyProjectError(err);
  } finally {
    renderProjects();
  }
}

async function downloadProjectExport() {
  const current = projects.find((p) => p.id === selected);
  if (!current) return;
  $('projectExport').disabled = true;
  showMessage('산출 중…');
  try {
    const result = await download(`/projects/${current.id}/export.zip`, `${current.name}_손상.zip`);
    showMessage(`내려받았습니다: ${result.name}`);
  } catch (err) {
    notifyProjectError(err);
  } finally {
    renderProjects();
  }
}

// 도면 줄의 "옮기기" 선택 상자(첫 옵션은 미분류, 이어서 모든 프로젝트의 path). 바꾸면 바로
// PATCH하고 목록을 새로 고친다. 실패하면 메시지를 보이고 고르던 값을 되돌린다.
function moveSelectCell(drawing) {
  const td = document.createElement('td');
  const select = document.createElement('select');
  select.setAttribute('aria-label', `${drawing.name} 옮기기`);

  const unfiledOption = document.createElement('option');
  unfiledOption.value = '';
  unfiledOption.textContent = '미분류';
  select.append(unfiledOption);

  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.path;
    select.append(option);
  }

  const currentValue = isKnownProject(drawing.projectId) ? drawing.projectId : '';
  select.value = currentValue;

  select.addEventListener('change', async () => {
    const next = select.value;
    select.disabled = true;
    try {
      await api(`/drawings/${drawing.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: next || null }),
      });
      showMessage(`옮겼습니다: ${drawing.name}`);
      await loadList();
    } catch (err) {
      showMessage(err.message, true);
      select.value = currentValue;
      select.disabled = false;
    }
  });

  td.append(select);
  return td;
}

// 휴지통을 못 읽어도 도면 목록은 그대로 쓴다.
async function loadTrash() {
  try {
    renderTrash(await api('/trash'));
  } catch (err) {
    console.error('[trash]', err);
  }
}

async function removeDrawing(drawing, button) {
  const ok = window.confirm(
    `"${drawing.name}"을(를) 삭제할까요?

도면과 그 손상 기록·사진이 휴지통으로 옮겨지고, 앱 목록에서도 사라집니다.
이 페이지 아래 휴지통에서 복구할 수 있습니다.`,
  );
  if (!ok) return;
  button.disabled = true;
  try {
    await api(`/drawings/${drawing.id}`, { method: 'DELETE' });
    showMessage(`휴지통으로 옮겼습니다: ${drawing.name}`);
    await loadList();
  } catch (err) {
    showMessage(err.message, true);
    button.disabled = false;
  }
}

async function restoreDrawing(item, button) {
  button.disabled = true;
  try {
    await api(`/trash/${item.id}/restore`, { method: 'POST' });
    showMessage(`복구했습니다: ${item.name}`);
    await loadList();
  } catch (err) {
    showMessage(err.message, true);
    button.disabled = false;
  }
}

// loadList는 폴링 타이머·버튼·만들기/옮기기 뒤에서 겹쳐 불린다. prompt/confirm이 떠 있는 동안 밀린
// 폴링이 먼저 출발하고 늦게 도착하면 방금 고친 내용을 옛 목록으로 덮어쓴다(검토 Task 4 Important).
// 호출마다 세대 번호를 올리고, 돌아왔을 때 자기가 가장 최근 호출이 아니면 결과를 버린다.
let loadGeneration = 0;

async function loadList() {
  clearTimeout(pollTimer);
  const generation = ++loadGeneration;
  try {
    // 프로젝트 목록만 실패해도(예: projects.json이 깨져 500) 도면 표·휴지통·폴링은 살아 있어야 한다
    // (최종 검토 Important 2) — 그때는 프로젝트 없이 전부 미분류로 보이고 오류 문구만 띄운다.
    // 도면 목록이 실패하면 지금처럼 아래 catch로 간다.
    const [projectResult, drawingList] = await Promise.all([
      api('/projects').then(
        (list) => ({ list, error: null }),
        (error) => ({ list: [], error }),
      ),
      api('/drawings'),
    ]);
    if (generation !== loadGeneration) return;
    projects = Array.isArray(projectResult.list) ? projectResult.list : [];
    drawings = drawingList;
    if (projectResult.error) showMessage(`프로젝트 목록을 불러오지 못했습니다: ${projectResult.error.message}`, true);
    // 고른 프로젝트가 없어졌으면(삭제됨) 미분류로 되돌린다.
    if (selected !== 'unfiled' && !projects.some((p) => p.id === selected)) {
      // 목록을 못 읽은 것뿐이면 기억해 둔 선택은 지우지 않는다 — 이번 화면에서만 미분류로 본다.
      if (projectResult.error) selected = 'unfiled';
      else setSelectedProject('unfiled');
    }
    renderProjects();
    renderRows(visibleDrawings());
    void loadTrash();
    // 폴링은 전체 도면 기준으로 건다 — 지금 보이는 프로젝트뿐 아니라 다른 프로젝트의
    // 변환이 끝나도 다음 새로고침에서 반영되게 한다.
    if (drawings.some((d) => d.status === 'pending' || d.status === 'inprogress')) {
      pollTimer = setTimeout(loadList, POLL_MS);
    }
  } catch (err) {
    if (generation !== loadGeneration) return;
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

// 사진이 없으면 서버가 400과 '저장된 사진이 없습니다'를 주고, download가 그 문구로 던진다 —
// 여기서는 그대로 보여준다(다른 오류도 같다).
async function downloadPhotos(drawing, button) {
  button.disabled = true;
  showMessage('사진을 모으는 중…');
  try {
    const result = await download(`/drawings/${drawing.id}/photos.zip`, `${drawing.name}_사진.zip`);
    showMessage(`내려받았습니다: ${result.name}`);
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

$('newProject').addEventListener('click', () => createProject());

$('newChild').addEventListener('click', () => {
  const current = projects.find((p) => p.id === selected);
  if (!current || current.depth !== 0) return;
  createProject(selected);
});

$('editProject').addEventListener('click', editSelectedProject);
$('deleteProject').addEventListener('click', deleteSelectedProject);
$('projectPhotos').addEventListener('click', downloadProjectPhotos);
$('projectExport').addEventListener('click', downloadProjectExport);

$('uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = $('file').files[0];
  if (!file) return;
  const nameLower = file.name.toLowerCase();
  // DWG는 화면에는 뜨지만 손상 DXF 산출·망도틀별 번호·물량표 채우기가 안 된다(원본을 서버가 읽지
  // 못한다). 결과물을 못 내는 도면이라 올리는 단계에서 막는다(2026-09-22 사용자 결정). 서버 API는
  // 예전에 올린 DWG 도면을 위해 그대로 둔다.
  if (nameLower.endsWith('.dwg')) {
    const text = 'DWG는 올릴 수 없습니다. 캐드에서 DXF로 저장한 뒤 올려 주세요. (DWG는 손상 DXF 산출과 물량표 채우기가 되지 않습니다)';
    showMessage(text, true);
    window.alert(text);
    return;
  }
  if (!nameLower.endsWith('.dxf')) {
    showMessage('.dxf 파일만 업로드할 수 있습니다.', true);
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showMessage('파일이 100MB를 넘습니다.', true);
    return;
  }

  const form = new FormData();
  form.append('name', file.name);
  // 미분류가 아니면 고른 프로젝트로 올린다(설계 5장).
  if (selected !== 'unfiled') {
    form.append('projectId', selected);
  }
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
