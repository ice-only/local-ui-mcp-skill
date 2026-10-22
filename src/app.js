let state = { components: [], category: 'All', tag: 'All', query: '', sort: 'random', page: 1, pageSize: 48 };
const $ = selector => document.querySelector(selector);
const grid = $('#grid');
const mainScroll = document.querySelector('main');
const sourceCache = new Map();
const sourceRequests = new Map();
const SOURCE_CACHE_LIMIT = 80;
let codeRequestId = 0;
let previewActivityObserver = null;
let pageScrollResumeTimer = 0;
let pageScrollPaused = false;
const PREVIEW_PAUSE_STYLE_ID = 'ui-library-preview-pause';
const PREVIEW_PAUSE_CSS = '*,:before,:after{animation-play-state:paused!important;transition:none!important}';

function escapeHtml(value = '') {
  return value.replace(/[&<>'\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function preview(sourcePath) {
  return '/preview/' + sourcePath.split('/').map(encodeURIComponent).join('/');
}

function isTextFile(file = '') {
  return /\.(html?|css|scss|sass|js|mjs|ts|tsx|jsx|vue|json|md|txt|svg|yml|yaml)$/i.test(file);
}

async function load() {
  const response = await fetch('/api/components');
  const data = await response.json();
  state.components = data.components || [];
  $('#count').textContent = state.components.length;
  renderCategories();
  render();
}

function renderCategories() {
  const categories = ['All', ...new Set(state.components.map(component => component.category))];
  $('#categories').innerHTML = categories.map(category => `<button class="${category === state.category ? 'active' : ''}" data-cat="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join('');
  document.querySelectorAll('[data-cat]').forEach(button => button.onclick = () => {
    state.category = button.dataset.cat;
    state.page = 1;
    renderCategories();
    render();
  });

  const tags = ['All', ...new Set(state.components.flatMap(component => component.tags || []))].sort();
  $('#tag').innerHTML = tags.map(tag => `<option value="${escapeHtml(tag)}" ${tag === state.tag ? 'selected' : ''}>${tag === 'All' ? '所有标签' : escapeHtml(tag)}</option>`).join('');
  $('#quick-tags').innerHTML = tags.filter(tag => tag !== 'All').slice(0, 12).map(tag => `<button class="quick-tag ${tag === state.tag ? 'active' : ''}" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('');
  document.querySelectorAll('[data-tag]').forEach(button => button.onclick = () => {
    state.tag = button.dataset.tag;
    state.page = 1;
    renderCategories();
    render();
  });
}

function updatePreviewPause(frame) {
  const shouldPause = frame.dataset.previewVisibilityPaused === '1' || frame.dataset.previewScrollPaused === '1';
  frame.dataset.previewPaused = shouldPause ? '1' : '0';
  try {
    const doc = frame.contentDocument;
    const root = doc?.documentElement;
    if (!root) return;
    let style = doc.getElementById(PREVIEW_PAUSE_STYLE_ID);
    if (shouldPause) {
      if (!style) {
        style = doc.createElement('style');
        style.id = PREVIEW_PAUSE_STYLE_ID;
        style.textContent = PREVIEW_PAUSE_CSS;
        (doc.head || root).appendChild(style);
      }
      doc.querySelectorAll('video,audio').forEach(media => {
        if (!media.paused) {
          media.dataset.uiLibraryWasPlaying = '1';
          media.pause();
        }
      });
    } else {
      style?.remove();
      doc.querySelectorAll('video,audio[data-ui-library-was-playing="1"]').forEach(media => {
        delete media.dataset.uiLibraryWasPlaying;
        media.play().catch(() => {});
      });
    }
  } catch {}
}

function setPreviewPauseReason(frame, reason, paused) {
  frame.dataset[reason] = paused ? '1' : '0';
  updatePreviewPause(frame);
}

function setupPreviewActivityObserver() {
  previewActivityObserver?.disconnect();
  previewActivityObserver = null;
  const frames = [...document.querySelectorAll('.card-preview iframe')];
  frames.forEach(frame => {
    frame.addEventListener('load', () => updatePreviewPause(frame), { passive: true });
    setPreviewPauseReason(frame, 'previewScrollPaused', pageScrollPaused);
  });
  if (!('IntersectionObserver' in window)) return;
  previewActivityObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => setPreviewPauseReason(entry.target, 'previewVisibilityPaused', !entry.isIntersecting));
  }, { rootMargin: '160px 0px' });
  frames.forEach(frame => previewActivityObserver.observe(frame));
}

function markPageScrolling() {
  if (!pageScrollPaused) {
    pageScrollPaused = true;
    document.documentElement.classList.add('page-scrolling');
    document.querySelectorAll('.card-preview iframe').forEach(frame => setPreviewPauseReason(frame, 'previewScrollPaused', true));
  }
  clearTimeout(pageScrollResumeTimer);
  pageScrollResumeTimer = setTimeout(() => {
    pageScrollPaused = false;
    document.documentElement.classList.remove('page-scrolling');
    document.querySelectorAll('.card-preview iframe').forEach(frame => setPreviewPauseReason(frame, 'previewScrollPaused', false));
  }, 140);
}

window.addEventListener('scroll', markPageScrolling, { passive: true });
mainScroll?.addEventListener('scroll', markPageScrolling, { passive: true });

let nextPagePrefetchToken = 0;
const GPU_ACCELERATION_KEY = 'ui-library-gpu-acceleration';
const gpuToggle = $('#gpu-toggle');

function applyHardwareAcceleration(enabled) {
  document.documentElement.classList.toggle('gpu-accel', enabled);
  try {
    localStorage.setItem(GPU_ACCELERATION_KEY, enabled ? '1' : '0');
  } catch {}
}

async function persistHardwareAcceleration(enabled) {
  applyHardwareAcceleration(enabled);
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gpuAcceleration: enabled })
    });
  } catch {}
}

async function restoreHardwareAcceleration() {
  let localValue = null;
  try { localValue = localStorage.getItem(GPU_ACCELERATION_KEY); } catch {}
  let enabled = localValue === '1';
  try {
    const response = await fetch('/api/settings', { cache: 'no-store' });
    if (response.ok) {
      const settings = await response.json();
      if (settings.configured) enabled = settings.gpuAcceleration === true;
      else if (localValue !== null) await persistHardwareAcceleration(enabled);
    }
  } catch {}
  applyHardwareAcceleration(enabled);
  if (!gpuToggle) return;
  gpuToggle.checked = enabled;
  gpuToggle.onchange = () => void persistHardwareAcceleration(gpuToggle.checked);
}

function prefetchNextPage(list, pages) {
  document.querySelectorAll('link[data-page-prefetch]').forEach(link => link.remove());
  const token = ++nextPagePrefetchToken;
  const nextPage = state.page < pages ? list.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize) : [];
  if (!nextPage.length) return;

  const schedule = window.requestIdleCallback || (callback => window.setTimeout(callback, 600));
  schedule(() => {
    if (token !== nextPagePrefetchToken) return;
    nextPage.forEach(component => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.href = preview(component.sourcePath);
      link.fetchPriority = 'low';
      link.dataset.pagePrefetch = String(state.page + 1);
      document.head.appendChild(link);
    });
  });
}

function render() {
  let list = state.components.filter(component =>
    (state.category === 'All' || component.category === state.category) &&
    (state.tag === 'All' || (component.tags || []).includes(state.tag)) &&
    `${component.name} ${component.category} ${(component.tags || []).join(' ')} ${component.sourcePath}`.toLowerCase().includes(state.query.toLowerCase())
  );
  if (state.sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  if (state.sort === 'category') list.sort((a, b) => a.category.localeCompare(b.category));

  const pages = Math.max(1, Math.ceil(list.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const visible = list.slice(start, start + state.pageSize);
  $('#status').textContent = `显示 ${list.length} 个组件`;
  $('#page').textContent = `第 ${state.page} / ${pages} 页`;
  $('#prev').disabled = state.page <= 1;
  $('#next').disabled = state.page >= pages;
  grid.innerHTML = visible.map(component => `<article class="card" data-id="${component.id}"><div class="card-preview"><iframe sandbox="allow-scripts allow-same-origin" src="${preview(component.sourcePath)}"></iframe></div><div class="card-body"><h3>${escapeHtml(component.name)}</h3><div class="card-meta"><span>${escapeHtml(component.category)}</span><span>${escapeHtml(component.framework)}</span></div><span class="tag">${escapeHtml(component.tags[0] || 'ui')}</span></div></article>`).join('') || '<p style="color:#777">没有找到匹配组件。</p>';

  document.querySelectorAll('.card').forEach(card => {
    const id = card.dataset.id;
    const frame = card.querySelector('iframe');
    card.onclick = () => openDetail(id);
    frame?.addEventListener('load', () => {
      try {
        frame.contentDocument?.addEventListener('click', () => openDetail(id), { once: true });
      } catch {}
      updatePreviewPause(frame);
    });
  });
  setupPreviewActivityObserver();
  prefetchNextPage(list, pages);
}

async function openDetail(id) {
  const component = state.components.find(item => item.id === id);
  if (!component) return;
  $('#detail').dataset.id = id;
  $('#detail-category').textContent = component.category;
  $('#detail-name').textContent = component.name;
  $('#detail-meta').textContent = `来源：${component.sourcePath} · ${component.framework}`;
  $('#edit-name').value = component.name;
  $('#edit-category').value = component.category;
  $('#edit-tags').value = (component.tags || []).join(', ');
  $('#frame').src = preview(component.sourcePath);
  $('#file-select').innerHTML = component.files.map(file => `<option value="${escapeHtml(file)}">${escapeHtml(file.split('/').pop())}</option>`).join('');
  const first = component.files.find(isTextFile) || component.files[0];
  $('#file-select').value = first;
  $('#file-select').onchange = event => showCode(event.target.value);
  $('#copy').onclick = () => navigator.clipboard.writeText($('#code').textContent);
  $('#download').onclick = () => location.href = '/api/download?id=' + encodeURIComponent(component.id);
  $('#detail').showModal();
  showCode(first);
  warmSourceFiles(component.files, first);
}

function rememberSource(file, text) {
  sourceCache.delete(file);
  sourceCache.set(file, text);
  while (sourceCache.size > SOURCE_CACHE_LIMIT) sourceCache.delete(sourceCache.keys().next().value);
}

async function fetchSource(file) {
  if (sourceCache.has(file)) return sourceCache.get(file);
  if (sourceRequests.has(file)) return sourceRequests.get(file);
  const request = fetch(preview(file) + '?raw=1', { cache: 'force-cache' })
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.text();
    })
    .then(text => {
      rememberSource(file, text);
      return text;
    })
    .finally(() => sourceRequests.delete(file));
  sourceRequests.set(file, request);
  return request;
}

function warmSourceFiles(files, first) {
  const candidates = files.filter(file => file !== first && isTextFile(file)).slice(0, 6);
  if (!candidates.length) return;
  const schedule = window.requestIdleCallback || (callback => window.setTimeout(callback, 700));
  schedule(async () => {
    for (const file of candidates) {
      try { await fetchSource(file); } catch {}
    }
  });
}

async function showCode(file) {
  const requestId = ++codeRequestId;
  if (!isTextFile(file)) {
    $('#code').textContent = '这是二进制资源，不能作为文本源码预览。请使用“下载组件”获取原始文件。';
    return;
  }
  $('#code').dataset.loading = '1';
  $('#code').textContent = '源码加载中…';
  try {
    const text = await fetchSource(file);
    if (requestId === codeRequestId) $('#code').textContent = text;
  } catch (error) {
    if (requestId === codeRequestId) $('#code').textContent = `源码加载失败：${error.message || '请求异常'}，请重新选择文件。`;
  } finally {
    if (requestId === codeRequestId) delete $('#code').dataset.loading;
  }
}

function closeDetail() {
  if ($('#detail').open) $('#detail').close();
}

$('#close').onclick = closeDetail;
$('#detail').addEventListener('close', () => {
  codeRequestId += 1;
  $('#frame').removeAttribute('src');
});
$('#save-edit').onclick = async () => {
  const id = $('#detail').dataset.id;
  const response = await fetch('/api/component/' + encodeURIComponent(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: $('#edit-name').value,
      category: $('#edit-category').value,
      tags: $('#edit-tags').value.split(',').map(value => value.trim()).filter(Boolean)
    })
  });
  const updated = await response.json();
  const index = state.components.findIndex(component => component.id === id);
  if (index >= 0) state.components[index] = updated;
  $('#detail-category').textContent = updated.category;
  $('#detail-name').textContent = updated.name;
  renderCategories();
  render();
  $('#save-edit').textContent = '已保存';
  setTimeout(() => $('#save-edit').textContent = '保存元数据', 1200);
};

$('#search').oninput = event => { state.query = event.target.value; state.page = 1; render(); };
$('#tag').onchange = event => { state.tag = event.target.value; state.page = 1; render(); };
$('#sort').onchange = event => { state.sort = event.target.value; state.page = 1; render(); };
$('#prev').onclick = () => { state.page--; render(); };
$('#next').onclick = () => { state.page++; render(); };
$('#scan').onclick = async () => {
  const button = $('#scan');
  button.disabled = true;
  button.textContent = '扫描中...';
  try {
    const response = await fetch('/api/scan', { method: 'POST' });
    const data = await response.json();
    state.components = data.components || [];
    state.page = 1;
    $('#count').textContent = state.components.length;
    $('#status').textContent = `扫描完成：新增 ${data.stats?.added || 0}，更新 ${data.stats?.updated || 0}，删除 ${data.stats?.removed || 0}，错误 ${data.stats?.errors || 0}`;
    renderCategories();
    render();
    button.textContent = `已扫描 ${state.components.length}`;
  } finally {
    button.disabled = false;
    setTimeout(() => button.textContent = '扫描 UI 库', 1800);
  }
};

async function bootstrap() {
  await restoreHardwareAcceleration();
  await load();
}

bootstrap();
