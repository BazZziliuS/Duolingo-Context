# Duolingo Context

<p align="center">
  <a href="https://github.com/BazZziliuS/Duolingo-Context/blob/main/README.md">🇷🇺 Русский</a> &nbsp;|&nbsp;
  <a href="https://github.com/BazZziliuS/Duolingo-Context/blob/main/README.en.md">🇬🇧 English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.0-58cc02?style=flat-square" alt="Version">
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-Extension-yellow?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="License">
  <a href="https://github.com/BazZziliuS/Duolingo-Context/stargazers">
    <img src="https://img.shields.io/github/stars/BazZziliuS/Duolingo-Context?style=flat-square&color=58cc02" alt="Stars">
  </a>
</p>

A Chrome extension that highlights words from your Duolingo vocabulary directly on any webpage. Hover over a highlighted word to see a tooltip with the translation, transcription, and usage example.

## Features

- Highlights Duolingo vocabulary words on any website
- Hover tooltip with translation, transcription, and example sentence
- Vocabulary sync from [practice-hub/words](https://www.duolingo.com/practice-hub/words) via request interception
- **Manual word addition** via context menu with auto-fill
- Auto-sync when the Duolingo words page is opened
- Filter by current lesson
- Three highlight intensity levels
- Language selection (17 languages, including Japanese/Chinese/Korean support)
- SPA support (Twitter, Reddit, etc.) via MutationObserver
- Statistics: words seen today, top-5 frequent words, progress by lesson

## Installation

1. Clone or download the repository
2. Open `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the extension folder

## Usage

### First launch

1. Open [Duolingo](https://www.duolingo.com) and sign in
2. Navigate to [duolingo.com/practice-hub/words](https://www.duolingo.com/practice-hub/words) — the extension will automatically capture your vocabulary
3. Open any website — words from your dictionary will be highlighted

Alternatively: click the extension icon → **Dictionary** tab → **Sync** (opens the words page automatically).

### Tooltip

Hover over any highlighted word:

```
┌─────────────────────────────┐
│ government          lesson 4│
│ /ˈɡʌvənmənt/                │
│ правительство               │
│ "The government announced   │
│  new rules yesterday."      │
└─────────────────────────────┘
```

### Adding words manually

1. Select any word on a page
2. Right-click → **Add to Duolingo Context dictionary**
3. Translation, transcription and example will be filled in automatically
4. Edit if needed and click **Add**

Auto-fill uses two sources:
- **MyMemory** — translation into Russian for any language
- **dictionaryapi.dev** — transcription and example (English only)

### Settings

| Setting | Description |
|---------|-------------|
| Word highlighting | Enable/disable the extension globally |
| Current lesson only | Show only words from the most recent lesson |
| Auto-sync | Update vocabulary when the Duolingo words page is opened |
| Intensity | Weak / Medium / Strong — highlight opacity |
| Learning language | Affects word matching rules (disables `\b` boundary for CJK) |

## File structure

```
duolingo-context/
├── manifest.json          — extension config (Manifest V3)
├── content.js             — word highlighting, tooltip, add-word modal
├── content.css            — highlight and tooltip styles
├── background.js          — service worker: context menu, auto-fill API calls
├── duolingo_interceptor.js — fetch/XHR interceptor on the words page (MAIN world)
├── duolingo_relay.js      — data relay to background (ISOLATED world)
├── popup.html             — extension UI
├── popup.js               — UI logic
├── popup.css              — UI styles
└── icons/
    └── icon128.png        — extension icon
```

## How sync works

Duolingo removed the old `/vocabulary/overview` API endpoint. The extension uses a different approach:

```
practice-hub/words page
        ↓
duolingo_interceptor.js (MAIN world)
intercepts all fetch/XHR requests made by the page
        ↓
window.postMessage
        ↓
duolingo_relay.js (ISOLATED world)
        ↓
chrome.runtime.sendMessage → background.js
        ↓
chrome.storage.local — vocabulary saved
```

## Data format

The dictionary is stored in `chrome.storage.local` under the key `duoWords`:

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

## Technical details

| What | How |
|------|-----|
| DOM traversal | `TreeWalker` — preserves page structure and events |
| Word matching | Single compiled `RegExp` for the entire dictionary |
| Word boundaries | `\b` for Latin-script languages, none for CJK/Arabic |
| Tooltip | Single global `<div>`, shown on `mouseover` with 120ms delay |
| Add-word modal | Shadow DOM — fully isolated from page styles |
| SPA support | `MutationObserver` with 300ms debounce |
| Sync | fetch/XHR interception in MAIN world via content script |
| Auto-fill | External API calls from service worker (no CORS restrictions) |

## Required permissions

| Permission | Purpose |
|-----------|---------|
| `storage` | Storing vocabulary and settings |
| `activeTab` | Access to the current tab |
| `scripting` | Script injection when triggered via context menu |
| `tabs` | Opening the sync page |
| `contextMenus` | "Add to dictionary" context menu item |
| `https://www.duolingo.com/*` | Request interception on the words page |

## Known limitations

- Sync requires an active Duolingo session
- Translation auto-fill uses MyMemory (free, ~5000 chars/day limit)
- Transcription and examples via dictionaryapi.dev — English only
- Content inside `<iframe>` is not processed
- Does not work on `chrome://` or `about:` pages
