<div align="center">

# Codelume

### Understand the code behind the README.

**An AI-assisted GitHub repository explorer that turns unfamiliar public codebases into readable, source-backed explanations.**

[Explore the source](https://github.com/AaryaRai01/codelume) · [Report an issue](https://github.com/AaryaRai01/codelume/issues)

</div>

---

## Overview

A README describes what a project *intends* to do. Understanding how it works requires locating entry points, dependencies, implementation files, and supporting evidence. **Codelume** provides a structured way to explore a public GitHub repository: from a high-level map to individual files and line-linked explanations.

Instead of presenting generated claims as unquestionable facts, Codelume surfaces the inspected source files, highlights coverage limitations, and links explanations back to code.

## Features

| Feature | What it does |
| --- | --- |
| **Public GitHub analysis** | Accepts public `https://github.com/owner/repository` URLs and retrieves repository metadata and a commit-pinned source snapshot. |
| **Repository overview** | Presents a summary, available feature insights, key technologies, and suggested reading order. |
| **Interactive file explorer** | Browse the repository file tree and inspect selected source files without switching tools. |
| **Technology map** | Shows identified technologies and their roles; the overview keeps this section compact and expandable. |
| **Start reading here** | Prioritizes useful files and entry points when learning an unfamiliar codebase. |
| **README claim checks** | When AI is available, compares selected claims with inspected source and labels the strength of supporting evidence. |
| **Source-linked explanations** | Displays citations with paths and line ranges so insights can be verified in GitHub. |
| **Repository Q&A** | Ask questions about the inspected codebase through retrieval-assisted chat. |
| **Basic mode** | Without Gemini access, browse real source data, declared dependencies, and matching excerpts instead of fabricated AI answers. |
| **Demo experience** | Explore the interface without submitting your own repository. |
| **Coverage indicators** | Distinguishes files actually inspected from files merely listed in the repository tree. |

> **Scope:** Codelume reads a bounded selection of files; it does **not** execute repository code or guarantee exhaustive analysis. AI output may contain errors and should be checked against cited sources.

## How It Works

```text
Public GitHub repository URL
             |
             v
    FastAPI analysis job
             |
             v
 GitHub API: metadata, commit,
  file tree and selected blobs
             |
             v
   Source filtering and limits
             |
             +---------------------------+
             |                           |
             v                           v
     Search index              Source-backed report
 (lexical by default)          |              |
             |                Gemini       Basic mode
             |              (if usable)    (fallback)
             |                           |
             +-------------+-------------+
                           |
                           v
                React analysis workspace
                           |
                           v
               Ask repository questions
                           |
                           v
             Relevant excerpts + Gemini
               or basic excerpt search
```

1. **Submit a repository:** Enter a public GitHub URL on the landing page.
2. **Inspect a fixed snapshot:** The backend resolves the default branch to a commit, lists files, and selectively reads supported text files.
3. **Build source context:** Files are prioritized by relevance (for example, READMEs, manifests, and probable entry points) and indexed for retrieval.
4. **Generate the overview:** When Gemini is configured and available, Codelume requests structured insights grounded in the inspected excerpts. If not, it presents a clearly labeled basic report.
5. **Explore and verify:** Navigate files, review cited line ranges, follow a suggested reading order, and ask questions about the inspected code.

### Inspection limits

Default inspection is capped at **30 files**, **60 KB per file**, and **180,000 characters** across the inspected source. The displayed repository tree is capped at **2,000 entries**. These boundaries manage performance and cost, but also mean that uninspected files may contain information not reflected in a report.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS |
| Interface | Radix UI, Lucide React, Framer Motion, React Router |
| Client data | TanStack Query |
| Backend API | Python, FastAPI, Pydantic, HTTPX |
| AI analysis | Google Gemini API (optional, server-side) |
| Source retrieval | Local lexical TF-IDF; optional Sentence Transformers |
| Data storage | SQLite (local analysis snapshots and reports) |
| Frontend production server | Express |
| External data | GitHub REST API |

## Project Structure

```text
codelume/
├── backend/
│   ├── app/
│   │   ├── main.py        # FastAPI endpoints and analysis jobs
│   │   ├── github.py      # GitHub API and source selection
│   │   ├── ai.py          # Gemini reports and source-backed answers
│   │   ├── retrieval.py   # Retrieval and citation validation
│   │   ├── store.py       # SQLite persistence
│   │   └── config.py      # Settings and environment variables
│   ├── tests/
│   ├── .env.example
│   └── requirements.txt
├── client/
│   ├── components/codelume/ # Repository workspace
│   ├── pages/               # Landing and other pages
│   ├── services/api.ts      # API client
│   ├── App.tsx              # Client routes
│   └── global.css           # Application styles
├── public/                  # Public images, icons and favicon
├── server/                  # Express production server
├── index.html
├── package.json
└── pnpm-lock.yaml
```

## Run Locally

### Prerequisites

- **Node.js 22.12+** and **pnpm**
- **Python 3.11 or 3.12**
- Internet access for public GitHub repositories
- Optional: a Gemini API key for AI-generated explanations

Clone the repository:

```bash
git clone https://github.com/AaryaRai01/codelume.git
cd codelume
```

### 1. Start the FastAPI backend

In terminal 1 (macOS/Linux):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

To enable AI, edit `backend/.env` and configure:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

The model name is an example: choose a model available to your account and quota. Leave `GEMINI_API_KEY` empty to use basic mode.

Then start the API:

```bash
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Backend: `http://127.0.0.1:8000`  
Interactive API documentation: `http://127.0.0.1:8000/docs`

### 2. Start the frontend

In terminal 2, from the project root:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open **http://127.0.0.1:8080** and paste a public GitHub repository URL.

> The Vite development server proxies `/api` requests to the FastAPI backend. Both services must run for live repository analysis. The built-in demo can be used independently.

### Optional: Enable semantic retrieval

By default, Codelume uses local lexical search. To use embeddings:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-semantic.txt
```

Set `RETRIEVAL_MODE=semantic` in `backend/.env` and restart the API. The first run may download embedding model weights. This optional mode has additional resource requirements.

## Configuration

See [`backend/.env.example`](backend/.env.example) for the available settings.

| Variable | Purpose | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Enable Gemini-generated reports and chat answers | Empty (basic mode) |
| `GEMINI_MODEL` | Gemini model ID | `gemini-2.5-flash` |
| `GITHUB_TOKEN` | Optional server-side token for GitHub API rate limits | Empty |
| `RETRIEVAL_MODE` | `lexical` or `semantic` | `lexical` |
| `EMBEDDING_MODEL` | Embedding model for semantic retrieval | `sentence-transformers/all-MiniLM-L6-v2` |
| `MAX_FILES` | Maximum inspected files, capped at 30 | `30` |
| `DATABASE_PATH` | Local SQLite database path | `data/codelume.sqlite3` |
| `CORS_ORIGINS` | Allowed frontend development origins | Local port 8080 |
| `VITE_API_BASE_URL` | Optional alternate frontend API base URL | `/api` |

**Security:** Never commit `backend/.env`, API keys, or access tokens. Never place a Gemini secret in a `VITE_` variable: those are exposed in the client bundle. The app uses public repository content only, even with a GitHub token.

## API Reference

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check API status and enabled analysis settings |
| `POST` | `/analyze` | Start asynchronous repository analysis |
| `GET` | `/analysis/{analysis_id}` | Poll for progress or retrieve a completed analysis |
| `POST` | `/chat` | Ask a question about an analyzed repository |

Example analysis request:

```bash
curl -X POST http://127.0.0.1:8000/analyze \
  -H 'Content-Type: application/json' \
  -d '{"repository_url":"https://github.com/octocat/Hello-World"}'
```

A successful submission returns an `analysis_id`; use it to poll `GET /analysis/{analysis_id}`. Chat accepts an `analysis_id`, a `message`, and optional recent conversation `history`.

## Validation and Tests

Frontend (project root):

```bash
pnpm typecheck
pnpm test
pnpm build
```

Backend:

```bash
cd backend
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest -q
```

Automated backend tests mock AI provider responses. Passing them does not prove that a live Gemini request will succeed; actual requests depend on API key validity, model availability, provider quotas, and network access.

## Troubleshooting

**Frontend loads but analysis fails:** Confirm that FastAPI is running at `127.0.0.1:8000`, then check `/health` and the backend terminal.

**Gemini quota or 429 error:** Your Gemini API key/model has reached a provider quota or rate limit. Try a model available to your account, review provider quotas, or continue in basic mode. Retrying immediately will not bypass a quota restriction.

**Repository cannot be analyzed:** Enter the canonical URL of a public, nonempty GitHub repository, without `/tree/`, `/blob/`, query strings, or fragments.

**No feature evidence:** Codelume may not have inspected the relevant file, or AI may be unavailable. Lack of evidence is not proof that the repository lacks a feature.

**Browser shows an old favicon:** Refresh with `Cmd + Shift + R`; favicons are often cached.

## Limitations and Deployment Notes

- Current implementation is a **single-user MVP**, not a multi-tenant production service.
- There is no application login or per-user authorization; analysis IDs are not an access-control mechanism.
- Codelume does not execute downloaded repository code or perform a comprehensive security scan.
- Source excerpts and recent chat context can be sent to Gemini when AI mode is enabled; do not assume inspected public files are suitable for sharing with an external model without reviewing your requirements.
- Reports are stored in a local SQLite database, with aging records cleaned up during writes. They are not a permanent archive.
- Provider outages and quota errors can cause report generation to fall back to basic mode; AI chat may instead return an error.
- For public deployment, add authentication, access control, a durable job queue, shared rate limiting, and managed storage. The provided static hosting configuration does not by itself host the Python backend.

## Author

**Aarya Rai**  
GitHub: [@AaryaRai01](https://github.com/AaryaRai01)

---

<div align="center">

**Codelume — A map, not a black box.**

</div>
