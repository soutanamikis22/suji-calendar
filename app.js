// ==========================================================================
// STATE MANAGEMENT & VARIABLES
// ==========================================================================
let sujiData = [];
let filteredData = [];
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-indexed (0 = Jan, 11 = Dec)
let currentFilter = 'all';
let searchQuery = '';

// デフォルトのタグ設計（初期値として設定されるタグ）
const DEFAULT_TAGS = [
  { id: 'tag-nyujo', name: '入場', color: 'cyan', keywords: ['入場', 'jy', '入回', '入試', 'TK入場', 'OM入場', 'KY入場', 'NN入場'] },
  { id: 'tag-shutsujo', name: '出場', color: 'green', keywords: ['出場', 'tc', '出回', 'TK出場', 'OM出場', 'KY出場', 'NN出場'] },
  { id: 'tag-haikyu', name: '配給', color: 'pink', keywords: ['配給', '甲種', '輸送', '配給輸送', '配'] },
  { id: 'tag-shiten', name: '試運転', color: 'yellow', keywords: ['試運転', '試', '試走'] },
  { id: 'tag-korin', name: '工臨', color: 'purple', keywords: ['工臨', '工', 'キヤ'] }
];

let customTags = [];

// DOM Elements
const calendarGrid = document.getElementById('calendar-grid');
const calendarTitle = document.getElementById('calendar-title');
const statCount = document.getElementById('stat-count');
const searchInput = document.getElementById('search-input');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnToday = document.getElementById('btn-today');
const btnSync = document.getElementById('btn-sync');
const lastSyncTime = document.getElementById('last-sync-time');

// Modal (Event Detail) DOM Elements
const modalDetail = document.getElementById('modal-detail');
const modalTitle = document.getElementById('modal-title');
const modalDate = document.getElementById('modal-date');
const modalTimetable = document.getElementById('modal-timetable');
const modalUser = document.getElementById('modal-user');
const btnCloseModal = document.getElementById('btn-close-modal');
const btnCloseFooter = document.getElementById('btn-close-footer');
const btnCopyDetail = document.getElementById('btn-copy-detail');

// Modal (Tags Settings) DOM Elements
const modalTags = document.getElementById('modal-tags');
const btnEditTags = document.getElementById('btn-edit-tags');
const btnCloseTags = document.getElementById('btn-close-tags');
const tagListBody = document.getElementById('tag-list-body');
const newTagName = document.getElementById('new-tag-name');
const newTagColor = document.getElementById('new-tag-color');
const newTagKeywords = document.getElementById('new-tag-keywords');
const btnAddTagSubmit = document.getElementById('btn-add-tag-submit');
const btnResetTags = document.getElementById('btn-reset-tags');
const btnSaveTags = document.getElementById('btn-save-tags');

// Toast DOM Elements
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// 一時的なタグの編集状態（保存・キャンセル用）
let editingTags = [];

// ==========================================================================
// INITIALIZATION
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadCustomTags();
  renderFilterTags();
  loadData();
  setupEventListeners();
});

// ==========================================================================
// TAG MANAGEMENT LOGIC (LOCALSTORAGE)
// ==========================================================================
function loadCustomTags() {
  const stored = localStorage.getItem('suji-tags');
  if (stored) {
    try {
      customTags = JSON.parse(stored);
    } catch (e) {
      console.error('Failed to parse stored tags, using default tags.');
      customTags = JSON.parse(JSON.stringify(DEFAULT_TAGS));
    }
  } else {
    customTags = JSON.parse(JSON.stringify(DEFAULT_TAGS));
    saveCustomTags();
  }
}

function saveCustomTags() {
  localStorage.setItem('suji-tags', JSON.stringify(customTags));
}

// クイックフィルターのタグ（サイドバー）を動的に生成
function renderFilterTags() {
  const filterTagsContainer = document.getElementById('filter-tags');
  if (!filterTagsContainer) return;
  
  let html = `<button class="filter-tag ${currentFilter === 'all' ? 'active' : ''}" data-type="all">すべて</button>`;
  
  customTags.forEach(tag => {
    const isActive = currentFilter === tag.id ? 'active' : '';
    html += `<button class="filter-tag ${isActive}" data-type="${tag.id}">${tag.name}</button>`;
  });
  
  filterTagsContainer.innerHTML = html;
  
  // イベントリスナーの割り当て
  const buttons = filterTagsContainer.querySelectorAll('.filter-tag');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.type;
      applyFilterAndRender();
    });
  });
}

// ==========================================================================
// DATA LOADING & SYNCING
// ==========================================================================
async function loadData() {
  try {
    const response = await fetch('./suji-data.json?t=' + new Date().getTime());
    if (!response.ok) throw new Error('データファイルの読み込みに失敗しました');
    
    sujiData = await response.json();
    
    // カレンダー表示用に日付の昇順にソート
    sujiData.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    console.log(`${sujiData.length} 件のスジデータをロードしました。`);
    
    if (sujiData.length > 0) {
      // 直近のデータがある月にカレンダーの初期表示位置を合わせる
      const latestDateStr = sujiData[sujiData.length - 1].date;
      const latestDate = new Date(latestDateStr);
      currentYear = latestDate.getFullYear();
      currentMonth = latestDate.getMonth();
    }
    
    updateLastSyncLabel();
    applyFilterAndRender();
  } catch (error) {
    console.error('Error loading suji-data:', error);
    showToast('データの読み込みに失敗しました。', 'error');
  }
}

function updateLastSyncLabel() {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  lastSyncTime.textContent = `最終更新: 今日 ${timeStr}`;
}

async function syncData() {
  const syncIcon = btnSync.querySelector('.sync-icon');
  const indicator = document.querySelector('.status-indicator');
  
  btnSync.disabled = true;
  syncIcon.classList.add('loading');
  indicator.className = 'status-indicator syncing';
  lastSyncTime.textContent = 'ツイートデータを分析中...';
  
  try {
    // キャッシュを100%回避するタイムスタンプクエリパラメータを付与して同期リクエスト
    const response = await fetch('/api/scrape?t=' + new Date().getTime());
    if (!response.ok) throw new Error(`HTTPエラー! ステータス: ${response.status}`);
    const result = await response.json();
    
    if (result.success) {
      showToast('最新のスジ情報を取得・更新しました！');
      await loadData();
    } else {
      throw new Error(result.error || '不明なエラー');
    }
  } catch (error) {
    console.error('Sync failed:', error);
    showToast('データ同期に失敗しました。ローカルサーバーを確認してください。', 'error');
  } finally {
    btnSync.disabled = false;
    syncIcon.classList.remove('loading');
    indicator.className = 'status-indicator online';
    updateLastSyncLabel();
  }
}

// ==========================================================================
// FILTER & SEARCH LOGIC
// ==========================================================================
function applyFilterAndRender() {
  filteredData = sujiData.filter(item => {
    // 1. 動的タイプフィルターの適用
    let matchesType = false;
    
    if (currentFilter === 'all') {
      matchesType = true;
    } else {
      const matchedTag = getSujiTag(item);
      if (matchedTag && matchedTag.id === currentFilter) {
        matchesType = true;
      }
    }
    
    // 2. キーワード検索の適用
    let matchesSearch = true;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      matchesSearch = (
        item.title.toLowerCase().includes(q) || 
        item.details.toLowerCase().includes(q) || 
        item.date.includes(q) ||
        (item.user && item.user.toLowerCase().includes(q))
      );
    }
    
    return matchesType && matchesSearch;
  });
  
  renderCalendar();
  updateStats();
}

// スジ情報に合致するカスタムタグを判定する
function getSujiTag(item) {
  const text = (item.title + ' ' + item.details).toLowerCase();
  
  for (const tag of customTags) {
    const matches = tag.keywords.some(kw => {
      if (!kw || !kw.trim()) return false;
      return text.includes(kw.trim().toLowerCase());
    });
    if (matches) {
      return tag;
    }
  }
  return null;
}

function updateStats() {
  const count = filteredData.filter(item => {
    const itemDate = new Date(item.date);
    return itemDate.getFullYear() === currentYear && itemDate.getMonth() === currentMonth;
  }).length;
  
  statCount.textContent = `${count} 件`;
}

// ==========================================================================
// CALENDAR RENDERING
// ==========================================================================
function renderCalendar() {
  calendarGrid.innerHTML = '';
  calendarTitle.textContent = `${currentYear}年 ${(currentMonth + 1)}月`;
  
  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
  const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
  const prevLastDay = new Date(currentYear, currentMonth, 0).getDate();
  const totalSlots = 42; 
  
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
  
  // 1. 前月の日付枠
  for (let i = firstDayIndex; i > 0; i--) {
    const day = prevLastDay - i + 1;
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
    const dateStr = `${prevYear}-${(prevMonth + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    
    createDayCell(day, dateStr, 'prev-month');
  }
  
  // 2. 当月の日付枠
  for (let day = 1; day <= lastDay; day++) {
    const dateStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const isToday = dateStr === todayStr ? 'today' : '';
    
    createDayCell(day, dateStr, isToday);
  }
  
  // 3. 翌月の日付枠
  const remainingSlots = totalSlots - (firstDayIndex + lastDay);
  for (let day = 1; day <= remainingSlots; day++) {
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
    const dateStr = `${nextYear}-${(nextMonth + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    
    createDayCell(day, dateStr, 'next-month');
  }
}

function createDayCell(dayNum, dateStr, additionalClass) {
  const dayCell = document.createElement('div');
  dayCell.className = `calendar-day ${additionalClass}`;
  
  const numberEl = document.createElement('span');
  numberEl.className = 'day-number';
  numberEl.textContent = dayNum;
  dayCell.appendChild(numberEl);
  
  const eventsContainer = document.createElement('div');
  eventsContainer.className = 'events-container';
  
  const daysEvents = filteredData.filter(item => item.date === dateStr);
  
  daysEvents.forEach(event => {
    const eventEl = document.createElement('div');
    
    // 合致するタグのネオンカラーを適用
    const matchedTag = getSujiTag(event);
    const borderClass = matchedTag ? `border-${matchedTag.color}` : 'border-other';
    
    eventEl.className = `suji-event ${borderClass}`;
    eventEl.textContent = event.title;
    
    eventEl.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetailModal(event);
    });
    
    eventsContainer.appendChild(eventEl);
  });
  
  dayCell.appendChild(eventsContainer);
  calendarGrid.appendChild(dayCell);
}

// ==========================================================================
// DETAILS MODAL LOGIC
// ==========================================================================
let activeEvent = null;

function openDetailModal(event) {
  activeEvent = event;
  modalTitle.textContent = event.title;
  modalDate.textContent = formatDateJapanese(event.date);
  modalTimetable.textContent = event.details;
  modalUser.textContent = `@${event.user || 'Unknown'}`;
  
  // モーダル内のタグバッジを動的表示
  const modalHeader = modalDetail.querySelector('.modal-title-area');
  // 既存の古いバッジがあれば消す
  const oldBadge = modalHeader.querySelector('.modal-tag-badge');
  if (oldBadge) oldBadge.remove();
  
  const matchedTag = getSujiTag(event);
  if (matchedTag) {
    const badge = document.createElement('span');
    badge.className = `modal-tag-badge badge-${matchedTag.color}`;
    badge.style.display = 'inline-block';
    badge.style.marginTop = '6px';
    badge.style.alignSelf = 'flex-start';
    badge.style.fontSize = '10px';
    badge.style.padding = '3px 8px';
    badge.style.borderRadius = '0px'; // 2017フラット仕様 (完全かくかく)
    badge.style.fontWeight = 'bold';
    badge.textContent = matchedTag.name;
    modalHeader.appendChild(badge);
  }
  
  // 元ツイートのリンクを制御して2017フラットボタンに割り当て
  const btnTwitterLink = document.getElementById('btn-twitter-link');
  if (btnTwitterLink) {
    if (event.url) {
      btnTwitterLink.href = event.url;
      btnTwitterLink.style.display = 'inline-flex';
    } else {
      btnTwitterLink.href = '#';
      btnTwitterLink.style.display = 'none';
    }
  }
  
  modalDetail.classList.remove('hidden');
}

function closeDetailModal() {
  modalDetail.classList.add('hidden');
  activeEvent = null;
}

function formatDateJapanese(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`;
  }
  return dateStr;
}

function copyToClipboard() {
  if (!activeEvent) return;
  
  const textToCopy = `【スジ公開】\n日付: ${formatDateJapanese(activeEvent.date)}\n内容: ${activeEvent.title}\n\n【詳細スケジュール】\n${activeEvent.details}`;
  
  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast('スジ情報をコピーしました！');
  }).catch(err => {
    console.error('Copy failed:', err);
    showToast('コピーに失敗しました', 'error');
  });
}

// ==========================================================================
// TAGS CUSTOMIZER MODAL LOGIC
// ==========================================================================
function openTagsModal() {
  editingTags = JSON.parse(JSON.stringify(customTags)); // ディープコピー
  renderEditingTagsTable();
  modalTags.classList.remove('hidden');
}

function closeTagsModal() {
  modalTags.classList.add('hidden');
}

function renderEditingTagsTable() {
  tagListBody.innerHTML = '';
  editingTags.forEach((tag, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="text" value="${tag.name}" class="edit-tag-name" data-index="${index}">
      </td>
      <td>
        <select class="edit-tag-color form-select" data-index="${index}">
          <option value="cyan" ${tag.color === 'cyan' ? 'selected' : ''}>シアン</option>
          <option value="green" ${tag.color === 'green' ? 'selected' : ''}>エメラルドグリーン</option>
          <option value="pink" ${tag.color === 'pink' ? 'selected' : ''}>ホットピンク</option>
          <option value="yellow" ${tag.color === 'yellow' ? 'selected' : ''}>ネオンイエロー</option>
          <option value="purple" ${tag.color === 'purple' ? 'selected' : ''}>ディープパープル</option>
          <option value="orange" ${tag.color === 'orange' ? 'selected' : ''}>ネオンオレンジ</option>
          <option value="red" ${tag.color === 'red' ? 'selected' : ''}>ネオンレッド</option>
        </select>
      </td>
      <td>
        <input type="text" value="${tag.keywords.join(', ')}" class="edit-tag-keywords" data-index="${index}">
      </td>
      <td>
        <button class="btn-delete" data-index="${index}"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `;
    
    // 削除イベントのバインド
    tr.querySelector('.btn-delete').addEventListener('click', () => {
      editingTags.splice(index, 1);
      renderEditingTagsTable();
    });
    
    tagListBody.appendChild(tr);
  });
}

function addNewTag() {
  const name = newTagName.value.trim();
  const color = newTagColor.value;
  const keywordsStr = newTagKeywords.value.trim();
  
  if (!name) {
    showToast('タグ名を入力してください', 'error');
    return;
  }
  
  const keywords = keywordsStr.split(',')
    .map(kw => kw.trim())
    .filter(kw => kw.length > 0);
    
  const newId = `tag-${Date.now()}`;
  editingTags.push({
    id: newId,
    name: name,
    color: color,
    keywords: keywords
  });
  
  newTagName.value = '';
  newTagKeywords.value = '';
  
  renderEditingTagsTable();
  showToast('タグを追加しました（適用ボタンで保存されます）');
}

function saveEditedTags() {
  const trs = tagListBody.querySelectorAll('tr');
  const updatedTags = [];
  
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const nameInput = tr.querySelector('.edit-tag-name');
    const colorSelect = tr.querySelector('.edit-tag-color');
    const keywordsInput = tr.querySelector('.edit-tag-keywords');
    
    const index = parseInt(nameInput.dataset.index);
    const originalTag = editingTags[index];
    
    const name = nameInput.value.trim();
    if (!name) {
      showToast('すべてのタグに名前を設定してください', 'error');
      return;
    }
    
    const keywords = keywordsInput.value.split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);
      
    updatedTags.push({
      id: originalTag.id,
      name: name,
      color: colorSelect.value,
      keywords: keywords
    });
  }
  
  customTags = updatedTags;
  saveCustomTags();
  closeTagsModal();
  
  // サイドバーとカレンダーの再描画
  renderFilterTags();
  applyFilterAndRender();
  showToast('タグ設定とフィルタリング規則を更新しました！');
}

function resetToDefaultTags() {
  if (confirm('タグ設定をすべて初期値に戻しますか？')) {
    customTags = JSON.parse(JSON.stringify(DEFAULT_TAGS));
    saveCustomTags();
    closeTagsModal();
    renderFilterTags();
    applyFilterAndRender();
    showToast('初期設定にリセットしました！');
  }
}

// ==========================================================================
// TOAST LOGIC
// ==========================================================================
function showToast(message, type = 'success') {
  toastMessage.textContent = message;
  
  if (type === 'error') {
    toast.style.background = '#f43f5e';
    toast.style.boxShadow = '0 10px 25px rgba(244, 63, 94, 0.3)';
    toast.querySelector('.toast-icon').className = 'fa-solid fa-circle-exclamation toast-icon';
  } else {
    toast.style.background = '#10b981';
    toast.style.boxShadow = '0 10px 25px rgba(16, 185, 129, 0.3)';
    toast.querySelector('.toast-icon').className = 'fa-solid fa-circle-check toast-icon';
  }
  
  toast.classList.remove('hidden');
  
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}

// ==========================================================================
// EVENT LISTENERS SETUP
// ==========================================================================
function setupEventListeners() {
  // 月ナビゲーション
  btnPrev.addEventListener('click', () => {
    if (currentMonth === 0) {
      currentMonth = 11;
      currentYear--;
    } else {
      currentMonth--;
    }
    renderCalendar();
    updateStats();
  });
  
  btnNext.addEventListener('click', () => {
    if (currentMonth === 11) {
      currentMonth = 0;
      currentYear++;
    } else {
      currentMonth++;
    }
    renderCalendar();
    updateStats();
  });
  
  btnToday.addEventListener('click', () => {
    const today = new Date();
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();
    renderCalendar();
    updateStats();
  });
  
  // 情報同期
  btnSync.addEventListener('click', syncData);
  
  // リアルタイム検索
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilterAndRender();
  });
  
  // スジ詳細モーダルのクローズ
  btnCloseModal.addEventListener('click', closeDetailModal);
  btnCloseFooter.addEventListener('click', closeDetailModal);
  btnCopyDetail.addEventListener('click', copyToClipboard);
  
  modalDetail.addEventListener('click', (e) => {
    if (e.target === modalDetail) {
      closeDetailModal();
    }
  });

  // タグ設定モーダルオープン・クローズ
  btnEditTags.addEventListener('click', openTagsModal);
  btnCloseTags.addEventListener('click', closeTagsModal);
  
  modalTags.addEventListener('click', (e) => {
    if (e.target === modalTags) {
      closeTagsModal();
    }
  });

  // タグ設定モーダル内部アクション
  btnAddTagSubmit.addEventListener('click', addNewTag);
  btnSaveTags.addEventListener('click', saveEditedTags);
  btnResetTags.addEventListener('click', resetToDefaultTags);
}
