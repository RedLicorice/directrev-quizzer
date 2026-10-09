# AWS Quizzer

A clean, offline-capable **Progressive Web App** for practising the **AWS Certified Developer Associate (DVA-C02)** exam.  
Bundled with 387 unique questions from the [Ditectrev open-source question bank](https://github.com/Ditectrev/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers).

**[▶ Open live demo](https://RedLicorice.github.io/directrev-quizzer/)**

---

## Features

### Three study modes

| Mode | Description |
|---|---|
| **Exam** | Timed simulation — configurable duration & passing score, answers revealed only at the end, question overview grid, flag for review |
| **Practice** | No time pressure — instant per-question feedback, live score counter, collapsible **Markdown notes editor** per question (persisted in `localStorage`) |
| **Flashcard** | 3D card flip — all options shown on the back (correct ✓ / wrong ✗), your saved notes appear on the reverse side, keyboard navigation (← → Space) |

### Data management

- **Datasets from a git repo / static host** — questions, images and explanations live in a separate data repo (or any static URL); the app loads them at runtime (see [Datasets](#datasets))
- **Per-dataset progress** — stats, notes, session history and practice drafts are stored locally *per dataset*
- **Backup** — one-click export of the current dataset's notes + stats into a JSON file
- **Restore** — restore notes and stats from a backup; a raw questions JSON or Ditectrev `README.md` can still be opened for the current session (not saved)
- All destructive operations require an explicit second confirmation

### PWA

- Installable on desktop and mobile
- Works offline after first load (Workbox service worker caches all assets)

---

## Getting started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Install and run locally

```bash
git clone https://github.com/RedLicorice/directrev-quizzer.git
cd directrev-quizzer
npm install
npm run dev
```

The bundled `src/data/questions.json` is committed to the repo, so the app is ready to use out of the box.

### Re-parse questions from source

If you update the upstream question repo, regenerate the JSON:

```bash
# Clone the source repo into assets/
git clone https://github.com/Ditectrev/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers \
  assets/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers

# Run the parser
npm run parse
```

The parser also accepts custom input/output paths:

```bash
node scripts/parse-questions.mjs path/to/README.md path/to/output.json
```

### Build for production

```bash
npm run build       # output goes to dist/
npm run preview     # preview the production build locally
```

---

## Datasets

Questions are **not** persisted in the browser. The app ships with one bundled dataset (AWS DVA-C02, works offline) and can load more from any number of *sources*:

| Source | Use for |
|---|---|
| **GitHub repo** (`owner/repo`, branch/tag, optional folder) | public repos are read from `raw.githubusercontent.com`; private repos need a fine-grained **read-only token** (Contents: read) and are read through the GitHub API |
| **Static URL** | any CORS-enabled static host (GitHub Pages, S3, …) |

Open **Datasets** on the home screen → *Add a source*. Sources (and tokens) are stored in this browser only.

### Layout of a source

```
index.json
<dataset-id>/questions.json
<dataset-id>/images/...        # referenced by relative path
```

```jsonc
// index.json
{ "schemaVersion": 1,
  "datasets": [
    { "id": "mcd-level-1", "title": "MuleSoft MCD Level 1", "file": "mcd-level-1/questions.json",
      "questions": 226, "images": 246 }
  ] }
```

```jsonc
// <dataset-id>/questions.json
[
  {
    "id": 1,
    "text": "Which of the following …? (Select TWO)",
    "image": "images/q001.jpeg",                  // optional, relative to this file
    "options": [
      { "text": "Option text", "correct": true },
      { "text": "", "correct": false, "image": "images/q001_B.jpeg" }
    ],
    "selectCount": 2,                              // number of correct options
    "explanation": "Markdown shown after answering",   // optional
    "explanationImage": "images/q001_expl.png"         // optional
  }
]
```

`id` must be stable: stats, notes and history are keyed by it, per dataset.

### Re-parse the bundled AWS questions

```bash
git clone https://github.com/Ditectrev/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers \
  assets/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers
npm run parse        # or: node scripts/parse-questions.mjs path/to/README.md path/to/output.json
```

---

## Project structure

```
directrev-quizzer/
├── scripts/
│   └── parse-questions.mjs   # README.md → questions.json converter
├── src/
│   ├── App.tsx                # Screen state machine
│   ├── types.ts               # Shared TypeScript types
│   ├── data/
│   │   └── questions.json     # Generated question bank (committed)
│   ├── hooks/
│   │   ├── useLocalStorage.ts
│   │   └── useTimer.ts
│   ├── utils/
│   │   ├── parseMarkdown.ts   # Client-side Ditectrev parser
│   │   ├── scoring.ts
│   │   └── shuffle.ts
│   └── components/
│       ├── HomeScreen.tsx
│       ├── ConfigScreen.tsx
│       ├── ExamSession.tsx
│       ├── PracticeSession.tsx
│       ├── FlashcardSession.tsx
│       ├── ResultsScreen.tsx
│       └── BackupRestoreModal.tsx
└── .github/
    └── workflows/
        └── deploy.yml         # Build + GitHub Pages deployment
```

---

## Tech stack

| | |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| Styling | Tailwind CSS 3 |
| Icons | Lucide React |
| Markdown | react-markdown |
| PWA | vite-plugin-pwa (Workbox) |
| CI/CD | GitHub Actions → GitHub Pages |

---

## Deploying your own instance

1. Fork this repo
2. Go to **Settings → Pages → Source** and select **GitHub Actions**
3. Push any commit to `main` — the workflow builds and deploys automatically

The `VITE_BASE_PATH` env variable is set automatically by the workflow to `/<repo-name>/`, so no manual configuration is needed after a fork.

---

## Local data storage

Only progress and settings are stored in the browser (`localStorage`). `<dataset>` is `aws-dva-c02` for the bundled dataset and `<source-id>:<dataset-id>` otherwise.

| Key | Content |
|---|---|
| `quizzer_stats:<dataset>` | per-question correct/wrong counters |
| `quizzer_notes:<dataset>` | `Record<questionId, markdownString>` — your notes |
| `quizzer_sessions:<dataset>` | session history |
| `quizzer_practice_draft:<dataset>` | resumable practice session |
| `quizzer_sources` | configured dataset sources (including tokens for private repos) |
| `quizzer_active_dataset` | last opened dataset |

Progress saved by earlier versions (unscoped `quizzer_*` keys) is migrated to the bundled dataset automatically.

---

## Credits

Questions sourced from the [Ditectrev AWS DVA-C02 Practice Tests](https://github.com/Ditectrev/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers) open-source repository, licensed under their respective terms.

---

## License

MIT
