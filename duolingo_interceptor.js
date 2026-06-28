/**
 * duolingo_interceptor.js — работает в MAIN world на ВСЕХ страницах duolingo.com.
 * Перехватывает fetch и XHR, ищет в ответах данные словаря из любого эндпоинта,
 * передаёт результат в ISOLATED world через window.postMessage.
 *
 * Запускается в MAIN world (доступ к window страницы), поэтому chrome.runtime недоступен.
 */

(function () {
  'use strict';

  const MSG_KEY = '__duoCtxVocab__';

  // Минимальное количество слов чтобы считать ответ словарём
  const MIN_WORDS = 2;

  // ──────────────────────────────────────────────
  // Перехват fetch
  // ──────────────────────────────────────────────

  const _origFetch = window.fetch.bind(window);

  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');

    // Пропускать сторонние запросы (реклама, аналитика) без перехвата
    if (!isDuolingoUrl(url)) {
      return _origFetch(...args);
    }

    const response = await _origFetch(...args);

    // Читать тело только у успешных JSON-ответов
    if (response.ok) {
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('json') || ct.includes('javascript')) {
        try {
          const clone = response.clone();
          const text = await clone.text();
          tryExtractAndPost(text, url);
        } catch (_) {}
      }
    }

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
    if (isDuolingoUrl(this.__duoUrl || '')) {
      this.addEventListener('load', function () {
        try {
          tryExtractAndPost(this.responseText, this.__duoUrl || '');
        } catch (_) {}
      });
    }
    return _origXHRSend.call(this, ...args);
  };

  function isDuolingoUrl(url) {
    if (!url) return false;
    try {
      // new URL с базой текущей страницы корректно разбирает относительные,
      // протокол-относительные (//example.com) и абсолютные URL
      const { hostname } = new URL(url, location.href);
      return hostname === 'duolingo.com' || hostname.endsWith('.duolingo.com');
    } catch (_) {
      return false;
    }
  }

  // ──────────────────────────────────────────────
  // Fallback: window.__NEXT_DATA__ и Redux store
  // ──────────────────────────────────────────────

  window.addEventListener('load', () => {
    setTimeout(checkPageData, 1500);
    setTimeout(checkPageData, 4000); // Второй проход — для медленных страниц
  });

  function checkPageData() {
    // Next.js initial data
    try {
      if (window.__NEXT_DATA__) {
        const words = extractVocabulary(window.__NEXT_DATA__);
        if (words && words.length >= MIN_WORDS) { postWords(words); return; }
      }
    } catch (_) {}

    // Redux / Zustand store (Duolingo использует Redux)
    try {
      const store = window.__store__ || window.store || window.__reduxStore__;
      if (store?.getState) {
        const words = extractVocabulary(store.getState());
        if (words && words.length >= MIN_WORDS) { postWords(words); return; }
      }
    } catch (_) {}
  }

  // ──────────────────────────────────────────────
  // Парсинг и поиск слов
  // ──────────────────────────────────────────────

  function tryExtractAndPost(text, url) {
    if (!text) return;
    const first = text.trimStart()[0];
    if (first !== '{' && first !== '[') return;

    try {
      const json = JSON.parse(text);
      const words = extractVocabulary(json);
      if (words && words.length >= MIN_WORDS) {
        postWords(words);
      }
    } catch (_) {}
  }

  // Рекурсивно обходит JSON в поисках массива объектов, похожих на словарь
  function extractVocabulary(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth ?? 0) > 10) return null;

    // Проверить массив напрямую
    if (Array.isArray(obj)) {
      if (obj.length >= MIN_WORDS) {
        const score = vocabScore(obj);
        if (score > 0) {
          const words = obj.map(normalizeWord).filter(Boolean);
          if (words.length >= MIN_WORDS) return words;
        }
      }
      // Рекурсия внутрь элементов массива
      for (const item of obj) {
        const result = extractVocabulary(item, (depth ?? 0) + 1);
        if (result) return result;
      }
      return null;
    }

    // Проверить значения объекта — сначала те, что выглядят как списки слов
    let best = null;
    for (const [key, val] of Object.entries(obj)) {
      if (Array.isArray(val) && val.length >= MIN_WORDS) {
        const score = vocabScore(val);
        if (score > 0) {
          const words = val.map(normalizeWord).filter(Boolean);
          if (words.length >= MIN_WORDS) {
            if (!best || words.length > best.length) best = words;
          }
        }
      }
    }
    if (best) return best;

    // Рекурсия в дочерние объекты
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const result = extractVocabulary(val, (depth ?? 0) + 1);
        if (result) return result;
      }
    }

    return null;
  }

  // Насколько массив похож на список слов (0 = точно не словарь, >0 = похоже)
  function vocabScore(arr) {
    if (!arr.length || typeof arr[0] !== 'object' || arr[0] === null) return 0;

    let hits = 0;
    const sample = arr.slice(0, Math.min(5, arr.length));

    for (const item of sample) {
      if (!item || typeof item !== 'object') continue;
      const keys = Object.keys(item).join(' ').toLowerCase();

      const hasWord = /\bword\b|wordstring|word_string|lexeme|token/.test(keys);
      const hasMeta = /translat|hint|meaning|skill|strength|lesson/.test(keys);

      if (hasWord) hits += 2;
      if (hasMeta) hits += 1;
    }

    return hits;
  }

  // Привести объект к унифицированному формату { word, translation, ... }
  function normalizeWord(item) {
    if (!item || typeof item !== 'object') return null;

    const word = (
      item.wordString ??
      item.word_string ??
      item.word ??
      item.lexeme_string ??
      item.token ??
      ''
    ).trim();

    if (!word || word.length < 1 || word.length > 80) return null;
    // Отфильтровать числа и мусор
    if (/^\d+$/.test(word)) return null;

    const rawTranslation =
      item.translationText ??
      item.translation ??
      item.hint ??
      (Array.isArray(item.hints) ? item.hints[0] : null) ??
      (Array.isArray(item.translations) ? item.translations[0] : null) ??
      '';

    const translation = typeof rawTranslation === 'string'
      ? rawTranslation
      : (Array.isArray(rawTranslation) ? rawTranslation[0] : '');

    return {
      word,
      translation: String(translation || ''),
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

  // Отправить слова в ISOLATED world через postMessage (с дедупликацией)
  function postWords(words) {
    const key = words.map(w => w.word).sort().join(',');
    if (window.__duoCtxLastKey === key) return;
    window.__duoCtxLastKey = key;

    window.postMessage({ [MSG_KEY]: true, words }, '*');
  }
})();
