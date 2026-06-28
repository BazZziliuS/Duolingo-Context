/**
 * duolingo_interceptor.js — работает в MAIN world на странице practice-hub/words.
 * Перехватывает fetch и XHR, ищет в ответах данные словаря,
 * передаёт результат в ISOLATED world через window.postMessage.
 *
 * Запускается в MAIN world (доступ к window страницы), поэтому chrome.runtime недоступен.
 */

(function () {
  'use strict';

  const MSG_KEY = '__duoCtxVocab__';

  // ──────────────────────────────────────────────
  // Перехват fetch
  // ──────────────────────────────────────────────

  const _origFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const response = await _origFetch(...args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (url.includes('duolingo.com')) {
        const clone = response.clone();
        const text = await clone.text();
        tryExtractAndPost(text, url);
      }
    } catch (_) {}

    return response;
  };

  // ──────────────────────────────────────────────
  // Перехват XMLHttpRequest
  // ──────────────────────────────────────────────

  const _origXHROpen = XMLHttpRequest.prototype.open;
  const _origXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__duoUrl = String(url);
    return _origXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    if (this.__duoUrl && this.__duoUrl.includes('duolingo.com')) {
      this.addEventListener('load', function () {
        try {
          tryExtractAndPost(this.responseText, this.__duoUrl);
        } catch (_) {}
      });
    }
    return _origXHRSend.call(this, ...args);
  };

  // ──────────────────────────────────────────────
  // Fallback: проверить window.__NEXT_DATA__ после загрузки
  // ──────────────────────────────────────────────

  window.addEventListener('load', () => {
    setTimeout(() => {
      try {
        if (window.__NEXT_DATA__) {
          const words = extractVocabulary(window.__NEXT_DATA__);
          if (words && words.length > 0) {
            postWords(words);
          }
        }
      } catch (_) {}
    }, 1500);
  });

  // ──────────────────────────────────────────────
  // Парсинг и поиск слов
  // ──────────────────────────────────────────────

  function tryExtractAndPost(text, url) {
    if (!text || text[0] !== '{' && text[0] !== '[') return;
    try {
      const json = JSON.parse(text);
      const words = extractVocabulary(json);
      if (words && words.length > 0) {
        postWords(words);
      }
    } catch (_) {}
  }

  // Рекурсивно обходит JSON и ищет массивы, похожие на список слов
  function extractVocabulary(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth ?? 0) > 8) return null;

    if (Array.isArray(obj)) {
      if (obj.length >= 3 && isVocabItem(obj[0])) {
        const words = obj.map(normalizeWord).filter(Boolean);
        if (words.length >= 3) return words;
      }
      for (const item of obj) {
        const result = extractVocabulary(item, (depth ?? 0) + 1);
        if (result) return result;
      }
      return null;
    }

    // Проверить значения объекта
    for (const val of Object.values(obj)) {
      if (Array.isArray(val) && val.length >= 3 && isVocabItem(val[0])) {
        const words = val.map(normalizeWord).filter(Boolean);
        if (words.length >= 3) return words;
      }
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const result = extractVocabulary(val, (depth ?? 0) + 1);
        if (result) return result;
      }
    }

    return null;
  }

  // Определить, похож ли объект на запись словаря
  function isVocabItem(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const keys = Object.keys(obj).join(' ').toLowerCase();

    const hasWord = /word|lexeme|token/.test(keys);
    const hasTranslation = /translat|hint|meaning/.test(keys);

    return hasWord && hasTranslation;
  }

  // Привести объект к унифицированному формату
  function normalizeWord(item) {
    const word = (
      item.wordString ??
      item.word_string ??
      item.word ??
      item.lexeme_string ??
      item.token ??
      ''
    ).trim();

    if (!word || word.length < 1 || word.length > 60) return null;

    const rawTranslation =
      item.translationText ??
      item.translation ??
      item.hint ??
      (Array.isArray(item.hints) ? item.hints[0] : '') ??
      (Array.isArray(item.translations) ? item.translations[0] : '') ??
      '';

    const translation = typeof rawTranslation === 'string'
      ? rawTranslation
      : Array.isArray(rawTranslation) ? rawTranslation[0] : '';

    return {
      word,
      translation: translation || '',
      transcription: item.pronunciation ?? item.tts ?? '',
      example:
        item.exampleSentence ??
        item.example ??
        item.contextString ??
        item.context ??
        '',
      lesson:
        item.lessonNumber ??
        item.lesson_number ??
        item.skillUrlTitle ??
        item.skill_url_title ??
        item.skill ??
        0,
      strength: item.strength ?? item.strengthBars ?? item.strength_bars ?? 0
    };
  }

  // Отправить слова в ISOLATED world через postMessage
  function postWords(words) {
    // Дедупликация: отправлять только если список изменился
    const key = words.map(w => w.word).join(',');
    if (window.__duoCtxLastKey === key) return;
    window.__duoCtxLastKey = key;

    window.postMessage({ [MSG_KEY]: true, words }, '*');
  }
})();
