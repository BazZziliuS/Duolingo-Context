# Duolingo Context

<p align="center">
  <a href="https://github.com/BazZziliuS/Duolingo-Context/blob/main/README.md">🇷🇺 Русский</a> &nbsp;|&nbsp;
  <a href="https://github.com/BazZziliuS/Duolingo-Context/blob/main/README.en.md">🇬🇧 English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/версия-1.1.0-58cc02?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-Extension-yellow?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/лицензия-MIT-lightgrey?style=flat-square" alt="License">
  <a href="https://github.com/BazZziliuS/Duolingo-Context/stargazers">
    <img src="https://img.shields.io/github/stars/BazZziliuS/Duolingo-Context?style=flat-square&color=58cc02" alt="Stars">
  </a>
</p>

Браузерное расширение для Chrome, которое подсвечивает слова из словаря Duolingo прямо на любых веб-страницах. При наведении на слово показывается тултип с переводом, транскрипцией и примером.

## Возможности

- Подсветка слов из словаря Duolingo на любых сайтах
- Тултип с переводом, транскрипцией и примером при наведении
- Синхронизация словаря со страницы [practice-hub/words](https://www.duolingo.com/practice-hub/words) через перехват запросов
- **Ручное добавление слов** через контекстное меню с автозаполнением перевода
- Автосинхронизация при открытии страницы слов Duolingo
- Фильтр по текущему уроку
- Три уровня интенсивности подсветки
- Выбор изучаемого языка (17 языков, включая поддержку японского/китайского/корейского)
- Поддержка SPA-сайтов (Twitter, Reddit и др.) через MutationObserver
- Статистика: слова за сегодня, топ-5 частых слов, прогресс по урокам

## Установка

1. Скачайте или клонируйте репозиторий
2. Откройте `chrome://extensions/`
3. Включите **Режим разработчика** (переключатель в правом верхнем углу)
4. Нажмите **Загрузить распакованное расширение**
5. Выберите папку с расширением

## Использование

### Первый запуск

1. Откройте [Duolingo](https://www.duolingo.com) и войдите в аккаунт
2. Перейдите на страницу [duolingo.com/practice-hub/words](https://www.duolingo.com/practice-hub/words) — расширение автоматически захватит словарь
3. Перейдите на любой сайт — слова из вашего словаря будут подсвечены

Альтернативно: кликните на иконку расширения → вкладка **Словарь** → **Синхронизировать** (откроет страницу слов автоматически).

### Тултип

Наведите курсор на подсвеченное слово:

```
┌─────────────────────────────┐
│ government          урок 4  │
│ /ˈɡʌvənmənt/                │
│ правительство               │
│ "The government announced   │
│  new rules yesterday."      │
└─────────────────────────────┘
```

### Добавление слов вручную

1. Выделите любое слово на странице
2. Нажмите правую кнопку мыши → **Добавить в словарь Duolingo Context**
3. В появившейся форме перевод, транскрипция и пример заполнятся автоматически
4. При необходимости отредактируйте и нажмите **Добавить**

Автозаполнение использует два источника:
- **MyMemory** — перевод на русский для любого языка
- **dictionaryapi.dev** — транскрипция и пример (для английского)

### Настройки

| Параметр | Описание |
|----------|----------|
| Подсветка слов | Включить/выключить расширение глобально |
| Только текущий урок | Показывать слова только из последнего пройденного урока |
| Автосинхронизация | Обновлять словарь при открытии страницы слов Duolingo |
| Интенсивность | Слабая / Средняя / Яркая — прозрачность подсветки |
| Изучаемый язык | Влияет на правила поиска слов (для CJK отключается граница `\b`) |

## Структура файлов

```
duolingo-context/
├── manifest.json          — конфигурация расширения (Manifest V3)
├── content.js             — подсветка слов, тултип, модалка добавления
├── content.css            — стили подсветки и тултипа
├── background.js          — сервис-воркер: контекстное меню, автозаполнение API
├── duolingo_interceptor.js — перехват fetch/XHR на странице слов (MAIN world)
├── duolingo_relay.js      — ретранслятор данных в background (ISOLATED world)
├── popup.html             — интерфейс расширения
├── popup.js               — логика интерфейса
├── popup.css              — стили интерфейса
└── icons/
    └── icon128.png        — иконка расширения
```

## Как работает синхронизация

Duolingo убрал старый API `/vocabulary/overview`. Расширение использует другой подход:

```
Страница practice-hub/words
        ↓
duolingo_interceptor.js (MAIN world)
перехватывает fetch/XHR запросы страницы
        ↓
window.postMessage
        ↓
duolingo_relay.js (ISOLATED world)
        ↓
chrome.runtime.sendMessage → background.js
        ↓
chrome.storage.local — словарь сохранён
```

## Формат данных

Словарь хранится в `chrome.storage.local` под ключом `duoWords`:

```json
[
  {
    "word": "government",
    "translation": "правительство",
    "transcription": "/ˈɡʌvənmənt/",
    "example": "The government announced new rules yesterday.",
    "lesson": 4,
    "strength": 0.85
  }
]
```

## Технические детали

| Что | Как реализовано |
|-----|----------------|
| Обход DOM | `TreeWalker` — не ломает структуру и события на странице |
| Поиск слов | Один скомпилированный `RegExp` для всего словаря |
| Границы слов | `\b` для латинских языков, без границ для CJK/арабского |
| Тултип | Один глобальный `<div>`, появляется по `mouseover` с задержкой 120ms |
| Добавление слов | Shadow DOM — полная изоляция от стилей страницы |
| SPA-сайты | `MutationObserver` с дебаунсом 300ms |
| Синхронизация | Перехват fetch/XHR в MAIN world через content script |
| Автозаполнение | Запросы к внешним API из service worker (нет CORS-ограничений) |

## Требуемые разрешения

| Разрешение | Зачем |
|-----------|-------|
| `storage` | Хранение словаря и настроек |
| `activeTab` | Доступ к текущей вкладке |
| `scripting` | Внедрение скриптов при открытии через контекстное меню |
| `tabs` | Открытие страницы синхронизации |
| `contextMenus` | Пункт «Добавить в словарь» в контекстном меню |
| `https://www.duolingo.com/*` | Перехват запросов на странице слов |

## Известные ограничения

- Синхронизация работает только при активной сессии Duolingo
- Автозаполнение перевода — через MyMemory (бесплатно, лимит ~5000 знаков/день)
- Транскрипция и примеры через dictionaryapi.dev — только для английского языка
- Содержимое `<iframe>` не обрабатывается
- Не работает на страницах `chrome://` и `about:`
