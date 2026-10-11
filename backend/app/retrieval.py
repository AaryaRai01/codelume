import math
import re
import threading
from collections import Counter
from functools import lru_cache

STOP = set('a an the is are was were to of in on at for with what how does do this that it and or be can i you me project repository code file implemented implement'.split())
ALIASES = {'authentication': 'auth login jwt session password', 'database': 'sqlite prisma postgres mongodb sql', 'ai': 'model inference predict gemini openai', 'frontend': 'react fetch axios component', 'backend': 'fastapi express router endpoint', 'purpose': 'readme description overview', 'endpoint': 'route router app get post handler'}


def terms(text):
    text = re.sub(r'([a-z])([A-Z])', r'\1 \2', text)
    return [t for t in re.findall(r'[a-zA-Z][a-zA-Z0-9]+', text.lower()) if t not in STOP]


def chunks(files):
    out = []
    for f in files:
        if not f['inspected'] or not f['content'].strip():
            continue
        lines = f['content'].splitlines()
        start = 0
        while start < len(lines):
            end, size = start, 0
            while end < len(lines) and end - start < 32:
                line_size = len(lines[end]) + 1
                if size + line_size > 3500 and end > start:
                    break
                size += line_size
                end += 1
            # Oversized single lines are not sent to the model or cited.
            if size <= 5000:
                out.append({'path': f['path'], 'start_line': start + 1, 'end_line': end, 'text': '\n'.join(lines[start:end]), 'url': f.get('url', '')})
            start = max(start + 1, end - 4)
    return out


_model_lock = threading.Lock()


@lru_cache(maxsize=1)
def semantic_model(name):
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(name, device='cpu')


class Retriever:
    def __init__(self, files, settings):
        self.items = chunks(files)
        self.settings = settings
        self.counts = [Counter(terms(c['path'] + ' ' + c['text'])) for c in self.items]
        df = Counter(t for counts in self.counts for t in counts)
        self.idf = {t: math.log((1 + len(self.items)) / (1 + n)) + 1 for t, n in df.items()}
        self.vectors = [{t: (1 + math.log(n)) * self.idf[t] for t, n in count.items()} for count in self.counts]
        self.norms = [math.sqrt(sum(v * v for v in row.values())) for row in self.vectors]
        self.embeddings = None
        if settings.retrieval == 'semantic' and self.items:
            with _model_lock:
                self.model = semantic_model(settings.embedding_model)
                self.embeddings = self.model.encode([c['path'] + '\n' + c['text'] for c in self.items], normalize_embeddings=True)

    def search(self, question, limit=8):
        query = question
        for word, expanded in ALIASES.items():
            if word in question.lower():
                query += ' ' + expanded
        q = Counter(terms(query))
        vec = {t: (1 + math.log(n)) * self.idf.get(t, 1) for t, n in q.items()}
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1
        scores = [sum(v * row.get(t, 0) for t, v in vec.items()) / (norm * n or 1) for row, n in zip(self.vectors, self.norms)]
        if self.embeddings is not None:
            with _model_lock:
                embedding = self.model.encode([question], normalize_embeddings=True)[0]
            dense = self.embeddings @ embedding
            scores = [0.45 * s + 0.55 * max(0, float(d)) for s, d in zip(scores, dense)]
        selected = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
        return [self.items[i] for i in selected[:limit] if scores[i] > 0.015]


def report_chunks(files, budget):
    all_chunks = chunks(files)
    # Spread context across files before adding second/third chunks of long files.
    buckets = {}
    for c in all_chunks:
        buckets.setdefault(c['path'], []).append(c)
    paths = sorted(buckets, key=lambda p: (not p.lower().endswith('readme.md'), not p.endswith(('package.json', 'requirements.txt', 'pyproject.toml')), p))
    selected, used = [], 0
    for i in range(max((len(v) for v in buckets.values()), default=0)):
        for path in paths:
            if i >= len(buckets[path]):
                continue
            c = buckets[path][i]
            size = len(c['text']) + 200
            if used + size <= budget:
                selected.append(c)
                used += size
    return selected


def context_text(items):
    return '\n\n'.join(f'FILE {c["path"]} L{c["start_line"]}-L{c["end_line"]}\n' + '\n'.join(f'{c["start_line"] + i}: {line}' for i, line in enumerate(c['text'].splitlines())) for c in items)


def valid_source(source, items):
    if not isinstance(source, dict):
        return None
    path, start, end = source.get('path'), source.get('start_line'), source.get('end_line')
    if type(start) is not int or type(end) is not int or start < 1 or end < start:
        return None
    for c in items:
        if path == c['path'] and c['start_line'] <= start <= end <= c['end_line']:
            return {'path': path, 'start_line': start, 'end_line': end, 'url': c['url'].split('#')[0] + f'#L{start}-L{end}'}
    return None
