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
                          state.js = regras puras            main.js / preload.js / renderer.js / mesh.js
```

- `daemon/state.js`: lógica de estado com relógio injetado e testável (`npm test` em `daemon/`, node:test).
- `daemon/reactions.js`: reações de outras fontes (`{"event":"react","kind":"celebrate|alert|hello"}`), repassadas como evento SSE `reaction` sem tocar no estado. `hooks/perch.js` é o CLI. 21 testes no daemon (inclui `server.test.js`, que sobe o servidor de verdade).
- `overlay/brain.js`: cérebro no ócio (rest → walk → sleep → wake), puro e testado. O main roda `update()` a cada 100ms com estado do Claude (o renderer reporta via `pet:claude-state`, só ele ouve o daemon), `powerMonitor.getSystemIdleTime()` e tela bloqueada; executa o passeio movendo a janela; manda `pet:activity`. O renderer escolhe imagem (`dormindo`/`andando` → `parado` → `pensando`) e humor (`MOODS.rest/walk/sleep/wake`). `settings.petMode` (padrão true) deixa o pet visível no ócio.
- `overlay/physics.js`: corpo do pet na tela (pés em DIP): gravidade, arremesso, paredes/chão da workArea, `releaseVelocity`. Puro, `npm test` em `overlay/` (11 testes). O main roda `step()` num timer e move a janela; manda `pet:moved {x,y,g}` (g>0 = queda livre, a malha desconta) e `pet:landed`.
- `%APPDATA%\perch\settings.json`: `{ gravity, feet: {x,y}, activePet, petMode, sleepAfterMin, walkiness, roam, home, seededBird }`, salvo ao parar/sair. `home` = x onde o pet foi solto por último (arraste, não clique; passeio não muda); `roam` (perto ±60 / medio ±200 / barra) limita o passeio em volta dela via `roamBounds` (brain.js), com passo e velocidade menores no perto (`ROAM` em main.js). O usuário achou estranho o pet sem pernas atravessar a barra inteira. `pet:drag-end` é `invoke` e devolve `{ click }` (clique = < 4px e < 350ms); o renderer faz `mesh.poke` + `mesh.hop`.
- `overlay/main.js`: janela transparente, protocolo `pet://`, IPC de click-through e arraste, bandeja, daemon embutido (`startDaemon` de `daemon/server.js`; EADDRINUSE = usa o daemon que já está na porta), passarinho de fábrica (`seedDefaultPet`, uma vez só: `settings.seededBird`), configurações (`cfg:*`), autostart (`setLoginItemSettings`, só empacotado).
- `overlay/claude-hooks.js`: liga/desliga os hooks no `~/.claude/settings.json` (puro, testado). Hook "do perch" = comando que roda um notify.js dentro de uma pasta chamada perch. O main faz backup (`settings.json.perch-backup-<data>`) antes de gravar.
- `overlay/settings.html/.js`: janela "Configurações…" (ou `npx electron . --settings`).
- Empacotamento: `npm run dist` em `overlay/` (electron-builder, NSIS por usuário). Daemon e hooks vão em `resources/` FORA do asar (`extraResources`): o notify.js roda no Node do Claude Code. Mascote: `overlay/assets/`, gerado por `npm run assets` (`tools/bird.js`, arte própria). Ícone da bandeja = `assets/tray.png`.
- `overlay/renderer.js`: estado → humor do mesh + classe CSS (opacidade/brilho), escolha de sprite (nomes PT/EN, variações), mouse.
- `overlay/mesh.js`: motor de malha (WebGL2). Recorte, personagem (maior ilha opaca), `place()` (pet.json → escala/pés), `windowSize()`, molas, hit-test na malha deformada. Não conhece estados. Também é carregado pelo calibrador.
- Editor de pet (bandeja "Editar pet…", ou `npx electron . --calibrate`): `calibrate.html` + `calibrate.js` (palco, tamanho/chão, cartões com estado e Lixeira) + `editor.js` (pet ativo, novo pet, zip, tela de importação). Erros dos IPCs do editor voltam como `{ error }`; use `flash()` para mostrá-los (o `updateStatus` esconde mensagem quando há alteração pendente).
- `overlay/pets.js`: pastas de pet (fs puro, testado): nomes válidos, `nextName` (pensando4.png...), add/rename/remove (rename e remove levam o pet.json junto), export/import. Tudo que vem do renderer ou de um zip passa por aqui.
- `overlay/zip.js` (escrita stored, leitura stored/deflate, limites contra zip bomb) e `overlay/bgremove.js` (flood fill a partir da borda + alfa do contorno por razão de distâncias; roda no navegador e no Node). Ambos testados.
- Vários pets: `settings.activePet`; URL `pet://p/<pet>/<arquivo>` (`PetMesh.url`). O nome vai no CAMINHO porque o host de esquema standard é normalizado (minúsculas) e quebraria "Pássaro Azul".
- `pet.json` (na pasta do pet): `height` + por imagem `scale` (px tela / px original) e `floor` (px originais da base da imagem até os pés). Sem entrada = palpite automático.
- A janela do overlay é dimensionada pelo renderer (`pet:resize`) para caber TODAS as imagens com os pés fixos no centro da base; o main guarda o tamanho em `size` e o arraste usa ele.
- Pets: `%APPDATA%\perch\pets\<nome>\*.png`. O pet ativo é fixo em `"default"` (constante duplicada em main.js e renderer.js; vira config na Fase 1/3).

## Invariantes: quebra se mexer sem entender

1. **Humor e pulos de entrada só mudam quando o `state` muda** (`renderer.js` → `render`). A troca de tool só troca a imagem (e só se a lista de variações mudar). Não volte a sortear imagem ou disparar pulo a cada mensagem.
2. **A janela é atravessável por padrão.** Ela só vira clicável quando o cursor está sobre um pixel opaco (`mesh.hitTest`: triângulo deformado → UV → alfa). Quem devolve o click-through na saída é o **main** (polling do cursor em `pet:interactive`): uma saída rápida não gera NENHUM evento no renderer (nem mouseout, nem mouseleave). Testado.
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
- `Page.captureScreenshot` TRAVA em janela oculta/encoberta (`document.visibilityState === "hidden"`, comum no calibrador atrás de outras janelas). Use `canvas.toDataURL()` via `Runtime.evaluate`. Com mais de uma janela, escolha o alvo do CDP pela `url` (index.html × calibrate.html).
- Não deixe `pet.json` de teste na pasta do usuário.
- O usuário mexe no pet enquanto você testa (aparece como arraste "fantasma" nos logs). Antes de caçar bug de posição, confira se não foi ele.
- Para testar o ócio (passeio, sono), suba o overlay SEM o daemon: com ele no ar, os seus próprios hooks deixam o estado em "working" o tempo todo. Se o pet já nasce dormindo, é porque o usuário está longe do teclado há mais de 2 min (confira com `GetLastInputInfo`).
- Teste com mouse real: peça ao renderer um ponto opaco (`mesh.hitTest` varrendo a janela) em vez de chutar coordenadas.
- Ao terminar, encerre o electron e o daemon que você subiu.

## Estado atual

- Fase 0 concluída (commit `8000d8e`): correções acima, testes do daemon, rename para perch, pets em `%APPDATA%`, ícone de bandeja visível, filtro de notificação de "esperando input", TTL 2 min / 15 min com tool rodando.
- O usuário renomeou ou vai renomear a pasta `clawd-overlay` → `perch` (precisa da sessão fechada).
- Fase 2 integrada: PoC em `poc/mesh/index.html` (bancada com sliders, modo Malha × Rígido); motor em `overlay/mesh.js`. Os keyframes CSS saíram; cada estado é um "humor" (`MOODS` no renderer). Janela 240px; pés a 14px da base; imagem centralizada na horizontal (não os pés). Testado com mouse real (SendInput): gelatina no arraste, janela não cresce.
- Pets do usuário em `%APPDATA%\perch\pets\default`: pensando1-3, finalizado1-3, permissao (arte local, não vai pro repo). Padronização de tamanho feita (palpite automático + calibrador). No automático acerta finalizado1 (ignora o foguete) e permissao (ignora o balão); erra finalizado2 (paraquedas grudado pelas cordas, precisa ~2x) e os chapéus de pensando1/finalizado3. O usuário ainda vai calibrar; não há pet.json salvo.

## Próximos passos (plano combinado)

**Fase 2 (concluída, ver Estado atual):** um HTML isolado com
uma imagem + sliders, testando a **deformação de malha** (Canvas/WebGL, imagem
dividida em grade, vértices deformados): respiração, balanço "gelatinoso",
inércia ao arrastar, squash/stretch. A pergunta a responder: uma imagem
qualquer fica convincente animada só pelo sistema? Só depois integra no
renderer, substituindo ou somando as transforms CSS atuais.

**Fase 1 (concluída):** posição salva (settings.json próprio, sem electron-store), gravidade + arremesso, clique = boop + pulo, chão/paredes por monitor e reancoragem quando monitores mudam. Multi-monitor/DPI misto implementado mas só testado com 1 monitor.

**Fase 3 (concluída):** editor de pet com importação de imagens (remoção de fundo por preenchimento a partir das bordas — escolha do usuário: sem dependência; `@imgly` foi descartado por ser AGPL), vários pets, zip. Soltar imagem direto no pet do overlay NÃO funciona (janela atravessável não recebe drop): o caminho é o editor. Exportar/importar .zip foi testado só nos testes unitários (o diálogo nativo não dá para automatizar).

**Fase 4 (concluída):** cérebro (parado/passeia/dorme/acorda, modo pet na bandeja, padrão visível) e reações de outras fontes (`hooks/perch.js`). Testado: passeio real (~70 px/s, pausas, fica no chão), parado com o Claude trabalhando, acorda com input, reações via CLI. O usuário vai fornecer `dormindo.png`.

**Fase 5 (concluída):** instalador NSIS (78 MB, não assinado), daemon embutido, configurações, autostart, conectar ao Claude Code, Passarinho de fábrica. Testado: app empacotado (`dist/win-unpacked/Perch.exe`) sobe o daemon, carrega os pets, perch.js de resources chega no daemon, status "other" com os hooks ainda no repo. NÃO testado: rodar o instalador, clicar Conectar (regravaria o settings do usuário) e ligar o autostart (escreve no registro). O usuário vai instalar e conectar.
- 0.1.1: raio de passeio (`roam`, padrão perto). Instalador gerado; release a cargo do usuário.
- 0.1.2: instância única (`requestSingleInstanceLock`; abrir de novo mostra Configurações). Antes, instalar por cima com o app aberto deixava DOIS pets, e o novo usava o daemon do antigo (EADDRINUSE); fechar o antigo deixava o novo surdo. Agora quem perde a porta tenta assumir de novo a cada 10 s. O lock só existe a partir da 0.1.2 (testado com duas cópias de dev).
- Também na 0.1.2: botão direito no pet = menu (Esconder, Editar pet, Configurações, Sair; `pet:menu` → `popupPetMenu`). Escolhido no lugar do duplo clique, que brigaria com o clique = boop + pulo. Esconder = `setHidden` (janela some, cérebro parado, não persiste); volta com clique no ícone da bandeja, item "Mostrar pet" ou abrindo o app de novo. Casa padrão à direita (`defaultFeet`: 90 DIP da borda). Testado com SendInput (direito → seta → Enter esconde; segunda cópia mostra). Clique no ícone da bandeja não foi automatizado. O PowerShell não tem DPI awareness: `GetWindowRect` e `GetSystemMetrics` já vêm em coordenadas lógicas, então não multiplique por devicePixelRatio.
- 0.1.3: painel "Estados do pet" no editor (`STATE_GUIDE`/`renderStates` em calibrate.js; "+ adicionar" → `presetState` em editor.js). Texto fala "a IA", não "o Claude": a ideia é suportar outras IAs (OpenCode, Codex...) com pontes como o notify.js; o daemon já é genérico. LEIA-ME.txt das pastas de pet atualizado (só vale para pastas novas). Testar o editor sem mexer no perch do usuário: `npx electron . --user-data-dir=<scratchpad> --calibrate` (pasta nova ganha o Passarinho; não conflita com a trava de instância única). Print do editor: a janela costuma nascer encoberta e o captureScreenshot recusa; leia o DOM (innerText/getBoundingClientRect) pelo CDP.
- Release `v0.1.0` publicada no GitHub (instalador montado a partir do `57d9273`, SHA-256 `14d0f9a8…d995`). Sem `gh` nesta máquina: a release é feita à mão pelo site, e o texto vai pronto. Nova versão = subir `version` no `overlay/package.json` e rodar `npm run dist`.
- Build: o `winCodeSign` do electron-builder falha sem Modo de Desenvolvedor (symlinks de macOS). Contorno usado: extrair o .7z em `Cache/winCodeSign/winCodeSign-2.6.0` aceitando o erro dos 2 symlinks.
- Avaliar Tauri v2 depois (instalador ~78 MB e ~180 MB de RAM com Electron).

## Limitações conhecidas

- Não desenha sobre fullscreen exclusivo (limitação do Windows).
- Multi-monitor: código pronto (`areaAt`, `reanchor`), nunca testado com 2 monitores. Troca de escala (100% → 125%) testada sem querer: o pet se reancorou no chão novo e a malha acompanhou o `devicePixelRatio`.
