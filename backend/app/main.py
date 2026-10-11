import asyncio
import logging
import re
import time
from collections import OrderedDict, defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .ai import Gemini, basic_report
from .batch import build_report
from .config import ServiceError, Settings
from .github import GitHub, parse_repo
from .retrieval import Retriever, report_chunks, valid_source
from .store import Store

log = logging.getLogger('codelume')


class AnalyzeRequest(BaseModel):
    repository_url: str = Field(min_length=1, max_length=300)


class HistoryItem(BaseModel):
    role: str = Field(pattern='^(user|assistant)$')
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    analysis_id: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=2000)
    history: list[HistoryItem] = Field(default_factory=list, max_length=12)


def create_app(settings=None, transport=None):
    settings = settings or Settings()
    if settings.retrieval not in {'lexical', 'semantic'}:
        raise ValueError('RETRIEVAL_MODE must be lexical or semantic')
    if not re.fullmatch(r'[A-Za-z0-9._-]+', settings.gemini_model):
        raise ValueError('GEMINI_MODEL must be a model identifier, not a URL')
    store = Store(settings.database)
    indexes = OrderedDict()
    rate = defaultdict(deque)
    active = set()
    index_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(transport=transport, limits=httpx.Limits(max_connections=10)) as client:
            app.state.client = client
            yield

    app = FastAPI(title='Codelume API', version='1.0.0', lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors, allow_methods=['GET', 'POST'], allow_headers=['Content-Type'])

    @app.exception_handler(ServiceError)
    async def service_error(_request, exc):
        return JSONResponse(status_code=exc.status, content={'detail': exc.message})

    def limit(request, action, count):
        key = ((request.client.host if request.client else 'local'), action)
        now = time.monotonic()
        queue = rate[key]
        while queue and now - queue[0] > 60:
            queue.popleft()
        if len(queue) >= count:
            raise ServiceError(429, 'Too many requests. Please wait one minute.')
        queue.append(now)
        # Bounded in-process bookkeeping; single-user/local MVP, not multi-tenant rate limiting.
        if len(rate) > 1000:
            for k in list(rate):
                if not rate[k] or now - rate[k][-1] > 60:
                    del rate[k]

    async def build_index(key, files):
        async with index_lock:
            if key in indexes:
                indexes.move_to_end(key)
                return indexes[key]
            try:
                index = await asyncio.to_thread(Retriever, files, settings)
            except Exception as exc:
                raise ServiceError(503, 'Semantic search could not initialize. Install requirements-semantic.txt and download its model, or use RETRIEVAL_MODE=lexical.') from exc
            indexes[key] = index
            if len(indexes) > 8:
                indexes.popitem(last=False)
            return index

    async def analyze_job(key, owner, repo):
        state = {'status': 'processing', 'stage': 'Reading repository metadata', 'repository_url': f'https://github.com/{owner}/{repo}'}
        async def progress(stage):
            state['stage'] = stage
            store.save(key, state)
        try:
            github = GitHub(settings, app.state.client)
            snapshot = await github.inspect(owner, repo, progress)
            state.update(snapshot, analyzed_at=datetime.now(timezone.utc).isoformat())
            if not snapshot['coverage']['inspected']:
                state.update(status='no-data', error='No supported text files were found within the inspection limits.')
                store.save(key, state)
                return
            await progress('Preparing source search')
            await build_index(key, snapshot['files'])
            report = basic_report(snapshot)
            mode, warning = 'basic', 'AI is not configured. Showing source files and declared dependencies only.'
            if settings.gemini_key:
                await progress('Generating source-backed explanation')
                try:
                    report = await build_report(settings, app.state.client, snapshot, progress)
                    mode, warning = 'ai', report.pop('_warning')
                except ServiceError as exc:
                    warning = exc.message + ' Showing basic source information instead.'
            state.update(status='complete', stage='Complete', report=report, analysis_mode=mode, warning=warning, retrieval_mode=settings.retrieval)
            state['coverage']['missingEvidence'] = any(c['status'] != 'supported' for c in report['evidence']) or mode != 'ai' or state['coverage'].get('aiPartial', False)
            store.save(key, state)
        except ServiceError as exc:
            state.update(status={429: 'rate-limited', 403: 'inaccessible', 404: 'inaccessible', 401: 'inaccessible', 422: 'invalid'}.get(exc.status, 'failed'), error=exc.message)
            store.save(key, state)
        except Exception:
            log.exception('Analysis job failed')
            state.update(status='failed', error='Analysis failed unexpectedly. Retry or check the backend logs.')
            store.save(key, state)
        finally:
            active.discard(key)

    async def retry_ai_job(key, data):
        try:
            async def progress(stage):
                data['stage'] = stage
                store.save(key, data)
            data['report'] = await build_report(settings, app.state.client, data, progress)
            data.update(analysis_mode='ai', warning=data['report'].pop('_warning'))
            data['coverage']['missingEvidence'] = data['coverage'].get('aiPartial', False) or any(c['status'] != 'supported' for c in data['report']['evidence'])
        except ServiceError as exc:
            data['warning'] = exc.message + ' The previous report and source files are still available.'
        except Exception:
            log.exception('AI retry failed')
            data['warning'] = 'AI retry failed unexpectedly. The previous report is still available; check the backend logs.'
        finally:
            data.update(status='complete', stage='Complete')
            store.save(key, data)
            active.discard(key)

    @app.post('/analysis/{key}/retry-ai', status_code=202)
    async def retry_ai(key: str, background: BackgroundTasks, request: Request):
        data = store.get(key)
        if not data:
            raise ServiceError(404, 'Analysis not found or expired. Analyze the repository again.')
        if not settings.gemini_key:
            raise ServiceError(503, 'Set GEMINI_API_KEY in backend/.env and restart the backend before retrying.')
        if data.get('status') != 'complete' or key in active:
            raise ServiceError(409, 'An analysis is already running or this snapshot is not ready.')
        limit(request, 'analyze', 4)
        if len(active) >= 2:
            raise ServiceError(429, 'Two analyses are already running. Wait for one to finish.')
        active.add(key)
        data.update(status='processing', stage='Retrying AI explanation from saved source files')
        store.save(key, data)
        background.add_task(retry_ai_job, key, data)
        return {'analysis_id': key}

    @app.get('/health')
    async def health():
        return {'status': 'ok', 'ai_configured': bool(settings.gemini_key), 'retrieval_mode': settings.retrieval, 'max_files': settings.max_files}

    @app.post('/analyze', status_code=202)
    async def analyze(body: AnalyzeRequest, background: BackgroundTasks, request: Request):
        owner, repo = parse_repo(body.repository_url)
        limit(request, 'analyze', 4)
        if len(active) >= 2:
            raise ServiceError(429, 'Two analyses are already running. Wait for one to finish.')
        key = str(uuid4())
        active.add(key)
        store.save(key, {'status': 'processing', 'stage': 'Queued', 'repository_url': f'https://github.com/{owner}/{repo}'})
        background.add_task(analyze_job, key, owner, repo)
        return {'analysis_id': key}

    @app.get('/analysis/{key}')
    async def analysis(key: str):
        data = store.get(key)
        if not data:
            raise HTTPException(404, 'Analysis not found or expired. Analyze the repository again.')
        return data

    @app.post('/chat')
    async def chat(body: ChatRequest, request: Request):
        limit(request, 'chat', 12)
        if not body.message.strip():
            raise ServiceError(422, 'Enter a question.')
        data = store.get(body.analysis_id)
        if not data:
            raise ServiceError(404, 'Analysis not found. Analyze the repository first.')
        if data['status'] != 'complete':
            raise ServiceError(409, 'The analysis is not ready. Wait for completion.')
        index = await build_index(body.analysis_id, data['files'])
        # Include the previous question to resolve short follow-ups, not as evidence.
        last_user = next((m.content for m in reversed(body.history) if m.role == 'user'), '')
        query = body.message + (' ' + last_user[:600] if len(body.message.split()) < 8 else '')
        items = await asyncio.to_thread(index.search, query)
        if not items:
            return {'answer': 'No relevant excerpts were found in the inspected files. Try a filename or a more specific question. This does not prove the feature is absent.', 'sources': [], 'mode': 'ai' if settings.gemini_key else 'basic'}
        if not settings.gemini_key:
            sources = [valid_source(c, items) for c in items[:3]]
            answer = 'Basic search mode — no AI explanation was generated. These inspected excerpts match your question; they are search results, not confirmation of a feature:\n\n' + '\n\n'.join(f'{c["path"]} (lines {c["start_line"]}–{c["end_line"]})\n\n    ' + c['text'][:900].replace('\n', '\n    ') for c in items[:3])
            return {'answer': answer, 'sources': sources, 'mode': 'basic'}
        return await Gemini(settings, app.state.client).answer(body.message, [m.model_dump() for m in body.history], items)

    return app


app = create_app()
