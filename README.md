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

- **Backup** — one-click export of all questions + notes into a single JSON file
- **Restore** — selectively restore questions, notes, or both from a backup; or load a new question set from a raw questions JSON or a Ditectrev-format `README.md`
- **Persisted imports** — custom question sets survive page reloads (stored in `localStorage`)
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

## Using custom questions

AWS Quizzer is not tied to any specific question bank. You can load your own questions in two ways:

### Option A — Import in-app

Click **Backup · Restore · Import** on the home screen, then choose a file:

| File type | What happens |
|---|---|
| `questions.json` (array) | Questions loaded and persisted in `localStorage` |
| Backup `.json` (exported by this app) | Choose to restore questions, notes, or both |
| Ditectrev `README.md` | Parsed client-side; questions loaded and persisted |

### Option B — Replace the bundled data

Run the parser with your own Ditectrev-format markdown file:

```bash
node scripts/parse-questions.mjs my-questions/README.md src/data/questions.json
npm run build
```

### Question JSON format

```jsonc
[
  {
    "id": 1,
    "text": "Which of the following are good use cases for ElastiCache? (Select TWO)",
    "options": [
      { "text": "Improve latency for read-heavy workloads.", "correct": true },
      { "text": "Improve performance of S3 PUT operations.", "correct": false }
      // ...
    ],
    "selectCount": 2   // number of correct answers; drives multi-select UI
  }
]
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

All data is stored exclusively in your browser's `localStorage` — nothing is sent to any server.

| Key | Content |
|---|---|
| `quizzer_notes` | `Record<questionId, markdownString>` — your per-question notes |
| `quizzer_imported_questions` | `Question[]` — custom question set (if imported) |

---

## Credits

Questions sourced from the [Ditectrev AWS DVA-C02 Practice Tests](https://github.com/Ditectrev/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers) open-source repository, licensed under their respective terms.

---

## License

MIT
