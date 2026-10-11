import json
import sqlite3
import time
from pathlib import Path


class Store:
    """One connection per operation; JSON reports survive a local backend restart."""
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS analyses (id TEXT PRIMARY KEY, updated REAL, payload TEXT NOT NULL)')
            # Background tasks are not durable: make interrupted work explicit on restart.
            for key, payload in db.execute('SELECT id,payload FROM analyses').fetchall():
                report = json.loads(payload)
                if report.get('status') == 'processing':
                    report.update(status='failed', error='The server restarted during analysis. Submit the repository again.')
                    db.execute('UPDATE analyses SET payload=? WHERE id=?', (json.dumps(report), key))

    def connect(self):
        return sqlite3.connect(self.path, timeout=15)

    def save(self, key: str, report: dict):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO analyses VALUES (?,?,?)', (key, time.time(), json.dumps(report)))
            # Local MVP retention: seven days.
            db.execute('DELETE FROM analyses WHERE updated < ?', (time.time() - 7 * 86400,))

    def get(self, key: str):
        with self.connect() as db:
            row = db.execute('SELECT payload FROM analyses WHERE id=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None
