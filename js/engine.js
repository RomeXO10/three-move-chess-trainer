/*
 * engine.js — Stockfish wrapper + chess scoring helpers.
 *
 * Loads Stockfish (asm.js single file) into a Web Worker via a blob URL so it
 * works even when the engine is served from a cross-origin CDN. Exposes a small
 * promise-based API for multi-PV analysis.
 *
 * Depends on the global `Chess` constructor (chess.js, loaded via <script>).
 */
(function (global) {
  'use strict';

  // Candidate engine sources, tried in order. All single-file asm.js builds that
  // run directly as a Web Worker. Fetched as text then wrapped in a blob URL to
  // dodge cross-origin Worker restrictions. The local vendored copy is tried
  // first so the app works offline; CDNs are fallbacks.
  var ENGINE_URLS = [
    'js/vendor/stockfish.js',
    'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js',
    'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
    'https://unpkg.com/stockfish.js@10.0.2/stockfish.js'
  ];

  // A large finite value used to make mate scores comparable to centipawns.
  var MATE_VALUE = 1000000;

  function mateToNum(mate) {
    // mate > 0: we deliver mate in `mate` moves (good). mate < 0: we get mated.
    return mate > 0 ? MATE_VALUE - mate : -MATE_VALUE - mate;
  }

  // Normalize an engine line score to a single comparable number, always from
  // the perspective of the side to move (higher = better for side to move).
  function scoreNum(line) {
    if (line.mate !== null && line.mate !== undefined) return mateToNum(line.mate);
    return line.cp;
  }

  // Human-readable score string from side-to-move perspective.
  function formatScore(line) {
    if (line.mate !== null && line.mate !== undefined) {
      return (line.mate > 0 ? '#' : '#-') + Math.abs(line.mate);
    }
    var v = line.cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(2);
  }

  function uciToSan(fen, uci) {
    try {
      var c = new Chess(fen);
      var m = c.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined
      });
      return m ? m.san : uci;
    } catch (e) {
      return uci;
    }
  }

  function Engine() {
    this.worker = null;
    this.ready = false;
    this._readyPromise = null;
    this._pending = null; // current analysis state
    this.sourceUrl = null;
  }

  Engine.prototype.init = function () {
    if (this._readyPromise) return this._readyPromise;
    var self = this;
    this._readyPromise = loadWorker(ENGINE_URLS).then(function (res) {
      self.worker = res.worker;
      self.sourceUrl = res.url;
      self.worker.onmessage = function (e) {
        self._onMessage(typeof e.data === 'string' ? e.data : e.data && e.data.data);
      };
      self.send('uci');
      return self._waitFor(function (line) { return line === 'uciok'; })
        .then(function () {
          self.send('setoption name Hash value 64');
          self.send('isready');
          return self._waitFor(function (line) { return line === 'readyok'; });
        })
        .then(function () { self.ready = true; });
    });
    return this._readyPromise;
  };

  Engine.prototype.send = function (cmd) {
    this.worker.postMessage(cmd);
  };

  // Wait for a single matching engine line (used during handshake).
  Engine.prototype._waitFor = function (predicate) {
    var self = this;
    return new Promise(function (resolve) {
      self._handshake = { predicate: predicate, resolve: resolve };
    });
  };

  Engine.prototype._onMessage = function (line) {
    if (typeof line !== 'string') return;
    if (this._handshake && this._handshake.predicate(line)) {
      var h = this._handshake;
      this._handshake = null;
      h.resolve(line);
      return;
    }
    if (this._pending) this._handlePending(line);
  };

  Engine.prototype._handlePending = function (line) {
    var p = this._pending;
    if (line.indexOf('info ') === 0 && line.indexOf(' pv ') !== -1) {
      var parsed = parseInfo(line);
      if (parsed && parsed.multipv) {
        p.lines[parsed.multipv] = parsed;
        if (parsed.depth) p.lastDepth = parsed.depth;
      }
    } else if (line.indexOf('bestmove') === 0) {
      var result = this._buildResult(p);
      this._pending = null;
      p.resolve(result);
    }
  };

  Engine.prototype._buildResult = function (p) {
    var arr = [];
    Object.keys(p.lines).forEach(function (k) { arr.push(p.lines[k]); });
    arr.sort(function (a, b) { return a.multipv - b.multipv; });
    var fen = p.fen;
    return {
      fen: fen,
      depth: p.lastDepth,
      lines: arr.map(function (l, i) {
        var firstUci = l.pv[0];
        return {
          rank: i + 1,
          uci: firstUci,
          san: firstUci ? uciToSan(fen, firstUci) : '',
          cp: l.cp,
          mate: l.mate,
          scoreNum: scoreNum(l),
          score: formatScore(l),
          pv: l.pv,
          pvSan: pvToSan(fen, l.pv)
        };
      })
    };
  };

  /*
   * analyze(fen, opts) -> Promise<result>
   *   opts.multipv (default 5), opts.depth (default 16), opts.movetime (ms, optional)
   */
  Engine.prototype.analyze = function (fen, opts) {
    opts = opts || {};
    var multipv = opts.multipv || 5;
    var self = this;
    return this.init().then(function () {
      // Serialize: wait for any in-flight analysis to finish.
      var prev = self._queue || Promise.resolve();
      var run = prev.then(function () {
        return new Promise(function (resolve) {
          self._pending = { fen: fen, lines: {}, lastDepth: 0, resolve: resolve };
          self.send('setoption name MultiPV value ' + multipv);
          self.send('position fen ' + fen);
          if (opts.movetime) self.send('go movetime ' + opts.movetime);
          else self.send('go depth ' + (opts.depth || 16));
        });
      });
      self._queue = run.catch(function () {});
      return run;
    });
  };

  Engine.prototype.stop = function () {
    if (this.worker) this.send('stop');
  };

  function pvToSan(fen, pv) {
    var c;
    try { c = new Chess(fen); } catch (e) { return []; }
    var out = [];
    for (var i = 0; i < pv.length && i < 12; i++) {
      var u = pv[i];
      var m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined });
      if (!m) break;
      out.push(m.san);
    }
    return out;
  }

  function parseInfo(line) {
    var tokens = line.split(/\s+/);
    var res = { depth: 0, multipv: 1, cp: null, mate: null, pv: [] };
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === 'depth') res.depth = parseInt(tokens[++i], 10);
      else if (t === 'multipv') res.multipv = parseInt(tokens[++i], 10);
      else if (t === 'score') {
        var type = tokens[++i];
        var val = parseInt(tokens[++i], 10);
        if (type === 'cp') res.cp = val;
        else if (type === 'mate') res.mate = val;
      } else if (t === 'pv') {
        res.pv = tokens.slice(i + 1);
        break;
      }
    }
    return res;
  }

  function loadWorker(urls) {
    var idx = 0;
    function tryNext() {
      if (idx >= urls.length) {
        return Promise.reject(new Error('Could not load Stockfish from any source.'));
      }
      var url = urls[idx++];
      return fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(function (text) {
          var blob = new Blob([text], { type: 'application/javascript' });
          var worker = new Worker(URL.createObjectURL(blob));
          return { worker: worker, url: url };
        })
        .catch(function () { return tryNext(); });
    }
    return tryNext();
  }

  // Grade a centipawn loss into a label + css class.
  function gradeLoss(cpLoss) {
    if (cpLoss <= 10) return { label: 'Top move', cls: 'g-top' };
    if (cpLoss <= 25) return { label: 'Excellent', cls: 'g-exc' };
    if (cpLoss <= 50) return { label: 'Good', cls: 'g-good' };
    if (cpLoss <= 100) return { label: 'Inaccuracy', cls: 'g-inacc' };
    if (cpLoss <= 250) return { label: 'Mistake', cls: 'g-mist' };
    return { label: 'Blunder', cls: 'g-blun' };
  }

  global.CMT = global.CMT || {};
  global.CMT.Engine = Engine;
  global.CMT.engineHelpers = {
    scoreNum: scoreNum,
    formatScore: formatScore,
    uciToSan: uciToSan,
    gradeLoss: gradeLoss,
    MATE_VALUE: MATE_VALUE
  };
})(typeof window !== 'undefined' ? window : this);
