/**
 * popup.js — логика интерфейса popup расширения.
 * Управляет вкладками, синхронизацией, настройками и отображением статистики.
 */

'use strict';

// ──────────────────────────────────────────────
// Элементы DOM
// ──────────────────────────────────────────────

const els = {
  wordCount:          document.getElementById('wordCount'),
  syncBtn:            document.getElementById('syncBtn'),
  syncStatus:         document.getElementById('syncStatus'),
  authWarning:        document.getElementById('authWarning'),
  wordTableBody:      document.getElementById('wordTableBody'),
  emptyState:         document.getElementById('emptyState'),
  searchInput:        document.getElementById('searchInput'),

  toggleEnabled:      document.getElementById('toggleEnabled'),
  toggleCurrentLesson:document.getElementById('toggleCurrentLesson'),
  toggleAutoSync:     document.getElementById('toggleAutoSync'),
  languageSelect:     document.getElementById('languageSelect'),

  statWordsToday:     document.getElementById('statWordsToday'),
  topWordsList:       document.getElementById('topWordsList'),
  lessonBars:         document.getElementById('lessonBars'),
};

let allWords = []; // Кэш всего словаря для поиска без перечитки storage

// ──────────────────────────────────────────────
// Инициализация
// ──────────────────────────────────────────────

async function init() {
  const data = await storageGet([
    'duoWords', 'enabled', 'highlightIntensity',
    'filterCurrentLesson', 'autoSync', 'stats', 'targetLanguage'
  ]);

  allWords = data.duoWords || [];

  // Настройки
  els.toggleEnabled.checked       = data.enabled !== false;
  els.toggleCurrentLesson.checked = !!data.filterCurrentLesson;
  els.toggleAutoSync.checked      = data.autoSync !== false;
  els.languageSelect.value        = data.targetLanguage || 'en';

  setActiveIntensity(data.highlightIntensity || 'medium');

  renderWordTable(allWords);
  updateWordCount(allWords.length);

  // Статистика
  renderStats(data.stats || {}, allWords);
}

// ──────────────────────────────────────────────
// Переключение вкладок
// ──────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));

    btn.classList.add('tab-active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');

    if (btn.dataset.tab === 'stats') {
      refreshStats();
    }
  });
});

// ──────────────────────────────────────────────
// Синхронизация
// ──────────────────────────────────────────────

els.syncBtn.addEventListener('click', () => {
  // Открыть страницу слов Duolingo — content script автоматически захватит данные.
  // Popup закроется при открытии вкладки; обновление словаря придёт через storage.onChanged.
  showSyncStatus('Открываю страницу слов…', '');
  chrome.runtime.sendMessage({ action: 'openWordsPage' });
});

// Получать обновления словаря в реальном времени, пока popup открыт
chrome.storage.onChanged.addListener((changes) => {
  if ('duoWords' in changes) {
    allWords = changes.duoWords.newValue || [];
    renderWordTable(allWords);
    updateWordCount(allWords.length);
    showSyncStatus(`Загружено ${allWords.length} слов`, 'success');
    els.authWarning.classList.add('hidden');
  }
});

function showSyncStatus(text, type) {
  els.syncStatus.textContent = text;
  els.syncStatus.className = 'sync-status' + (type ? ` ${type}` : '');
  if (type === 'success') {
    setTimeout(() => { els.syncStatus.textContent = ''; }, 3000);
  }
}

// ──────────────────────────────────────────────
// Таблица слов
// ──────────────────────────────────────────────

function renderWordTable(words) {
  const query = els.searchInput.value.trim().toLowerCase();
  const filtered = query
    ? words.filter(w =>
        w.word.toLowerCase().includes(query) ||
        (w.translation || '').toLowerCase().includes(query)
      )
    : words;

  if (filtered.length === 0) {
    els.wordTableBody.innerHTML = '';
    els.emptyState.classList.remove('hidden');
    return;
  }

  els.emptyState.classList.add('hidden');

  // Строить HTML батчем, а не по одной строке
  const rows = filtered.map(w => `
    <tr>
      <td>${escapeHtml(w.word)}</td>
      <td>${escapeHtml(w.translation || '—')}</td>
    </tr>
  `).join('');

  els.wordTableBody.innerHTML = rows;
}

els.searchInput.addEventListener('input', () => {
  renderWordTable(allWords);
});

function updateWordCount(count) {
  els.wordCount.textContent = `${count} ${pluralWords(count)}`;
}

function pluralWords(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 19) return 'слов';
  if (mod10 === 1) return 'слово';
  if (mod10 >= 2 && mod10 <= 4) return 'слова';
  return 'слов';
}

// ──────────────────────────────────────────────
// Настройки
// ──────────────────────────────────────────────

els.toggleEnabled.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: els.toggleEnabled.checked });
});

els.toggleCurrentLesson.addEventListener('change', () => {
  chrome.storage.local.set({ filterCurrentLesson: els.toggleCurrentLesson.checked });
});

els.toggleAutoSync.addEventListener('change', () => {
  chrome.storage.local.set({ autoSync: els.toggleAutoSync.checked });
});

els.languageSelect.addEventListener('change', () => {
  chrome.storage.local.set({ targetLanguage: els.languageSelect.value });
});

// Интенсивность подсветки
document.querySelectorAll('.intensity-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveIntensity(btn.dataset.intensity);
    chrome.storage.local.set({ highlightIntensity: btn.dataset.intensity });

    // Применить класс на активной вкладке браузера
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: applyIntensityClass,
          args: [btn.dataset.intensity]
        }).catch(() => {}); // Молча игнорировать если вкладка недоступна
      }
    });
  });
});

function setActiveIntensity(intensity) {
  document.querySelectorAll('.intensity-btn').forEach(btn => {
    btn.classList.toggle('intensity-active', btn.dataset.intensity === intensity);
  });
}

// Функция выполняется в контексте страницы
function applyIntensityClass(intensity) {
  const html = document.documentElement;
  html.classList.remove('duo-intensity-weak', 'duo-intensity-medium', 'duo-intensity-strong');
  if (intensity !== 'medium') {
    html.classList.add(`duo-intensity-${intensity}`);
  }
}

// ──────────────────────────────────────────────
// Статистика
// ──────────────────────────────────────────────

function renderStats(stats, words) {
  // Сколько слов встречено сегодня
  els.statWordsToday.textContent = stats.wordsSeenToday || 0;

  // Топ-5 самых частых слов
  const freq = stats.wordFrequency || {};
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (sorted.length === 0) {
    els.topWordsList.innerHTML = '<li style="color:#bbb;padding:8px 10px;font-size:12px;">Ещё нет данных</li>';
  } else {
    els.topWordsList.innerHTML = sorted.map(([word, count], i) => `
      <li>
        <span class="top-word-rank">${i + 1}</span>
        <span class="top-word-text">${escapeHtml(word)}</span>
        <span class="top-word-count">${count} раз</span>
      </li>
    `).join('');
  }

  // Прогресс-бары по урокам
  renderLessonBars(words, freq);
}

function renderLessonBars(words, freq) {
  // Группировать слова по урокам
  const lessonMap = {};
  for (const w of words) {
    const lesson = w.lesson || 0;
    if (!lessonMap[lesson]) lessonMap[lesson] = { total: 0, seen: 0 };
    lessonMap[lesson].total++;
    if (freq[w.word] || freq[w.word.toLowerCase()]) {
      lessonMap[lesson].seen++;
    }
  }

  const lessons = Object.entries(lessonMap)
    .filter(([l]) => l !== '0')
    .sort((a, b) => Number(a[0]) - Number(b[0]));

  if (lessons.length === 0) {
    els.lessonBars.innerHTML = '<div style="color:#bbb;font-size:12px;padding:4px 0;">Нет данных по урокам</div>';
    return;
  }

  els.lessonBars.innerHTML = lessons.map(([lesson, { total, seen }]) => {
    const pct = total > 0 ? Math.round(seen / total * 100) : 0;
    return `
      <div class="lesson-bar-item">
        <div class="lesson-bar-header">
          <span>Урок ${lesson}</span>
          <span>${seen} / ${total} (${pct}%)</span>
        </div>
        <div class="lesson-bar-track">
          <div class="lesson-bar-fill" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function refreshStats() {
  const data = await storageGet(['stats', 'duoWords']);
  renderStats(data.stats || {}, data.duoWords || []);
}

// ──────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Запуск
init();
