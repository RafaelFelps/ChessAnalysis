# Análise de Partidas (chess.com / Lichess + Stockfish)

Ferramenta local para analisar suas partidas do chess.com ou do Lichess lance a lance.

## Como usar

Dê dois cliques em `iniciar.bat` (instala as dependências na primeira vez, sobe o servidor e abre o navegador).

Ou pelo terminal:

```bash
node server.js
```

> No PowerShell, `npm start` pode falhar com "running scripts is disabled on this system". Use `npm.cmd start` ou `node server.js`.

Abra http://localhost:5173, escolha o site (chess.com ou Lichess), digite seu nick, escolha a partida e aguarde a análise.

## O que ela faz

- Busca suas partidas pelas APIs públicas do chess.com e do Lichess (filtro por ritmo, carrega partidas mais antigas).
- Mostra a precisão oficial do site ao lado da nossa, quando a partida já foi analisada lá.
- Analisa cada posição com o **Stockfish 19** rodando no navegador (WebAssembly), com opção de voltar ao 17.1.
- Classifica cada lance: Brilhante, Ótimo lance, Melhor, Excelente, Bom, Forçado, Imprecisão, Erro, Chance perdida e Capivarada.
- Calcula a precisão de cada jogador (no geral e por fase: abertura, meio-jogo e final).
- Gera um resumo com o ponto de virada, onde você errou, o que fez bem, dicas de treino e momentos-chave clicáveis.
- Usa o relógio do PGN para detectar erros com pouco tempo, lances impulsivos e derrotas por tempo.
- Aba **Lances** com todos os lances, o ícone de cada peça e quanto tempo cada um levou.
- Estima o rating de cada jogador pela precisão da partida, partindo do rating real.
- Botão **Analisar novamente** para refazer a análise com outro motor ou profundidade.

## Como os lances são classificados

A avaliação do motor é convertida em chance de vitória (0–100%). A perda de chance causada pelo lance define a classe:

| Perda   | Classe      |
|---------|-------------|
| 0 (lance do motor) | Melhor |
| < 2%    | Excelente   |
| < 5%    | Bom         |
| < 10%   | Imprecisão  |
| < 20%   | Erro        |
| ≥ 20%   | Capivarada  |

- **Brilhante**: o melhor lance (perda ≤ 1%, não forçado) que sacrifica de verdade uma peça (não só peões) e tem uma ideia por trás. Todos os critérios abaixo precisam valer:
  - o material fica 2+ pontos abaixo mesmo depois da resposta do adversário e do seu lance seguinte, ou a peça fica oferecida e o motor confirma que capturá-la é um erro;
  - não é uma troca nem uma peça que já estava perdida (desperado);
  - era necessário: a melhor alternativa segura é bem pior (≥ 5%) ou o sacrifício força mate;
  - a posição não estava já totalmente ganha (> 90%), a não ser que o sacrifício leve a um mate mais rápido, e não fica perdida depois.

  A ferramenta mostra a ideia do sacrifício e a linha do motor que o justifica.
- **Ótimo lance**: o melhor lance quando a 2ª opção é muito pior (≥ 15%), ou seja, o único lance bom.
- **Chance perdida**: o adversário errou e você não aproveitou (perda ≥ 10%).

## Tabuleiro

- **Animação** das peças com velocidade configurável no topo (Desligada, Rápida, Normal, Lenta, Muito lenta).
- **Setas**: botão direito + arrastar de uma casa a outra. Botão direito numa casa a marca com um círculo. Repetir remove.
- **Cores**: laranja (padrão), Shift = vermelho, Ctrl = azul, Alt = verde.
- Clique esquerdo no tabuleiro limpa as marcações.
- As marcações ficam salvas por lance enquanto a partida está aberta.

## Motores

| Opção | Observação |
|---|---|
| Stockfish 19 · multi-thread (padrão) | Usa vários núcleos. Se o navegador não suportar, cai sozinho para 1 thread. |
| Stockfish 19 · 1 thread | Rede neural completa (~94 MB, carregada do disco local). |
| Stockfish 19 Lite | Bem mais leve, um pouco mais fraco. |
| Stockfish 17.1 / 17.1 Lite | Versões anteriores. |

O motor e a profundidade em uso aparecem na barra de progresso da análise. As preferências ficam salvas no navegador.

## Créditos

- Motor: [Stockfish](https://stockfishchess.org/) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPLv3), instalado pelo npm.
- Regras e PGN: [chess.js](https://github.com/jhlywa/chess.js).
- Peças: conjunto *cburnett* de Colin M.L. Burnett (CC BY-SA 3.0), via [Lichess](https://github.com/lichess-org/lila).
- Precisão: fórmula pública do [Lichess](https://lichess.org/page/accuracy).
