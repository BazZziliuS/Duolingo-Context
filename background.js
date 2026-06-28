/**
 * background.js — сервис-воркер расширения (Manifest V3).
 * Отвечает за:
 *  - инициализацию дефолтных настроек при установке
 *  - контекстное меню «Добавить в словарь»
 *  - получение словаря от content script (перехватчик fetch на practice-hub/words)
 *  - автосинхронизацию при открытии страницы слов Duolingo
 */

'use strict';

// ──────────────────────────────────────────────
// Дефолтные настройки
// ──────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  duoWords: [],
  enabled: true,
  highlightIntensity: 'medium',
  filterCurrentLesson: false,
  autoSync: true,
  targetLanguage: 'en',
  stats: {
    wordsSeenToday: 0,
    wordFrequency: {},
    lastResetDate: null,
    lastSyncDate: null
  }
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (existing) => {
    const toSet = {};
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
      if (!(key in existing)) {
        toSet[key] = val;
      }
    }
    if (Object.keys(toSet).length > 0) {
      chrome.storage.local.set(toSet);
    }
  });

  // Создать пункт контекстного меню
  chrome.contextMenus.create({
    id: 'addToDictionary',
    title: 'Добавить в словарь Duolingo Context',
    contexts: ['selection']
  });
});

// ──────────────────────────────────────────────
// Контекстное меню
// ──────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'addToDictionary') return;

  const word = (info.selectionText || '').trim();
  if (!word || !tab?.id) return;

  // Попробовать отправить сообщение content script-у.
  // Если он не загружен (вкладка открыта до установки расширения) — внедрить его вручную.
  chrome.tabs.sendMessage(tab.id, { action: 'showAddWordModal', word }, () => {
    if (!chrome.runtime.lastError) return; // Всё хорошо, сообщение доставлено

    // Content script недоступен — внедряем его, потом повторяем
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      .then(() => chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] }))
      .then(() => new Promise(r => setTimeout(r, 150))) // Дать скрипту инициализироваться
      .then(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'showAddWordModal', word }, () => {
          void chrome.runtime.lastError; // Подавить ошибку если страница недоступна
        });
      })
      .catch(() => {}); // chrome:// и другие системные страницы — молча игнорировать
  });
});

// ──────────────────────────────────────────────
// Обработка сообщений от popup и content scripts
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Команда из popup: открыть страницу слов для синхронизации
  if (msg.action === 'openWordsPage') {
    openWordsPage();
    sendResponse({ success: true });
    return;
  }

  // Данные от duolingo_relay.js: словарь перехвачен на странице practice-hub/words
  if (msg.action === 'vocabCaptured') {
    const words = msg.words || [];
    if (words.length === 0) return;

    chrome.storage.local.get(['stats'], (data) => {
      const stats = data.stats || {};
      stats.lastSyncDate = new Date().toISOString();
      chrome.storage.local.set({ duoWords: words, stats });
    });
    return;
  }

  if (msg.action === 'getStats') {
    chrome.storage.local.get(['stats', 'duoWords'], (data) => {
      sendResponse({ stats: data.stats, wordCount: (data.duoWords || []).length });
    });
    return true;
  }

  // Поиск перевода и информации о слове через внешние API
  if (msg.action === 'lookupWord') {
    lookupWord(msg.word, msg.fromLang || 'en', sendResponse);
    return true; // async sendResponse
  }
});

// ──────────────────────────────────────────────
// Поиск слова через внешние API
// background.js не имеет CORS-ограничений — можно делать fetch к любым URL
// ──────────────────────────────────────────────

async function lookupWord(word, fromLang, sendResponse) {
  const result = { translation: '', transcription: '', example: '' };

  // 1. Перевод через MyMemory (бесплатно, без ключа, до 5000 знаков/день)
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=${fromLang}%7Cru`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.responseStatus === 200 && data.responseData?.translatedText) {
        const translated = data.responseData.translatedText;
        // MyMemory иногда возвращает строку с предупреждением — игнорировать
        if (!translated.toUpperCase().includes('MYMEMORY') && translated !== word) {
          result.translation = translated;
        }
      }
    }
  } catch (_) {}

  // 2. Транскрипция и пример через Free Dictionary API (только для английского)
  if (fromLang === 'en') {
    try {
      const res = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const entries = await res.json();
        const entry = Array.isArray(entries) ? entries[0] : null;
        if (entry) {
          // Транскрипция — берём первую найденную
          result.transcription =
            entry.phonetic ||
            entry.phonetics?.find(p => p.text)?.text ||
            '';

          // Пример — ищем первое определение с примером
          for (const meaning of entry.meanings || []) {
            const def = (meaning.definitions || []).find(d => d.example);
            if (def?.example) {
              result.example = def.example;
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  sendResponse({ success: true, ...result });
}

// ──────────────────────────────────────────────
// Открыть страницу слов Duolingo
// ──────────────────────────────────────────────

async function openWordsPage() {
  // Приоритет URL: сначала practice-hub/words, если не грузится — /learn
  // Interceptor перехватывает запросы на ЛЮБОЙ странице duolingo.com
  const candidates = [
    'https://www.duolingo.com/practice-hub/words',
    'https://www.duolingo.com/learn'
  ];

  // Поискать уже открытую вкладку Duolingo
  const existing = await chrome.tabs.query({ url: 'https://www.duolingo.com/*' });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.tabs.reload(existing[0].id);
  } else {
    await chrome.tabs.create({ url: candidates[0] });
  }
}

// ──────────────────────────────────────────────
// Автосинхронизация: открытие practice-hub/words запускает захват автоматически
// (content script сам захватывает — здесь только слушаем вкладки)
// ──────────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;

  // Автосинхронизация активируется только на странице слов
  if (!tab.url.startsWith('https://www.duolingo.com/practice-hub/words')) return;

  chrome.storage.local.get(['autoSync'], (data) => {
    // Content script уже запущен на этой странице и сам захватит данные.
    // Здесь ничего делать не нужно — vocabCaptured придёт автоматически.
    void data;
  });
});
