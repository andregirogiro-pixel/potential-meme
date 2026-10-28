# Entre modelos

Uma mensagem sua inicia uma conversa automática entre dois modelos de texto do **OpenRouter**, em três caixas: você, modelo A e modelo B.

## Executar

Requer **Node.js 24 ou superior**. Não há dependências externas.

```sh
npm start
```

O servidor usa a porta 3000 (configurável por `PORT`). Para desenvolvimento com reinício automático, execute `npm run dev`.

1. Informe sua chave do OpenRouter no campo da página.
2. Em cada seletor, busque um modelo do catálogo ou cole seu identificador exato, por exemplo `openai/gpt-4o-mini`. Você pode usar modelos iguais ou diferentes. O catálogo lista modelos com saída de texto; disponibilidade, saldo e compatibilidade dependem da sua conta.
3. Escreva a mensagem inicial e, se quiser, instruções individuais para os modelos.
4. Escolha o limite total de respostas e clique em **Iniciar conversa**.
5. A responde primeiro, B recebe a resposta, e os dois alternam com o histórico completo. **Pausar** interrompe a espera local; **Retomar** continua pelo próximo participante. **Reiniciar** limpa as respostas e libera os modelos e a mensagem inicial para edição.

O limite conta respostas individuais: 10 respostas equivalem a 5 de cada modelo. Cada chamada pede no máximo 800 tokens de saída. Há um intervalo de 1,2 segundo entre respostas. Modelos com raciocínio extenso podem consumir o limite antes de produzir texto; nesse caso, escolha outro modelo.

## Chave e privacidade

A chave digitada fica apenas na memória da página e passa pelo servidor local para autenticar a chamada HTTPS ao OpenRouter. Não usamos armazenamento do navegador, banco de dados ou logs de mensagens/chaves. Recarregar a página apaga a conversa e a chave digitada. O OpenRouter e o provedor do modelo recebem as mensagens conforme suas próprias políticas.

Como alternativa, defina `OPENROUTER_API_KEY` no processo do servidor. Para carregar um arquivo `.env` local, copie `.env.example`, preencha a chave e execute:

```sh
node --use-env-proxy --env-file=.env server.js
```

Nunca faça commit de chaves. O catálogo público de modelos não exige chave. As chamadas da conversa podem consumir créditos. Pausar aborta a conexão local, mas uma geração já recebida pelo provedor pode continuar e ser cobrada. Se uma solicitação falhar, a conversa pausa sem avançar o histórico e permite tentar novamente.

O servidor é voltado ao desenvolvimento local, escuta em `0.0.0.0` e não possui login. **Não o exponha publicamente com uma chave de servidor configurada** sem adicionar autenticação, HTTPS e limites de uso.

## Verificar

```sh
npm test
```

Os testes usam um provedor simulado, sem chave ou créditos: validam a alternância A → B → A, o contexto enviado, seleção de modelos, catálogo, credenciais, validação, erros e entrega da interface. Chamadas reais de geração exigem sua chave e saldo e não fazem parte dessa suíte.
