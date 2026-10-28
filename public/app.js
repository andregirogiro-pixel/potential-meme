const $ = id => document.getElementById(id);
const state = { history: [], running: false, controller: null, session: null, hasServerKey: false, generation: 0 };
const empties = { a: $('messages-a').innerHTML, b: $('messages-b').innerHTML };
const wait = (ms, signal) => new Promise(resolve => {
  const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
  const timer = setTimeout(finish, ms);
  signal.addEventListener('abort', finish, { once: true });
  if (signal.aborted) finish();
});

// A datalist allows both a searchable catalog and an exact, manually entered ID.
const list = document.createElement('datalist');
list.id = 'openrouter-models';
document.body.append(list);
for (const speaker of ['a', 'b']) {
  const input = $(`model-${speaker}`);
  input.setAttribute('list', list.id);
  input.setAttribute('autocomplete', 'off');
  input.placeholder = 'Busque ou cole o ID do modelo';
}
const catalogStatus = document.createElement('p');
catalogStatus.className = 'catalog-status';
catalogStatus.textContent = 'Carregando o catálogo de modelos…';
document.querySelector('.settings').after(catalogStatus);
fetch('/api/models').then(async response => {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  for (const model of data.models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.label = model.name;
    list.append(option);
  }
  catalogStatus.textContent = `${data.models.length} modelos disponíveis. Busque pelo nome ou cole o identificador nos seletores abaixo.`;
}).catch(() => { catalogStatus.textContent = 'Catálogo indisponível. Você ainda pode colar o identificador de qualquer modelo de texto do OpenRouter.'; });
fetch('/api/config').then(r => r.json()).then(data => {
  state.hasServerKey = data.hasServerKey;
  if (data.hasServerKey) {
    $('key-status').textContent = 'chave configurada no servidor';
    $('api-key').placeholder = 'Chave do servidor ativa (ou insira outra)';
  }
}).catch(() => {});

function showError(message = '') { $('error').textContent = message; $('error').hidden = !message; }
function update(status) {
  const count = state.history.length;
  const limit = state.session?.limit ?? Number($('limit').value);
  $('counter').textContent = `${count} de ${limit} respostas`;
  if (status) $('status').textContent = status;
  $('status-dot').classList.toggle('active', state.running);
  $('reset').disabled = !state.session;
  $('start').textContent = state.running ? 'Pausar conversa Ⅱ' : count >= limit ? 'Conversa concluída ✓' : state.session ? 'Retomar conversa →' : 'Iniciar conversa →';
  $('start').disabled = !state.running && count >= limit;
  document.querySelector('.seed-panel').classList.toggle('has-session', Boolean(state.session));
  for (const id of ['initial', 'model-a', 'model-b', 'instruction-a', 'instruction-b', 'limit']) $(id).disabled = Boolean(state.session);
  // A key can be corrected while paused without discarding the conversation.
  $('api-key').disabled = state.running;
  for (const button of document.querySelectorAll('.suggestion')) button.disabled = Boolean(state.session);
}
function footer(speaker, text, busy = false) {
  const target = $(`footer-${speaker}`);
  target.replaceChildren();
  const dot = document.createElement('span');
  dot.className = `small-dot${busy ? ' active' : ''}`;
  target.append(dot, document.createTextNode(text));
  $(`panel-${speaker}`).classList.toggle('thinking', busy);
}
function renderTurn(turn) {
  const container = $(`messages-${turn.speaker}`);
  container.querySelector('.empty')?.remove();
  const article = document.createElement('div');
  article.className = 'message';
  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = `RESPOSTA ${state.history.length} · ${turn.speaker.toUpperCase()}`;
  const content = document.createElement('p');
  content.textContent = turn.content;
  article.append(label, content);
  container.append(article);
  container.scrollTop = container.scrollHeight;
}
function pause() {
  state.running = false;
  state.generation++;
  state.controller?.abort();
  footer('a', 'Conversa pausada');
  footer('b', 'Conversa pausada');
  update('Pausada. Continue quando quiser.');
}
async function start() {
  if (state.running) return pause();
  showError();
  const key = $('api-key').value.trim();
  if (!key && !state.hasServerKey) { showError('Informe sua chave do OpenRouter para começar.'); $('api-key').focus(); return; }
  if (!state.session) {
    const initial = $('initial').value.trim();
    if (!initial) { showError('Escreva uma mensagem para iniciar a conversa.'); $('initial').focus(); return; }
    const models = { a: $('model-a').value.trim(), b: $('model-b').value.trim() };
    if (Object.values(models).some(m => !/^[\w./:@-]{1,150}$/.test(m))) { showError('Selecione ou cole um identificador de modelo válido para cada participante.'); return; }
    state.session = { initial, models, instructions: { a: $('instruction-a').value.trim(), b: $('instruction-b').value.trim() }, limit: Number($('limit').value) };
  }
  state.running = true;
  const generation = ++state.generation;
  const controller = new AbortController();
  state.controller = controller;
  update();
  try {
    while (state.running && generation === state.generation && state.history.length < state.session.limit) {
      const speaker = state.history.length % 2 === 0 ? 'a' : 'b';
      const other = speaker === 'a' ? 'b' : 'a';
      footer(speaker, 'Preparando uma resposta…', true);
      footer(other, `Aguardando o modelo ${speaker.toUpperCase()}`);
      update(`Modelo ${speaker.toUpperCase()} está respondendo…`);
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ apiKey: key || undefined, model: state.session.models[speaker], initial: state.session.initial, history: state.history.map(({ speaker, content }) => ({ speaker, content })), speaker, instruction: state.session.instructions[speaker] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Não foi possível obter a resposta.');
      if (!state.running || generation !== state.generation) return;
      if (typeof data.content !== 'string' || !data.content.trim()) throw new Error('O modelo retornou uma resposta vazia.');
      const turn = { speaker, content: data.content };
      state.history.push(turn);
      renderTurn(turn);
      footer(speaker, 'Resposta recebida');
      update('Passando a palavra…');
      if (state.history.length < state.session.limit) await wait(1200, controller.signal);
    }
    if (generation !== state.generation) return;
    state.running = false;
    footer('a', 'Conversa concluída');
    footer('b', 'Conversa concluída');
    update('Limite atingido. Uma boa hora para refletir.');
  } catch (error) {
    if (generation !== state.generation) return;
    state.running = false;
    footer('a', 'Conversa pausada');
    footer('b', 'Conversa pausada');
    update('Conversa pausada. Você pode tentar novamente.');
    showError(error.name === 'AbortError' ? 'Solicitação cancelada.' : error.message);
  }
}
$('start').addEventListener('click', start);
$('reset').addEventListener('click', () => {
  if (state.running) pause();
  state.generation++;
  state.history = [];
  state.session = null;
  for (const speaker of ['a', 'b']) $(`messages-${speaker}`).innerHTML = empties[speaker];
  footer('a', 'Aguardando o início');
  footer('b', 'Aguardando o modelo A');
  showError();
  update('Tudo pronto para começar');
});
$('toggle-key').addEventListener('click', () => {
  const visible = $('api-key').type === 'password';
  $('api-key').type = visible ? 'text' : 'password';
  $('toggle-key').textContent = visible ? 'Ocultar' : 'Mostrar';
  $('toggle-key').setAttribute('aria-label', visible ? 'Ocultar chave' : 'Mostrar chave');
});
$('limit').addEventListener('change', () => update());
for (const button of document.querySelectorAll('.suggestion')) button.addEventListener('click', () => { $('initial').value = button.dataset.prompt; $('initial').focus(); });
update();
