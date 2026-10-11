import asyncio
import base64
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import ServiceError, Settings
from app.github import parse_repo
from app.main import create_app
from app.retrieval import Retriever, report_chunks, valid_source

FILES = {'README.md': '# Notes\nA notes API.\n- List notes\n', 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/notes")\ndef notes():\n    return []\n', 'requirements.txt': 'fastapi>=0.115\n'}


def source():
    return {'path': 'main.py', 'start_line': 3, 'end_line': 5}


def draft():
    return {'summary': 'An API that lists notes.', 'summarySources': [source()], 'features': [{'text': 'Lists notes', 'sources': [source()]}],
            'technologies': [{'name': 'FastAPI', 'role': 'HTTP routes', 'evidence': 'observed', 'sources': [{'path': 'main.py', 'start_line': 1, 'end_line': 3}]}],
            'entryPoints': ['main.py', 'invented.py'], 'readingOrder': ['README.md', 'main.py'],
            'evidence': [{'claim': 'List notes', 'status': 'supported', 'explanation': 'A GET endpoint returns a list.', 'source': source()},
                         {'claim': 'Bad claim', 'status': 'supported', 'explanation': 'Not grounded', 'source': {'path': 'made-up.py', 'start_line': 1, 'end_line': 2}}]}


def transport(*, private=False, quota=False, ai_payload=None):
    def handle(request):
        if request.url.host == 'generativelanguage.googleapis.com':
            if quota:
                return httpx.Response(429, json={})
            schema = json.loads(request.content)['generationConfig']['responseJsonSchema']
            payload = ai_payload if ai_payload is not None else (draft() if schema['title'] == 'ReportDraft' else {'answer': 'The GET /notes route returns a list.', 'sources': [source()]})
            return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': json.dumps(payload)}]}}]})
        path = request.url.path
        if path == '/repos/test/notes':
            return httpx.Response(200, json={'private': private, 'html_url': 'https://github.com/test/notes', 'default_branch': 'main', 'description': 'Test notes'})
        if path.endswith('/commits/main'):
            return httpx.Response(200, json={'sha': 'a' * 40, 'commit': {'tree': {'sha': 'tree'}}})
        if path.endswith('/git/trees/tree'):
            entries = [{'path': p, 'sha': str(i), 'size': len(t), 'type': 'blob', 'mode': '100644'} for i, (p, t) in enumerate(FILES.items())]
            entries += [{'path': '.env', 'sha': 'secret', 'size': 20, 'type': 'blob', 'mode': '100644'}, {'path': 'node_modules/x.js', 'sha': 'vendor', 'size': 20, 'type': 'blob', 'mode': '100644'}]
            return httpx.Response(200, json={'tree': entries, 'truncated': False})
        if '/git/blobs/' in path:
            sha = path.split('/')[-1]
            assert sha not in {'secret', 'vendor'}, 'Sensitive/generated file was fetched'
            text = list(FILES.values())[int(sha)]
            return httpx.Response(200, json={'encoding': 'base64', 'content': base64.b64encode(text.encode()).decode(), 'size': len(text)})
        return httpx.Response(404, json={})
    return httpx.MockTransport(handle)


def make(tmp_path, **kwargs):
    return Settings(database=tmp_path / 'test.sqlite', gemini_key=kwargs.pop('key', ''), github_token='', retrieval='lexical', **kwargs)


def analyze(client):
    r = client.post('/analyze', json={'repository_url': 'https://github.com/test/notes'})
    assert r.status_code == 202
    key = r.json()['analysis_id']
    return key, client.get('/analysis/' + key).json()


@pytest.mark.parametrize('url', ['http://github.com/test/notes', 'https://github.com.evil.test/a/b', 'https://github.com/test/notes/tree/main', 'https://github.com/a/..', 'https://user@github.com/test/notes', 'https://127.0.0.1/a/b', 'https://github.com/a/b?x=y'])
def test_reject_non_repository_urls(url):
    with pytest.raises(ServiceError):
        parse_repo(url)


def test_basic_real_files_and_retention(tmp_path):
    settings = make(tmp_path)
    with TestClient(create_app(settings, transport())) as client:
        key, result = analyze(client)
        assert result['status'] == 'complete'
        assert result['analysis_mode'] == 'basic'
        assert result['coverage']['inspected'] == 3 and result['coverage']['total'] == 5
        assert not result['report']['evidence']
        assert all('/blob/' + 'a' * 40 + '/' in f['url'] for f in result['files'])
        answer = client.post('/chat', json={'analysis_id': key, 'message': 'Where is the notes endpoint?', 'history': []})
        assert answer.status_code == 200 and answer.json()['mode'] == 'basic'
        assert answer.json()['sources']
        assert 'Basic search mode' in answer.json()['answer']
    with TestClient(create_app(settings, transport())) as client:
        assert client.get('/analysis/' + key).json()['status'] == 'complete'


def test_private_repo_rejected(tmp_path):
    with TestClient(create_app(make(tmp_path), transport(private=True))) as client:
        _, result = analyze(client)
        assert result['status'] == 'inaccessible'
        assert 'files' not in result


def test_ai_reports_validate_citations(tmp_path):
    with TestClient(create_app(make(tmp_path, key='test-only-key'), transport())) as client:
        key, result = analyze(client)
        assert result['analysis_mode'] == 'ai'
        assert result['report']['entryPoints'] == ['main.py']
        assert len(result['report']['evidence']) == 1
        r = client.post('/chat', json={'analysis_id': key, 'message': 'Where is the notes endpoint?'}).json()
        assert r['mode'] == 'ai' and r['sources'][0]['path'] == 'main.py'
        assert r['sources'][0]['url'].endswith('#L3-L5')


def test_quota_falls_back_and_chat_errors(tmp_path):
    with TestClient(create_app(make(tmp_path, key='test-only-key'), transport(quota=True))) as client:
        key, result = analyze(client)
        assert result['status'] == 'complete' and result['analysis_mode'] == 'basic'
        assert 'quota' in result['warning'].lower()
        assert client.post('/chat', json={'analysis_id': key, 'message': 'notes'}).status_code == 429


def test_invalid_ai_is_not_displayed_as_success(tmp_path):
    with TestClient(create_app(make(tmp_path, key='test-only-key'), transport(ai_payload={'unexpected': 'invalid'}))) as client:
        _, result = analyze(client)
        assert result['analysis_mode'] == 'basic'
        assert 'invalid' in result['warning']


def test_request_validation_and_rate_limit(tmp_path):
    with TestClient(create_app(make(tmp_path), transport())) as client:
        assert client.post('/analyze', json={'repository_url': 'https://localhost/a/b'}).status_code == 422
        assert client.get('/analysis/missing').status_code == 404
        for _ in range(4):
            analyze(client)
        assert client.post('/analyze', json={'repository_url': 'https://github.com/test/notes'}).status_code == 429
        assert client.post('/chat', json={'analysis_id': 'x', 'message': 'x' * 2001}).status_code == 422


def test_retrieval_and_context_boundaries(tmp_path):
    files = [{'path': p, 'content': text, 'inspected': True, 'url': 'https://github.com/test/notes/blob/commit/' + p} for p, text in FILES.items()]
    items = report_chunks(files, 10000)
    assert valid_source(source(), items)
    assert valid_source({'path': 'main.py', 'start_line': 0, 'end_line': 3}, items) is None
    assert valid_source({'path': 'main.py', 'start_line': 1, 'end_line': 999}, items) is None
    assert valid_source({'path': 'missing.py', 'start_line': 1, 'end_line': 1}, items) is None
    assert not report_chunks(files, 1)
    assert Retriever(files, make(tmp_path)).search('notes endpoint')[0]['path'] == 'main.py'


def test_maximum_files_enforced(tmp_path):
    with TestClient(create_app(make(tmp_path, max_files=1), transport())) as client:
        _, result = analyze(client)
        assert result['coverage']['inspected'] == 1
        assert len([f for f in result['files'] if f['inspected']]) == 1


def test_temporary_provider_error_retries_and_redacts(tmp_path, caplog, monkeypatch):
    from app import ai
    async def no_wait(_):
        pass
    monkeypatch.setattr(ai.asyncio, 'sleep', no_wait)
    normal = transport()
    attempts = []
    def handle(request):
        if request.url.host == 'generativelanguage.googleapis.com':
            attempts.append(request)
            if len(attempts) == 1:
                return httpx.Response(503, json={'error': {'message': 'Busy test-only-key'}})
        return normal.handle_request(request)
    with TestClient(create_app(make(tmp_path, key='test-only-key'), httpx.MockTransport(handle))) as client:
        _, result = analyze(client)
        assert result['analysis_mode'] == 'ai'
        assert len(attempts) == 2
    assert 'test-only-key' not in caplog.text
    assert 'HTTP 503' in caplog.text


def test_retry_ai_uses_snapshot_without_github_requests(tmp_path, monkeypatch):
    from app import ai
    async def no_wait(_):
        pass
    monkeypatch.setattr(ai.asyncio, 'sleep', no_wait)
    normal = transport()
    requests = []
    fail = True
    def handle(request):
        requests.append(request.url.host)
        if request.url.host == 'generativelanguage.googleapis.com' and fail:
            return httpx.Response(503, json={'error': {'message': 'Model busy'}})
        return normal.handle_request(request)
    with TestClient(create_app(make(tmp_path, key='test-only-key'), httpx.MockTransport(handle))) as client:
        key, result = analyze(client)
        assert result['analysis_mode'] == 'basic'
        assert 'HTTP 503' in result['warning']
        requests.clear()
        fail = False
        assert client.post('/analysis/' + key + '/retry-ai').status_code == 202
        updated = client.get('/analysis/' + key).json()
        assert updated['analysis_mode'] == 'ai'
        assert updated['files'] == result['files']
        assert requests == ['generativelanguage.googleapis.com']


def test_permanent_provider_error_not_retried(tmp_path):
    normal = transport()
    attempts = []
    def handle(request):
        if request.url.host == 'generativelanguage.googleapis.com':
            attempts.append(request)
            return httpx.Response(400, json={'error': {'message': 'Unsupported schema'}})
        return normal.handle_request(request)
    with TestClient(create_app(make(tmp_path, key='test-only-key'), httpx.MockTransport(handle))) as client:
        _, result = analyze(client)
        assert result['analysis_mode'] == 'basic'
        assert 'Unsupported schema' in result['warning']
        assert len(attempts) == 1


def test_retry_requires_key_and_preserves_previous_report(tmp_path):
    with TestClient(create_app(make(tmp_path), transport())) as client:
        key, result = analyze(client)
        assert client.post('/analysis/' + key + '/retry-ai').status_code == 503
        assert client.get('/analysis/' + key).json()['report'] == result['report']
