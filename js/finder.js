/*
 * finder.js — scan master games (PGN) for positions with no single best move.
 *
 * For every position (within the configured ply window) Stockfish runs a
 * multi-PV search. A position qualifies when the top `cluster` moves are all
 * within `threshold` centipawns of the best move AND the position isn't already
 * decisive (|best eval| <= maxAdv). Those are the "several roughly equal moves"
 * positions that make good top-three puzzles.
 */
(function () {
  'use strict';

  var H = CMT.engineHelpers;
  var engine = new CMT.Engine();

  var el = {
    pgn: document.getElementById('pgn'),
    loadSample: document.getElementById('load-sample'),
    pgnFile: document.getElementById('pgn-file'),
    threshold: document.getElementById('threshold'),
    cluster: document.getElementById('cluster'),
    depth: document.getElementById('depth'),
    maxadv: document.getElementById('maxadv'),
    minply: document.getElementById('minply'),
    maxply: document.getElementById('maxply'),
    maxresults: document.getElementById('maxresults'),
    run: document.getElementById('run'),
    stop: document.getElementById('stop'),
    sendAll: document.getElementById('send-all'),
    export: document.getElementById('export'),
    clearStore: document.getElementById('clear-store'),
    progress: document.getElementById('progress'),
    status: document.getElementById('finder-status'),
    results: document.getElementById('results'),
    resultCount: document.getElementById('result-count'),
    engineSrc: document.getElementById('engine-src')
  };

  var found = [];
  var cancelled = false;
  var running = false;

  el.pgn.value = CMT.SAMPLE_PGN;

  // --- PGN handling ---------------------------------------------------------

  function splitGames(pgn) {
    // Split on a blank line that precedes the next game's [Event ...] header.
    var normalized = pgn.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];
    var parts = normalized.split(/\n\s*\n(?=\[Event )/);
    // The above misses the first split if headers/moves are interleaved; fall
    // back to splitting whenever an [Event tag starts a new block.
    return parts.length ? parts : [normalized];
  }

  // Build the list of candidate positions to analyze across all games.
  function collectPositions(pgn, minPly, maxPly) {
    var games = splitGames(pgn);
    var positions = [];
    games.forEach(function (gtext, gi) {
      var chess = new Chess();
      var ok = false;
      try { ok = chess.load_pgn(gtext, { sloppy: true }); } catch (e) { ok = false; }
      if (!ok) return;
      var headers = chess.header() || {};
      var history = chess.history({ verbose: true });
      var replay = new Chess();
      for (var ply = 0; ply < history.length; ply++) {
        var fenBefore = replay.fen();
        var moveNumber = Math.floor(ply / 2) + 1;
        if (ply >= minPly && ply <= maxPly) {
          positions.push({
            fen: fenBefore,
            ply: ply,
            moveNumber: moveNumber,
            turn: replay.turn(),
            played: history[ply].san,
            white: headers.White || 'White',
            black: headers.Black || 'Black',
            event: headers.Event || '',
            gameIndex: gi
          });
        }
        replay.move(history[ply]);
      }
    });
    return positions;
  }

  // --- Qualification test ---------------------------------------------------

  function qualifies(analysis, opts) {
    var lines = analysis.lines;
    if (lines.length < opts.cluster) return null;
    var best = lines[0];
    // Skip already-decisive or forced-mate positions: those have an obvious move.
    if (best.mate !== null && best.mate !== undefined) return null;
    if (Math.abs(best.scoreNum) > opts.maxAdv) return null;
    // All moves in the cluster must be within `threshold` of the best.
    var spread = best.scoreNum - lines[opts.cluster - 1].scoreNum;
    if (spread > opts.threshold) return null;
    // Require a meaningful drop-off after the cluster when an extra line exists,
    // so the cluster is genuinely "the good moves" and not just a flat position.
    return { spread: spread, cluster: opts.cluster };
  }

  // --- Main scan loop -------------------------------------------------------

  function readOpts() {
    return {
      threshold: clampInt(el.threshold.value, 5, 100, 35),
      cluster: clampInt(el.cluster.value, 3, 5, 4),
      depth: clampInt(el.depth.value, 6, 20, 12),
      maxAdv: clampInt(el.maxadv.value, 50, 400, 180),
      minPly: clampInt(el.minply.value, 1, 80, 12),
      maxPly: clampInt(el.maxply.value, 2, 160, 70),
      maxResults: clampInt(el.maxresults.value, 1, 50, 12)
    };
  }

  function run() {
    if (running) return;
    var opts = readOpts();
    var positions = collectPositions(el.pgn.value, opts.minPly, opts.maxPly);
    if (!positions.length) {
      el.status.textContent = 'No valid games / positions found. Check the PGN.';
      return;
    }
    found = [];
    cancelled = false;
    running = true;
    el.results.innerHTML = '';
    el.resultCount.textContent = '0';
    setRunning(true);

    engine.init().then(function () {
      el.engineSrc.textContent = 'Stockfish ready';
      scanLoop(positions, opts, 0);
    }).catch(function (err) {
      el.status.textContent = 'Engine failed to load: ' + err.message;
      setRunning(false);
    });
  }

  function scanLoop(positions, opts, i) {
    if (cancelled || i >= positions.length || found.length >= opts.maxResults) {
      finishScan(positions.length, i);
      return;
    }
    var pos = positions[i];
    el.progress.textContent = 'Analyzing position ' + (i + 1) + ' / ' + positions.length +
      ' · found ' + found.length;
    el.progress.style.setProperty('--p', Math.round(100 * (i + 1) / positions.length) + '%');

    engine.analyze(pos.fen, { multipv: opts.cluster + 1, depth: opts.depth }).then(function (analysis) {
      var q = qualifies(analysis, opts);
      if (q) {
        var scenario = buildScenario(pos, analysis, q);
        found.push(scenario);
        renderCard(scenario);
        el.resultCount.textContent = String(found.length);
      }
      scanLoop(positions, opts, i + 1);
    }).catch(function () {
      scanLoop(positions, opts, i + 1);
    });
  }

  function finishScan(total, scanned) {
    running = false;
    setRunning(false);
    el.progress.style.setProperty('--p', '100%');
    el.status.textContent = (cancelled ? 'Stopped. ' : 'Done. ') +
      'Scanned ' + scanned + '/' + total + ' positions · ' + found.length + ' candidates found.';
    el.sendAll.disabled = el.export.disabled = found.length === 0;
  }

  function buildScenario(pos, analysis, q) {
    var sideTxt = pos.turn === 'w' ? 'White' : 'Black';
    var moveLabel = pos.moveNumber + (pos.turn === 'w' ? '.' : '...');
    return {
      id: 'found-' + pos.gameIndex + '-' + pos.ply + '-' + Date.now(),
      name: pos.white.split(',')[0] + ' – ' + pos.black.split(',')[0] +
            ' · ' + moveLabel + ' (' + sideTxt + ' to move)',
      fen: pos.fen,
      source: (pos.event ? pos.event + ' · ' : '') + 'played ' + moveLabel + ' ' + pos.played +
              ' · top moves within ' + (q.spread / 100).toFixed(2),
      played: pos.played,
      spread: q.spread,
      analysis: {
        depth: analysis.depth,
        lines: analysis.lines.map(function (l) {
          return {
            rank: l.rank, uci: l.uci, san: l.san, cp: l.cp, mate: l.mate,
            scoreNum: l.scoreNum, score: l.score, pv: l.pv, pvSan: l.pvSan
          };
        })
      }
    };
  }

  // --- Rendering ------------------------------------------------------------

  function renderCard(scenario) {
    var card = document.createElement('div');
    card.className = 'result-card';

    var boardDiv = document.createElement('div');
    boardDiv.className = 'cmt-board mini';
    card.appendChild(boardDiv);
    var b = new CMT.Board(boardDiv, { interactive: false });
    b.setPosition(scenario.fen);
    b.setFlipped(scenario.fen.split(' ')[1] === 'b');

    var info = document.createElement('div');
    info.className = 'result-info';
    var movesHtml = scenario.analysis.lines.map(function (l) {
      var played = l.san === scenario.played ? ' <em>(played)</em>' : '';
      return '<li><span class="m-san">' + l.san + '</span>' +
             '<span class="m-score">' + l.score + '</span>' + played + '</li>';
    }).join('');
    info.innerHTML =
      '<div class="result-title">' + escapeHtml(scenario.name) + '</div>' +
      '<div class="result-source">' + escapeHtml(scenario.source) + '</div>' +
      '<ol class="result-moves">' + movesHtml + '</ol>';

    var actions = document.createElement('div');
    actions.className = 'result-actions';
    var trainBtn = document.createElement('button');
    trainBtn.className = 'btn primary small';
    trainBtn.textContent = 'Train this';
    trainBtn.onclick = function () {
      CMT.store.add([scenario]);
      window.location.href = 'index.html';
    };
    var addBtn = document.createElement('button');
    addBtn.className = 'btn ghost small';
    addBtn.textContent = 'Save';
    addBtn.onclick = function () {
      CMT.store.add([scenario]);
      addBtn.textContent = 'Saved ✓';
      addBtn.disabled = true;
    };
    actions.appendChild(trainBtn);
    actions.appendChild(addBtn);
    info.appendChild(actions);

    card.appendChild(info);
    el.results.appendChild(card);
  }

  // --- Helpers --------------------------------------------------------------

  function setRunning(b) {
    el.run.disabled = b;
    el.stop.disabled = !b;
    el.loadSample.disabled = b;
  }

  function clampInt(v, lo, hi, dflt) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // --- Wiring ---------------------------------------------------------------

  el.run.onclick = run;
  el.stop.onclick = function () { cancelled = true; };
  el.loadSample.onclick = function () { el.pgn.value = CMT.SAMPLE_PGN; };
  el.pgnFile.onchange = function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { el.pgn.value = reader.result; };
    reader.readAsText(f);
  };
  el.sendAll.onclick = function () {
    CMT.store.add(found);
    window.location.href = 'index.html';
  };
  el.export.onclick = function () {
    var blob = new Blob([JSON.stringify(found, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chess-scenarios.json';
    a.click();
  };
  el.clearStore.onclick = function () {
    CMT.store.clear();
    el.status.textContent = 'Saved scenarios cleared.';
  };

  engine.init().then(function () {
    el.engineSrc.textContent = 'Stockfish ready';
  }).catch(function () {
    el.engineSrc.textContent = 'failed to load (needs network)';
  });
})();
