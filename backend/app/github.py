import base64
import re
from pathlib import PurePosixPath
from urllib.parse import quote, urlsplit

import httpx

from .config import ServiceError, Settings

EXTENSIONS = {'.py': 'python', '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.json': 'json', '.md': 'markdown', '.rst': 'text', '.txt': 'text', '.toml': 'toml', '.yaml': 'yaml', '.yml': 'yaml', '.go': 'go', '.java': 'java', '.rs': 'rust', '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.sql': 'sql', '.html': 'html', '.css': 'css', '.sh': 'shell'}
SKIP_DIRS = {'node_modules', 'vendor', 'dist', 'build', '.git', '.next', '.venv', 'venv', '__pycache__', 'coverage'}
MANIFESTS = {'package.json', 'requirements.txt', 'pyproject.toml', 'cargo.toml', 'go.mod', 'pom.xml', 'dockerfile'}
ENTRY_NAMES = {'main.py', 'app.py', 'main.ts', 'main.tsx', 'app.tsx', 'index.ts', 'index.js', 'main.go', 'main.rs', 'server.ts', 'server.js'}
LOCKS = {'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'poetry.lock', 'uv.lock'}


def parse_repo(value: str) -> tuple[str, str]:
    u = urlsplit(value.strip())
    parts = u.path.strip('/').split('/')
    if u.scheme != 'https' or u.netloc.lower() != 'github.com' or u.query or u.fragment or len(parts) != 2:
        raise ServiceError(422, 'Use https://github.com/owner/repository without a branch or file path.')
    owner, repo = parts
    repo = repo.removesuffix('.git')
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})', owner) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', repo) or repo in {'.', '..'}:
        raise ServiceError(422, 'Invalid GitHub owner or repository name.')
    return owner, repo


def skip_reason(item: dict, settings: Settings):
    p = PurePosixPath(item['path'])
    name = p.name.lower()
    if item.get('mode') == '120000' or item.get('type') != 'blob':
        return 'Symlink or submodule excluded'
    if any(part in SKIP_DIRS for part in p.parts) or name in LOCKS or '.min.' in name:
        return 'Generated, vendor or lock file'
    if name.startswith('.env') or p.suffix.lower() in {'.pem', '.key', '.p12', '.pfx'}:
        return 'Environment or credential file excluded'
    if item.get('size', 0) > settings.max_file_bytes:
        return 'File exceeds inspection size limit'
    if p.suffix.lower() not in EXTENSIONS and name not in MANIFESTS and name not in {'readme', 'license', 'makefile', 'go.mod'}:
        return 'Unsupported or binary file'
    return None


def priority(item):
    p = PurePosixPath(item['path'])
    name = p.name.lower()
    rank = 0 if name.startswith('readme') else 1 if name in MANIFESTS else 2 if name in ENTRY_NAMES else 3 if 'route' in str(p) or 'model' in str(p) else 4
    return rank, len(p.parts), str(p)


class GitHub:
    def __init__(self, settings: Settings, client: httpx.AsyncClient):
        self.s, self.client = settings, client

    async def get(self, path: str, *, authenticated=True):
        headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Codelume/1.0'}
        if authenticated and self.s.github_token:
            headers['Authorization'] = f'Bearer {self.s.github_token}'
        try:
            r = await self.client.get('https://api.github.com' + path, headers=headers, timeout=25, follow_redirects=False)
        except httpx.RequestError as exc:
            raise ServiceError(503, 'Could not reach GitHub. Check your connection and retry.') from exc
        if r.status_code in {403, 429} and (r.headers.get('x-ratelimit-remaining') == '0' or r.status_code == 429 or 'rate limit' in r.text.lower()):
            raise ServiceError(429, 'GitHub rate limit reached. Wait for reset or configure a server-side GitHub token.')
        if r.status_code in {301, 302, 307, 308}:
            raise ServiceError(422, 'This repository moved. Use its current GitHub URL.')
        if r.status_code == 409:
            raise ServiceError(404, 'This repository is empty; there is no commit to inspect.')
        if r.status_code in {401, 403, 404}:
            raise ServiceError(r.status_code, 'GitHub could not provide this public repository. Check its URL and any configured token.')
        if r.status_code >= 400:
            raise ServiceError(502, 'GitHub returned an upstream error. Retry later.')
        return r.json()

    async def inspect(self, owner, repo, progress):
        base = f'/repos/{quote(owner)}/{quote(repo)}'
        meta = await self.get(base)
        if meta.get('private') or meta.get('visibility', 'public') != 'public':
            raise ServiceError(403, 'Codelume only analyzes public repositories.')
        commit = await self.get(base + '/commits/' + quote(meta['default_branch'], safe=''))
        sha = commit['sha']
        tree = await self.get(base + '/git/trees/' + commit['commit']['tree']['sha'] + '?recursive=1')
        entries = [e for e in tree.get('tree', []) if e.get('type') in {'blob', 'commit'}]
        candidates = sorted([e for e in entries if skip_reason(e, self.s) is None], key=priority)
        inspected, reasons, total_chars = {}, {}, 0
        for item in candidates:
            if len(inspected) >= self.s.max_files:
                break
            await progress(f"Reading files ({len(inspected)}/{min(len(candidates), self.s.max_files)})")
            blob = await self.get(base + '/git/blobs/' + item['sha'])
            if blob.get('encoding') != 'base64' or blob.get('size', 0) > self.s.max_file_bytes:
                reasons[item['path']] = 'Unsupported encoding or file size'
                continue
            try:
                raw = base64.b64decode(blob['content'])
                if len(raw) > self.s.max_file_bytes or b'\x00' in raw:
                    raise ValueError('Not a bounded text file')
                text = raw.decode('utf-8')
            except (UnicodeError, ValueError):
                reasons[item['path']] = 'Binary or non-UTF-8 content'
                continue
            if total_chars + len(text) > self.s.max_total_chars:
                reasons[item['path']] = 'Total inspection text budget reached'
                continue
            inspected[item['path']] = text
            total_chars += len(text)
        url = meta['html_url'].rstrip('/')
        files = []
        # Bound response size for very large trees. Selected files always remain visible.
        displayed = sorted(entries, key=lambda e: (e['path'] not in inspected, e['path']))[:2000]
        for item in displayed:
            path = item['path']
            is_read = path in inspected
            name = PurePosixPath(path).name
            files.append({'path': path, 'content': inspected.get(path, ''), 'language': EXTENSIONS.get(PurePosixPath(path).suffix.lower(), 'text'), 'inspected': is_read,
                          'purpose': f'Inspected {name} at this commit.' if is_read else (reasons.get(path) or skip_reason(item, self.s) or 'Outside the selected file limit'),
                          'url': f'{url}/blob/{sha}/{quote(path, safe="/")}'})
        return {'repository_url': url, 'branch': meta['default_branch'], 'commit': sha, 'description': meta.get('description') or '',
                'stars': meta.get('stargazers_count', 0), 'forks': meta.get('forks_count', 0), 'files': files,
                'coverage': {'inspected': len(inspected), 'maximum': self.s.max_files, 'total': len(entries), 'eligible': len(candidates), 'treeTruncated': bool(tree.get('truncated')), 'listed': len(displayed), 'missingEvidence': True}}
