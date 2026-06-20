/*
 * scenarios.js — built-in training scenarios + a sample master PGN.
 *
 * A scenario is: { id, name, fen, source?, analysis? }
 *   - fen: position to solve (player picks the top 3 moves for the side to move)
 *   - analysis (optional): precomputed engine result so the trainer can score
 *     instantly/offline. Same shape the Engine produces:
 *       { depth, lines: [{ rank, uci, san, cp, mate, scoreNum, score, pv, pvSan }] }
 *
 * Scenarios without `analysis` are evaluated live in the browser.
 */
(function (global) {
  'use strict';

  // Positions chosen because several reasonable moves are roughly equal — i.e.
  // "no single obvious best move", which is exactly the kind the finder hunts for.
  var BUILT_IN = [
    {
      id: 'builtin-italian',
      name: 'Quiet Italian — many plans',
      fen: 'r1bqk2r/ppppbppp/2n2n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5',
      source: 'Italian Game, typical middlegame branch'
    },
    {
      id: 'builtin-qgd',
      name: 'Queen\'s Gambit Declined — flexible',
      fen: 'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4',
      source: 'QGD, multiple sound continuations'
    },
    {
      id: 'builtin-ruy',
      name: 'Ruy Lopez — closed center',
      fen: 'r1bqkbnr/1pp2ppp/p1np4/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5',
      source: 'Ruy Lopez, Morphy Defence'
    },
    {
      id: 'builtin-sicilian',
      name: 'Open Sicilian — rich choices',
      fen: 'r1bqkb1r/pp2pppp/2np1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6',
      source: 'Sicilian Defence, Classical structure'
    },
    {
      id: 'builtin-caro',
      name: 'Caro-Kann — balanced',
      fen: 'rnbqkb1r/pp2pppp/2p2n2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R b KQkq - 0 4',
      source: 'Caro-Kann, several equal setups'
    }
  ];

  // A short, real, well-known master game so the finder works with zero input.
  // Kasparov vs Topalov, Wijk aan Zee 1999 (the famous one) — plus a calmer game.
  var SAMPLE_PGN = [
    '[Event "Hoogovens Group A"]',
    '[Site "Wijk aan Zee NED"]',
    '[Date "1999.01.20"]',
    '[White "Kasparov, Garry"]',
    '[Black "Topalov, Veselin"]',
    '[Result "1-0"]',
    '',
    '1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7',
    '8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O',
    '14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5',
    '20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4 25. Re7+ Kb6',
    '26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7 30. Rxb7 Qc4 31. Qxf6 Kxa3',
    '32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2 35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7',
    '38. Bxc4 bxc4 39. Qxh8 Rd3 40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2',
    '44. Qa7 1-0',
    '',
    '[Event "Linares"]',
    '[Site "Linares ESP"]',
    '[Date "1993.??.??"]',
    '[White "Karpov, Anatoly"]',
    '[Black "Kasparov, Garry"]',
    '[Result "1/2-1/2"]',
    '',
    '1. d4 Nf6 2. c4 e6 3. Nf3 b6 4. g3 Ba6 5. b3 Bb4+ 6. Bd2 Be7 7. Bg2 c6',
    '8. Bc3 d5 9. Ne5 Nfd7 10. Nxd7 Nxd7 11. Nd2 O-O 12. O-O Rc8 13. e4 b5',
    '14. Re1 dxe4 15. Nxe4 c5 16. d5 exd5 17. cxd5 Bf6 18. Bxf6 Nxf6 19. Nxf6+ Qxf6',
    '20. Qd2 b4 21. Rac1 Rfd8 22. Re5 c4 23. bxc4 Bxc4 24. d6 Bd5 25. Bxd5 Rxd6',
    '1/2-1/2'
  ].join('\n');

  global.CMT = global.CMT || {};
  global.CMT.BUILT_IN_SCENARIOS = BUILT_IN;
  global.CMT.SAMPLE_PGN = SAMPLE_PGN;

  // Scenario store helpers — found scenarios are persisted to localStorage so the
  // finder page can hand them off to the trainer page.
  var STORE_KEY = 'cmt_found_scenarios';
  global.CMT.store = {
    load: function () {
      try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; }
      catch (e) { return []; }
    },
    save: function (list) {
      localStorage.setItem(STORE_KEY, JSON.stringify(list || []));
    },
    add: function (scenarios) {
      var cur = this.load();
      var seen = {};
      cur.forEach(function (s) { seen[s.fen] = true; });
      scenarios.forEach(function (s) { if (!seen[s.fen]) { cur.push(s); seen[s.fen] = true; } });
      this.save(cur);
      return cur;
    },
    clear: function () { localStorage.removeItem(STORE_KEY); }
  };
})(typeof window !== 'undefined' ? window : this);
