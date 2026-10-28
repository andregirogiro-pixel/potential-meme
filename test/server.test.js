import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, buildMessages, retryAfterSeconds } from '../server.js';

async function app(t, options) {
  const server = createApp({ apiKey: '', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, post: body => fetch(`${url}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
}
const seed = { model: 'openai/gpt-4o-mini', initial: 'Vamos explorar uma ideia?', speaker: 'a', history: [], apiKey: 'test-key' };

test('histórico usa a perspectiva correta e mantém o contexto dos dois modelos', () => {
  const history = [{ speaker: 'a', content: 'Uma ideia A' }, { speaker: 'b', content: 'Um contraponto B' }];
  const a = buildMessages({ ...seed, history });
  assert.deepEqual(a.map(m => m.role), ['system', 'user', 'assistant', 'user']);
  const b = buildMessages({ ...seed, speaker: 'b', history: history.slice(0, 1), instruction: 'Questione as ideias.' });
  assert.equal(b[0].content, 'Questione as ideias.');
  assert.equal(b.at(-1).role, 'user');
  assert.equal(b.at(-1).content, 'Uma ideia A');
});
test('conversa A → B → A envia os modelos e respostas escolhidos ao OpenRouter', async t => {
  const calls = [];
  const { post } = await app(t, { request: async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    calls.push(JSON.parse(options.body));
    return Response.json({ choices: [{ message: { content: `Resposta ${calls.length}` } }] });
  } });
  const history = [];
  for (const speaker of ['a', 'b', 'a']) {
    const response = await post({ ...seed, speaker, model: speaker === 'a' ? seed.model : 'anthropic/claude-sonnet-4', history });
    assert.equal(response.status, 200);
    history.push({ speaker, content: (await response.json()).content });
  }
  assert.equal(calls[1].model, 'anthropic/claude-sonnet-4');
  assert.equal(calls[1].messages.at(-1).content, 'Resposta 1');
  assert.equal(calls[2].messages.at(-1).content, 'Resposta 2');
  assert.equal(calls[2].messages.at(-2).role, 'assistant');
});
test('chave do servidor funciona sem expor o valor na configuração', async t => {
  const { url, post } = await app(t, { apiKey: 'secret-server-key', request: async (_, options) => {
    assert.equal(options.headers.Authorization, 'Bearer secret-server-key');
    return Response.json({ choices: [{ message: { content: 'Olá!' } }] });
  } });
  assert.deepEqual(await (await fetch(`${url}/api/config`)).json(), { hasServerKey: true });
  const response = await post({ ...seed, apiKey: undefined });
  assert.equal(response.status, 200);
});
test('entradas inválidas e ausência de chave não acionam o provedor', async t => {
  const { post } = await app(t, { request: () => assert.fail('Não deve chamar o provedor') });
  for (const [body, status] of [[{ ...seed, apiKey: '' }, 401], [{ ...seed, history: [null] }, 400], [{ ...seed, model: '' }, 400], [{ ...seed, initial: ' ' }, 400], [{ ...seed, speaker: 'c' }, 400], [{ ...seed, apiKey: {} }, 400]]) {
    assert.equal((await post(body)).status, status);
  }
});
test('erros do provedor são compreensíveis e não vazam o corpo remoto', async t => {
  const { post } = await app(t, { request: async () => new Response('secret upstream detail', { status: 402 }) });
  const response = await post(seed);
  assert.equal(response.status, 402);
  assert.deepEqual(await response.json(), { error: 'Saldo insuficiente no OpenRouter.' });
});
test('Retry-After aceita segundos e data HTTP sem inventar espera para valores inválidos', () => {
  const now = Date.UTC(2026, 9, 28, 12);
  assert.equal(retryAfterSeconds('60', now), 60);
  assert.equal(retryAfterSeconds('0.5', now), 1);
  assert.equal(retryAfterSeconds('Wed, 28 Oct 2026 12:01:00 GMT', now), 60);
  for (const value of [null, '', 'inválido', '-1', '999999999999', 'Wed, 28 Oct 2026 11:00:00 GMT']) assert.equal(retryAfterSeconds(value, now), null);
});
test('429 identifica o modelo e preserva a espera informada sem vazar dados remotos', async t => {
  let calls = 0;
  const { post } = await app(t, { request: async () => {
    calls++;
    return new Response('secret upstream detail', { status: 429, headers: { 'Retry-After': '45' } });
  } });
  const response = await post({ ...seed, model: 'test/model:free' });
  const data = await response.json();
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '45');
  assert.equal(data.code, 'OPENROUTER_RATE_LIMIT');
  assert.equal(data.model, 'test/model:free');
  assert.equal(data.retryAfterSeconds, 45);
  assert.match(data.error, /cotas diárias compartilhadas/);
  assert.match(data.error, /histórico e a vez/);
  assert.doesNotMatch(JSON.stringify(data), /secret upstream detail|test-key/);
  assert.equal(calls, 1);
});
test('429 sem Retry-After informa que a duração é desconhecida', async t => {
  const { post } = await app(t, { request: async () => new Response('', { status: 429 }) });
  const response = await post(seed);
  const data = await response.json();
  assert.equal(data.retryAfterSeconds, null);
  assert.equal(response.headers.get('retry-after'), null);
  assert.match(data.error, /Não foi informado um tempo/);
});
test('resposta vazia é tratada como falha recuperável', async t => {
  const { post } = await app(t, { request: async () => Response.json({ choices: [{ message: { content: null } }] }) });
  assert.equal((await post(seed)).status, 502);
});
test('catálogo aceita modelos de texto e mantém IDs exatos em cache', async t => {
  let calls = 0;
  const { url } = await app(t, { request: async () => {
    calls++;
    return Response.json({ data: [{ id: 'provider/model:free', name: 'Modelo livre', architecture: { output_modalities: ['text'] } }, { id: 'image/model', architecture: { output_modalities: ['image'] } }] });
  } });
  for (let i = 0; i < 2; i++) assert.deepEqual(await (await fetch(`${url}/api/models`)).json(), { models: [{ id: 'provider/model:free', name: 'Modelo livre' }] });
  assert.equal(calls, 1);
});
test('servidor entrega a interface e bloqueia origens externas', async t => {
  const { url } = await app(t);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Dê a partida/);
  assert.equal((html.match(/class="panel model-panel"/g) || []).length, 2);
  assert.doesNotMatch(html, /character-figure|seed-panel/);
  const external = await fetch(`${url}/api/chat`, { method: 'POST', headers: { Origin: 'https://external.example', 'Content-Type': 'application/json' }, body: JSON.stringify(seed) });
  assert.equal(external.status, 403);
  assert.equal((await fetch(`${url}/server.js`)).status, 404);
});
