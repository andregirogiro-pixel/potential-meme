# Entre modelos

Uma mensagem sua inicia uma conversa passo a passo entre dois modelos de texto do **OpenRouter**, em apenas dois quadros: modelo A e modelo B. O campo **Assunto inicial**, acima dos quadros, serve para dar a partida; você não participa como um terceiro modelo.

## Executar

Requer **Node.js 24 ou superior**. Não há dependências externas.

```sh
npm start
```

O servidor usa a porta 3000 (configurável por `PORT`). Para desenvolvimento com reinício automático, execute `npm run dev`.

1. Informe sua chave do OpenRouter no campo da página.
2. Em cada caixa de seleção, escolha um modelo do catálogo. Para inserir outro, clique no botão **+**, digite o identificador exato (por exemplo `openai/gpt-4o-mini`) e clique em **Adicionar modelo**. Ele entra nas listas dos dois modelos e fica selecionado no quadro em que você clicou. Não há duplicatas; os modelos adicionados permanecem durante a sessão, inclusive ao reiniciar a conversa. Você pode usar modelos iguais ou diferentes. O catálogo lista modelos com saída de texto; disponibilidade, saldo e compatibilidade dependem da sua conta.
3. No campo **Assunto inicial**, escreva a pauta que será enviada ao modelo A. Você pode clicar em **Usar exemplo** e editar o texto. Se quiser, configure instruções individuais nos quadros: por exemplo, A propõe soluções e B faz críticas construtivas.
4. Escolha o limite total de respostas e clique em **Enviar ao modelo A →**. Apenas o A responde.
5. Clique em **Modelo B responde →** para enviar a resposta do A ao B. Depois, o botão muda para **Modelo A responde →**. Cada clique libera exatamente uma resposta, com o histórico completo; a conversa nunca avança sozinha. O botão fica bloqueado durante a solicitação para evitar envios duplicados. **Cancelar resposta** interrompe a espera local e mantém a vez do mesmo modelo. **Reiniciar** limpa as respostas e libera os modelos e o assunto inicial para edição.

Exemplo: escolha Nemotron no quadro A e um modelo da OpenAI no quadro B (use os identificadores disponíveis na sua conta OpenRouter). No assunto inicial, escreva: “Como a IA pode ajudar pequenos negócios? Proponha uma ideia prática; o outro modelo deve questioná-la e sugerir melhorias.” Clique em **Enviar ao modelo A →** e use a seta para liberar cada resposta seguinte. O modelo do quadro A começa, independentemente do provedor escolhido.

O limite conta respostas individuais: 10 respostas equivalem a 5 de cada modelo. Cada chamada pede no máximo 800 tokens de saída. O intervalo entre respostas é decidido por você: a próxima só é solicitada ao clicar na seta. Modelos com raciocínio extenso podem consumir o limite antes de produzir texto; nesse caso, escolha outro modelo.

## Chave e privacidade

A chave digitada fica apenas na memória da página e passa pelo servidor local para autenticar a chamada HTTPS ao OpenRouter. Não usamos armazenamento do navegador, banco de dados ou logs de mensagens/chaves. Recarregar a página apaga a conversa e a chave digitada. O OpenRouter e o provedor do modelo recebem as mensagens conforme suas próprias políticas.

Como alternativa, defina `OPENROUTER_API_KEY` no processo do servidor. Para carregar um arquivo `.env` local, copie `.env.example`, preencha a chave e execute:

```sh
node --use-env-proxy --env-file=.env server.js
```

Nunca faça commit de chaves. O catálogo público de modelos não exige chave. As chamadas da conversa podem consumir créditos. Cancelar resposta aborta a conexão local, mas uma geração já recebida pelo provedor pode continuar e ser cobrada. Se uma solicitação falhar, o histórico e a vez do modelo são mantidos; use a seta para tentar novamente.

O servidor é voltado ao desenvolvimento local, escuta em `0.0.0.0` e não possui login. **Não o exponha publicamente com uma chave de servidor configurada** sem adicionar autenticação, HTTPS e limites de uso.

## Verificar

```sh
npm test
```

Os testes usam um provedor simulado, sem chave ou créditos: validam a alternância A → B → A, o contexto enviado, seleção de modelos, catálogo, credenciais, validação, erros e entrega da interface. Chamadas reais de geração exigem sua chave e saldo e não fazem parte dessa suíte.
