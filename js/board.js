/*
 * board.js — minimal dependency-free chessboard widget.
 *
 * Renders an 8x8 board of DOM squares with Unicode pieces, supports click-to-
 * select a candidate move (source square -> target square), legal-move
 * highlighting (via chess.js), promotion selection, flipping, and arbitrary
 * square markers used to show engine suggestions.
 */
(function (global) {
  'use strict';

  var FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  // Where the vendored SVG piece set lives, relative to the HTML pages.
  var PIECE_PATH = 'pieces/';

  function makeCoord(kind, text) {
    var s = document.createElement('span');
    s.className = 'coord ' + kind;
    s.textContent = text;
    return s;
  }

  function Board(container, opts) {
    opts = opts || {};
    this.el = container;
    this.showCoords = opts.coords !== false;
    this.flipped = false;
    this.fen = null;
    this.chess = null;
    this.selected = null;      // currently selected source square
    this.interactive = opts.interactive !== false;
    this.onMove = opts.onMove || function () {};
    this.markers = {};         // square -> css class for highlights/arrows
    this._build();
  }

  Board.prototype._build = function () {
    this.el.classList.add('cmt-board');
    this.el.innerHTML = '';
    this.squares = {};
    for (var r = 0; r < 8; r++) {
      for (var f = 0; f < 8; f++) {
        var sq = document.createElement('div');
        sq.className = 'sq ' + ((r + f) % 2 === 0 ? 'light' : 'dark');
        sq.dataset.idx = r + ',' + f;
        this.el.appendChild(sq);
        this.squares[r + ',' + f] = sq;
        var self = this;
        sq.addEventListener('click', (function (square) {
          return function () { self._onClick(square); };
        })(sq));
      }
    }
    this._render();
  };

  // Map an algebraic square (e.g. "e4") to the grid cell, accounting for flip.
  Board.prototype._cellFor = function (square) {
    var file = FILES.indexOf(square[0]);
    var rank = parseInt(square[1], 10); // 1..8
    var r = this.flipped ? rank - 1 : 8 - rank;
    var f = this.flipped ? 7 - file : file;
    return this.squares[r + ',' + f];
  };

  // Inverse: grid cell -> algebraic square.
  Board.prototype._squareFor = function (cell) {
    var parts = cell.dataset.idx.split(',');
    var r = parseInt(parts[0], 10);
    var f = parseInt(parts[1], 10);
    var rank = this.flipped ? r + 1 : 8 - r;
    var file = this.flipped ? 7 - f : f;
    return FILES[file] + rank;
  };

  Board.prototype.setPosition = function (fen) {
    this.fen = fen;
    try { this.chess = new Chess(fen); } catch (e) { this.chess = null; }
    this.selected = null;
    this._render();
  };

  Board.prototype.setFlipped = function (flipped) {
    this.flipped = flipped;
    this._render();
  };

  Board.prototype.clearMarkers = function () {
    this.markers = {};
    this._render();
  };

  Board.prototype.setMarkers = function (map) {
    this.markers = map || {};
    this._render();
  };

  Board.prototype._render = function () {
    if (!this.fen) return;
    var board = this.fen.split(' ')[0];
    var rows = board.split('/');
    // Clear cells (pieces, coordinate labels) and transient classes.
    for (var key in this.squares) {
      var c = this.squares[key];
      c.textContent = '';
      c.className = c.className.replace(/\s*(sel|legal|legal-capture|mk-[\w-]+)/g, '');
      // Coordinate labels on the board edges (chess.com style).
      if (this.showCoords) {
        var parts = key.split(',');
        var gr = parseInt(parts[0], 10), gf = parseInt(parts[1], 10);
        var alg = this._squareFor(c);
        if (gf === 0) c.appendChild(makeCoord('rank', alg[1]));
        if (gr === 7) c.appendChild(makeCoord('file', alg[0]));
      }
    }
    for (var rank = 0; rank < 8; rank++) {
      var row = rows[rank];
      var file = 0;
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (/\d/.test(ch)) { file += parseInt(ch, 10); continue; }
        var color = ch === ch.toUpperCase() ? 'w' : 'b';
        var piece = color + ch.toUpperCase();
        var square = FILES[file] + (8 - rank);
        var cell = this._cellFor(square);
        var pe = document.createElement('div');
        pe.className = 'piece p-' + piece;
        pe.style.backgroundImage = 'url("' + PIECE_PATH + piece + '.svg")';
        cell.appendChild(pe);
        file++;
      }
    }
    // Selection + legal targets (captures get a ring instead of a dot).
    if (this.selected) {
      var selCell = this._cellFor(this.selected);
      if (selCell) selCell.className += ' sel';
      var moves = this.chess ? this.chess.moves({ square: this.selected, verbose: true }) : [];
      for (var m = 0; m < moves.length; m++) {
        var tc = this._cellFor(moves[m].to);
        if (tc) tc.className += moves[m].flags.indexOf('c') !== -1 || moves[m].flags.indexOf('e') !== -1
          ? ' legal-capture' : ' legal';
      }
    }
    // External markers
    for (var sq in this.markers) {
      var mc = this._cellFor(sq);
      if (mc) mc.className += ' mk-' + this.markers[sq];
    }
  };

  Board.prototype._onClick = function (cell) {
    if (!this.interactive || !this.chess) return;
    var square = this._squareFor(cell);
    var piece = this.chess.get(square);
    if (this.selected) {
      // Attempt move selected -> square
      var legal = this.chess.moves({ square: this.selected, verbose: true });
      var match = legal.filter(function (mm) { return mm.to === square; });
      if (match.length) {
        var promotion = null;
        if (match[0].flags.indexOf('p') !== -1) {
          promotion = this._askPromotion();
          if (!promotion) { this.selected = null; this._render(); return; }
        }
        var chosen = promotion
          ? match.filter(function (mm) { return mm.promotion === promotion; })[0]
          : match[0];
        var src = this.selected;
        this.selected = null;
        this._render();
        this.onMove({
          from: src,
          to: square,
          promotion: promotion,
          uci: src + square + (promotion || ''),
          san: chosen ? chosen.san : null
        });
        return;
      }
      // Clicked another own piece -> reselect; else clear.
      if (piece && piece.color === this.chess.turn()) {
        this.selected = square;
      } else {
        this.selected = null;
      }
      this._render();
    } else {
      if (piece && piece.color === this.chess.turn()) {
        this.selected = square;
        this._render();
      }
    }
  };

  Board.prototype._askPromotion = function () {
    var ans = (global.prompt('Promote to (q, r, b, n)?', 'q') || '').toLowerCase().trim();
    return ['q', 'r', 'b', 'n'].indexOf(ans) !== -1 ? ans : null;
  };

  global.CMT = global.CMT || {};
  global.CMT.Board = Board;
})(typeof window !== 'undefined' ? window : this);
