/*
 * trainer.js — the "pick the top three moves" training game.
 */
(function () {
  'use strict';

  var H = CMT.engineHelpers;
  var engine = new CMT.Engine();

  var state = {
    scenarios: [],
    index: 0,
    picks: [],        // [{uci, san, from, to, promotion}]
    busy: false
  };

  var el = {
    board: document.getElementById('board'),
    turn: document.getElementById('turn-indicator'),
    flip: document.getElementById('flip'),
    select: document.getElementById('scenario-select'),
    name: document.getElementById('scenario-name'),
    source: document.getElementById('scenario-source'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    shuffle: document.getElementById('shuffle'),
    picks: document.getElementById('picks'),
    pickCount: document.getElementById('pick-count'),
    resetPicks: document.getElementById('reset-picks'),
    submit: document.getElementById('submit'),
    depth: document.getElementById('depth'),
    status: document.getElementById('engine-status'),
    result: document.getElementById('result'),
    lines: document.getElementById('engine-lines'),
    engineSrc: document.getElementById('engine-src')
  };

  var board = new CMT.Board(el.board, {
    interactive: true,
    onMove: onPickMove
  });

  function loadScenarios() {
    var found = CMT.store.load();
    state.scenarios = CMT.BUILT_IN_SCENARIOS.concat(found);
    el.select.innerHTML = '';
    state.scenarios.forEach(function (s, i) {
      var opt = document.createElement('option');
      opt.value = i;
      opt.textContent = (found.indexOf(s) !== -1 ? '★ ' : '') + s.name;
      el.select.appendChild(opt);
    });
  }

  function current() { return state.scenarios[state.index]; }

  function showScenario() {
    var s = current();
    state.picks = [];
    board.clearMarkers();
    board.setPosition(s.fen);
    var whiteToMove = s.fen.split(' ')[1] === 'w';
    board.setFlipped(!whiteToMove); // put the side to move at the bottom
    el.turn.textContent = (whiteToMove ? 'White' : 'Black') + ' to move';
    el.turn.className = 'turn-indicator ' + (whiteToMove ? 'white' : 'black');
    el.name.textContent = s.name || '';
    el.source.textContent = s.source || '';
    el.select.value = String(state.index);
    el.result.innerHTML = '';
    el.lines.innerHTML = '';
    el.status.textContent = '';
    renderPicks();
  }

  function onPickMove(move) {
    if (state.busy) return;
    if (state.picks.length >= 3) {
      flashStatus('You already picked 3 moves. Clear or submit.');
      return;
    }
    if (state.picks.some(function (p) { return p.uci === move.uci; })) {
      flashStatus('That move is already picked.');
      return;
    }
    state.picks.push(move);
    renderPicks();
  }

  function renderPicks() {
    el.picks.innerHTML = '';
    state.picks.forEach(function (p, i) {
      var li = document.createElement('li');
      li.innerHTML = '<span class="pick-san">' + (p.san || p.uci) + '</span>';
      var rm = document.createElement('button');
      rm.className = 'btn ghost small';
      rm.textContent = '✕';
      rm.onclick = function () { state.picks.splice(i, 1); renderPicks(); };
      li.appendChild(rm);
      el.picks.appendChild(li);
    });
    el.pickCount.textContent = String(state.picks.length);
    el.submit.disabled = state.picks.length === 0 || state.busy;
  }

  function flashStatus(msg) {
    el.status.textContent = msg;
  }

  function setBusy(b) {
    state.busy = b;
    el.submit.disabled = b || state.picks.length === 0;
    board.interactive = !b;
    el.prev.disabled = el.next.disabled = el.shuffle.disabled = b;
  }

  // Score a single user pick: returns scoreNum (side-to-move perspective).
  function evalPick(fen, pick, analysis, depth) {
    var line = analysis.lines.filter(function (l) { return l.uci === pick.uci; })[0];
    if (line) return Promise.resolve({ scoreNum: line.scoreNum, rank: line.rank });

    // Not in the multi-PV list: play the move and evaluate the reply.
    var c = new Chess(fen);
    c.move({ from: pick.from, to: pick.to, promotion: pick.promotion || undefined });
    if (c.in_checkmate()) return Promise.resolve({ scoreNum: H.MATE_VALUE - 1, rank: null });
    if (c.in_draw() || c.in_stalemate()) return Promise.resolve({ scoreNum: 0, rank: null });
    return engine.analyze(c.fen(), { multipv: 1, depth: depth }).then(function (res) {
      var oppBest = res.lines[0] ? res.lines[0].scoreNum : 0;
      return { scoreNum: -oppBest, rank: null }; // negate to side-to-move perspective
    });
  }

  function submit() {
    if (state.busy || !state.picks.length) return;
    var s = current();
    var depth = clamp(parseInt(el.depth.value, 10) || 14, 6, 24);
    setBusy(true);
    el.result.innerHTML = '';
    el.lines.innerHTML = '';
    flashStatus('Analyzing with Stockfish (depth ' + depth + ')…');

    var analysisPromise = engine.analyze(s.fen, { multipv: 5, depth: depth })
      .catch(function (err) {
        // Engine failed to load — fall back to any stored analysis.
        if (s.analysis) return s.analysis;
        throw err;
      });

    analysisPromise.then(function (analysis) {
      if (!analysis.lines.length) {
        flashStatus('Engine returned no moves for this position.');
        setBusy(false);
        return;
      }
      var best = analysis.lines[0].scoreNum;
      var pickPromises = state.picks.map(function (p) {
        return evalPick(s.fen, p, analysis, depth).then(function (r) {
          var cpLoss = Math.max(0, best - r.scoreNum);
          return { pick: p, scoreNum: r.scoreNum, rank: r.rank, cpLoss: cpLoss, grade: H.gradeLoss(cpLoss) };
        });
      });
      return Promise.all(pickPromises).then(function (graded) {
        renderResult(analysis, graded);
        flashStatus('');
        setBusy(false);
      });
    }).catch(function (err) {
      flashStatus('Engine error: ' + err.message + '. Check your network connection.');
      setBusy(false);
    });
  }

  function renderResult(analysis, graded) {
    // Per-pick points: 100 at 0 cp loss, 0 at >=200 cp loss.
    var points = graded.map(function (g) {
      return Math.max(0, Math.round(100 * (1 - g.cpLoss / 200)));
    });
    var total = Math.round(points.reduce(function (a, b) { return a + b; }, 0) / graded.length);
    var stars = graded.filter(function (g) { return g.cpLoss <= 50; }).length;

    var html = '<div class="score-summary">';
    html += '<div class="score-big">' + total + '<span>/100</span></div>';
    html += '<div class="stars">' + '★'.repeat(stars) + '☆'.repeat(3 - stars) +
            '<div class="stars-cap">' + stars + ' of your picks were Good or better</div></div>';
    html += '</div>';

    html += '<div class="grades">';
    graded.forEach(function (g, i) {
      var rankTxt = g.rank ? 'engine #' + g.rank : 'outside top 5';
      html += '<div class="grade-row ' + g.grade.cls + '">' +
        '<span class="grade-san">' + (g.pick.san || g.pick.uci) + '</span>' +
        '<span class="grade-label">' + g.grade.label + '</span>' +
        '<span class="grade-loss">−' + (g.cpLoss / 100).toFixed(2) + '</span>' +
        '<span class="grade-rank">' + rankTxt + '</span>' +
        '<span class="grade-pts">' + points[i] + ' pts</span>' +
        '</div>';
    });
    html += '</div>';
    el.result.innerHTML = html;

    // Engine top lines with eval bars + arrows on the board.
    var maxAbs = Math.max(50, Math.abs(analysis.lines[0].scoreNum));
    var markers = {};
    var linesHtml = '<h3>Stockfish top moves (depth ' + (analysis.depth || '?') + ')</h3>';
    analysis.lines.forEach(function (l, i) {
      var pickedClass = state.picks.some(function (p) { return p.uci === l.uci; }) ? ' picked' : '';
      var pct = Math.max(4, Math.min(100, Math.round(100 * (l.scoreNum) / (maxAbs))));
      if (pct < 0) pct = 4;
      linesHtml += '<div class="eng-line' + pickedClass + '">' +
        '<span class="eng-rank">' + l.rank + '</span>' +
        '<span class="eng-san">' + l.san + '</span>' +
        '<span class="eng-bar"><span style="width:' + Math.abs(pct) + '%"></span></span>' +
        '<span class="eng-score">' + l.score + '</span>' +
        '<span class="eng-pv">' + (l.pvSan || []).slice(0, 6).join(' ') + '</span>' +
        '</div>';
      if (l.uci) {
        markers[l.uci.slice(0, 2)] = i === 0 ? 'best-from' : 'good-from';
        markers[l.uci.slice(2, 4)] = i === 0 ? 'best' : 'good';
      }
    });
    el.lines.innerHTML = linesHtml;
    board.setMarkers(markers);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // --- Wiring ---
  el.flip.onclick = function () { board.setFlipped(!board.flipped); };
  el.resetPicks.onclick = function () { state.picks = []; board.clearMarkers(); board.setPosition(current().fen); renderPicks(); };
  el.submit.onclick = submit;
  el.prev.onclick = function () { state.index = (state.index - 1 + state.scenarios.length) % state.scenarios.length; showScenario(); };
  el.next.onclick = function () { state.index = (state.index + 1) % state.scenarios.length; showScenario(); };
  el.shuffle.onclick = function () { state.index = Math.floor(Math.random() * state.scenarios.length); showScenario(); };
  el.select.onchange = function () { state.index = parseInt(el.select.value, 10); showScenario(); };

  // Init
  loadScenarios();
  showScenario();
  engine.init().then(function () {
    el.engineSrc.textContent = 'Stockfish ready';
  }).catch(function () {
    el.engineSrc.textContent = 'Stockfish failed to load (needs network)';
  });
})();
