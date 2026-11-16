# perch

Pet de desktop que fica em cima de todas as janelas. A meta: você deposita
qualquer imagem e o sistema dá vida a ela.

A primeira fonte de eventos é o Claude Code: o pet reflete o estado da sessão
e resolve o caso "fechei a aba do Claude, fui pro editor, não sei se já
terminou".

```
hooks do Claude Code ──POST──► daemon (:4747) ──SSE──► overlay (Electron)
```

## Estados

| Estado    | Dispara em                      | Leitura visual                  |
|-----------|---------------------------------|---------------------------------|
| `idle`    | nada ativo                      | invisível                       |
| `working` | `UserPromptSubmit`, `PreToolUse`| respiração lenta, 85% opacidade |
|           | (`PostToolUse` só renova o TTL) |                                 |
| `done`    | `Stop` da última sessão ativa   | pulo brusco, depois bob         |
| `blocked` | `Notification` de permissão     | balanço rápido + glow           |

`SessionEnd` remove a sessão sem celebrar. A notificação de "esperando seu
input" é descartada pelo `notify.js`: o turno já acabou, não é bloqueio.

`blocked` tem precedência sobre `working`: é o único que exige ação sua agora.

## Instalação (Windows)

Pré-requisito: Node 18+.

**1. Daemon**

```powershell
cd C:\dev\perch\daemon
npm start      # ou: node server.js
npm test       # testes das regras de estado (node:test, sem dependências)
```

Deve imprimir `perch-daemon ouvindo em http://127.0.0.1:4747`. Deixe rodando.

**2. Hooks**

Abra `hooks/settings.example.json`, copie o objeto `hooks` para
`C:\Users\<voce>\.claude\settings.json` e **troque os caminhos**.
Use barra normal (`C:/caminho/do/perch/hooks/notify.js`): o Node aceita no
Windows e não tem escape nenhum para errar em JSON.

Teste sem o Claude:

```powershell
echo {"session_id":"teste","tool_name":"Bash"} | node hooks\notify.js working
curl http://127.0.0.1:4747/state
```

Deve voltar `{"state":"working","tool":"Bash","sessions":1}`.

**3. Overlay**

```powershell
cd C:\dev\perch\overlay
npm install
npm start
```

Sem arte na pasta do pet, aparece um quadrado laranja — isso é o
placeholder e confirma que a ligação toda funciona. Saia pelo ícone laranja
da bandeja (o app não aparece no Alt+Tab de propósito).

O pet é clicável só onde é opaco: passe o mouse sobre ele e arraste. Fora
disso, cliques atravessam para a janela de trás.

## Sprites

Os pets moram em `%APPDATA%\perch\pets\<nome>\` (bandeja → **Abrir pasta
do pet**), não ao lado do código — empacotado, o código vira um `.asar`
somente-leitura. O overlay lê de lá pelo protocolo `pet://`.

```
idle.png  working.png  done.png  blocked.png  sherlock.png  cooking.png
```

Todos opcionais. Sprite de tool ausente cai para o do estado (`sherlock.png`
faltando → `working.png`); sprite de estado ausente → placeholder. Depois de
trocar arquivos, bandeja → **Recarregar**.

Recomendado 64×64 ou 128×128, fundo transparente. O renderer escala para
128px com `image-rendering: pixelated`; use múltiplo inteiro do tamanho
original ou vai borrar em tela com escala 125%/150%.

O mapa tool → sprite está em `SPRITES` dentro de `overlay/renderer.js`.

> A arte do Clawd pertence à Anthropic. Use localmente à vontade; se for
> publicar o projeto, publique com mascote próprio e deixe a pasta de pets
> como ponto de extensão.

## Decisões de design

**Por que um daemon separado e não o hook falando direto com o overlay**
Desacopla emissor de renderizador. Trocar Electron por Tauri depois não toca
em uma linha de hook. E permite mais de uma fonte de evento (terminal, VS Code,
futuramente extensão de browser) sem cada uma saber da existência das outras.

**Por que `Map` de sessões e não um booleano**
Dois terminais rodando: o `Stop` do primeiro não pode apagar a animação
enquanto o segundo trabalha. O estado global é derivado do conjunto.

**Por que dois TTLs (2 min / 15 min)**
`Ctrl+C`, kill do terminal ou crash não disparam `Stop`. Sem expiração, o
pet pensaria para sempre. Mas um `npm run build` de 5 minutos também não
dispara hook nenhum no meio — com um TTL só, curto, o pet sumia com o Claude
trabalhando. Entre `PreToolUse` e `PostToolUse` vale o TTL longo.

**Por que `async: true` nos hooks**
Hook síncrono bloqueia o Claude até retornar. Com `PreToolUse` em `.*`, isso
é um spawn de processo por tool call no caminho crítico. Assíncrono + timeout
de 300ms no POST + erro engolido: o daemon fora do ar não degrada o Claude.

**Por que `focusable: false`**
No Windows, janela topmost rouba foco ao ser clicada. Você esbarra no mascote
e perde o cursor do editor. Equivale a `WS_EX_NOACTIVATE`. Por isso o arraste
é manual (`setBounds` seguindo o cursor) e não `-webkit-app-region: drag`.

**Por que o click-through é alternado, e não desligado**
A janela é um quadrado de 160px quase todo transparente. Clicável inteira, ela
engole cliques do que está atrás. O renderer recebe `mousemove` mesmo
atravessável (`forward: true`), testa o alfa do pixel sob o cursor (desfazendo
a transform da animação) e pede ao main para virar clicável. Na saída, quem
devolve o click-through é o main, vigiando o cursor: um movimento rápido que
pula a borda transparente não gera nenhum evento no renderer.

**Por que `setBounds` e não `setPosition` no arraste**
No Windows, com `resizable: false`, cada `setPosition` faz a janela crescer
alguns pixels (bug do Electron). A 60Hz ela dobrava de tamanho em meio segundo.

**Por que a animação só reinicia em mudança de estado**
Um loop de edições dispara `PreToolUse` dezenas de vezes por segundo, e o
payload muda a cada troca de tool. O renderer reinicia o keyframe só quando
`state` muda; trocar de tool troca a imagem e deixa a animação seguir. O
daemon também só emite em mudança, mas isso agora é economia, não requisito.

## Limitações conhecidas

- Não desenha sobre aplicação em fullscreen exclusivo (limitação do Windows).
- Monitor único (usa `getPrimaryDisplay`). Multi-monitor exige escolher display.
- A posição arrastada não é salva: reiniciou, volta ao canto.
- Sem claude.ai (web): não existe hook. Exigiria extensão de browser lendo o
  DOM + native messaging, e quebra a cada deploy do front.

## Próximos passos óbvios

1. Salvar posição (`electron-store`) e suporte a multi-monitor.
2. Animação procedural para qualquer imagem (deformação de malha).
3. Importar pet: arrastar imagem, remover fundo, recortar.
4. Porte para Tauri v2 (~30MB de RAM contra ~180MB).
5. Som curto e discreto no `done` — opcional, desligado por padrão.
