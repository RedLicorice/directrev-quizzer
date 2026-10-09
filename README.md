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

- Node.js ≥ 20 (≥ 18 is enough for the Pages build alone)
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

In the AWS build (below) every key is per user: `<dataset>` becomes `u:<sub>:hosted:<dataset-id>` (or
`u:<sub>:<source-id>:<dataset-id>`), and `quizzer_sources` / `quizzer_active_dataset` become `…:u:<sub>`, so colleagues
sharing a browser never see each other's stats, notes or tokens in the app. The legacy migration is not applied there.

---

## Hosting on AWS (colleagues build)

One codebase, two builds:

| | `npm run build` (GitHub Pages) | `npm run build -- --mode aws` (or `npm run build:aws`) |
|---|---|---|
| Flag | `VITE_DEPLOY=pages` (`.env`) | `VITE_DEPLOY=aws` (`.env.aws`) |
| Base path | `VITE_BASE_PATH` (set by the Pages workflow) | `/` |
| Backend | none | CloudFront + Lambda `auth` (Cognito) + S3, see `infra/` on branch `feat/aws-infra` |
| Datasets | bundled DVA-C02 + GitHub / Static URL sources | built-in **hosted** source (same origin, `/data/<id>/`), GitHub / URL sources under *Avanzate*; the bundled dataset is not shipped |
| Progress keys | unchanged | per user (`u:<sub>:…`) |
| Auth code | tree-shaken away (checked by `tests/builds.test.ts`) | `src/aws/` (`AuthGate`, session client, user chip + *Esci*) |

How the hosted build works:

- At start `AuthGate` calls `GET /auth/me` (cookie `__Host-qz_session`, HttpOnly JWT). No session → one
  `POST /auth/refresh` → otherwise `location.assign('/auth/login?return=<path>')` (Cognito managed login, invite-only).
  Without network the app shell still opens from the service worker and shows an offline banner.
- The hosted source lists the dataset ids the session allows (`ds`, or `allDatasets` when `ds = ["*"]`) and loads
  `/data/<id>/index.json`, then the entry's `questions.json` (relative to that index). Each dataset repo publishes
  `data/<id>/{index.json,questions.json,images/}`; there is no shared index. Images are plain `<img>` URLs, the cookie
  authenticates them. 401 → one refresh + retry → login; 403 → "dataset non abilitato".
- The session is refreshed 5 minutes before it expires and when the tab becomes visible. *Esci* clears runtime caches,
  `sessionStorage` and in-memory images, then goes to `/auth/logout`.
- The service worker never answers `/auth/*`, `/data/*`, `/api/*` with the cached `index.html` and never caches them
  (`navigateFallbackDenylist` + `NetworkOnly`).
- Fonts are self-hosted (`@fontsource/inter`, `@fontsource/jetbrains-mono`): no external host, CSP-ready.
- Limits of a shared PC: progress is separated per user *in the app*, but `localStorage` itself is readable by anyone
  using the same browser profile, and GitHub tokens of *Avanzate* sources are stored there in clear.

The backend (Terraform, CloudFront Function, Lambda `auth`) lives in `infra/` on branch `feat/aws-infra`; its
authoritative contract is `infra/CONTRACT.md`, mirrored for the app in [`server/mock/CONTRACT.md`](server/mock/CONTRACT.md).

### Local mock of the backend

`server/mock/server.mjs` (Node ≥ 20, no dependencies) implements the same contract: it serves `dist/`, serves a
datasets folder under `/data/<id>/`, applies the edge authorization and fakes the `/auth/*` endpoints with a login form
where you pick the email and the groups (`ds-<id>`, `ds-all`, `admin`).

```bash
npm run build -- --mode aws
# <datasets> holds one folder per dataset: <datasets>/aws-dva-c02/, <datasets>/mule-mcd-01/ (e.g. clones of the
# quizzer-dataset-* repos). It is read in place and never copied into this repo.
node server/mock/server.mjs --dist dist --data <datasets> --port 4200 --secret dev
# open http://localhost:4200  (localhost, not 127.0.0.1: __Host-/__Secure- cookies need a secure context,
# and browsers only treat plain-http localhost as one)
```

### Tests

```bash
npm test     # vitest: URL building, 401/403 mapping, per-user keys, session client, edge vectors, mock gateway,
             # and both builds (Pages invariants, service-worker denylist)
node e2e/aws-mock.e2e.mjs --data <datasets> --pw <path>/node_modules/playwright-core [--chromium <chrome>] [--out <dir>]
             # end-to-end in Chromium against the mock (Playwright is not a dependency of this repo)
```

---

## Credits

Questions sourced from the [Ditectrev AWS DVA-C02 Practice Tests](https://github.com/Ditectrev/Amazon-Web-Services-AWS-Developer-Associate-DVA-C02-Practice-Tests-Exams-Questions-Answers) open-source repository, licensed under their respective terms.

---

## License

MIT
