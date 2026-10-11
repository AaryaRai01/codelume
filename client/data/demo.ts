import type { DemoFile, EvidenceClaim, DemoReport } from "@/types";

export const demoMetadata = { stars: 128, forks: 14, languages: ["TypeScript", "Python"] };

export const demoFiles: DemoFile[] = [
  {
    path: "README.md",
    purpose: "Project overview and declared capabilities",
    language: "markdown",
    inspected: true,
    content: `# Lumen Notes\n\nA small notes app built with React, FastAPI, and SQLite.\n\n## Features\n\n- Create, read, and delete notes\n- Search notes by text\n- Offline sync keeps notes available everywhere\n\n## Development\n\nRun the frontend with npm run dev. Start the API with uvicorn backend.main:app --reload.\n`,
  },
  {
    path: "frontend/src/App.tsx",
    purpose: "Notes interface and client-side title filtering",
    language: "tsx",
    inspected: true,
    content: `import { useEffect, useState } from "react";\nimport { getNotes, createNote, deleteNote } from "./api";\n\ntype Note = { id: number; title: string; body: string };\n\nexport default function App() {\n  const [notes, setNotes] = useState<Note[]>([]);\n  const [query, setQuery] = useState("");\n\n  useEffect(() => { getNotes().then(setNotes); }, []);\n\n  const visibleNotes = notes.filter((note) =>\n    note.title.toLowerCase().includes(query.toLowerCase())\n  );\n\n  async function addNote(title: string, body: string) {\n    const note = await createNote({ title, body });\n    setNotes((current) => [...current, note]);\n  }\n\n  async function removeNote(id: number) {\n    await deleteNote(id);\n    setNotes((current) => current.filter((note) => note.id !== id));\n  }\n\n  return <main aria-label="Notes">{visibleNotes.map((note) => <article key={note.id}>{note.title}</article>)}</main>;\n}\n`,
  },
  {
    path: "frontend/src/api.ts",
    purpose: "HTTP requests from the React app to the notes API",
    language: "typescript",
    inspected: true,
    content: `const API = "http://localhost:8000";\n\nexport async function getNotes() {\n  const response = await fetch(\`${"${API}"}/notes\`);\n  return response.json();\n}\n\nexport async function createNote(note: { title: string; body: string }) {\n  const response = await fetch(\`${"${API}"}/notes\`, {\n    method: "POST",\n    headers: { "Content-Type": "application/json" },\n    body: JSON.stringify(note),\n  });\n  return response.json();\n}\n\nexport async function deleteNote(id: number) {\n  return fetch(\`${"${API}"}/notes/${"${id}"}\`, { method: "DELETE" });\n}\n`,
  },
  {
    path: "backend/main.py",
    purpose: "FastAPI routes for listing, creating, and deleting notes",
    language: "python",
    inspected: true,
    content: `from fastapi import FastAPI\nfrom pydantic import BaseModel\nfrom backend.database import connect\n\napp = FastAPI()\n\nclass NoteInput(BaseModel):\n    title: str\n    body: str\n\n@app.get("/notes")\ndef list_notes():\n    with connect() as db:\n        return db.execute("SELECT id, title, body FROM notes").fetchall()\n\n@app.post("/notes")\ndef create_note(note: NoteInput):\n    with connect() as db:\n        cursor = db.execute(\n            "INSERT INTO notes (title, body) VALUES (?, ?)",\n            (note.title, note.body),\n        )\n        return {"id": cursor.lastrowid, **note.model_dump()}\n\n@app.delete("/notes/{note_id}")\ndef delete_note(note_id: int):\n    with connect() as db:\n        db.execute("DELETE FROM notes WHERE id = ?", (note_id,))\n        return {"deleted": note_id}\n`,
  },
  {
    path: "backend/database.py",
    purpose: "SQLite connection and notes table initialization",
    language: "python",
    inspected: true,
    content: `import sqlite3\n\nDATABASE = "notes.db"\n\ndef connect():\n    db = sqlite3.connect(DATABASE)\n    db.row_factory = sqlite3.Row\n    db.execute(\n        "CREATE TABLE IF NOT EXISTS notes ("\n        "id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL)"\n    )\n    return db\n`,
  },
  {
    path: "requirements.txt",
    purpose: "Python runtime dependencies",
    language: "text",
    inspected: true,
    content: `fastapi==0.115.0\nuvicorn==0.30.6\n`,
  },
  {
    path: "package.json",
    purpose: "Frontend scripts and JavaScript dependencies",
    language: "json",
    inspected: true,
    content: `{"scripts":{"dev":"vite","build":"vite build"},"dependencies":{"react":"^18.3.0","vite":"^5.4.0"}}\n`,
  },
  {
    path: "tests/test_notes.py",
    purpose: "API test for creating and listing a note",
    language: "python",
    inspected: true,
    content: `from fastapi.testclient import TestClient\nfrom backend.main import app\n\nclient = TestClient(app)\n\ndef test_create_and_list_note():\n    created = client.post("/notes", json={"title": "First", "body": "Hello"})\n    assert created.status_code == 200\n    assert created.json()["title"] == "First"\n\n    notes = client.get("/notes")\n    assert any(note["title"] == "First" for note in notes.json())\n`,
  },
];

export const demoClaims: EvidenceClaim[] = [
  {
    claim: "Create, read, and delete notes",
    status: "supported",
    explanation: "The API defines GET /notes to list, POST /notes to create, and DELETE /notes/{note_id} to remove notes.",
    sourcePath: "backend/main.py",
    startLine: 10,
    endLine: 27,
  },
  {
    claim: "Search notes by text",
    status: "partial",
    explanation: "The interface filters note titles in the browser. The API has no search endpoint and note bodies are not included in the filter.",
    sourcePath: "frontend/src/App.tsx",
    startLine: 12,
    endLine: 14,
  },
  {
    claim: "Offline sync keeps notes available everywhere",
    status: "not-found",
    explanation: "No service worker, local persistence, or synchronization logic appears in the eight inspected files.",
  },
];

export const demoReport: DemoReport = {
  summary: "Lumen Notes is a small React notes interface backed by a FastAPI service and SQLite. The frontend reads and mutates notes through HTTP calls; persistence lives in the local database.",
  features: ["List notes from the API", "Create and delete notes", "Filter titles in the browser"],
  technologies: [
    { name: "React", role: "Renders the notes interface and manages visible note state.", evidence: "observed" },
    { name: "FastAPI", role: "Exposes HTTP endpoints for note operations.", evidence: "observed" },
    { name: "SQLite", role: "Stores note rows in a local database file.", evidence: "observed" },
    { name: "Offline sync", role: "Claimed in README, but no implementation was found.", evidence: "declared" },
  ],
  entryPoints: ["frontend/src/App.tsx", "backend/main.py"],
  readingOrder: ["README.md", "frontend/src/App.tsx", "frontend/src/api.ts", "backend/main.py", "backend/database.py"],
};

export const demoAnswers: Record<string, { answer: string; sources: { path: string; startLine: number; endLine: number }[] }> = {
  purpose: {
    answer: "Lumen Notes is a small note-taking app. The React interface displays notes and calls a FastAPI service, while SQLite stores them locally.\n\nThe README also claims offline sync, but that behavior was **not found** in the inspected files.",
    sources: [{ path: "README.md", startLine: 1, endLine: 3 }, { path: "backend/database.py", startLine: 3, endLine: 8 }],
  },
  frontend: {
    answer: "The frontend calls the API through `frontend/src/api.ts`. It fetches the note list on mount, then updates the visible list after creating or deleting a note.\n\nSearch is currently a client-side **title-only filter** in `frontend/src/App.tsx`; it does not search note bodies.",
    sources: [{ path: "frontend/src/App.tsx", startLine: 9, endLine: 14 }, { path: "frontend/src/api.ts", startLine: 1, endLine: 18 }],
  },
  auth: {
    answer: "I found no authentication routes, middleware, or login flow in the eight inspected files. That means there is **no evidence of authentication in this snapshot**; it is not a security assessment of the full repository.",
    sources: [{ path: "backend/main.py", startLine: 1, endLine: 27 }],
  },
  ai: {
    answer: "There is no AI integration visible in the inspected files. Codelume’s live analysis and Q&A require a connected backend; this demo answer is based only on the bundled example repository.",
    sources: [{ path: "requirements.txt", startLine: 1, endLine: 2 }, { path: "package.json", startLine: 1, endLine: 1 }],
  },
};
