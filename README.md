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

O jeito fácil é a bandeja → **Editar pet…**:

- **Adicionar imagens** (ou solte PNG/JPG na janela). Cada imagem passa por
  uma prévia: escolha o estado (o nome do arquivo dá o palpite), e a remoção
  de fundo apaga a cor que encosta nas bordas da imagem (branco de imagem
  gerada por IA, cor chapada de pixel art). Tolerância ajustável; clicar no
  fundo da prévia escolhe a cor; "buracos fechados" remove também o vão
  entre as pernas quando ele não encosta na borda. Não é IA: foto com fundo
  complexo não sai limpa.
- No cartão de cada imagem: trocar o estado (renomeia o arquivo) ou mandar
  para a Lixeira.
- **Vários pets**: cada um é uma pasta; "Novo pet" cria, o seletor (ou a
  bandeja → **Pet**) troca o ativo.
- **Exportar / Importar .zip** para compartilhar um pet (imagens +
  `pet.json`). A importação aceita só PNG e `pet.json`, achata pastas,
  nunca sobrescreve um pet existente e recusa zip bomb.

Os pets moram em `%APPDATA%\perch\pets\<nome>\` (bandeja → **Abrir pasta
do pet**), não ao lado do código — empacotado, o código vira um `.asar`
somente-leitura. O overlay lê de lá pelo protocolo `pet://`. Dá para mexer
direto na pasta também, com estes nomes:

| Estado | Nomes aceitos |
|---|---|
| trabalhando | `pensando`, `working`, `trabalhando` |
| esperando você | `permissao`, `blocked`, `bloqueado` |
| terminou | `finalizado`, `done`, `pronto` |
| repouso (o pet some) | `parado`, `idle` |
| por tool (opcional) | `lendo`/`sherlock` (Read, Grep, Glob), `terminal`/`cooking` (Bash), `editando` (Edit, Write) |

Variações numeradas (`pensando1.png`, `pensando2.png`...) são sorteadas ao
entrar no estado e trocam a cada 30 s. Caixa e acento não importam. Faltou um
estado: usa o de trabalho, depois qualquer imagem; pasta vazia → placeholder.
A pasta é vigiada: imagem nova aparece sem reiniciar.

Qualquer tamanho, fundo transparente. Os nomes ficam em `NAMES`/`TOOL_NAMES`
em `overlay/renderer.js`.

### Tamanho e chão

Cada imagem é recortada no que é opaco e o **personagem** é detectado como a
maior "ilha" de pixels opacos: balão de pensamento, foguete ao lado ou sujeira
da remoção de fundo ficam de fora. O palpite automático escala o personagem
para a mesma altura em todas as imagens e apoia os pés dele no chão.

O automático erra quando o personagem está grudado em outra coisa (paraquedas
preso pelas cordas) ou usa chapéu (o chapéu conta como altura). Para isso:
bandeja → **Editar pet…**. Todas as imagens aparecem lado a lado no
mesmo chão, com uma linha de altura alvo; roda do mouse ajusta o tamanho,
arrastar ajusta o chão, duplo clique volta ao automático. Salvar grava
`pet.json` na pasta do pet e o overlay atualiza na hora:

```json
{ "version": 1, "height": 120,
  "images": { "finalizado2.png": { "scale": 0.45, "floor": 0 } } }
```

`scale` = px da tela por px da imagem original; `floor` = px originais entre
a base da imagem e os pés. Imagem sem entrada usa o palpite automático.

A janela do overlay se dimensiona para caber a maior imagem (com folga para
pulo e balanço), com os pés sempre no mesmo ponto: trocar de estado não muda
o pet de lugar nem de tamanho.

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
A janela é um retângulo quase todo transparente (do tamanho da maior imagem do pet). Clicável inteira, ela
engole cliques do que está atrás. O renderer recebe `mousemove` mesmo
atravessável (`forward: true`), testa o alfa do pixel sob o cursor (achando o
triângulo da malha deformada que contém o ponto) e pede ao main para virar
clicável. Na saída, quem
devolve o click-through é o main, vigiando o cursor: um movimento rápido que
pula a borda transparente não gera nenhum evento no renderer.

**Gravidade, arremesso e clique**
Soltou no ar, o pet cai até o chão, que é o topo da barra de tarefas do
monitor onde estão os pés. Soltou em movimento, sai com a velocidade do gesto
(últimos ~100ms), bate nas bordas e desliza até parar. Mal mexeu e soltou
rápido (< 4px, < 350ms), é um clique: a malha afunda no ponto clicado e o pet
dá um pulinho. A física roda no main (`overlay/physics.js`, testada com
`npm test` em `overlay/`), porque é ele que move a janela. A malha recebe a
posição e desconta a gravidade durante a queda (queda livre não deforma); o
pouso achata. Bandeja → **Gravidade** desliga: o pet fica onde for solto.

**Por que a posição salva é a dos pés**
`%APPDATA%\perch\settings.json` guarda o ponto dos pés, não o canto da
janela: o tamanho da janela muda com as imagens do pet, os pés não. Ao abrir,
se esse ponto não existe mais em nenhum monitor, o pet volta ao canto do
monitor principal.

**Por que `setBounds` e não `setPosition` no arraste**
No Windows, com `resizable: false`, cada `setPosition` faz a janela crescer
alguns pixels (bug do Electron). A 60Hz ela dobrava de tamanho em meio segundo.

**Por que a animação só reinicia em mudança de estado**
Um loop de edições dispara `PreToolUse` dezenas de vezes por segundo, e o
payload muda a cada troca de tool. Humor e comportamento de entrada (os pulos
do "done") só mudam quando `state` muda; trocar de tool troca a imagem e deixa
a animação seguir.

**Por que malha e não CSS**
A Fase 2 (`poc/mesh`) comparou os dois com a mesma física: transform CSS só
escala e gira a imagem inteira. A malha (`overlay/mesh.js`, WebGL2) dobra:
o topo atrasa no balanço, as pontas balançam como gelatina quando você arrasta
(o main manda a posição da janela a cada tick), o corpo pende quando segurado
e achata ao pousar. Custa ~0,3 ms por frame, e o laço dorme em idle. O
daemon também só emite em mudança, mas isso agora é economia, não requisito.

## Limitações conhecidas

- Não desenha sobre aplicação em fullscreen exclusivo (limitação do Windows).
- Multi-monitor e DPI misto implementados (chão e paredes do monitor onde
  estão os pés; volta para a tela se o monitor sumir), mas só testados com um
  monitor.
- Sem claude.ai (web): não existe hook. Exigiria extensão de browser lendo o
  DOM + native messaging, e quebra a cada deploy do front.

## Próximos passos óbvios

1. Cérebro do pet (passear pela barra, dormir) e fontes de evento plugáveis.
2. Remoção de fundo por IA local para fotos (modelo Apache/MIT; evitar
   `@imgly/background-removal`, que é AGPL).
3. Porte para Tauri v2 (~30MB de RAM contra ~180MB).
4. Som curto e discreto no `done` — opcional, desligado por padrão.
