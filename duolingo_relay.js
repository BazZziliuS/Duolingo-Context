/**
 * duolingo_relay.js — работает в ISOLATED world на странице practice-hub/words.
 * Получает слова от MAIN world через window.postMessage
 * и передаёт их в background.js через chrome.runtime.sendMessage.
 */

'use strict';

const MSG_KEY = '__duoCtxVocab__';

window.addEventListener('message', (event) => {
  // Принимать только сообщения из того же окна с нашим маркером
  if (event.source !== window) return;
  if (!event.data?.[MSG_KEY]) return;

  const words = event.data.words;
  if (!Array.isArray(words) || words.length === 0) return;

  chrome.runtime.sendMessage({ action: 'vocabCaptured', words }, (response) => {
    // Игнорировать ошибки если popup закрыт
    void chrome.runtime.lastError;
  });
});
