# Three-Move Chess Trainer

A 100% client-side chess training tool. You're shown a position and have to pick
the **top three moves** Stockfish would consider best — then the engine scores
your choices. It also includes a **Scenario Finder** that scans real master games
to surface positions where there is *no single obvious best move* (the top 3–5
moves are bunched together in evaluation), which make the most interesting puzzles.

Everything runs in the browser. No backend, no build step. Stockfish runs as a
Web Worker, and chess.js handles move legality. The board uses a chess.com-style
green/cream theme with real SVG pieces and coordinate labels.

All third-party libraries (Stockfish, chess.js) and the piece graphics are
**vendored locally** under `js/vendor/` and `pieces/`, so the app works fully
offline — no CDN needed at runtime. (The engine wrapper keeps CDN URLs as a
fallback only.)

## Run it

It's a static site — just serve the folder and open it in a browser:

```bash
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000/
```

You can also open `index.html` directly, but a local server is recommended so the
Stockfish engine (fetched from a CDN and wrapped in a Web Worker) loads cleanly.

> **Offline note:** Stockfish, chess.js and the piece graphics are bundled in the
> repo, so the app runs without any network access. Found scenarios are stored in
> `localStorage`, so once discovered they replay instantly.

## Trainer (`index.html`)

1. Pick a scenario from the dropdown (built-ins, plus anything you saved from the
   Finder, marked with ★).
2. The side to move is placed at the bottom of the board. Click a piece, then its
   destination to register a **candidate move**. Choose up to **three**.
3. Hit **Submit & Score**. Stockfish analyzes the position (multi-PV) and:
   - shows its **top moves** with evaluations, principal variations and eval bars,
   - **grades each of your picks** by centipawn loss vs. the best move
     (Top / Excellent / Good / Inaccuracy / Mistake / Blunder),
   - gives an overall **score out of 100** and a star rating.

Picks that fall outside the engine's multi-PV list are still graded — the tool
plays your move and evaluates the resulting position so you always get a real
centipawn loss.

Adjust the search **Depth** to trade speed for accuracy.

## Scenario Finder (`finder.html`)

Paste one or more games in **PGN** (or load the bundled sample, or a `.pgn` file).
The finder walks through every position in the configured ply window and runs a
multi-PV Stockfish search, keeping positions that match:

- the top **N** moves (the *cluster size*, 3–5) are all within **Closeness (cp)**
  centipawns of the best move, and
- the position isn't already decisive (`|eval| ≤ Max |eval|`), and
- it's past the opening (`Min ply`) and before the configurable `Max ply`.

Each match is shown with a board, the close moves and their evals (the move
actually played in the game is flagged), and buttons to:

- **Train this** — save it and jump straight into the trainer,
- **Save** — add it to your saved set,
- **Export JSON** / **Send all to Trainer** for the whole batch.

Found scenarios carry their precomputed engine analysis, so they load and score
instantly in the trainer.

### Tuning tips

| Control | Effect |
| --- | --- |
| Closeness (cp) | Smaller = stricter "moves are equal" requirement |
| Cluster size | How many top moves must be close (3–5) |
| Depth | Higher = more accurate evals, slower scan |
| Max \|eval\| | Excludes already-winning/losing positions |
| Min/Max ply | Skips the opening and trims the endgame |
| Max results | Stops the scan once enough are found |

## Project layout

```
index.html        Trainer page
finder.html       Scenario Finder page
css/styles.css    Styling (dark theme)
js/engine.js      Stockfish Web Worker wrapper + scoring helpers
js/board.js       Dependency-free board widget (Unicode pieces)
js/scenarios.js   Built-in scenarios, sample PGN, localStorage store
js/trainer.js     Trainer game logic
js/finder.js      PGN scanning + qualification logic
js/vendor/        Vendored chess.js + stockfish.js
pieces/           SVG chess piece set (cburnett)
```

## How scoring works

Engine scores are normalized to the **side-to-move** perspective. For a pick,
**centipawn loss = best move's eval − your move's eval**. Mates are mapped to a
large finite value so they compare sensibly against centipawn scores. Per-pick
points scale linearly from 100 (0 loss) to 0 (≥200 cp loss); the overall score is
their average.

## Credits

- [Stockfish](https://stockfishchess.org/) (via `stockfish.js`, vendored locally)
- [chess.js](https://github.com/jhlywa/chess.js) for move generation and PGN parsing
- Piece graphics: the **cburnett** SVG set by Colin M.L. Burnett (GPLv2+), as used
  by Lichess

Sample games: Kasparov–Topalov (Wijk aan Zee 1999) and Karpov–Kasparov
(Linares 1993), included for demonstration.
