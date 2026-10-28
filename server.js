import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

export function retryAfterSeconds(value, now = Date.now()) {
  if (!value) return null;
  const seconds = /^\d+(\.\d+)?$/.test(value.trim())
    ? Math.ceil(Number(value))
    : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 604800 ? seconds : null;
}

export function buildMessages({ initial, history, speaker, instruction }) {
  return [
    { role: 'system', content: instruction || 'Você participa de uma conversa com outro modelo de IA. Responda em português, de forma clara e direta. Desenvolva a conversa a partir da última mensagem, sem simular os outros participantes.' },
    { role: 'user', content: initial },
    ...history.map(turn => ({ role: turn.speaker === speaker ? 'assistant' : 'user', content: turn.content })),
  ];
}

export function createApp({ request = fetch, apiKey = process.env.OPENROUTER_API_KEY } = {}) {
  let catalog;
  return http.createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/config') return json(200, { hasServerKey: Boolean(apiKey) });
      if (req.method === 'GET' && path === '/api/models') {
        if (catalog && Date.now() - catalog.time < 3600000) return json(200, { models: catalog.models });
        const upstream = await request('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15000) });
        if (!upstream.ok) return json(502, { error: 'Catálogo indisponível. Cole o identificador do modelo diretamente.' });
        const data = await upstream.json();
        if (!Array.isArray(data.data)) return json(502, { error: 'Catálogo inválido. Cole o identificador do modelo diretamente.' });
        const models = data.data.filter(m => typeof m.id === 'string' && (!m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'))).map(m => ({ id: m.id, name: m.name || m.id })).sort((a, b) => a.name.localeCompare(b.name));
        catalog = { models, time: Date.now() };
        return json(200, { models });
      }
      if (req.method === 'POST' && path === '/api/chat') {
        if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) return json(403, { error: 'Origem não permitida.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Envie JSON.' });
        let raw = '';
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 200_000) return json(413, { error: 'Conversa muito longa. Reinicie para continuar.' });
        }
        let body;
        try { body = JSON.parse(raw); } catch { return json(400, { error: 'JSON inválido.' }); }
        const { model, initial, history, speaker, instruction } = body;
        if (typeof model !== 'string' || !/^[\w./:@-]{1,150}$/.test(model) || typeof initial !== 'string' || !initial.trim() || initial.length > 12000 || !['a', 'b'].includes(speaker) || !Array.isArray(history) || history.length > 100 || history.some(t => !t || !['a', 'b'].includes(t.speaker) || typeof t.content !== 'string' || !t.content.trim() || t.content.length > 20000) || (instruction !== undefined && (typeof instruction !== 'string' || instruction.length > 4000))) return json(400, { error: 'Verifique o modelo, a mensagem e o histórico da conversa.' });
        if (body.apiKey !== undefined && typeof body.apiKey !== 'string') return json(400, { error: 'Chave inválida.' });
        const key = body.apiKey?.trim() || apiKey;
        if (!key) return json(401, { error: 'Informe sua chave do OpenRouter.' });
        if (/\s/.test(key) || key.length > 512) return json(400, { error: 'Chave inválida.' });
        const controller = new AbortController();
        const cancel = () => controller.abort();
        res.on('close', cancel);
        const timeout = setTimeout(cancel, 90000);
        try {
          const upstream = await request('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Entre modelos' },
            body: JSON.stringify({ model, messages: buildMessages(body), max_tokens: 800, stream: false }),
            signal: controller.signal,
          });
          if (!upstream.ok) {
            if (upstream.status === 429) {
              const seconds = retryAfterSeconds(upstream.headers.get('retry-after'));
              if (seconds !== null) res.setHeader('Retry-After', String(seconds));
              return json(429, {
                error: `O OpenRouter limitou a solicitação ao modelo ${model}. O limite pode ser da conta ou do provedor.${model.endsWith(':free') ? ' Modelos :free também podem ter cotas diárias compartilhadas.' : ''} ${seconds === null ? 'Não foi informado um tempo de espera. Aguarde antes de tentar novamente e consulte os limites da sua conta no OpenRouter.' : 'Aguarde o tempo informado antes de tentar novamente pela seta.'} O histórico e a vez deste modelo foram preservados.`,
                code: 'OPENROUTER_RATE_LIMIT',
                model,
                retryAfterSeconds: seconds,
              });
            }
            const messages = { 400: 'O OpenRouter recusou a solicitação. Verifique o identificador e a compatibilidade do modelo.', 401: 'Chave do OpenRouter inválida ou expirada.', 402: 'Saldo insuficiente no OpenRouter.', 403: 'Acesso ao modelo negado pelo OpenRouter.', 404: 'Modelo não encontrado no OpenRouter.' };
            return json(upstream.status >= 500 ? 502 : (messages[upstream.status] ? upstream.status : 502), { error: messages[upstream.status] || 'O OpenRouter está indisponível. Tente novamente.' });
          }
          const data = await upstream.json();
          const content = data.choices?.[0]?.message?.content;
          if (typeof content !== 'string' || !content.trim()) return json(502, { error: 'O modelo não retornou texto. Tente outro modelo ou retome.' });
          if (content.length > 20000) return json(502, { error: 'A resposta excedeu o tamanho permitido. Tente outro modelo.' });
          return json(200, { content, model: data.model || model, usage: data.usage || null });
        } finally {
          clearTimeout(timeout);
          res.off('close', cancel);
        }
      }
      if (req.method === 'GET' && files.has(path)) {
        const [file, type] = files.get(path);
        const content = await readFile(new URL(`./public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
        return res.end(content);
      }
      return json(404, { error: 'Não encontrado.' });
    } catch (error) {
      if (!res.destroyed) json(error.name === 'AbortError' ? 504 : 502, { error: error.name === 'AbortError' ? 'A resposta demorou demais. Retome para tentar novamente.' : 'Não foi possível concluir a solicitação. Verifique a conexão e tente novamente.' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => console.log(`Entre modelos · porta ${port}`));
}
