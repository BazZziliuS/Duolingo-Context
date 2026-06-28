/**
 * content.js — скрипт, внедряемый на все страницы кроме duolingo.com.
 * Получает словарь из chrome.storage, обходит DOM через TreeWalker,
 * оборачивает найденные слова в span-элементы и показывает тултип при клике.
 */

'use strict';

// Теги, внутри которых не нужно искать слова
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'BUTTON',
  'CODE', 'PRE', 'NOSCRIPT', 'IFRAME', 'SVG', 'MATH'
]);

let wordMap = {};           // { 'слово_lowercase': { word, translation, transcription, example, lesson } }
let wordRegex = null;       // Скомпилированный регулярный выражение для всех слов
let tooltip = null;         // Единственный глобальный тултип на странице
let isEnabled = true;       // Глобальный переключатель подсветки
let observer = null;        // MutationObserver для SPA
let targetLanguage = 'en';  // Изучаемый язык (влияет на regex)

// Языки без пробельных границ слов — \b не работает
const NO_WORD_BOUNDARY_LANGS = new Set(['ja', 'zh', 'ko', 'ar', 'hi']);

// ──────────────────────────────────────────────
// Инициализация
// ──────────────────────────────────────────────

function init() {
  chrome.storage.local.get(
    ['duoWords', 'enabled', 'highlightIntensity', 'filterCurrentLesson', 'targetLanguage'],
    (data) => {
      isEnabled = data.enabled !== false;
      if (!isEnabled) return;

      targetLanguage = data.targetLanguage || 'en';

      const words = data.duoWords || [];
      if (words.length === 0) return;

      buildWordMap(words, data.filterCurrentLesson);
      buildRegex();
      createTooltip();
      processDocument();
      startObserver();
    }
  );
}

// Собрать словарь в Map для быстрого доступа по ключу
function buildWordMap(words, filterCurrentLesson) {
  wordMap = {};
  let currentLesson = null;

  if (filterCurrentLesson) {
    // Текущий урок — максимальный номер урока в словаре
    currentLesson = Math.max(...words.map(w => w.lesson || 0));
  }

  for (const entry of words) {
    if (filterCurrentLesson && entry.lesson !== currentLesson) continue;
    wordMap[entry.word.toLowerCase()] = entry;
  }
}

// Собрать один regex из всех слов словаря
function buildRegex() {
  const keys = Object.keys(wordMap);
  if (keys.length === 0) {
    wordRegex = null;
    return;
  }
  // Экранировать спецсимволы, отсортировать по длине (длинные первыми — жадный матч)
  const escaped = keys
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length);

  const pattern = escaped.join('|');

  // Для иероглифических языков \b не работает — границы нет между символами
  if (NO_WORD_BOUNDARY_LANGS.has(targetLanguage)) {
    wordRegex = new RegExp(`(${pattern})`, 'gi');
  } else {
    wordRegex = new RegExp(`\\b(${pattern})\\b`, 'gi');
  }
}

// ──────────────────────────────────────────────
// Обход DOM
// ──────────────────────────────────────────────

function processDocument() {
  if (!wordRegex) return;
  processNode(document.body);
}

function processNode(root) {
  if (!root) return;

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // Пропустить запрещённые теги
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;

        // Пропустить уже обработанные span
        if (parent.classList && parent.classList.contains('duo-ctx-word')) return NodeFilter.FILTER_REJECT;

        // Пропустить contenteditable
        if (parent.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;

        // Пропустить пустые ноды и ноды без совпадений
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  // Собрать все текстовые ноды в массив (нельзя изменять DOM во время обхода)
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  for (const textNode of textNodes) {
    highlightTextNode(textNode);
  }
}

// Обработать один текстовый нод — заменить совпадения на span
function highlightTextNode(textNode) {
  const text = textNode.nodeValue;
  wordRegex.lastIndex = 0;

  if (!wordRegex.test(text)) return; // Быстрая проверка наличия совпадений
  wordRegex.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    const matchedWord = match[0];
    const start = match.index;

    // Добавить текст до совпадения
    if (start > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
    }

    // Создать span для слова
    const entry = wordMap[matchedWord.toLowerCase()];
    if (entry) {
      const span = document.createElement('span');
      span.className = 'duo-ctx-word';
      span.textContent = matchedWord;
      span.dataset.word = entry.word;
      span.dataset.translation = entry.translation || '';
      span.dataset.transcription = entry.transcription || '';
      span.dataset.example = entry.example || '';
      span.dataset.lesson = entry.lesson || '';
      fragment.appendChild(span);
    } else {
      fragment.appendChild(document.createTextNode(matchedWord));
    }

    lastIndex = start + matchedWord.length;
  }

  // Добавить оставшийся текст
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  // Заменить текстовый нод фрагментом
  textNode.parentNode.replaceChild(fragment, textNode);
}

// ──────────────────────────────────────────────
// Тултип
// ──────────────────────────────────────────────

function createTooltip() {
  tooltip = document.createElement('div');
  tooltip.className = 'duo-ctx-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  let hideTimer = null;

  const scheduleHide = () => {
    hideTimer = setTimeout(hideTooltip, 120);
  };

  const cancelHide = () => {
    clearTimeout(hideTimer);
  };

  // Наведение на слово — показать тултип
  document.addEventListener('mouseover', (e) => {
    if (e.target.classList.contains('duo-ctx-word')) {
      cancelHide();
      showTooltip(e.target);
    }
  });

  // Уход курсора со слова — отложить скрытие
  document.addEventListener('mouseout', (e) => {
    if (e.target.classList.contains('duo-ctx-word')) {
      scheduleHide();
    }
  });

  // Навели на сам тултип — не скрывать
  tooltip.addEventListener('mouseenter', cancelHide);
  tooltip.addEventListener('mouseleave', scheduleHide);
}

function showTooltip(span) {
  const data = span.dataset;
  tooltip.dataset.currentWord = data.word;

  // Наполнить тултип
  tooltip.innerHTML = `
    <div class="duo-tooltip-header">
      <span class="duo-word">${escapeHtml(data.word)}</span>
      ${data.lesson && Number(data.lesson) > 0 ? `<span class="duo-badge">урок ${escapeHtml(data.lesson)}</span>` : ''}
    </div>
    ${data.transcription ? `<div class="duo-transcription">${escapeHtml(data.transcription)}</div>` : ''}
    <div class="duo-translation">${escapeHtml(data.translation)}</div>
    ${data.example ? `<div class="duo-example">"${escapeHtml(data.example)}"</div>` : ''}
  `;

  // Позиционирование
  tooltip.style.display = 'block';
  positionTooltip(span);

  // Обновить статистику
  updateStats(data.word);
}

function positionTooltip(span) {
  const rect = span.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const margin = 8;

  let top = rect.top + window.scrollY - tooltipRect.height - margin;
  let left = rect.left + window.scrollX;

  // Если не помещается сверху — показать снизу
  if (top < window.scrollY + margin) {
    top = rect.bottom + window.scrollY + margin;
    tooltip.classList.add('duo-tooltip-below');
  } else {
    tooltip.classList.remove('duo-tooltip-below');
  }

  // Не выходить за правый край
  const maxLeft = window.innerWidth + window.scrollX - tooltipRect.width - margin;
  if (left > maxLeft) left = maxLeft;
  if (left < margin) left = margin;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function hideTooltip() {
  if (tooltip) {
    tooltip.style.display = 'none';
    tooltip.dataset.currentWord = '';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ──────────────────────────────────────────────
// MutationObserver для SPA (Twitter, Reddit и т.д.)
// ──────────────────────────────────────────────

function startObserver() {
  let debounceTimer = null;
  const pendingNodes = new Set();

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Пропустить служебные элементы
          if (node.classList && node.classList.contains('duo-ctx-tooltip')) continue;
          if (node.classList && node.classList.contains('duo-ctx-word')) continue;
          pendingNodes.add(node);
        }
      }
    }

    if (pendingNodes.size === 0) return;

    // Дебаунс 300ms — не обрабатывать каждую мутацию отдельно
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      for (const node of pendingNodes) {
        processNode(node);
      }
      pendingNodes.clear();
    }, 300);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// ──────────────────────────────────────────────
// Статистика
// ──────────────────────────────────────────────

function updateStats(word) {
  chrome.storage.local.get(['stats'], (data) => {
    const stats = data.stats || { wordsSeenToday: 0, wordFrequency: {}, lastResetDate: null };
    const today = new Date().toDateString();

    // Сброс счётчика в новый день
    if (stats.lastResetDate !== today) {
      stats.wordsSeenToday = 0;
      stats.wordFrequency = {};
      stats.lastResetDate = today;
    }

    stats.wordsSeenToday += 1;
    stats.wordFrequency = stats.wordFrequency || {};
    stats.wordFrequency[word] = (stats.wordFrequency[word] || 0) + 1;

    chrome.storage.local.set({ stats });
  });
}

// ──────────────────────────────────────────────
// Слушать изменения настроек из popup
// ──────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if ('enabled' in changes) {
    isEnabled = changes.enabled.newValue;
    if (!isEnabled) {
      // Снять все подсветки
      document.querySelectorAll('.duo-ctx-word').forEach(span => {
        span.replaceWith(document.createTextNode(span.textContent));
      });
      hideTooltip();
      if (observer) observer.disconnect();
    } else {
      // Перезапустить
      init();
    }
  }

  if ('duoWords' in changes || 'filterCurrentLesson' in changes ||
      'highlightIntensity' in changes || 'targetLanguage' in changes) {
    document.querySelectorAll('.duo-ctx-word').forEach(span => {
      span.replaceWith(document.createTextNode(span.textContent));
    });
    if (observer) observer.disconnect();
    init();
  }
});

// ──────────────────────────────────────────────
// Сообщения от background.js (контекстное меню)
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'showAddWordModal') {
    showAddWordModal(msg.word || '');
  }
});

// ──────────────────────────────────────────────
// Модалка «Добавить в словарь»
// Shadow DOM изолирует стили от стилей страницы
// ──────────────────────────────────────────────

function showAddWordModal(word) {
  if (document.getElementById('duo-ctx-modal-host')) return;

  const host = document.createElement('div');
  host.id = 'duo-ctx-modal-host';
  const shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      .overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 2147483647;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .modal {
        background: #fff;
        border-radius: 16px;
        padding: 22px 24px 20px;
        width: 360px;
        max-width: calc(100vw - 32px);
        box-shadow: 0 12px 40px rgba(0,0,0,0.2);
        animation: pop-in 0.15s ease;
      }

      @keyframes pop-in {
        from { opacity: 0; transform: scale(0.94) translateY(-8px); }
        to   { opacity: 1; transform: scale(1)   translateY(0); }
      }

      .modal-title {
        font-size: 16px; font-weight: 700; color: #1a1a1a;
        margin-bottom: 16px;
        display: flex; align-items: center; gap: 8px;
      }
      .modal-title::before {
        content: ''; display: inline-block;
        width: 20px; height: 20px;
        background: #58cc02; border-radius: 50%; flex-shrink: 0;
      }

      .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }

      .field label {
        font-size: 11px; font-weight: 700; color: #aaa;
        text-transform: uppercase; letter-spacing: 0.5px;
      }

      .word-row { display: flex; gap: 6px; }

      .field input, .field textarea {
        border: 1.5px solid #e5e5e5; border-radius: 9px;
        padding: 9px 11px; font-size: 14px; font-family: inherit;
        color: #1a1a1a; outline: none; width: 100%; background: #fff;
        transition: border-color 0.15s, background 0.15s;
      }
      .field input:focus, .field textarea:focus { border-color: #58cc02; }
      .field textarea { resize: vertical; min-height: 60px; max-height: 110px; }

      /* Поле заполнено автоматически */
      .field input.autofilled, .field textarea.autofilled {
        border-color: rgba(88, 204, 2, 0.5);
        background: rgba(88, 204, 2, 0.04);
      }

      /* Кнопка поиска перевода */
      .btn-lookup {
        flex-shrink: 0; width: 38px; height: 38px;
        border: 1.5px solid #e5e5e5; border-radius: 9px;
        background: #fff; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .btn-lookup:hover { border-color: #58cc02; background: rgba(88,204,2,0.08); }
      .btn-lookup.loading { pointer-events: none; opacity: 0.6; }
      .btn-lookup svg { display: block; }

      /* Спиннер */
      @keyframes spin { to { transform: rotate(360deg); } }
      .spinner {
        width: 16px; height: 16px;
        border: 2px solid #ddd; border-top-color: #58cc02;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }

      /* Статус поиска */
      .lookup-status {
        font-size: 11px; min-height: 15px; margin-top: 1px;
        transition: color 0.2s;
      }
      .lookup-status.loading { color: #aaa; }
      .lookup-status.success { color: #58cc02; }
      .lookup-status.error   { color: #ff9600; }

      .required-mark { color: #ff4b4b; margin-left: 2px; }

      .error-msg { font-size: 12px; color: #ff4b4b; margin-top: 3px; display: none; }
      .error-msg.visible { display: block; }

      .buttons { display: flex; gap: 8px; margin-top: 16px; }

      .btn-cancel {
        flex: 1; padding: 10px;
        border: 1.5px solid #e5e5e5; border-radius: 9px;
        background: none; font-size: 13px; font-weight: 600;
        cursor: pointer; color: #999; transition: all 0.15s;
      }
      .btn-cancel:hover { border-color: #bbb; color: #555; }

      .btn-submit {
        flex: 2; padding: 10px; border: none; border-radius: 9px;
        background: #58cc02; color: #fff;
        font-size: 13px; font-weight: 700;
        cursor: pointer; transition: background 0.15s;
      }
      .btn-submit:hover { background: #4cac02; }
    </style>

    <div class="overlay" id="overlay">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-title">Добавить в словарь</div>

        <form id="form" novalidate>
          <div class="field">
            <label>Слово</label>
            <div class="word-row">
              <input id="wordInput" type="text" required autocomplete="off" placeholder="Введите слово…">
              <button type="button" class="btn-lookup" id="lookupBtn" title="Найти перевод автоматически">
                <svg id="lookupIcon" width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7.5" stroke="#888" stroke-width="2"/>
                  <path d="M21 21l-4-4" stroke="#888" stroke-width="2" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
            <div class="lookup-status" id="lookupStatus"></div>
          </div>

          <div class="field">
            <label>Перевод <span class="required-mark">*</span></label>
            <input id="translationInput" type="text" placeholder="Заполнится автоматически…" autocomplete="off">
            <span class="error-msg" id="translationError">Перевод обязателен</span>
          </div>

          <div class="field">
            <label>Транскрипция</label>
            <input id="transcriptionInput" type="text" placeholder="Заполнится автоматически…" autocomplete="off">
          </div>

          <div class="field">
            <label>Пример</label>
            <textarea id="exampleInput" placeholder="Заполнится автоматически…"></textarea>
          </div>

          <div class="buttons">
            <button type="button" class="btn-cancel" id="cancelBtn">Отмена</button>
            <button type="submit" class="btn-submit">Добавить</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const $ = id => shadow.getElementById(id);

  // Безопасно устанавливаем значение без innerHTML
  $('wordInput').value = word;

  // ── Автозаполнение ──
  let lookupTimer = null;

  function setLookupStatus(text, type) {
    const el = $('lookupStatus');
    el.textContent = text;
    el.className = `lookup-status ${type || ''}`;
  }

  function setLookupButtonLoading(loading) {
    const btn = $('lookupBtn');
    btn.classList.toggle('loading', loading);
    btn.innerHTML = loading
      ? '<div class="spinner"></div>'
      : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
           <circle cx="11" cy="11" r="7.5" stroke="#888" stroke-width="2"/>
           <path d="M21 21l-4-4" stroke="#888" stroke-width="2" stroke-linecap="round"/>
         </svg>`;
  }

  function clearAutofilled() {
    ['translationInput', 'transcriptionInput', 'exampleInput'].forEach(id => {
      $(id).classList.remove('autofilled');
    });
  }

  function triggerLookup() {
    const w = $('wordInput').value.trim();
    if (w.length < 2) return;

    setLookupStatus('Ищу перевод…', 'loading');
    setLookupButtonLoading(true);
    clearAutofilled();

    chrome.runtime.sendMessage(
      { action: 'lookupWord', word: w, fromLang: targetLanguage || 'en' },
      (response) => {
        setLookupButtonLoading(false);

        if (chrome.runtime.lastError || !response?.success) {
          setLookupStatus('Не удалось найти', 'error');
          return;
        }

        const found = [];

        if (response.translation && !$('translationInput').dataset.userEdited) {
          $('translationInput').value = response.translation;
          $('translationInput').classList.add('autofilled');
          found.push('перевод');
        }
        if (response.transcription && !$('transcriptionInput').dataset.userEdited) {
          $('transcriptionInput').value = response.transcription;
          $('transcriptionInput').classList.add('autofilled');
          found.push('транскрипция');
        }
        if (response.example && !$('exampleInput').dataset.userEdited) {
          $('exampleInput').value = response.example;
          $('exampleInput').classList.add('autofilled');
          found.push('пример');
        }

        setLookupStatus(
          found.length ? `Найдено: ${found.join(', ')}` : 'Перевод не найден',
          found.length ? 'success' : 'error'
        );
      }
    );
  }

  // Дебаунс при вводе слова — 650ms
  $('wordInput').addEventListener('input', () => {
    clearTimeout(lookupTimer);
    setLookupStatus('');
    clearAutofilled();
    const w = $('wordInput').value.trim();
    if (w.length >= 2) {
      lookupTimer = setTimeout(triggerLookup, 650);
    }
  });

  // Ручной запуск по кнопке
  $('lookupBtn').addEventListener('click', () => {
    clearTimeout(lookupTimer);
    triggerLookup();
  });

  // Отмечать поля, которые пользователь редактировал вручную
  // (не перезаписывать их автозаполнением)
  ['translationInput', 'transcriptionInput', 'exampleInput'].forEach(id => {
    $(id).addEventListener('input', () => {
      $(id).dataset.userEdited = '1';
      $(id).classList.remove('autofilled');
    });
  });

  // ── Закрытие ──
  $('overlay').addEventListener('click', (e) => {
    if (e.target === $('overlay')) host.remove();
  });

  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { host.remove(); document.removeEventListener('keydown', onEsc); }
  });

  $('cancelBtn').addEventListener('click', () => host.remove());

  // ── Сохранение ──
  $('form').addEventListener('submit', (e) => {
    e.preventDefault();

    const translation = $('translationInput').value.trim();
    if (!translation) {
      $('translationError').classList.add('visible');
      $('translationInput').focus();
      return;
    }
    $('translationError').classList.remove('visible');

    const newEntry = {
      word:          $('wordInput').value.trim(),
      translation,
      transcription: $('transcriptionInput').value.trim(),
      example:       $('exampleInput').value.trim(),
      lesson:        0,
      strength:      1
    };

    if (!newEntry.word) return;

    chrome.storage.local.get(['duoWords'], (data) => {
      const words = data.duoWords || [];
      const idx = words.findIndex(w => w.word.toLowerCase() === newEntry.word.toLowerCase());
      if (idx >= 0) {
        words[idx] = { ...words[idx], ...newEntry };
      } else {
        words.push(newEntry);
      }
      chrome.storage.local.set({ duoWords: words });
    });

    host.remove();
  });

  document.body.appendChild(host);

  // Если слово уже передано — сразу запустить поиск
  if (word.length >= 2) {
    setTimeout(triggerLookup, 100);
  } else {
    setTimeout(() => $('wordInput').focus(), 60);
  }
}

// Запуск
init();
