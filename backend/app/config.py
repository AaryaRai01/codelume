import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env')


@dataclass
class Settings:
    github_token: str = field(default_factory=lambda: os.getenv('GITHUB_TOKEN', ''))
    gemini_key: str = field(default_factory=lambda: os.getenv('GEMINI_API_KEY', ''))
    gemini_model: str = field(default_factory=lambda: os.getenv('GEMINI_MODEL', 'gemini-2.5-flash'))
    retrieval: str = field(default_factory=lambda: os.getenv('RETRIEVAL_MODE', 'lexical'))
    embedding_model: str = field(default_factory=lambda: os.getenv('EMBEDDING_MODEL', 'sentence-transformers/all-MiniLM-L6-v2'))
    max_files: int = field(default_factory=lambda: min(2000, max(1, int(os.getenv('MAX_FILES', '500')))))
    database: Path = field(default_factory=lambda: ROOT / os.getenv('DATABASE_PATH', 'data/codelume.sqlite3'))
    cors: list[str] = field(default_factory=lambda: os.getenv('CORS_ORIGINS', 'http://localhost:8080,http://127.0.0.1:8080').split(','))
    max_file_bytes: int = 200_000
    max_total_chars: int = 2_000_000
    ai_batch_chars: int = 40_000
    max_ai_batches: int = 12
    report_context_chars: int = 65_000


class ServiceError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)
