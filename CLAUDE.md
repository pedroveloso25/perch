# perch — contexto para o Claude

Conversa em português, tom informal. O README explica instalação e decisões de
design; este arquivo é o que NÃO está lá: visão, estado atual, armadilhas e
como testar.

## Visão

Pet de desktop genérico: o usuário deposita **qualquer imagem** e o sistema
dá vida a ela (sem desenhar frames), para que qualquer pessoa use o próprio
pet. O Claude Code é só a primeira **fonte de eventos** (plugin), não o núcleo.

A arte do Clawd é da Anthropic: pode ser usada localmente, nunca vai para o
repo nem para uma release. O projeto se publica com mascote próprio.

## Arquitetura (resumo)

```
hooks/notify.js ──POST──► daemon/server.js (:4747) ──SSE──► overlay/ (Electron)
                          state.js = regras puras            main.js / preload.js / renderer.js
```

- `daemon/state.js`: lógica de estado com relógio injetado e testável (`npm test` em `daemon/`, node:test, 14 testes).
- `overlay/main.js`: janela transparente, protocolo `pet://`, IPC de click-through e arraste, bandeja.
- `overlay/renderer.js`: estado → classe CSS (animação), sprite, hit-test por alfa.
- Pets: `%APPDATA%\perch\pets\<nome>\*.png`. O pet ativo é fixo em `"default"` (constante duplicada em main.js e renderer.js; vira config na Fase 1/3).

## Invariantes: quebra se mexer sem entender

1. **A animação só reinicia quando o `state` muda** (`renderer.js` → `render`). A troca de tool só troca a imagem. Não volte a reiniciar o keyframe a cada mensagem.
2. **A janela é atravessável por padrão.** Ela só vira clicável quando o cursor está sobre um pixel opaco (`hitTest`, que desfaz a transform da animação). Quem devolve o click-through na saída é o **main** (polling do cursor em `pet:interactive`): uma saída rápida não gera NENHUM evento no renderer (nem mouseout, nem mouseleave). Testado.
3. **`focusable: false`** fica sempre. Por isso o arraste é manual.
4. **Arraste com `setBounds` (tamanho explícito), nunca `setPosition`.** No Windows, com `resizable:false`, a janela cresce a cada `setPosition` (bug do Electron; foi de 160 para 308px em meio segundo).
5. O nome da ponte do `contextBridge` é `window.overlay`. `window.pet` colide com o `const pet` do renderer e mata o script inteiro.
6. **A imagem precisa de CORS**: `img.crossOrigin="anonymous"` + `Access-Control-Allow-Origin` no handler `pet://`. Sem isso o canvas fica "tainted" e o hit-test quebra.
7. **CSP em `index.html`**: um novo recurso externo ou esquema exige atualizar o `<meta>`.
8. **Hooks são async e engolem erro.** O daemon fora do ar nunca pode degradar o Claude.

## Hooks do usuário

`~/.claude/settings.json` já tem os 6 hooks apontando para
`C:/Users/pedro/OneDrive/Documentos/Projetos/pessoal/desktop pet/perch/hooks/notify.js`
(barra normal, testado via bash e cmd). Se a pasta mudar de lugar, atualize
esses caminhos. Backup do settings original: `%TEMP%\claude-settings.backup.json`.

## Como testar o overlay de verdade (Windows)

- Suba com `npx electron . --remote-debugging-port=9223` (em `overlay/`) e avalie JS no renderer pelo CDP (`/json/list` → `webSocketDebuggerUrl` → `Runtime.evaluate`). Node 22+ tem `WebSocket` global.
- **Simule o mouse com `SendInput`/`mouse_event`, não com `SetCursorPos`.** O `forward:true` do Electron usa o hook `WH_MOUSE_LL`, que ignora `SetCursorPos`, e aí parece que o hover está quebrado sem estar.
- A posição real da janela vem do Win32 `GetWindowRect` (handle via `Get-Process electron` → `MainWindowHandle`). Não confie em `screenX` do renderer para isso.
- No PowerShell, nada de função chamada `Move` (é alias de `Move-Item`). Coloque todo o `Add-Type` em um script só, porque cada `powershell` novo leva segundos para recompilar.
- Dá para gerar sprites de teste (círculo com fundo transparente) com zlib puro no Node e jogar em `%APPDATA%\perch\pets\default\`. Apague depois.
- Ao terminar, encerre o electron e o daemon que você subiu.

## Estado atual

- Fase 0 concluída (commit `8000d8e`): correções acima, testes do daemon, rename para perch, pets em `%APPDATA%`, ícone de bandeja visível, filtro de notificação de "esperando input", TTL 2 min / 15 min com tool rodando.
- O usuário renomeou ou vai renomear a pasta `clawd-overlay` → `perch` (precisa da sessão fechada).

## Próximos passos (plano combinado)

**Fase 2, prova de conceito primeiro (próxima tarefa):** um HTML isolado com
uma imagem + sliders, testando a **deformação de malha** (Canvas/WebGL, imagem
dividida em grade, vértices deformados): respiração, balanço "gelatinoso",
inércia ao arrastar, squash/stretch. A pergunta a responder: uma imagem
qualquer fica convincente animada só pelo sistema? Só depois integra no
renderer, substituindo ou somando as transforms CSS atuais.

**Fase 1:** salvar a posição (`electron-store`), multi-monitor/DPI misto, gravidade (soltou no ar → cai até a `workArea`), clique sem arrastar = reação.

**Fase 3:** importar pet arrastando uma imagem ou pelo item "Adicionar pet" no menu da bandeja. Remoção de fundo local (ex.: `@imgly/background-removal`), recorte, normalização e detecção dos "pés" para o pivô. Pacote = pasta com `pet.json` + imagens (zip para compartilhar).

**Fase 4:** cérebro do pet (idle → wander pela barra → sleep → react) e fontes de evento plugáveis via daemon (o Claude Code é uma delas).

**Fase 5:** `electron-builder`, autostart, tela de config. Avaliar Tauri v2 depois que o motor de animação estabilizar.

## Limitações conhecidas

- Não desenha sobre fullscreen exclusivo (limitação do Windows).
- Só o monitor primário. Mudança de DPI entre monitores não foi testada.
- A posição arrastada não persiste.
