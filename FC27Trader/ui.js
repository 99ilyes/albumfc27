// Interface unique : bouton flottant + panneau (Sniper, Galerie, Ventes, Journal, Réglages)
// Calque dans le DOM de la page (cartes rendues par la Web App) ; règles préfixées par #afc-root.
(function () {
  const X = globalThis.__fc27;
  const { fmt, fmtSigned, hm, fmtClock, fmtWait, perHour, profitOf, isOpen, isFailed, isUnsold, tolOf, netOf, step } = X;
  const PAGE_CARDS = 36;
  const FUTGG_GALLERY = 'https://www.fut.gg/fut-gallery/';
  const MAX_TOLERANCE = 10;

  const CSS = `
#afc-root { --ac: #00CAF6; --bg: #10151d; --panel: #161d27; --panel2: #1b2330; --line: rgba(255,255,255,.07); --dim: #949db0; --ok: #3ddc84; --ko: #ff6b6b; --warn: #ffb347;
  font: 14px/1.5 Roboto, Arial, sans-serif; color: #dfe4ec; }
#afc-root * { box-sizing: border-box; }
#afc-root .a-launch { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; display: flex; align-items: center; gap: 8px; max-width: 420px;
  padding: 6px 6px 6px 14px; border-radius: 999px; background: #1f2834; border: 1px solid rgba(255,255,255,.12); color: #fff; font: 600 13px/1.2 Roboto, Arial, sans-serif;
  box-shadow: 0 8px 24px rgba(0,0,0,.45); cursor: pointer; }
#afc-root .a-launch:hover { border-color: var(--ac); }
#afc-root .a-launch small { font-weight: 400; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
#afc-root .a-launch .a-mini { flex: none; width: 28px; height: 28px; border-radius: 50%; border: 0; display: grid; place-items: center; cursor: pointer; font-size: 11px; background: var(--ok); color: #0b1118; }
#afc-root .a-launch .a-mini.stop { background: var(--ko); color: #fff; }
#afc-root .a-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #5c6170; }
#afc-root .a-dot.on { background: var(--ok); animation: afc-pulse 1.2s ease-in-out infinite; }
#afc-root .a-dot.lock { background: var(--warn); }
@keyframes afc-pulse { 50% { opacity: .3; } }
#afc-root .a-layer { position: fixed; inset: 0; z-index: 2147483001; display: flex; align-items: center; justify-content: center; background: rgba(12,15,20,.7);
  visibility: hidden; opacity: 0; transition: opacity .2s, visibility .2s; }
#afc-root .a-layer.open { visibility: visible; opacity: 1; }
#afc-root .a-layer.a-buy, #afc-root .a-layer.a-cal { z-index: 2147483002; }
#afc-root .a-inner { position: relative; display: flex; flex-direction: column; width: calc(100% - 3rem); max-width: 1180px; height: calc(100% - 3rem); max-height: 900px;
  background: rgba(31,40,52,.98); border-radius: .75rem; box-shadow: 0 .5rem 2rem rgba(0,0,0,.35); overflow: hidden; }
#afc-root .a-buy .a-inner { max-width: 600px; height: auto; max-height: calc(100% - 2rem); }
#afc-root .a-cal .a-inner { max-width: 980px; height: auto; padding: 1.2rem 1.5rem; gap: .8rem; }
#afc-root .a-head { position: relative; display: flex; align-items: center; gap: .75rem; padding: 1rem 3rem 1rem 1.5rem; border-bottom: 1px solid var(--line); flex-shrink: 0; }
#afc-root .a-head .a-text { min-width: 0; flex: 1; }
#afc-root .a-eyebrow { font-size: .62rem; text-transform: uppercase; letter-spacing: .1em; font-weight: 700; color: #8b94a4; }
#afc-root .a-title { font-size: 1.2rem; font-weight: 700; color: #fff; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-sub { font-size: .78rem; color: var(--dim); margin-top: .15rem; }
#afc-root .a-mark { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--ac); color: #0b1118; font-weight: 900; font-size: 15px; }
#afc-root .a-close { position: absolute; top: 50%; right: 1.1rem; transform: translateY(-50%); background: none; border: 0; color: #fff; font-size: 20px; line-height: 1; cursor: pointer; padding: 4px; }
#afc-root .a-close:hover { opacity: .7; }
#afc-root .a-back { flex: none; width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(255,255,255,.16); background: none; color: #fff; font-size: 16px; cursor: pointer; }
#afc-root .a-coins { flex: none; font-weight: 700; color: #ffd76a; font-variant-numeric: tabular-nums; font-size: .85rem; }
#afc-root .a-coins-btn { flex: none; width: 26px; height: 26px; border-radius: 7px; border: 1px solid rgba(255,215,106,.35); background: none; color: #ffd76a; font-size: 14px; line-height: 1; cursor: pointer; }
#afc-root .a-coins-btn:hover:not(:disabled) { background: rgba(255,215,106,.1); }
#afc-root .a-coins-btn:disabled { opacity: .5; cursor: default; }
#afc-root .a-nav { display: flex; gap: .25rem; padding: .4rem 1.5rem 0; border-bottom: 1px solid var(--line); flex-shrink: 0; overflow-x: auto; }
#afc-root .a-nav button { display: inline-flex; align-items: center; gap: 6px; padding: .5rem .95rem; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--dim); font: 600 .82rem Roboto, Arial, sans-serif; cursor: pointer; white-space: nowrap; }
#afc-root .a-nav button.active { color: #fff; border-bottom-color: var(--ac); }
#afc-root .a-nav .badge { padding: 0 6px; border-radius: 8px; background: #5c4012; color: #ffd8a8; font-size: 10px; }
#afc-root .a-strip { display: flex; align-items: center; gap: .6rem; padding: .5rem 1.5rem; background: rgba(0,202,246,.08); border-bottom: 1px solid var(--line); font-size: .8rem; flex-shrink: 0; }
#afc-root .a-strip.lock { background: rgba(255,179,71,.12); color: #ffd8a8; }
#afc-root .a-strip .a-st { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-strip.hidden { display: none; }
#afc-root .a-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 1.25rem 1.5rem 1.5rem; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #4c5969 transparent; }
#afc-root .a-actionbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; flex-shrink: 0; padding: .75rem 1.5rem; border-top: 1px solid var(--line); background: rgba(16,21,29,.85); }
#afc-root .a-actionbar.hidden { display: none; }
#afc-root .a-count { font-weight: 700; color: #fff; }
#afc-root .a-proj { display: flex; flex-wrap: wrap; gap: .2rem .9rem; font-size: .75rem; color: var(--dim); }
#afc-root .a-proj b { color: #fff; font-variant-numeric: tabular-nums; }
#afc-root .a-proj b.neg { color: var(--ko); } #afc-root .a-proj b.pos { color: var(--ok); }
#afc-root .a-proj .warn { color: var(--warn); font-weight: 600; } #afc-root .a-proj .dim { color: #6f7889; }
#afc-root .a-btn { display: inline-flex; align-items: center; justify-content: center; gap: .3rem; padding: .45rem .85rem; border: 1px solid rgba(255,255,255,.18); border-radius: .5rem; background: transparent;
  color: #fff; font: 600 .78rem Roboto, Arial, sans-serif; cursor: pointer; transition: background .15s, border-color .15s; white-space: nowrap; }
#afc-root .a-btn:hover:not(:disabled) { border-color: rgba(255,255,255,.4); }
#afc-root .a-btn:disabled { opacity: .4; cursor: default; }
#afc-root .a-btn.primary { background: var(--ac); border-color: var(--ac); color: #0b1118; }
#afc-root .a-btn.go { background: var(--ok); border-color: var(--ok); color: #0b1118; }
#afc-root .a-btn.danger { background: #c92a2a; border-color: #c92a2a; }
#afc-root .a-btn.big { width: 100%; padding: .8rem 1rem; font-size: .92rem; border-radius: .6rem; }
#afc-root .a-btn.small { padding: .25rem .6rem; font-size: .7rem; }
#afc-root .a-btn.ghost { border-color: transparent; color: var(--dim); }
#afc-root .a-link { background: none; border: 0; padding: 0; color: var(--ac); font: inherit; font-size: .75rem; cursor: pointer; }
#afc-root .a-link:disabled { opacity: .4; cursor: default; }
#afc-root .a-row { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
#afc-root .a-grow { flex: 1; min-width: 0; }
#afc-root .a-pill { display: inline-flex; align-items: center; padding: .1rem .5rem; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; font-size: .66rem; font-weight: 600; color: #dfe4ec; white-space: nowrap; }
#afc-root .a-pill.ok { border-color: rgba(61,220,132,.4); color: var(--ok); }
#afc-root .a-pill.ko { border-color: rgba(255,107,107,.4); color: var(--ko); }
#afc-root .a-pill.ac { border-color: rgba(0,202,246,.5); color: var(--ac); }
#afc-root .a-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: .75rem; }
#afc-root .a-cols { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: .9rem; align-items: start; }
#afc-root .a-col { display: flex; flex-direction: column; gap: .9rem; min-width: 0; }
@media (max-width: 860px) { #afc-root .a-cols { grid-template-columns: 1fr; } }
#afc-root .a-tile { position: relative; display: flex; flex-direction: column; gap: .8rem; min-height: 150px; padding: 1rem 1.1rem; background: var(--panel); border: 1px solid var(--line);
  border-radius: .75rem; cursor: pointer; transition: border-color .15s, transform .15s; }
#afc-root .a-tile:hover { border-color: rgba(255,255,255,.22); transform: translateY(-1px); }
#afc-root .a-tile.add { align-items: center; justify-content: center; text-align: center; border-style: dashed; color: var(--dim); }
#afc-root .a-tile.add b { color: #fff; font-size: 1rem; }
#afc-root .a-tile-top { display: flex; align-items: center; gap: .5rem; }
#afc-root .a-tile-name { flex: 1; min-width: 0; font-size: .95rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-tile-stats { display: flex; flex-wrap: wrap; gap: .4rem .9rem; font-size: .74rem; color: var(--dim); }
#afc-root .a-tile.picked { border-color: var(--ac); box-shadow: inset 0 0 0 1px var(--ac); }
#afc-root .a-tile .a-check { flex: none; cursor: pointer; }
#afc-root .a-hits { display: flex; flex-direction: column; gap: 3px; max-height: 320px; overflow-y: auto; scrollbar-width: thin; }
#afc-root .a-hit { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 4px 10px; padding: 6px 9px; border-radius: 6px; background: var(--panel2); font-size: 12px; }
#afc-root .a-hit.pick { cursor: pointer; } #afc-root .a-hit.pick:hover { background: #222c3a; }
#afc-root .a-hit .n { color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#afc-root .a-hit .n i { font-style: normal; color: #ffd76a; margin-right: .35rem; }
#afc-root .a-hit .m { font-size: 11px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-hit .ok { color: var(--ok); } #afc-root .a-hit .ac { color: var(--ac); } #afc-root .a-hit .warn { color: var(--warn); }
#afc-root .a-tile-foot { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: .5rem; font-size: .75rem; color: var(--ac); font-weight: 600; }
#afc-root .a-x { background: none; border: 0; color: var(--dim); font-size: 15px; cursor: pointer; padding: 0 2px; }
#afc-root .a-x:hover:not(:disabled) { color: #fff; } #afc-root .a-x:disabled { opacity: .3; cursor: default; }
#afc-root .a-bar { height: 6px; background: rgba(255,255,255,.08); border-radius: 3px; overflow: hidden; display: flex; }
#afc-root .a-bar > span { height: 100%; background: var(--ok); transition: width .4s; }
#afc-root .a-bar > span.ac { background: var(--ac); } #afc-root .a-bar > span.warn { background: var(--warn); } #afc-root .a-bar > span.ko { background: var(--ko); }
#afc-root .a-tabs { display: inline-flex; gap: .25rem; padding: .25rem; background: var(--panel); border-radius: .6rem; }
#afc-root .a-tabs button { padding: .35rem .75rem; border: 0; border-radius: .45rem; background: transparent; color: var(--dim); font: 600 .78rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .a-tabs button.active { background: rgba(255,255,255,.1); color: #fff; }
#afc-root .a-ctl { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; margin-bottom: 1rem; }
#afc-root input.a-in, #afc-root select.a-in { background: #0d1117; color: #fff; border: 1px solid rgba(255,255,255,.14); border-radius: .45rem; padding: .4rem .6rem; font: .8rem Roboto, Arial, sans-serif; min-width: 0; }
#afc-root input.a-in:focus, #afc-root select.a-in:focus { outline: none; border-color: var(--ac); }
#afc-root select.a-in { max-width: 100%; }
#afc-root input.a-num { width: 76px; text-align: right; font-variant-numeric: tabular-nums; }
#afc-root .a-players { display: grid; grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); gap: .6rem; }
#afc-root .a-player { position: relative; display: flex; flex-direction: column; align-items: center; gap: .3rem; padding: 1.4rem .5rem .75rem; background: var(--panel);
  border: 1px solid var(--line); border-radius: .65rem; min-width: 0; }
#afc-root .a-player.is-collected .a-card { opacity: .55; }
#afc-root .a-player.is-selectable { cursor: pointer; transition: border-color .15s, background .15s, transform .15s; }
#afc-root .a-player.is-selectable:hover { border-color: rgba(255,255,255,.22); transform: translateY(-1px); }
#afc-root .a-player.is-selected { border-color: var(--ac); background: rgba(0,202,246,.07); }
#afc-root .a-pick { position: absolute; top: .4rem; right: .45rem; width: 16px; height: 16px; border-radius: 999px; border: 1.5px solid rgba(255,255,255,.28); background: rgba(255,255,255,.04);
  display: grid; place-items: center; font-size: 10px; color: transparent; }
#afc-root .a-pick.on { background: var(--ac); border-color: var(--ac); color: #10151d; }
#afc-root .a-got { position: absolute; top: .4rem; right: .45rem; width: 16px; height: 16px; border-radius: 999px; background: var(--ok); color: #10151d; display: grid; place-items: center; font-size: 10px; font-weight: 900; }
#afc-root .a-tgt { position: absolute; top: .4rem; left: .45rem; font-size: 11px; color: var(--warn); }
#afc-root .a-card { position: relative; display: flex; justify-content: center; align-items: center; width: 80px; min-height: 104px; }
#afc-root .a-card .item.small { margin: 0 auto; }
#afc-root .a-fallback { width: 64px; height: 88px; display: grid; place-items: center; border-radius: .4rem; background: rgba(255,255,255,.06); font-size: 1.1rem; font-weight: 700; color: #fff; }
#afc-root .a-pname { max-width: 100%; font-size: .78rem; font-weight: 700; color: #fff; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-price { font-size: .7rem; color: var(--dim); text-align: center; }
#afc-root .a-pstate { font-size: .66rem; text-align: center; color: var(--ac); }
#afc-root .a-pstate.ok { color: var(--ok); } #afc-root .a-pstate.ko { color: var(--ko); }
#afc-root .a-pbtn { margin-top: .2rem; padding: .25rem .6rem; border: 1px solid rgba(255,255,255,.16); border-radius: 999px; background: rgba(255,255,255,.04); color: #aab3c2;
  font: 700 .66rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .a-pbtn:hover:not(:disabled) { border-color: var(--warn); color: var(--warn); }
#afc-root .a-pbtn.on { border-color: var(--warn); background: rgba(255,179,71,.14); color: var(--warn); }
#afc-root .a-pbtn:disabled { opacity: .35; cursor: default; }
#afc-root .a-pager { display: flex; align-items: center; justify-content: center; gap: .9rem; margin-top: 1.25rem; font-size: .8rem; }
#afc-root .a-empty { padding: 1.4rem; text-align: center; color: var(--dim); font-size: .82rem; }
#afc-root .a-empty ol { text-align: left; display: inline-block; margin: .8rem 0 0; line-height: 1.8; }
#afc-root .a-block { display: flex; flex-direction: column; gap: .55rem; padding: .95rem 1rem; border: 1px solid rgba(255,255,255,.08); border-radius: .75rem; background: var(--panel); min-width: 0; }
#afc-root .a-block-title { font-size: .7rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: #8b94a4; }
#afc-root .a-block-hint { font-size: .72rem; color: var(--dim); line-height: 1.45; }
#afc-root .a-kv { display: flex; justify-content: space-between; gap: 1rem; font-size: .8rem; }
#afc-root .a-kv b { color: #fff; font-variant-numeric: tabular-nums; }
#afc-root .a-kv .warn { color: var(--warn); }
#afc-root .a-seg { display: inline-flex; gap: .25rem; padding: .2rem; background: #0d1117; border-radius: .5rem; }
#afc-root .a-seg button { padding: .3rem .75rem; border: 0; border-radius: .4rem; background: none; color: var(--dim); font: 600 .76rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .a-seg button.active { background: rgba(255,255,255,.12); color: #fff; }
#afc-root .a-seg button:disabled { cursor: default; }
#afc-root .a-opt { display: flex; gap: .6rem; align-items: flex-start; padding: .55rem .6rem; border: 1px solid transparent; border-radius: .55rem; cursor: pointer; }
#afc-root .a-opt.active { border-color: var(--ac); background: rgba(0,202,246,.06); }
#afc-root .a-opt .a-radio { flex: none; margin-top: 3px; width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); }
#afc-root .a-opt.active .a-radio { border-color: var(--ac); background: radial-gradient(var(--ac) 45%, transparent 50%); }
#afc-root .a-opt b { color: #fff; font-size: .82rem; }
#afc-root .a-buybody { display: flex; flex-direction: column; gap: .75rem; padding: 1rem 1.5rem; overflow-y: auto; min-height: 0; flex: 1; scrollbar-width: thin; scrollbar-color: #4c5969 transparent; }
#afc-root .a-brows { display: flex; flex-direction: column; gap: .3rem; max-height: 300px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #4c5969 transparent; }
#afc-root .a-brow { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: .2rem .7rem; padding: .45rem .6rem; border-radius: .5rem; background: #121821; cursor: pointer; }
#afc-root .a-brow.off { opacity: .45; }
#afc-root .a-brow .a-bn { font-weight: 700; color: #fff; font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .a-brow .a-bn i { font-style: normal; color: #ffd76a; margin-right: .35rem; }
#afc-root .a-brow .a-bs { grid-column: 2 / span 2; font-size: .7rem; color: var(--dim); }
#afc-root .a-brow .a-bs.ok { color: var(--ok); } #afc-root .a-brow .a-bs.ko { color: var(--ko); } #afc-root .a-brow .a-bs.ac { color: var(--ac); }
#afc-root .a-check { width: 16px; height: 16px; border-radius: 4px; border: 1.5px solid rgba(255,255,255,.35); display: grid; place-items: center; font-size: 10px; color: transparent; }
#afc-root .a-check.on { background: var(--ac); border-color: var(--ac); color: #0b1118; }
#afc-root .a-buyfoot { display: flex; flex-direction: column; gap: .5rem; padding: .9rem 1.5rem 1.2rem; border-top: 1px solid var(--line); background: #1f2834; flex-shrink: 0; }
#afc-root .a-cta-sub { text-align: center; font-size: .72rem; color: var(--dim); }
#afc-root .a-sec { display: flex; flex-direction: column; gap: .9rem; max-width: 860px; }
#afc-root .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
#afc-root .tiles.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 860px) { #afc-root .tiles.four { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
#afc-root .tile { background: var(--panel2); border-radius: 8px; padding: 8px 10px; min-width: 0; }
#afc-root .tile span { display: block; font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .tile b { display: block; font-size: 17px; color: #fff; font-variant-numeric: tabular-nums; white-space: nowrap; }
#afc-root .tile small { display: block; font-size: 10px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#afc-root .tile.neg b { color: var(--ko); } #afc-root .tile.pos b { color: var(--ok); } #afc-root .tile.warn b { color: var(--warn); }
#afc-root .hero { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
#afc-root .hero span { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: var(--dim); }
#afc-root .hero b { font-size: 22px; color: #fff; font-variant-numeric: tabular-nums; }
#afc-root .hero b.neg { color: var(--ko); } #afc-root .hero b.pos { color: var(--ok); }
#afc-root .hero small { margin-left: auto; font-size: 11px; color: var(--dim); text-align: right; }
#afc-root .salelist { display: flex; flex-direction: column; gap: 3px; max-height: 280px; overflow-y: auto; scrollbar-width: thin; }
#afc-root .sale { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 2px 10px; padding: 6px 9px; border-radius: 6px; background: var(--panel2); font-size: 12px; font-variant-numeric: tabular-nums; }
#afc-root .sale .n { color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#afc-root .sale .m { font-size: 11px; color: var(--dim); }
#afc-root .sale.unsold { box-shadow: inset 3px 0 #fd7e14; }
#afc-root .stbl { display: flex; flex-direction: column; gap: 3px; max-height: 300px; overflow-y: auto; scrollbar-width: thin; font-size: 12px; font-variant-numeric: tabular-nums; }
#afc-root .stbl .r { display: grid; grid-template-columns: var(--cols); align-items: center; gap: 8px; padding: 5px 9px; border-radius: 6px; background: var(--panel2); }
#afc-root .stbl .r > :not(:first-child) { text-align: right; white-space: nowrap; }
#afc-root .stbl .r.hd { position: sticky; top: 0; z-index: 1; background: var(--panel); padding-top: 0; font-size: 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; }
#afc-root .stbl .r.cur { box-shadow: inset 3px 0 var(--ok); }
#afc-root .stbl .n { color: #fff; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#afc-root .stbl .m { font-size: 11px; color: var(--dim); }
#afc-root .stbl .bar { height: 6px; border-radius: 3px; background: rgba(255,255,255,.06); overflow: hidden; display: flex; }
#afc-root .stbl .bar > span { height: 100%; background: var(--ok); } #afc-root .stbl .bar > span.neg { background: var(--ko); }
#afc-root .pos { color: var(--ok); } #afc-root .neg { color: var(--ko); }
#afc-root .ev { display: grid; grid-template-columns: 58px 14px 1fr; gap: 4px; padding: 2px 6px; border-radius: 4px; font-size: 12px; line-height: 1.45; color: #c9ccd4; }
#afc-root .ev .tm { color: #6c7180; font-variant-numeric: tabular-nums; }
#afc-root .ev .ic { text-align: center; font-weight: 700; }
#afc-root .ev.step { color: #7c8190; }
#afc-root .ev.major { color: #e6e7eb; }
#afc-root .ev.buy .ic, #afc-root .ev.buy.major { color: #69db7c; } #afc-root .ev.sell .ic, #afc-root .ev.sell { color: #ffe066; }
#afc-root .ev.list .ic { color: #74c0fc; } #afc-root .ev.miss .ic, #afc-root .ev.error .ic { color: #ff8787; } #afc-root .ev.error { color: #ffa8a8; }
#afc-root .ev.lock { color: #ffc078; background: #2b2012; } #afc-root .ev.lock .ic, #afc-root .ev.warn .ic { color: #ffa94d; }
#afc-root .jtools { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
#afc-root .jlist { background: #0d1117; border-radius: 8px; padding: 4px; }
#afc-root .s-status { display: flex; align-items: center; gap: .8rem; }
#afc-root .s-phase { font-size: 1.15rem; font-weight: 800; letter-spacing: .06em; color: #fff; }
#afc-root .s-spin { flex: none; width: 26px; height: 26px; border-radius: 50%; border: 4px solid rgba(61,220,132,.25); border-top-color: var(--ok); animation: afc-spin 1s linear infinite; }
#afc-root .s-spin.pause { animation: none; border-color: var(--warn); }
#afc-root .s-spin.off { animation: none; border-color: #3a4352; }
@keyframes afc-spin { to { transform: rotate(360deg); } }
#afc-root .s-target { font-size: .82rem; color: #dfe4ec; }
#afc-root .s-target b { color: #fff; }
#afc-root .s-act { font-size: .76rem; color: var(--dim); min-height: 1.2em; }
#afc-root .s-log { background: #0d1117; border-radius: 8px; padding: 8px; height: 190px; overflow-y: auto; font: 11.5px/1.5 ui-monospace, monospace; color: #c9cfdb; scrollbar-width: thin; }
#afc-root .s-log div:first-child { color: #fff; }
#afc-root .switch { position: relative; width: 38px; height: 22px; flex: 0 0 38px; display: inline-block; }
#afc-root .switch input { opacity: 0; width: 0; height: 0; position: absolute; }
#afc-root .switch span { position: absolute; inset: 0; background: #3a3f4b; border-radius: 22px; cursor: pointer; transition: .15s; }
#afc-root .switch span::before { content: ''; position: absolute; width: 16px; height: 16px; left: 3px; top: 3px; background: #fff; border-radius: 50%; transition: .15s; }
#afc-root .switch input:checked + span { background: var(--ok); }
#afc-root .switch input:checked + span::before { transform: translateX(16px); }
#afc-root .switch input:disabled + span { opacity: .4; cursor: default; }
#afc-root .setting { display: flex; justify-content: space-between; align-items: center; gap: .8rem; font-size: .8rem; }
#afc-root .setting > span { min-width: 0; }
#afc-root .setting small { display: block; color: var(--dim); font-size: .7rem; }
#afc-root .t-list { display: flex; flex-direction: column; gap: 4px; max-height: 330px; overflow-y: auto; scrollbar-width: thin; }
#afc-root .t-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 2px 10px; padding: 7px 9px; border-radius: 7px; background: var(--panel2); border: 1px solid transparent; cursor: pointer; }
#afc-root .t-row.active { border-color: var(--ac); background: rgba(0,202,246,.07); }
#afc-root .t-row.lock { cursor: default; }
#afc-root .t-row .t-n { color: #fff; font-weight: 600; font-size: .8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#afc-root .t-row .t-p { grid-column: 2; font-size: .7rem; color: var(--dim); }
#afc-root .t-row .a-x { grid-row: 1 / span 2; grid-column: 3; }
#afc-root .t-row .a-radio { grid-row: 1 / span 2; width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(255,255,255,.35); }
#afc-root .t-row.active .a-radio { border-color: var(--ac); background: radial-gradient(var(--ac) 45%, transparent 50%); }
#afc-root .results { display: flex; flex-direction: column; border-radius: 6px; overflow: hidden; }
#afc-root .results:empty { display: none; }
#afc-root .result { text-align: left; background: #232b38; color: #fff; border: 0; padding: 6px 9px; font: 500 .78rem Roboto, Arial, sans-serif; cursor: pointer; }
#afc-root .result:hover { background: #2c3646; }
#afc-root .prices { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 6px; align-items: center; font-size: .8rem; }
#afc-root .prices input { width: 100%; text-align: right; }
#afc-root .market { flex-direction: row; align-items: center; gap: 10px; border-left: 4px solid; cursor: pointer; }
#afc-root .market:hover { filter: brightness(1.12); }
#afc-root .market.inactive { border-left-color: var(--ko); } #afc-root .market.semi { border-left-color: #e0c341; } #afc-root .market.active { border-left-color: var(--ok); }
#afc-root .market .dot { width: 10px; height: 10px; border-radius: 50%; flex: none; }
#afc-root .market.inactive .dot { background: var(--ko); } #afc-root .market.semi .dot { background: #e0c341; } #afc-root .market.active .dot { background: var(--ok); }
#afc-root .market b { color: #fff; font-size: .82rem; } #afc-root .market .a-block-hint { margin-top: 1px; }
#afc-root .limits { display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: 8px 14px; font-size: .75rem; color: var(--dim); font-variant-numeric: tabular-nums; align-items: center; }
#afc-root .limits .col { font-size: .68rem; text-align: right; }
#afc-root .limits .lim { display: flex; flex-direction: column; gap: 3px; text-align: right; }
#afc-root .limits b { color: #fff; }
#afc-root .limits small { font-size: .66rem; color: var(--warn); }
#afc-root .lockbox { background: rgba(255,179,71,.1); border-color: rgba(255,179,71,.3); color: #ffd8a8; }
#afc-root .cal table { width: 100%; border-collapse: separate; border-spacing: 3px; table-layout: fixed; }
#afc-root .cal th { font-size: 12px; font-weight: 600; color: #c9cfdb; padding: 4px; }
#afc-root .cal th.h { width: 92px; text-align: left; font-variant-numeric: tabular-nums; white-space: nowrap; }
#afc-root .cal td { font-size: 12px; text-align: center; padding: 8px 4px; border-radius: 4px; color: #fff; }
#afc-root .cal .inactive { background: #8f1f1f; } #afc-root .cal .semi { background: #7a6a12; } #afc-root .cal .active { background: #23733a; }
#afc-root .cal td.now { outline: 2px solid #fff; outline-offset: -2px; font-weight: 700; }
#afc-root .cal .key { display: flex; gap: 10px; font-size: 12px; color: var(--dim); align-items: center; flex-wrap: wrap; }
#afc-root .cal .key i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
`;

  function h(tag, props = {}, ...children) {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...children.filter((c) => c !== null && c !== undefined && c !== false && c !== ''));
    return n;
  }
  const btn = (label, onclick, cls = '', extra = {}) => h('button', { type: 'button', className: `a-btn ${cls}`.trim(), textContent: label, onclick, ...extra });
  const tile = (label, value, sub, cls = '') => h('div', { className: `tile ${cls}` }, h('span', { textContent: label }), h('b', { textContent: value }), sub ? h('small', { textContent: sub, title: sub }) : null);
  const block = (title, ...children) => h('div', { className: 'a-block' }, title ? h('div', { className: 'a-block-title', textContent: title }) : null, ...children);
  const hint = (text) => h('div', { className: 'a-block-hint', textContent: text });
  function toggle(checked, onchange, disabled = false) {
    const i = h('input', { type: 'checkbox', checked, disabled });
    i.onchange = () => onchange(i.checked);
    return h('label', { className: 'switch' }, i, h('span'));
  }
  const setting = (label, sub, control) => h('div', { className: 'setting' }, h('span', {}, label, sub ? h('small', { textContent: sub }) : null), control);
  const perH = (v) => (v === null ? '—' : `${fmtSigned(v)} / h`);
  const rate = (a, b) => (a + b ? ` · réussite ${Math.round((100 * a) / (a + b))} %` : '');
  // Recherche insensible à la casse et aux accents
  const norm = (t) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const sign = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const dur = (ms) => (ms >= 36e5 ? `${Math.floor(ms / 36e5)} h ${String(Math.floor((ms % 36e5) / 6e4)).padStart(2, '0')}` : `${Math.max(0, Math.round(ms / 6e4))} min`);
  const when = (t) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  // Tableau : cols = grid-template-columns, head = intitulés, rows = [cellules, classe, title]
  function table(cols, head, rows) {
    const r = (cells, cls = '', title = '') => h('div', { className: `r ${cls}`.trim(), title }, ...cells.map((c) => (c instanceof Node ? c : h('span', { textContent: String(c) }))));
    const el = h('div', { className: 'stbl', style: `--cols:${cols}` }, r(head, 'hd'), ...rows.map(([cells, cls, title]) => r(cells, cls, title)));
    return el;
  }
  // Grade estimé d'un set (score sans bonus de tags) et prochain seuil
  const gradePill = (gr) =>
    gr.grade || gr.next
      ? h('span', {
          className: `a-pill${gr.grade === 'S' ? ' ok' : gr.grade ? ' ac' : ''}`,
          title: `Score estimé ~${fmt(gr.score)} (cartes de ta collection, sans bonus de tags : souvent plus haut en jeu)${gr.next ? ` · ${gr.next.grade} à ${fmt(gr.next.at)}` : ''}`,
          textContent: `Grade ${gr.grade ?? '—'}${gr.next ? ` · ${gr.next.grade} à ${fmtShort(gr.next.at)}` : ''}`,
        })
      : null;
  const fmtShort = (v) => (v >= 1e6 ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M` : v >= 1e3 ? `${Math.round(v / 1e3)} k` : String(v));
  const cell = (text, cls) => h('span', { className: cls, textContent: text });
  const ago = (t) => {
    const m = Math.floor((Date.now() - t) / 6e4);
    return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`;
  };
  async function copyText(t) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: t });
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  }

  // Carte rendue par la Web App à partir de l'itemData EA ; null si indisponible
  const cardCache = new Map();
  function cardElement(defId, itemData) {
    if (cardCache.has(defId)) return cardCache.get(defId);
    if (!itemData) return null;
    let el = null;
    try {
      const item = window.factories?.Item?.generateItemsFromItemData?.([{ ...itemData, dream: false }])?.[0];
      const VF = window.UTItemViewFactory;
      if (item && VF?.createSmallItem) {
        const view = VF.createSmallItem(item);
        view.init();
        view.supportSecondaryViews = false;
        view.render(item);
        el = view.getRootElement();
      }
    } catch {
      el = null;
    }
    cardCache.set(defId, el);
    return el;
  }

  function rowStatus(q) {
    if (!q) return null;
    const m = {
      pending: ['En attente', ''],
      searching: ['Achat…', 'ac'],
      listed: [`Mis en vente à ${fmt(q.sell)}`, 'ok'],
      kept: ['Au club', 'ok'],
      bought: ['Acheté · non-assignés', 'ok'],
      skipped: ['Déjà dans la Galerie', 'ok'],
      moved: [`Prix monté${q.seen ? ` · ${fmt(q.seen)} maintenant` : ''}`, 'ko'],
      notfound: [/concurrence/.test(q.note ?? '') ? 'Surenchéri' : 'Non trouvé', 'ko'],
      nocoins: ['Crédits insuffisants', 'ko'],
    }[q.status] ?? [q.status, ''];
    if (q.price && (q.status === 'kept' || q.status === 'bought')) m[0] += ` · payé ${fmt(q.price)}`;
    return m;
  }

  const TABS = [
    ['snipe', 'Sniper'],
    ['gallery', 'Galerie'],
    ['sales', 'Ventes'],
    ['log', 'Journal'],
    ['settings', 'Réglages'],
  ];
  const PHASES = { idle: 'DÉMARRAGE', search: 'RECHERCHE', price: 'VÉRIFICATION DU PRIX', break: 'PAUSE', wait: 'EN ATTENTE' };

  X.UI = class {
    setKey = null;
    filter = 'missing';
    text = '';
    page = 0;
    buyKey = null;
    buyKeys = [];
    homeText = '';
    homeFilter = 'all';
    homeSel = new Set();
    buyRows = [];
    jfilter = 'all';
    shownEventId = 0;
    lastSig = '';
    synced = new Map();
    queued = false;

    constructor(app) {
      this.app = app;
      this.sniper = app.sniper;
      this.album = app.album;
      this.tab = TABS.some(([k]) => k === app.cfg.tab) ? app.cfg.tab : 'snipe';
      document.getElementById('afc-style')?.remove();
      document.head.append(h('style', { id: 'afc-style', textContent: CSS }));
      this.root = h('div', { id: 'afc-root' });
      for (const ev of ['keydown', 'keyup', 'keypress']) this.root.addEventListener(ev, (e) => e.stopPropagation());
      document.body.appendChild(this.root);
      this.build();
    }
    get cfg() {
      return this.app.cfg;
    }
    get isOpen() {
      return this.layer.classList.contains('open');
    }
    // Saisie en cours dans le panneau : pas de reconstruction
    typing(scope = this.root) {
      const a = document.activeElement;
      return !!a && scope.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'SELECT');
    }
    toggle() {
      this.isOpen ? this.close() : this.show();
    }
    show(tab) {
      if (tab) this.tab = tab;
      this.layer.classList.add('open');
      this.launcher.style.display = 'none';
      this.renderAll();
    }
    close() {
      this.layer.classList.remove('open');
      this.launcher.style.display = '';
      this.closeBuy();
    }

    build() {
      this.launchDot = h('span', { className: 'a-dot' });
      this.launchSub = h('small');
      this.launchBtn = h('button', { type: 'button', className: 'a-mini' });
      this.launchBtn.onclick = (ev) => {
        ev.stopPropagation();
        X.unlockAudio();
        this.sniper.running && this.sniper.task === 'snipe' ? this.app.stopSniper() : this.app.startSniper();
      };
      this.launcher = h('div', { className: 'a-launch', title: `Ouvrir ${X.APP}`, onclick: () => this.show() }, this.launchDot, h('span', { textContent: X.APP }), this.launchSub, this.launchBtn);

      this.backBtn = h('button', { type: 'button', className: 'a-back', textContent: '←', title: 'Retour aux sets', onclick: () => this.openSet(null) });
      this.eyebrowEl = h('div', { className: 'a-eyebrow' });
      this.titleEl = h('div', { className: 'a-title' });
      this.subEl = h('div', { className: 'a-sub' });
      this.syncBtn = btn('', () => void this.syncCurrent(), 'small');
      this.coinsEl = h('span', { className: 'a-coins', title: 'Crédits disponibles' });
      this.coinsBtn = h('button', { type: 'button', className: 'a-coins-btn', textContent: '↻', title: 'Actualiser les crédits', onclick: () => void this.refreshCoins() });
      const head = h(
        'div',
        { className: 'a-head' },
        this.backBtn,
        h('span', { className: 'a-mark', textContent: 'F' }),
        h('div', { className: 'a-text' }, this.eyebrowEl, this.titleEl, this.subEl),
        this.syncBtn,
        this.coinsEl,
        this.coinsBtn,
        h('button', { type: 'button', className: 'a-close', textContent: '×', title: 'Fermer', onclick: () => this.close() }),
      );
      this.navBtns = {};
      this.nav = h('div', { className: 'a-nav' });
      for (const [id, label] of TABS) {
        this.navBtns[id] = h('button', { type: 'button', onclick: () => this.showTab(id) }, label);
        this.nav.append(this.navBtns[id]);
      }
      this.snipeDot = h('span', { className: 'a-dot' });
      this.navBtns.snipe.prepend(this.snipeDot);
      this.salesBadge = h('span', { className: 'badge' });
      this.stripDot = h('span', { className: 'a-dot on' });
      this.stripText = h('span', { className: 'a-st' });
      this.stripBtn = h('span', { className: 'a-row' });
      this.strip = h('div', { className: 'a-strip hidden' }, this.stripDot, this.stripText, this.stripBtn);
      this.body = h('div', { className: 'a-body' });
      this.actionbar = h('div', { className: 'a-actionbar hidden' });
      this.inner = h('div', { className: 'a-inner' }, head, this.nav, this.strip, this.body, this.actionbar);
      this.layer = h('div', { className: 'a-layer' }, this.inner);
      this.layer.addEventListener('mousedown', (e) => e.target === this.layer && this.close());

      this.buyInner = h('div', { className: 'a-inner' });
      this.buyLayer = h('div', { className: 'a-layer a-buy' }, this.buyInner);
      this.buyLayer.addEventListener('mousedown', (e) => e.target === this.buyLayer && !this.album.running && this.closeBuy());
      this.calInner = h('div', { className: 'a-inner cal' });
      this.calLayer = h('div', { className: 'a-layer a-cal' }, this.calInner);
      this.calLayer.addEventListener('mousedown', (e) => e.target === this.calLayer && this.calLayer.classList.remove('open'));

      this.snipeSec = this.buildSnipeTab();
      this.salesSec = this.buildSalesTab();
      this.logSec = this.buildLogTab();
      this.settingsSec = h('div', { className: 'a-sec' });
      this.root.append(this.launcher, this.layer, this.buyLayer, this.calLayer);
      this.renderEvents(true);
      setInterval(() => this.tick(), 1e3);
      this.renderAll();
    }

    showTab(id) {
      this.tab = id;
      this.app.setConfig({ tab: id });
      this.body.scrollTop = 0;
      this.renderAll();
    }

    // --- Rendu général ---

    renderAll() {
      this.renderHead();
      this.renderStrip();
      this.renderBody();
      this.renderLauncher();
      if (this.buyKey) this.renderBuy();
    }
    renderHead() {
      const a = this.album;
      const set = this.setKey && this.tab === 'gallery' ? a.sets[this.setKey] : null;
      this.backBtn.style.display = set ? '' : 'none';
      this.eyebrowEl.textContent = set ? 'Galerie · Set' : X.APP;
      this.titleEl.textContent = set ? set.name : Object.fromEntries(TABS)[this.tab];
      if (set) {
        const all = a.setPlayers(set);
        const pr = a.progress(set);
        const gr = a.gradeOf(set);
        this.subEl.textContent = `Places remplies ${pr.have} / ${pr.slots} · ${gr.grade || gr.next ? `grade estimé ${gr.grade ?? '—'} (~${fmt(gr.score)}${gr.next ? `, ${gr.next.grade} à ${fmt(gr.next.at)}` : ''}) · ` : ''}${pr.crit ? `${X.CRIT_LABEL[pr.crit.k]} : ${fmt(pr.owned.size)} joueur(s) de ta collection` : 'liste fut.gg'} · ${all.length} joueurs listés (équipe la moins chère fut.gg)`;
      } else
        this.subEl.textContent = {
          snipe: 'Achète sous le prix du marché et revend avec profit, sans interruption',
          gallery: `${a.setList().length} set(s) importé(s) depuis fut.gg`,
          sales: 'Profits du sniper, coût de la Galerie, liste de transferts',
          log: 'Toutes les actions, du sniper et de la Galerie',
          settings: 'Appliqués immédiatement, y compris pendant une tâche',
        }[this.tab];
      this.syncBtn.style.display = this.tab === 'gallery' ? '' : 'none';
      const at = set ? set.syncedAt : a.gallerySyncAt;
      this.syncBtn.textContent = this.syncing ? 'Synchronisation…' : at ? `↻ Synchronisé ${ago(at)}` : '↻ Non synchronisé';
      this.syncBtn.title = 'Relire chez EA les cartes collectées';
      this.syncBtn.disabled = this.syncing || a.running;
      const c = X.coins();
      this.coinsEl.textContent = c == null ? '' : `${fmt(c)} crédits`;
      for (const [k, b] of Object.entries(this.navBtns)) b.classList.toggle('active', k === this.tab);
      const unsold = Object.values(a.bought).filter(isUnsold).length;
      this.salesBadge.textContent = String(unsold);
      if (unsold) this.navBtns.sales.append(this.salesBadge);
      else this.salesBadge.remove();
    }
    // Bandeau : tâche en cours (sniper ou Galerie) et un seul bouton Arrêter
    renderStrip() {
      const s = this.sniper;
      const a = this.album;
      const locked = s.guard.lockedUntil() > 0;
      const busy = s.running || a.running;
      this.strip.classList.toggle('hidden', !busy && !locked && !a.resumeAt);
      this.strip.classList.toggle('lock', locked);
      this.stripDot.className = `a-dot${busy && !locked ? ' on' : locked ? ' lock' : ''}`;
      const kids = [];
      if (busy) kids.push(btn('Arrêter', () => this.app.stopAll(), 'small danger', { title: 'Arrête la tâche en cours et le sniper' }));
      if (locked) kids.push(btn('Lever la pause', () => confirm('Lever la pause anti-captcha ? Seulement si EA n’affiche plus de captcha et que le marché fonctionne à la main.') && this.app.unlock(), 'small'));
      this.stripBtn.replaceChildren(...kids);
      this.tick();
    }
    renderLauncher() {
      const s = this.sniper;
      const snipe = s.running && s.task === 'snipe';
      const locked = s.guard.lockedUntil() > 0;
      this.launchDot.className = `a-dot${s.running || this.album.running ? (locked ? ' lock' : ' on') : locked ? ' lock' : ''}`;
      this.launchBtn.className = `a-mini${snipe ? ' stop' : ''}`;
      this.launchBtn.textContent = snipe ? '■' : '▶';
      this.launchBtn.title = snipe ? 'Arrêter le sniper' : 'Lancer le sniper';
      this.snipeDot.className = `a-dot${snipe ? (locked ? ' lock' : ' on') : ''}`;
    }
    statusText() {
      const s = this.sniper;
      const a = this.album;
      const now = Date.now();
      const lockAt = s.guard.lockedUntil();
      if (a.running) {
        const left = a.waitUntil - now;
        const what = a.mode === 'buy' ? 'Achats Galerie' : a.mode === 'scan' ? 'Scan du club' : 'Vérification des prix';
        return `${what} · ${left > 0 ? `${a.waitLabel || 'Prochaine action'} dans ${fmtWait(left)}` : a.activityText || 'en cours…'}`;
      }
      if (s.running && s.task === 'relist') return `Relister · ${s.relistProgress ? `${s.relistProgress.done} / ${s.relistProgress.total} · ` : ''}${s.activity}`;
      if (s.running) {
        if (s.breakUntil) return `Sniper en pause · reprise dans ${fmtClock(s.breakUntil - now)}`;
        return `Sniper · ${s.activity || 'démarrage'}`;
      }
      if (lockAt) return `Pause anti-captcha jusqu'à ${hm(lockAt)}${a.resumeAt || s.on ? ', reprise automatique' : ''}`;
      if (a.resumeAt) return `Achats Galerie : reprise vers ${hm(a.resumeAt)}`;
      return '';
    }
    tick() {
      const txt = this.statusText();
      this.stripText.textContent = txt;
      this.launchSub.textContent = txt || (this.sniper.on ? 'Sniper : reprise imminente' : 'à l’arrêt');
      if (this.isOpen && this.tab === 'snipe') this.renderSnipeLive();
      if (this.isOpen && this.tab === 'gallery' && this.setKey === null && !this.syncing) {
        const at = this.album.gallerySyncAt;
        this.syncBtn.textContent = at ? `↻ Synchronisé ${ago(at)}` : '↻ Non synchronisé';
      }
    }
    renderBody() {
      const top = this.body.scrollTop;
      const tab = this.tab;
      if (tab === 'snipe') {
        this.renderSnipe();
        if (this.body.firstChild !== this.snipeSec) this.body.replaceChildren(this.snipeSec);
      } else if (tab === 'gallery') this.setKey && this.album.sets[this.setKey] ? this.renderSet() : ((this.setKey = null), this.renderHome());
      else if (tab === 'sales') {
        this.renderSales();
        if (this.body.firstChild !== this.salesSec) this.body.replaceChildren(this.salesSec);
      } else if (tab === 'log') {
        if (this.body.firstChild !== this.logSec) this.body.replaceChildren(this.logSec);
      } else {
        this.renderSettings();
        if (this.body.firstChild !== this.settingsSec) this.body.replaceChildren(this.settingsSec);
      }
      if (tab !== 'gallery' || (!this.setKey && !this.homeSel.size)) this.actionbar.classList.add('hidden');
      this.body.scrollTop = top;
    }

    // ================= Sniper =================

    buildSnipeTab() {
      this.sPhase = h('div', { className: 's-phase' });
      this.sSpin = h('div', { className: 's-spin off' });
      this.sTarget = h('div', { className: 's-target' });
      this.sTiles = h('div', { className: 'tiles four' });
      this.sAct = h('div', { className: 's-act' });
      this.sGo = btn('', () => {
        X.unlockAudio();
        this.sniper.running && this.sniper.task === 'snipe' ? this.app.stopSniper() : this.app.startSniper();
      }, 'big go');
      this.sRotate = h('div');
      this.sLog = h('div', { className: 's-log' });
      const control = h('div', { className: 'a-block' }, h('div', { className: 's-status' }, this.sSpin, h('div', { className: 'a-grow' }, this.sPhase, this.sTarget)), this.sTiles, this.sAct, this.sGo, this.sRotate);
      const logBlock = block('Recherches', this.sLog);
      this.sMarket = h('div', { className: 'a-block market', title: 'Voir le calendrier du marché', onclick: () => this.openCalendar() });
      this.sLimits = h('div', { className: 'limits' });
      this.sLock = h('div');
      const limits = block('Limites anti-ban', this.sLimits, this.sLock);

      // Cibles
      this.tList = h('div', { className: 't-list' });
      this.tHint = h('div', { className: 'a-block-hint' });
      const live = btn('+ Filtre de la Web App', () => void this.addLiveFilter(), 'small', { title: 'Copie le filtre réglé dans la recherche du marché de la Web App' });
      this.tClear = h('button', { type: 'button', className: 'a-link', textContent: 'Retirer les cibles Galerie', onclick: () => this.app.clearAlbumTargets() });
      const targets = h(
        'div',
        { className: 'a-block' },
        h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: 'Cibles' }), this.tClear),
        this.tList,
        h('div', { className: 'a-row', style: 'align-items:flex-start' }, this.searchBox(), live),
        this.tHint,
      );
      this.pricesEl = h('div', { className: 'a-block' });
      this.afterEl = h('div', { className: 'a-block' });
      return h('div', { className: 'a-cols' }, h('div', { className: 'a-col' }, control, logBlock), h('div', { className: 'a-col' }, targets, this.pricesEl, this.afterEl, this.sMarket, limits));
    }

    searchBox() {
      const input = h('input', { type: 'search', className: 'a-in', placeholder: 'Ajouter un joueur (nom)' });
      const results = h('div', { className: 'results' });
      let base = null;
      let timer;
      input.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            base ??= await X.loadPlayers();
          } catch (err) {
            this.tHint.textContent = X.errMsg(err);
            return;
          }
          const found = X.findPlayers(base, input.value);
          this.tHint.textContent = input.value.trim() && !found.length ? 'Aucun joueur trouvé' : '';
          results.replaceChildren(
            ...found.map((p) =>
              h('button', {
                type: 'button',
                className: 'result',
                textContent: `${p.rating}  ${p.name}`,
                onclick: () => {
                  results.replaceChildren();
                  input.value = '';
                  this.app.addTarget({ label: `${p.name} ${p.rating}`, defId: p.id, criteria: null });
                },
              }),
            ),
          );
        }, 200);
      };
      const wrap = h('div', {}, input, results);
      wrap.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px;min-width:0';
      return wrap;
    }
    async addLiveFilter() {
      const c = X.liveCriteria();
      if (!c) return void (this.tHint.textContent = 'Ouvre la recherche du marché de la Web App, règle le filtre, puis réessaie.');
      if (X.emptyCriteria(c)) return void (this.tHint.textContent = 'Filtre vide : choisis au moins un joueur, une rareté, une ligue…');
      const parts = [];
      const id = Number(c.maskedDefId) || 0;
      if (id) {
        const p = await X.loadPlayers()
          .then((l) => l.find((x) => x.id === id))
          .catch(() => undefined);
        parts.push(p ? `${p.name} ${p.rating}` : `joueur ${id}`);
      }
      for (const [k, lbl] of Object.entries({ level: 'niveau', league: 'ligue', nation: 'nation', club: 'club', _position: 'poste', playStyle: 'style' })) {
        const v = c[k];
        if (v !== undefined && v !== -1 && v !== 'any' && v !== '-1') parts.push(`${lbl} ${v}`);
      }
      if (Array.isArray(c.rarities) && c.rarities.length) parts.push(`rareté ${c.rarities.join('/')}`);
      this.tHint.textContent = '';
      this.app.addTarget({ label: parts.join(', ') || String(c._type), defId: id || null, criteria: c });
    }

    renderSnipe() {
      if (this.typing(this.snipeSec)) return this.renderSnipeLive();
      const s = this.sniper;
      const cfg = this.cfg;
      const snipe = s.running && s.task === 'snipe';
      const list = this.app.targets();
      const activeIdx = snipe ? s.idx : cfg.activeFilter;
      // Cibles
      this.tList.replaceChildren(
        ...(list.length
          ? list.map((f, i) => {
              const on = i === activeIdx;
              const price = f.buyPrice ? `achat ≤ ${fmt(f.buyPrice)}${f.sellPrice ? ` · vente ${fmt(f.sellPrice)}` : ''}` : f.auto ? 'prix calculés au lancement' : 'prix à renseigner';
              const row = h(
                'div',
                { className: `t-row${on ? ' active' : ''}${snipe ? ' lock' : ''}`, title: snipe ? 'Cible choisie par le sniper (alternance si activée)' : 'Cible de départ' },
                h('span', { className: 'a-radio' }),
                h('span', { className: 'a-row', style: 'gap:6px;min-width:0;flex-wrap:nowrap' }, h('span', { className: 't-n', textContent: f.label }), f.album ? h('span', { className: 'a-pill ac', textContent: 'Galerie' }) : null),
                h('button', { type: 'button', className: 'a-x', textContent: '×', title: snipe && on ? 'Cible en cours' : 'Retirer', disabled: snipe && on, onclick: (ev) => (ev.stopPropagation(), this.app.removeTarget(f.id)) }),
                h('span', { className: 't-p', textContent: price }),
              );
              if (!snipe) row.onclick = () => this.app.setActiveTarget(i);
              return row;
            })
          : [h('div', { className: 'a-empty', textContent: 'Aucune cible. Cherche un joueur, copie le filtre de la Web App, ou ajoute des cartes manquantes depuis l’onglet Galerie (🎯).' })]),
      );
      this.tClear.style.display = list.some((f) => f.album) ? '' : 'none';
      this.tClear.disabled = snipe;
      // Prix de la cible active
      const f = list[activeIdx];
      const ptitle = h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: 'Prix de la cible' }));
      if (!f) this.pricesEl.replaceChildren(ptitle, hint('Choisis une cible.'));
      else {
        ptitle.append(h('span', { className: 'a-block-hint', textContent: 'Automatique' }), toggle(!!f.auto, (v) => this.app.patchTarget(f.id, { auto: v }), snipe));
        const gain = f.buyPrice && f.sellPrice ? profitOf(f.buyPrice, f.sellPrice) : null;
        const line = h('div', { style: 'font-size:.82rem;color:#fff', textContent: f.buyPrice ? `Achat ≤ ${fmt(f.buyPrice)} · Vente ${fmt(f.sellPrice)}${gain === null ? '' : ` · Profit ${fmt(gain)}`}` : 'Prix calculés au lancement' });
        if (f.auto) this.pricesEl.replaceChildren(ptitle, line, hint(`Achat un palier sous la moins chère du marché, baissé jusqu’au profit visé (${cfg.minProfit > 0 ? `${fmt(cfg.minProfit)} min` : '2 % du prix, 150 min'}). Prix revérifiés ${cfg.recheckEvery > 0 ? `toutes les ${cfg.recheckEvery} recherches, ` : ''}toutes les 15 min et après chaque snipe.`));
        else {
          const num = (k) => {
            const i = h('input', { type: 'number', className: 'a-in', min: '0', step: '50', value: String(f[k] || ''), disabled: snipe });
            i.onchange = () => this.app.patchTarget(f.id, { [k]: Math.max(0, Math.floor(Number(i.value) || 0)) });
            return i;
          };
          this.pricesEl.replaceChildren(ptitle, cfg.sellAfterSnipe ? h('div', { className: 'prices' }, 'Achat', num('buyPrice'), 'Vente', num('sellPrice')) : h('div', { className: 'prices' }, 'Achat', num('buyPrice')), line);
        }
      }
      this.sRotate.replaceChildren(
        setting(
          'Alterner les cibles',
          list.length > 1 ? 'Change de cible toutes les 450 à 900 recherches' : 'Ajoute au moins 2 cibles pour alterner',
          toggle(cfg.rotate, (v) => this.app.setConfig({ rotate: v })),
        ),
      );
      // Après un snipe
      const seg = h(
        'div',
        { className: 'a-seg' },
        ...[
          [true, 'Revendre'],
          [false, 'Garder'],
        ].map(([v, l]) => h('button', { type: 'button', className: cfg.sellAfterSnipe === v ? 'active' : '', textContent: l, onclick: () => (this.app.setConfig({ sellAfterSnipe: v }), this.renderSnipe()) })),
      );
      this.afterEl.replaceChildren(
        h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: 'Après un snipe' }), seg),
        hint(cfg.sellAfterSnipe ? 'Remis en vente 1 h au prix calculé, jamais sous le prix d’achat taxe comprise. Invendus remis en vente pendant les pauses.' : 'Gardé en liste de transferts, sans mise en vente.'),
      );
      this.renderSnipeLive();
    }

    renderSnipeLive() {
      const s = this.sniper;
      const cfg = this.cfg;
      const now = Date.now();
      const snipe = s.running && s.task === 'snipe';
      const locked = s.guard.lockedUntil() > 0;
      const f = snipe ? s.filter : this.app.targets()[cfg.activeFilter];
      this.sPhase.textContent = snipe ? (locked ? 'PAUSE ANTI-CAPTCHA' : PHASES[s.phase]) : s.running ? 'RELISTER' : this.album.running ? 'SUSPENDU (GALERIE)' : s.on ? 'REPRISE IMMINENTE' : 'À L’ARRÊT';
      this.sSpin.className = `s-spin${!s.running ? ' off' : s.phase === 'break' || s.phase === 'wait' ? ' pause' : ''}`;
      const rot = snipe && cfg.rotate && s.filters.length > 1 ? ` · changement de cible dans ${Math.max(0, s.rotateAt - s.run.searches)} recherches` : '';
      this.sTarget.replaceChildren(f ? h('span', {}, h('b', { textContent: f.label }), f.buyPrice ? ` · achat ≤ ${fmt(f.buyPrice)} · vente ${fmt(f.sellPrice)}` : '', rot) : 'Aucune cible');
      const c = s.stats.current;
      const pause = s.breakUntil ? `pause encore ${fmtClock(s.breakUntil - now)}` : s.breakAt ? `pause dans ${fmtClock(s.breakAt - now)}` : X.BREAK_PRESETS[cfg.breakPreset]?.every ? '' : 'sans pause';
      const cp = c ? (s.pendingBy((x) => x.sid).get(c.id) ?? { count: 0, expected: 0 }) : null;
      const cms = c ? c.ms + (snipe ? now - s.lastTick : 0) : 0;
      const cTotal = c ? c.realized + cp.expected : 0;
      this.sTiles.replaceChildren(
        tile('Profit de la session', c ? fmtSigned(cTotal) : '—', c ? `réel ${fmtSigned(c.realized)} · ${cp.count} en attente · ${perH(perHour(cTotal, cms))}` : 'aucune session en cours', sign(cTotal)),
        tile('Recherches', fmt(c?.searches ?? 0), snipe ? `${fmt(s.guard.limits().searchesHour)} sur 1 h${c?.snipes ? ` · 1 snipe / ${fmt(Math.round(c.searches / c.snipes))}` : ''}` : ''),
        tile('Snipes', fmt(c?.snipes ?? 0), `${c?.misses ?? 0} raté(s) de peu${rate(c?.snipes ?? 0, c?.misses ?? 0)}`),
        tile('Durée de la session', c ? fmtClock(cms) : '—', pause || (c ? `depuis ${when(c.start)}` : '')),
      );
      this.sAct.textContent = snipe ? s.activity : s.on && !s.running ? 'Le sniper reprend dès la fin de la tâche ou de la pause en cours.' : '';
      this.sGo.textContent = snipe ? 'Arrêter le sniper' : 'Lancer le sniper';
      this.sGo.className = `a-btn big ${snipe ? 'danger' : 'go'}`;
      this.sGo.disabled = s.running && !snipe;
      const log = s.searchLog;
      const keep = this.sLog.scrollTop;
      this.sLog.replaceChildren(...(log.length ? log.slice(0, 60).map((l) => h('div', { textContent: l })) : [h('div', { textContent: 'Aucune recherche pour l’instant' })]));
      this.sLog.scrollTop = keep;
      // Marché
      const m = X.marketNow(now);
      const next = m.next ? ` · marché ${X.MARKET_WORD[m.next.level]} à ${hm(m.next.at)}` : '';
      this.sMarket.className = `a-block market ${m.level}`;
      this.sMarket.replaceChildren(h('span', { className: 'dot' }), h('div', { className: 'a-grow' }, h('div', {}, h('b', { textContent: m.label }), h('span', { className: 'a-block-hint', textContent: ` jusqu’à ${hm(m.until)}` })), hint(`${m.detail}${next}`)));
      // Limites
      const l = s.guard.limits();
      const bar = (v, max, end) => {
        const ratio = Math.min(1, v / max);
        const cls = v >= max ? 'ko' : ratio >= 0.8 ? 'warn' : '';
        return h(
          'div',
          { className: 'lim' },
          h('span', {}, h('b', { textContent: fmt(v) }), ` / ${fmt(max)}`),
          h('div', { className: 'a-bar' }, h('span', { className: cls, style: `width:${ratio * 100}%` })),
          cls && end ? h('small', { textContent: `${v >= max ? 'plein, ' : ''}libre dans ${fmtClock(end - now)}` }) : null,
        );
      };
      this.sLimits.replaceChildren(
        h('span'),
        h('span', { className: 'col', textContent: 'sur 24 h' }),
        h('span', { className: 'col', textContent: 'sur 1 h' }),
        h('span', { textContent: 'Recherches' }),
        bar(l.searchesDay, l.max.searchesDay, l.searchesDayEnd),
        bar(l.searchesHour, l.max.searchesHour, l.searchesHourEnd),
        h('span', { textContent: 'Achats', title: 'Tentatives d’achat, réussies ou ratées' }),
        bar(l.bidsDay, l.max.bidsDay, l.bidsDayEnd),
        bar(l.bidsHour, l.max.bidsHour, l.bidsHourEnd),
      );
      const lockAt = s.guard.lockedUntil();
      this.sLock.replaceChildren(
        lockAt
          ? h(
              'div',
              { className: 'a-block lockbox' },
              h('div', { textContent: `Pause anti-captcha jusqu’à ${hm(lockAt)} (encore ${fmtClock(lockAt - now)}), reprise automatique.` }),
              hint('Si EA affiche un captcha, résous-le dans la Web App avant la fin de la pause.'),
            )
          : '',
      );
    }

    openCalendar() {
      const { rows, offset } = X.marketCalendar();
      const sign = offset >= 0 ? '+' : '−';
      const abs = Math.abs(offset);
      const zone = offset ? `Londres ${sign} ${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60}` : ''}` : 'heure de Londres';
      const key = (cls, t) => h('span', {}, h('i', { className: cls }), t);
      this.calInner.replaceChildren(
        h('div', { className: 'a-row' }, h('b', { className: 'a-grow', style: 'color:#fff;font-size:1.1rem', textContent: 'Activité du marché' }), h('button', { type: 'button', className: 'a-x', textContent: '×', onclick: () => this.calLayer.classList.remove('open') })),
        h('div', { className: 'key' }, key('inactive', 'Calme'), key('semi', 'Moyen'), key('active', 'Actif'), h('span', { textContent: `· heures locales (${zone})` })),
        h(
          'table',
          {},
          h('tr', {}, h('th', { className: 'h' }), ...['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map((d) => h('th', { textContent: d }))),
          ...rows.map((r) => h('tr', {}, h('th', { className: 'h', textContent: r.label }), ...r.cells.map((c) => h('td', { className: `${c.level}${c.now ? ' now' : ''}`, textContent: c.text })))),
        ),
        hint(X.MARKET_TIP),
      );
      this.calLayer.classList.add('open');
    }

    // ================= Galerie =================

    openSet(key) {
      this.setKey = key;
      this.page = 0;
      this.text = '';
      this.tab = 'gallery';
      this.body.scrollTop = 0;
      this.renderAll();
      if (key) {
        const s = this.album.sets[key];
        const stale = !s?.syncedAt || Date.now() - s.syncedAt > 5 * 6e4 || Object.values(s.players ?? {}).some((p) => !this.album.itemData.has(p.defId));
        if (stale && !this.album.running && !this.synced.get(key)) void this.syncCurrent();
      }
    }
    async refreshCoins() {
      if (this.coinsBtn.disabled) return;
      this.coinsBtn.disabled = true;
      try {
        await X.refreshCoins();
      } catch {}
      this.coinsBtn.disabled = false;
      this.update();
    }
    async syncCurrent() {
      const key = this.setKey;
      if (this.album.running) return this.album.log('Lecture de la Galerie EA : attendre la fin de la tâche en cours');
      this.synced.set(key ?? '*', true);
      this.syncing = true;
      this.renderHead();
      await this.album.syncGallery(key ? [key] : undefined);
      this.syncing = false;
      this.synced.set(key ?? '*', false);
      this.renderAll();
    }
    renderHome() {
      if (!this.homeWrap) {
        this.homeSearch = h('input', { type: 'search', className: 'a-in', placeholder: 'Rechercher un set ou un joueur', style: 'flex:1;min-width:200px' });
        this.homeSearch.oninput = () => {
          this.homeText = norm(this.homeSearch.value.trim());
          this.renderHomeContent();
        };
        this.homeSeg = h('div', { className: 'a-tabs' });
        this.homePickAll = h('button', { type: 'button', className: 'a-link' });
        this.homeContent = h('div', { className: 'a-sec', style: 'max-width:none' });
        this.homeWrap = h('div', {}, h('div', { className: 'a-ctl' }, this.homeSeg, this.homeSearch, this.homePickAll), this.homeContent);
      }
      if (this.body.firstChild !== this.homeWrap) this.body.replaceChildren(this.homeWrap);
      this.renderHomeContent();
    }
    renderHomeContent() {
      const a = this.album;
      const t = this.homeText;
      const targets = new Set(this.app.targets().filter((f) => f.album).map((f) => f.defId));
      const info = a.setList().map((s) => {
        const all = a.setPlayers(s);
        const pr = a.progress(s);
        // missing : joueurs listés à acheter pour combler les places libres (vide si le set est rempli)
        const missing = pr.have < pr.slots ? all.filter((p) => !p.collected) : [];
        return { s, all, pr, missing, hits: t ? all.filter((p) => norm(p.name).includes(t)) : [], nameHit: !t || norm(s.name).includes(t) };
      });
      // Sets complétés ou retirés : plus cochables
      const byKey = new Map(info.map((x) => [x.s.key, x]));
      for (const k of [...this.homeSel]) if (!byKey.get(k)?.missing.length || !a.toFinish(byKey.get(k).s).length) this.homeSel.delete(k);
      const counts = { all: info.length, todo: info.filter((x) => x.missing.length).length, done: info.filter((x) => !x.missing.length).length };
      this.homeSeg.replaceChildren(
        ...[
          ['all', 'Tous'],
          ['todo', 'Incomplets'],
          ['done', 'Complets'],
        ].map(([id, label]) => h('button', { type: 'button', className: this.homeFilter === id ? 'active' : '', textContent: `${label} ${counts[id]}`, onclick: () => ((this.homeFilter = id), this.renderHomeContent()) })),
      );
      const shown = info.filter((x) => (this.homeFilter === 'all' || (this.homeFilter === 'todo') === x.missing.length > 0) && (x.nameHit || x.hits.length));
      const pickable = shown.filter((x) => x.missing.length);
      const allPicked = pickable.length > 0 && pickable.every((x) => this.homeSel.has(x.s.key));
      this.homePickAll.textContent = allPicked ? 'Décocher les sets affichés' : `Cocher les ${pickable.length} set(s) incomplet(s) affiché(s)`;
      this.homePickAll.disabled = !pickable.length;
      this.homePickAll.onclick = () => {
        for (const x of pickable) allPicked ? this.homeSel.delete(x.s.key) : this.homeSel.add(x.s.key);
        this.renderHomeContent();
      };
      const tiles = shown.map(({ s, all, pr, missing, hits }) => {
        const got = pr.have;
        const left = a.toFinish(s).reduce((n, p) => n + (p.minPrice || 0), 0);
        const sel = missing.filter((p) => a.isSelected(p.defId)).length;
        const tg = missing.filter((p) => targets.has(p.defId)).length;
        const picked = this.homeSel.has(s.key);
        return h(
          'div',
          { className: `a-tile${picked ? ' picked' : ''}`, onclick: () => this.openSet(s.key) },
          h(
            'div',
            { className: 'a-tile-top' },
            missing.length
              ? h('span', {
                  className: `a-check${picked ? ' on' : ''}`,
                  textContent: '✓',
                  title: picked ? 'Retirer de la sélection de sets' : 'Cocher pour faire plusieurs sets d’un coup',
                  onclick: (ev) => {
                    ev.stopPropagation();
                    picked ? this.homeSel.delete(s.key) : this.homeSel.add(s.key);
                    this.renderHomeContent();
                  },
                })
              : null,
            h('span', { className: 'a-tile-name', textContent: s.name, title: s.name }),
            s.url ? h('button', { type: 'button', className: 'a-x', textContent: '↗', title: 'Ouvrir sur fut.gg (renvoyer pour mettre à jour)', onclick: (ev) => (ev.stopPropagation(), window.open(s.url, '_blank', 'noopener')) }) : null,
            h('button', { type: 'button', className: 'a-x', textContent: '×', title: 'Retirer le set', disabled: a.running, onclick: (ev) => (ev.stopPropagation(), confirm(`Retirer le set « ${s.name} » ?`) && a.removeSet(s.key)) }),
          ),
          h(
            'div',
            { className: 'a-tile-stats' },
            h('span', { textContent: `${pr.slots} places${s.needed ? '' : ' ?'}`, title: s.needed ? 'Joueurs requis lus sur fut.gg' : 'Nombre de joueurs requis non lu sur fut.gg : taille de la liste fut.gg (« ↻ Réimporter » pour relire)' }),
            gradePill(a.gradeOf(s)),
            pr.crit ? h('span', { className: 'a-pill', title: 'Critère déduit des joueurs listés par fut.gg : tout joueur de ta collection qui le remplit compte', textContent: `${X.CRIT_LABEL[pr.crit.k]} · ${fmt(pr.owned.size)} à toi` }) : h('span', { className: 'a-pill', title: 'Critère non reconnu : seuls les joueurs listés par fut.gg comptent', textContent: 'liste fut.gg' }),
            left ? h('span', { textContent: `manquants ~${fmt(left)} crédits` }) : null,
            hits.length ? h('span', { className: 'a-pill ac', textContent: `${hits.length} joueur(s) trouvé(s)` }) : null,
            sel ? h('span', { className: 'a-pill ac', textContent: `${sel} sélectionné(s)` }) : null,
            tg ? h('span', { className: 'a-pill', style: 'color:var(--warn);border-color:rgba(255,179,71,.4)', textContent: `🎯 ${tg} ciblé(s)` }) : null,
          ),
          h('div', { className: 'a-bar' }, h('span', { style: `width:${pr.slots ? (got / pr.slots) * 100 : 0}%` })),
          h('div', { className: 'a-tile-foot' }, h('span', { style: 'color:#dfe4ec;font-weight:400', textContent: `Remplies ${got} / ${pr.slots}` }), h('span', { textContent: 'Voir les joueurs →' })),
        );
      });
      const c = a.catalog;
      const extra = t
        ? []
        : [
            h(
              'div',
              { className: 'a-tile add', onclick: () => window.open(FUTGG_GALLERY, '_blank', 'noopener') },
              h('b', { textContent: '+ Importer un set fut.gg' }),
              hint(`Ouvre un set de la Galerie sur fut.gg, puis clique « Envoyer à ${X.APP} ».`),
            ),
            h(
              'div',
              { className: 'a-tile add', title: 'Lit tous les sets de la Galerie sur fut.gg (sets retirés à la main exclus)', onclick: () => a.requestCatalog(true) },
              h('b', { textContent: c.busy ? 'Catalogue fut.gg…' : '↻ Réimporter tous les sets fut.gg' }),
              hint(c.busy ? c.text : `${c.at ? `Catalogue lu ${ago(c.at)}` : 'Catalogue jamais lu'}${this.cfg.autoCatalog ? ' · relu à l’ouverture (toutes les 6 h)' : ''}`),
            ),
          ];
      const intro = info.length
        ? null
        : h(
            'div',
            { className: 'a-empty' },
            h('b', { style: 'color:#fff', textContent: 'Aucun set importé.' }),
            h(
              'ol',
              {},
              h('li', { textContent: 'Les sets de la Galerie fut.gg sont importés à l’ouverture (ou « ↻ Réimporter »), ou un par un avec « + Importer un set fut.gg ».' }),
              h('li', { textContent: '« Scanner le club » : joueurs présents au club et passés (Galerie EA), puis sets proposés selon le solde.' }),
              h('li', { textContent: 'Coche les sets puis « Faire les sets » : les cartes manquantes sont achetées au prix du marché, set par set. Ou « Sniper » (sous le prix du marché, revente avec profit).' }),
            ),
          );
      const top = this.body.scrollTop;
      this.homeContent.replaceChildren(
        ...[
          t.length >= 2 ? this.playerHits(info) : null,
          !t && info.length ? this.levelBlock() : null,
          !t && info.length ? this.proposalBlock() : null,
          tiles.length || extra.length ? h('div', { className: 'a-grid' }, ...tiles, ...extra) : h('div', { className: 'a-empty', textContent: 'Aucun set ne correspond.' }),
          intro,
        ].filter(Boolean),
      );
      this.body.scrollTop = top;
      this.renderHomeActionbar();
    }
    // Joueurs trouvés dans tous les sets : un clic sélectionne une carte manquante, ↗ ouvre son set
    playerHits(info) {
      const a = this.album;
      const seen = new Map();
      for (const { s, hits } of info) for (const p of hits) if (!seen.has(p.defId)) seen.set(p.defId, { p, sets: [s] });
      else seen.get(p.defId).sets.push(s);
      const list = [...seen.values()].sort((x, y) => Number(x.p.collected) - Number(y.p.collected) || (y.p.rating || 0) - (x.p.rating || 0));
      if (!list.length) return block('Joueurs', h('div', { className: 'a-empty', textContent: 'Aucun joueur ne correspond.' }));
      const rows = list.slice(0, 60).map(({ p, sets }) => {
        const sel = !p.collected && a.isSelected(p.defId);
        const price = Number(a.selection[p.defId]) || p.minPrice || 0;
        const row = h(
          'div',
          { className: `a-hit${p.collected || a.running ? '' : ' pick'}`, title: sets.map((x) => x.name).join(', ') },
          p.collected ? h('span', { className: 'ok', textContent: '✓' }) : h('span', { className: `a-check${sel ? ' on' : ''}`, textContent: '✓' }),
          h('span', { className: 'n' }, p.rating ? h('i', { textContent: String(p.rating) }) : null, p.name, h('span', { className: 'm', textContent: ` · ${sets[0].name}${sets.length > 1 ? ` +${sets.length - 1}` : ''}` })),
          h('span', { className: `m${p.collected ? ' ok' : sel ? ' ac' : ''}`, textContent: p.collected ? 'Collecté' : price ? `${fmt(price)} crédits` : 'sans prix' }),
          h('button', { type: 'button', className: 'a-x', textContent: '↗', title: 'Ouvrir le set', onclick: (ev) => (ev.stopPropagation(), this.openSet(sets[0].key)) }),
        );
        if (!p.collected && !a.running)
          row.onclick = () => {
            a.setSelected(p.defId, !sel);
            a.touch();
            this.renderHomeContent();
          };
        return row;
      });
      return block(`Joueurs (${list.length}${list.length > 60 ? ', 60 premiers' : ''})`, hint('Touche un joueur manquant pour le sélectionner ; il est acheté ou snipé avec les sets cochés ou depuis son set.'), h('div', { className: 'a-hits' }, ...rows));
    }
    // Sets à faire : coût pour finir chaque set incomplet, sets proposés (les moins chers qui tiennent ensemble dans le solde)
    proposalBlock() {
      const a = this.album;
      const coins = X.coins();
      const prop = a.proposedSets();
      const rank = new Map(prop.map((x, i) => [x.key, i]));
      const rows = a
        .setList()
        .map((s) => {
          const cards = a.toFinish(s);
          return { s, cards, spend: cards.reduce((t, p) => t + a.priceOf(p), 0), unpriced: cards.filter((p) => !a.priceOf(p)).length };
        })
        .filter((x) => x.cards.length)
        .sort((x, y) => (rank.get(x.s.key) ?? Infinity) - (rank.get(y.s.key) ?? Infinity) || x.unpriced - y.unpriced || x.spend - y.spend);
      const scan = btn(a.mode === 'scan' ? 'Scan en cours…' : '⟳ Scanner le club', () => void this.scanClub(), 'small primary', {
        disabled: a.running,
        title: 'Lit les joueurs présents au club, puis le statut « collecté » de tous les joueurs du jeu chez EA (joueurs passés au club, 200 par page, quelques minutes), et propose les sets faisables avec le solde. Le sniper est suspendu pendant le scan.',
      });
      const diag = h('button', { type: 'button', className: 'a-link', textContent: 'Copier le diagnostic', title: 'Copie dans le presse-papiers ce que l’extension lit chez EA (Galerie, club, statut collecté), pour corriger la synchro', onclick: () => void this.copyDiag(diag) });
      const head = h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: `Sets à faire (${rows.length})` }), diag, scan);
      const spend = prop.reduce((t, x) => t + x.spend, 0);
      const info = hint(
        `${a.clubAt ? `Club scanné ${ago(a.clubAt)} (${fmt(a.clubIds.size)} joueurs)` : 'Club jamais scanné'} · collection connue ${fmt(a.coll.size)} joueur(s) · ${
          coins === null ? 'solde inconnu' : `${prop.length} set(s) faisable(s) avec ${fmt(coins)} crédits${prop.length ? ` (~${fmt(spend)})` : ''}`
        }`,
      );
      if (!rows.length) return h('div', { className: 'a-block' }, head, info, h('div', { className: 'a-empty', textContent: 'Tous les sets importés sont complets.' }));
      const allProp = prop.length > 0 && prop.every((x) => this.homeSel.has(x.key));
      const pick = h('button', {
        type: 'button',
        className: 'a-link',
        textContent: allProp ? 'Sets proposés cochés' : `Cocher les ${prop.length} set(s) proposé(s)`,
        disabled: !prop.length || allProp || a.running,
        onclick: () => {
          this.homeSel = new Set(prop.map((x) => x.key));
          this.renderHomeContent();
        },
      });
      const shown = this.propAll ? rows : rows.slice(0, 10);
      const list = shown.map(({ s, cards, spend: v, unpriced }) => {
        const on = this.homeSel.has(s.key);
        const ok = rank.has(s.key);
        const pr = a.progress(s);
        const req = ` · ${pr.have} / ${pr.slots} places`;
        return h(
          'div',
          {
            className: `a-hit${a.running ? '' : ' pick'}`,
            title: cards.map((p) => `${p.name}${a.priceOf(p) ? ` · ${fmt(a.priceOf(p))}` : ' · sans prix'}`).join('\n'),
            onclick: () => {
              if (a.running) return;
              on ? this.homeSel.delete(s.key) : this.homeSel.add(s.key);
              this.renderHomeContent();
            },
          },
          h('span', { className: `a-check${on ? ' on' : ''}`, textContent: '✓' }),
          h('span', { className: 'n' }, s.name, h('span', { className: 'm', textContent: ` · ${cards.length} carte(s) à acheter${req}` })),
          h('span', {
            className: `m ${ok ? 'ok' : unpriced || (coins !== null && v > coins) ? 'warn' : ''}`,
            textContent: `${v ? `~${fmt(v)}` : ''}${unpriced ? `${v ? ' + ' : ''}${unpriced} sans prix` : ''}${ok ? ' · proposé' : coins !== null && v > coins ? ' · au-delà du solde' : ''}`,
          }),
          h('button', { type: 'button', className: 'a-x', textContent: '↗', title: 'Voir les joueurs du set', onclick: (ev) => (ev.stopPropagation(), this.openSet(s.key)) }),
        );
      });
      const more =
        rows.length > 10
          ? h('button', { type: 'button', className: 'a-link', textContent: this.propAll ? 'Réduire' : `Voir les ${rows.length} sets`, onclick: () => ((this.propAll = !this.propAll), this.renderHomeContent()) })
          : null;
      return h(
        'div',
        { className: 'a-block' },
        head,
        info,
        hint('Proposés : les sets les moins chers à finir qui tiennent ensemble dans le solde (joueur commun à plusieurs sets acheté une fois). Coche les sets puis « Faire les sets » : les cartes manquantes sont achetées au prix du marché, set par set, du moins cher au plus cher.'),
        h('div', { className: 'a-row' }, pick, h('span', { className: 'a-grow' }), more),
        h('div', { className: 'a-hits', style: 'max-height:none' }, ...list),
      );
    }
    // Objectif niveau Galerie : cartes qui rapportent le plus de points estimés par crédit, jusqu'au score visé
    levelPlan() {
      const a = this.album;
      const cfg = this.cfg;
      const est = a.estimatedScore();
      const live = X.galleryLive?.score || 0;
      const current = cfg.levelScore || live || est;
      const need = Math.max(0, cfg.levelTarget - current);
      const coins = X.coins();
      const budget = cfg.levelBudget || coins || 0;
      return { est, live, current, need, budget, coins, plan: need && budget ? a.planLevel(need, budget) : { picks: [], spend: 0, gain: 0, cost: 0, candidates: 0 } };
    }
    levelBlock() {
      const a = this.album;
      const cfg = this.cfg;
      const L = this.levelPlan();
      const { plan } = L;
      const num = (key, value, placeholder, title) => {
        const i = h('input', { type: 'number', className: 'a-in', min: '0', step: '1000', value: value ? String(value) : '', placeholder, title, style: 'width:130px;text-align:right' });
        i.onchange = () => {
          this.app.setConfig({ [key]: Math.max(0, Math.floor(Number(i.value) || 0)) });
          this.renderHomeContent();
        };
        return i;
      };
      const field = (label, input) => h('label', { className: 'a-row', style: 'gap:.4rem;font-size:.75rem;color:var(--dim)' }, label, input);
      const inputs = h(
        'div',
        { className: 'a-row', style: 'gap:.5rem 1rem' },
        field('Score actuel', num('levelScore', cfg.levelScore, fmt(L.live || L.est), 'Score Galerie affiché dans le jeu. Vide : score lu dans la Web App, sinon estimé.')),
        field('Objectif', num('levelTarget', cfg.levelTarget, '3000000', 'Niveau 10 : ~3 000 000 points (estimation des joueurs, EA n’a pas publié le barème)')),
        field('Budget', num('levelBudget', cfg.levelBudget, L.coins == null ? 'solde' : fmt(L.coins), 'Crédits engagés au plus. Vide : le solde.')),
      );
      const src = cfg.levelScore ? 'saisi' : L.live ? 'lu dans la Web App, à vérifier' : 'estimé sur les sets importés, sans bonus de tags';
      const pct = L.need ? Math.min(100, Math.round((100 * plan.gain) / L.need)) : 100;
      const reach = L.need && plan.gain >= L.need;
      const keep = cfg.afterBuy === 'keep';
      const status = !L.need
        ? h('div', { className: 'a-block-hint', style: 'color:var(--ok)', textContent: `Objectif atteint (${fmt(L.current)} points, ${src}).` })
        : h(
            'div',
            { className: 'a-proj' },
            h('span', {}, 'Manque ', h('b', { textContent: fmt(L.need) }), ` (score ${fmt(L.current)}, ${src})`),
            plan.picks.length ? h('span', {}, `plan ${plan.picks.length} carte(s) · `, h('b', { textContent: `+${fmt(plan.gain)}` }), ` points (${pct} %)`) : null,
            plan.picks.length ? h('span', {}, 'engagés ', h('b', { textContent: `~${fmt(plan.spend)}` })) : null,
            plan.picks.length ? h('span', {}, `coût réel${keep ? ' (club)' : ''} `, h('b', { className: 'neg', textContent: `~${fmt(plan.cost)}` })) : null,
            plan.picks.length && !reach ? h('span', { className: 'warn', textContent: 'budget insuffisant : relancer après les ventes' }) : null,
          );
      const shown = this.levelAll ? plan.picks : plan.picks.slice(0, 8);
      const rows = shown.map(({ p, price, gain, keys }) =>
        h(
          'div',
          { className: 'a-hit', title: keys.map((k) => a.sets[k]?.name).filter(Boolean).join('\n') },
          h('span', { className: 'ac', textContent: `+${fmt(gain)}` }),
          h('span', { className: 'n' }, p.rating ? h('i', { textContent: String(p.rating) }) : null, p.name, h('span', { className: 'm', textContent: ` · ${keys.length} set(s)` })),
          h('span', { className: 'm', textContent: `${fmt(price)} · ${fmt(Math.round((gain / price) * 1e3))} pts / 1k` }),
          h('button', { type: 'button', className: 'a-x', textContent: '↗', title: 'Ouvrir le set', onclick: () => this.openSet(keys[0]) }),
        ),
      );
      const more = plan.picks.length > 8 ? h('button', { type: 'button', className: 'a-link', textContent: this.levelAll ? 'Réduire' : `Voir les ${plan.picks.length} cartes`, onclick: () => ((this.levelAll = !this.levelAll), this.renderHomeContent()) }) : null;
      const go = btn(a.mode === 'buy' ? 'Achats en cours…' : `Acheter le plan (${plan.picks.length})`, () => void this.runLevel(), 'small primary', {
        disabled: !plan.picks.length || a.running,
        title: 'Achète au prix du marché les cartes du plan, de la plus rentable à la moins rentable, puis les traite selon « Après achat ». Le sniper est suspendu pendant les achats puis reprend.',
      });
      const snipe = btn(`🎯 Sniper le plan`, () => this.app.snipeSelection(plan.picks.map((x) => x.p.defId)), 'small', { disabled: !plan.picks.length, title: 'Les cartes du plan deviennent des cibles du sniper : achat sous le prix du marché, plus lent' });
      return h(
        'div',
        { className: 'a-block' },
        h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: 'Objectif niveau Galerie' }), snipe, go),
        inputs,
        status,
        rows.length ? h('div', { className: 'a-hits', style: 'max-height:none' }, ...rows) : null,
        more,
        hint(
          'Points estimés : barème des joueurs (or 75 = 90 … 85 = 2 100, 90 = 14 000, 99 = 100 000 ; argent 35 ; bronze 20), non publié par EA. Une carte compte dans chaque set importé où elle entre ou remplace une carte plus faible. Une carte achetée n’a pas le tag First Owner et les bonus de tags ne sont pas comptés. Après les achats, placer les cartes dans les sets du jeu (remplissage automatique de chaque set) : le score reste acquis même après la revente.',
        ),
      );
    }
    async runLevel() {
      const a = this.album;
      if (a.running) return;
      const { plan, coins } = this.levelPlan();
      if (!plan.picks.length) return;
      if (coins !== null && plan.spend > coins && !confirm(`Solde ${fmt(coins)} pour ~${fmt(plan.spend)} crédits engagés. Les cartes les plus rentables passent d’abord ; ensuite les achats attendent les ventes en cours, ou s’arrêtent faute de crédits. Lancer ?`)) return;
      const ids = plan.picks.map((x) => x.p.defId);
      this.openBuy([...new Set(plan.picks.flatMap((x) => x.keys))]);
      await this.runBuy(ids, () => a.buyLevel(plan.picks));
    }
    async copyDiag(el) {
      const a = this.album;
      const sets = a.setList();
      const withAttrs = [...a.coll.values()].filter((x) => x.l || x.c || x.n).length;
      const first = [...a.itemData.values()][0];
      const out = {
        version: X.VERSION,
        at: new Date().toISOString(),
        sets: sets.length,
        collection: { total: a.coll.size, withAttrs, club: a.clubIds.size, clubAt: a.clubAt, done: a.done.size },
        netCollected: [...X.netItems.values()].filter((x) => x.collected).length,
        galleryLive: X.galleryLive,
        defidSample: first ? { keys: Object.keys(first), item: first } : null,
        clubSample: a.clubSample ?? null,
        setsSample: sets.slice(0, 40).map((s) => {
          const pr = a.progress(s);
          return { name: s.name, url: s.url, needed: s.needed, listed: Object.keys(s.players ?? {}).length, crit: pr.crit ? { k: pr.crit.k, v: [...pr.crit.v], tier: pr.crit.tier } : null, owned: pr.owned.size, slots: pr.slots };
        }),
        galleryResponses: X.galleryDiag,
      };
      const ok = await copyText(JSON.stringify(out, null, 1));
      el.textContent = ok ? 'Diagnostic copié' : 'Copie impossible';
      setTimeout(() => (el.textContent = 'Copier le diagnostic'), 3e3);
    }
    async scanClub() {
      const a = this.album;
      if (a.running) return;
      if (await a.scanClub()) this.homeSel = new Set(a.proposedSets().map((x) => x.key));
      this.renderAll();
    }
    // Sets cochés : cartes à acheter pour les finir, achat direct lancé tout de suite (progression dans la fenêtre d'achat)
    async completeSets(keys) {
      const a = this.album;
      if (a.running) return;
      const plan = a.planSets(keys);
      const ids = plan.flatMap((x) => x.cards.map((p) => p.defId));
      if (!ids.length) return a.log('Sets cochés déjà complets : rien à acheter');
      const spend = plan.reduce((t, x) => t + x.spend, 0);
      const c = X.coins();
      if (c !== null && spend > c && !confirm(`Solde ${fmt(c)} pour ~${fmt(spend)} crédits nécessaires. Les sets les moins chers passent d’abord ; ensuite les achats attendent les ventes en cours, ou s’arrêtent faute de crédits. Lancer ?`)) return;
      this.homeSel.clear();
      const order = plan.map((x) => x.key);
      this.openBuy(order);
      await this.runBuy(ids, () => a.completeSets(order));
    }
    // Plusieurs sets cochés : cartes à acheter pour les finir, en un clic (ou sniper)
    renderHomeActionbar() {
      const a = this.album;
      const keys = [...this.homeSel];
      if (!keys.length) return this.actionbar.classList.add('hidden');
      const plan = a.planSets(keys);
      const ids = plan.flatMap((x) => x.cards.map((p) => p.defId));
      const sum = (f) => plan.reduce((t, x) => t + f(x), 0);
      const spend = sum((x) => x.spend);
      const cost = sum((x) => x.cost);
      const unpriced = sum((x) => x.unpriced);
      const c = X.coins();
      const over = c !== null && spend > c;
      const keep = this.cfg.afterBuy === 'keep';
      this.actionbar.classList.remove('hidden');
      this.actionbar.replaceChildren(
        h(
          'div',
          { className: 'a-row a-grow' },
          h('span', { className: 'a-count', textContent: `${keys.length} set(s) coché(s)` }),
          h(
            'span',
            { className: 'a-proj' },
            h('span', {}, `${ids.length} carte(s) · achat `, h('b', { textContent: `~${fmt(spend)}` })),
            h('span', {}, `coût réel${keep ? ' (club)' : ''} `, h('b', { className: cost > 0 ? 'neg' : 'pos', textContent: cost < 0 ? `+${fmt(-cost)}` : `~${fmt(cost)}` })),
            unpriced ? h('span', { className: 'dim', textContent: `+ ${unpriced} sans prix` }) : null,
            over ? h('span', { className: 'warn', textContent: `solde ${fmt(c)} insuffisant` }) : null,
          ),
        ),
        h(
          'div',
          { className: 'a-row' },
          btn('Décocher', () => (this.homeSel.clear(), this.renderHomeContent(), this.actionbar.classList.add('hidden')), 'ghost'),
          btn(`🎯 Sniper (${ids.length})`, () => (this.homeSel.clear(), this.app.snipeSelection(ids)), '', {
            disabled: !ids.length,
            title: 'Les cartes à acheter des sets cochés deviennent des cibles du sniper (alternance) : achat sous le prix du marché, revente avec profit.',
          }),
          btn('Ajuster…', () => {
            for (const id of ids) a.setSelected(id, true);
            this.openBuy(plan.map((x) => x.key));
          }, '', { disabled: !ids.length || a.running, title: 'Ouvre la fenêtre d’achat : prix de départ, cartes, écart max, après achat' }),
          btn(a.mode === 'buy' ? 'Achats en cours…' : `Faire ${keys.length > 1 ? `les ${keys.length} sets` : 'le set'}`, () => void this.completeSets(keys), 'primary', {
            disabled: !ids.length || a.running,
            title: 'Achète au prix du marché les cartes qui manquent pour finir les sets cochés, set par set du moins cher au plus cher, puis les traite selon « Après achat ». Le sniper est suspendu pendant les achats puis reprend.',
          }),
        ),
      );
    }
    renderSet() {
      const a = this.album;
      const set = a.sets[this.setKey];
      const all = a.setPlayers(set);
      const queue = new Map(a.queue.map((q) => [q.defId, q]));
      const lists = { all, collected: all.filter((p) => p.collected), missing: all.filter((p) => !p.collected) };
      const tabs = h(
        'div',
        { className: 'a-tabs' },
        ...[
          ['all', 'Tous'],
          ['collected', 'Collectés'],
          ['missing', 'Manquants'],
        ].map(([id, label]) => h('button', { type: 'button', className: this.filter === id ? 'active' : '', textContent: `${label} ${lists[id].length}`, onclick: () => ((this.filter = id), (this.page = 0), this.renderBody()) })),
      );
      const search = h('input', { type: 'search', className: 'a-in', placeholder: 'Rechercher un joueur', value: this.text });
      search.oninput = () => {
        this.text = norm(search.value.trim());
        this.page = 0;
        this.renderGrid(lists, queue);
      };
      const selAll = btn('Tout sélectionner', () => {
        for (const p of lists.missing) if (!a.isSelected(p.defId)) a.setSelected(p.defId, true);
        this.renderBody();
      }, 'small ghost', { disabled: a.running });
      this.gridWrap = h('div');
      this.body.replaceChildren(h('div', { className: 'a-ctl' }, tabs, search, h('span', { className: 'a-grow' }), selAll), this.gridWrap);
      this.renderGrid(lists, queue);
      this.renderActionbar(set);
    }
    renderGrid(lists, queue) {
      const a = this.album;
      const t = this.text;
      const list = lists[this.filter].filter((p) => !t || norm(p.name).includes(t));
      const pages = Math.max(1, Math.ceil(list.length / PAGE_CARDS));
      this.page = Math.min(this.page, pages - 1);
      const shown = list.slice(this.page * PAGE_CARDS, (this.page + 1) * PAGE_CARDS);
      const targets = new Set(this.app.targets().filter((f) => f.album).map((f) => f.defId));
      const cards = shown.map((p) => {
        const sel = !p.collected && a.isSelected(p.defId);
        const selectable = !p.collected && !a.running;
        const q = queue.get(p.defId);
        const card = h('div', { className: 'a-card' });
        card.append(cardElement(p.defId, a.itemData.get(p.defId)) ?? h('div', { className: 'a-fallback', textContent: p.rating ? String(p.rating) : '?' }));
        const price = Number(a.selection[p.defId]) || p.minPrice || 0;
        const st = q && (!p.collected || q.price) ? rowStatus(q) : null;
        const tg = targets.has(p.defId);
        const node = h(
          'div',
          { className: `a-player${p.collected ? ' is-collected' : ''}${selectable ? ' is-selectable' : ''}${sel ? ' is-selected' : ''}` },
          p.collected ? h('span', { className: 'a-got', textContent: '✓', title: 'Collecté' }) : h('span', { className: `a-pick${sel ? ' on' : ''}`, textContent: '✓' }),
          tg && !p.collected ? h('span', { className: 'a-tgt', textContent: '🎯', title: 'Cible du sniper' }) : null,
          card,
          h('div', { className: 'a-pname', textContent: p.name, title: p.name }),
          h('div', { className: 'a-price', textContent: p.collected ? 'Collecté' : price ? `${fmt(price)} crédits${a.selection[p.defId] && Number(a.selection[p.defId]) !== p.minPrice ? '' : ' · fut.gg'}` : 'sans prix' }),
          st ? h('div', { className: `a-pstate ${st[1]}`, textContent: st[0] }) : null,
          !p.collected
            ? h('button', {
                type: 'button',
                className: `a-pbtn${tg ? ' on' : ''}`,
                textContent: tg ? '🎯 Ciblé' : '🎯 Sniper',
                title: tg ? 'Retirer des cibles du sniper' : 'Ajouter aux cibles du sniper : achat sous le prix du marché, revente avec profit',
                onclick: (ev) => {
                  ev.stopPropagation();
                  tg ? this.app.removeAlbumTarget(p.defId) : this.app.addAlbumTargets([p.defId]);
                  this.renderGrid(lists, queue);
                },
              })
            : null,
        );
        if (selectable)
          node.onclick = () => {
            a.setSelected(p.defId, !a.isSelected(p.defId));
            this.renderGrid(lists, queue);
            this.renderActionbar(a.sets[this.setKey]);
          };
        return node;
      });
      const pager =
        pages > 1
          ? h(
              'div',
              { className: 'a-pager' },
              btn('‹', () => ((this.page = Math.max(0, this.page - 1)), this.renderGrid(lists, queue)), 'small', { disabled: this.page === 0 }),
              h('span', { textContent: `Page ${this.page + 1} sur ${pages}` }),
              btn('›', () => ((this.page = Math.min(pages - 1, this.page + 1)), this.renderGrid(lists, queue)), 'small', { disabled: this.page >= pages - 1 }),
            )
          : null;
      this.gridWrap.replaceChildren(cards.length ? h('div', { className: 'a-players' }, ...cards) : h('div', { className: 'a-empty', textContent: 'Aucun joueur ici.' }), pager ?? '');
    }
    selectedOf(set) {
      return this.album.setPlayers(set).filter((p) => !p.collected && this.album.isSelected(p.defId));
    }
    // Barre du bas : deux façons de remplir la sélection
    renderActionbar(set) {
      const a = this.album;
      const sel = this.selectedOf(set);
      const pk = a.picks(sel.map((p) => String(p.defId)));
      this.actionbar.classList.remove('hidden');
      const keep = this.cfg.afterBuy === 'keep';
      const proj = sel.length
        ? h(
            'div',
            { className: 'a-proj' },
            h('span', {}, 'Achat direct ', h('b', { textContent: `~${fmt(pk.spend)}` })),
            h('span', {}, `coût réel${keep ? ' (club)' : ''} `, h('b', { className: pk.cost > 0 ? 'neg' : 'pos', textContent: pk.cost < 0 ? `+${fmt(-pk.cost)}` : `~${fmt(pk.cost)}` })),
            pk.unpriced.length ? h('span', { className: 'dim', textContent: `+ ${pk.unpriced.length} sans prix` }) : null,
            pk.fit < pk.list.length ? h('span', { className: 'warn', textContent: `solde : ${pk.fit} / ${pk.list.length} couverte(s)` }) : null,
          )
        : h('span', { className: 'a-proj', textContent: 'Touche les cartes manquantes pour les sélectionner.' });
      this.actionbar.replaceChildren(
        h('div', { className: 'a-row a-grow' }, h('span', { className: 'a-count', textContent: `${sel.length} sélectionné(s)` }), proj),
        h(
          'div',
          { className: 'a-row' },
          btn('Effacer', () => {
            for (const p of sel) a.setSelected(p.defId, false);
            this.renderBody();
          }, 'ghost', { disabled: !sel.length || a.running }),
          btn(`🎯 Sniper${sel.length ? ` (${sel.length})` : ''}`, () => this.app.snipeSelection(sel.map((p) => p.defId)), '', {
            disabled: !sel.length,
            title: 'Ajoute la sélection aux cibles du sniper et le lance (alternance des cibles) : achat sous le prix du marché, revente avec profit. Plus lent, gagne des crédits.',
          }),
          btn(a.mode === 'buy' ? 'Achats en cours…' : 'Acheter maintenant', () => this.openBuy(set.key), 'primary', {
            disabled: !sel.length && a.mode !== 'buy',
            title: 'Achat direct au prix du marché puis revente : rapide, coût = taxe EA 5 %',
          }),
        ),
      );
    }

    // --- Fenêtre « Acheter des cartes Galerie » ---

    // keys : un set ou plusieurs (sets cochés de l'accueil Galerie)
    openBuy(keys) {
      const sets = [].concat(keys).map((k) => this.album.sets[k]).filter(Boolean);
      if (!sets.length) return;
      this.buyKeys = sets.map((x) => x.key);
      const key = this.buyKeys.join('|');
      this.buyKey = key;
      const running = this.album.running;
      this.buyRows = running || (this.buyRan && this.buyRanKey === key) ? this.album.queue.map((q) => q.defId) : [...new Set(sets.flatMap((x) => this.selectedOf(x).map((p) => p.defId)))];
      if (!running && !(this.buyRan && this.buyRanKey === key)) this.buyRan = false;
      this.buyLayer.classList.add('open');
      this.renderBuy();
    }
    closeBuy() {
      this.buyKey = null;
      this.buyKeys = [];
      this.buyRan = false;
      this.buyLayer.classList.remove('open');
      if (this.isOpen) this.renderBody();
    }
    async runBuy(ids, run) {
      this.buyRan = true;
      this.buyRanKey = this.buyKey;
      this.buyRows = ids;
      await (run ? run() : this.album.validate(ids));
      this.buyRows = this.album.queue.map((q) => q.defId);
      this.renderBuy();
    }
    renderBuy() {
      const a = this.album;
      const sets = this.buyKeys.map((k) => a.sets[k]).filter(Boolean);
      if (!sets.length) return this.closeBuy();
      const multi = sets.length > 1;
      const setOf = new Map();
      for (const x of [...sets].reverse()) for (const id of Object.keys(x.players ?? {})) setOf.set(Number(id), x.name);
      const cfg = this.cfg;
      const running = a.running;
      const queue = new Map(a.queue.map((q) => [q.defId, q]));
      const showRun = running || this.buyRan;
      const rows = this.buyRows.map((id) => ({ id, p: a.findPlayer(id), q: showRun ? queue.get(id) : null })).filter((r) => r.p);
      const on = rows.filter((r) => !r.p.collected && a.isSelected(r.id));
      const pk = a.picks(on.map((r) => String(r.id)));
      const wallet = X.coins();
      const relist = cfg.afterBuy !== 'keep';
      const head = h(
        'div',
        { className: 'a-head' },
        h('div', { className: 'a-text' }, h('div', { className: 'a-eyebrow', textContent: 'Galerie · Achat direct' }), h('div', { className: 'a-title', textContent: `Acheter des cartes · ${multi ? `${sets.length} sets` : sets[0].name}`, title: sets.map((x) => x.name).join(', ') }), h('div', { className: 'a-sub', textContent: running ? 'Achat des cartes au prix du marché, patiente…' : 'Achat au prix du marché, un bouton lance tout. Le sniper est suspendu pendant les achats puis reprend.' })),
        h('button', { type: 'button', className: 'a-close', textContent: '×', title: 'Fermer', onclick: () => this.closeBuy(), disabled: running }),
      );
      const listRows = rows.map(({ id, p, q }) => {
        const inc = !p.collected && a.isSelected(id);
        const v = Number(a.selection[id]) || 0;
        let st = q ? rowStatus(q) : null;
        if (!st) st = p.collected ? ['Déjà dans la Galerie', 'ok'] : v ? [`${fmt(v)} crédits${v === p.minPrice ? ' · prix fut.gg' : ''}`, ''] : ['Sans prix · vérifié avant l’achat', 'ac'];
        const price = h('input', { type: 'number', className: 'a-in a-num', min: '150', step: String(step(v || p.minPrice || 200)), value: v ? String(v) : '', placeholder: 'auto', title: 'Prix de départ (vide = vérifié sur le marché)', disabled: running || p.collected || showRun });
        price.onclick = (ev) => ev.stopPropagation();
        price.onchange = () => {
          const raw = Math.floor(Number(price.value));
          a.setSelected(id, true, raw > 0 ? Math.max(150, Math.floor(raw / step(raw)) * step(raw)) : 0);
          this.renderBuy();
        };
        const row = h(
          'div',
          { className: `a-brow${inc || q ? '' : ' off'}` },
          h('span', { className: `a-check${inc || (q && showRun) ? ' on' : ''}`, textContent: '✓' }),
          h('span', { className: 'a-bn' }, p.rating ? h('i', { textContent: String(p.rating) }) : null, p.name, multi ? h('span', { style: 'color:var(--dim);font-weight:400', textContent: ` · ${q?.set ?? setOf.get(Number(id)) ?? ''}` }) : null),
          showRun ? h('span') : price,
          h('span', { className: `a-bs ${st[1]}`, textContent: st[0] + (q?.note && isFailed(q) && q.status !== 'moved' ? ` · ${q.note}` : '') }),
        );
        if (!running && !showRun && !p.collected) row.onclick = () => (a.setSelected(id, !inc), this.renderBuy());
        return row;
      });
      const listHead = h(
        'div',
        { className: 'a-row' },
        h('b', { style: 'color:#fff;font-size:.8rem', textContent: showRun ? `${rows.filter((r) => r.q?.price > 0).length} / ${rows.length} achetée(s)` : `${on.length} / ${rows.length} cartes` }),
        !running && !showRun
          ? h('button', {
              type: 'button',
              className: 'a-link',
              textContent: on.length === rows.length ? 'Tout désélectionner' : 'Tout sélectionner',
              onclick: () => {
                const all = on.length !== rows.length;
                for (const r of rows) if (!r.p.collected) a.setSelected(r.id, all);
                this.renderBuy();
              },
            })
          : null,
        h('span', { className: 'a-grow' }),
        !showRun ? btn(a.mode === 'check' ? 'Vérification…' : 'Vérifier les prix', () => void this.checkRows(on.map((r) => r.id)), 'small', { disabled: running || !on.length, title: 'Sonde le marché : prix de départ = 4e annonce la moins chère' }) : null,
      );
      const listBlock = h('div', { className: 'a-block' }, listHead, !showRun ? hint('Touche une ligne pour inclure ou retirer une carte.') : null, h('div', { className: 'a-brows' }, ...listRows));
      const tol = tolOf(cfg);
      const over = wallet !== null && pk.spend > wallet;
      const summary = block(
        'Résumé',
        h('div', { className: 'a-kv' }, h('span', { textContent: 'Coût' }), h('b', { textContent: `~${fmt(pk.spend)} crédits` })),
        pk.capSpend > pk.spend ? h('div', { className: 'a-kv' }, h('span'), hint(`jusqu'à ${fmt(pk.capSpend)} avec la hausse (+${tol} paliers)`)) : null,
        relist ? h('div', { className: 'a-kv' }, h('span', { textContent: 'Revente nette' }), h('b', { textContent: `~${fmt(pk.back)} crédits` })) : null,
        relist ? h('div', { className: 'a-kv' }, h('span', { textContent: 'Taxe EA (5 %)' }), h('b', { style: 'color:var(--ko)', textContent: `~${fmt(pk.tax)} crédits` })) : null,
        h('div', { className: 'a-kv' }, h('span', { textContent: relist ? 'Coût réel' : 'Coût réel (gardées au club)' }), h('b', { style: `color:var(${pk.cost > 0 ? '--ko' : '--ok'})`, textContent: pk.cost < 0 ? `+${fmt(-pk.cost)} crédits` : `~${fmt(pk.cost)} crédits` })),
        wallet !== null ? h('div', { className: 'a-kv' }, h('span', { textContent: 'Solde' }), h('b', { className: over ? 'warn' : '', textContent: `${fmt(wallet)} · ${over ? `couvre ${pk.fit} / ${pk.list.length} carte(s)` : 'suffisant'}` })) : null,
        pk.unpriced.length ? hint(`${pk.unpriced.length} carte(s) sans prix : vérifiée(s) sur le marché avant l’achat.`) : null,
        over ? hint('Achats un par un, du moins cher au plus cher. Solde insuffisant : le lot attend les ventes de la liste de transferts (relecture toutes les 2 min) puis reprend.') : null,
      );
      const tolInput = h('input', { type: 'number', className: 'a-in a-num', min: '0', max: String(MAX_TOLERANCE), value: String(cfg.tolerance), disabled: cfg.toleranceAuto || running });
      tolInput.onchange = () => (this.app.setConfig({ tolerance: Math.min(MAX_TOLERANCE, Math.max(0, Math.floor(Number(tolInput.value) || 0))) }), this.renderBuy());
      const seg = h(
        'div',
        { className: 'a-seg' },
        h('button', { type: 'button', className: cfg.toleranceAuto ? 'active' : '', textContent: 'Auto', disabled: running, onclick: () => (this.app.setConfig({ toleranceAuto: true }), this.renderBuy()) }),
        h('button', { type: 'button', className: cfg.toleranceAuto ? '' : 'active', textContent: 'Manuel', disabled: running, onclick: () => (this.app.setConfig({ toleranceAuto: false }), this.renderBuy()) }),
      );
      const tolBlock = h(
        'div',
        { className: 'a-block' },
        h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: 'Écart max' }), seg, h('span', { className: 'a-row', style: 'gap:.3rem' }, tolInput, hint('paliers'))),
        hint(cfg.toleranceAuto ? 'De combien une carte peut coûter plus que son prix connu. Auto : 3 paliers EA (+150 sur une carte à 500, +3 000 sur une carte à 100k).' : `Une carte peut coûter jusqu’à ${cfg.tolerance} palier(s) EA de plus que son prix connu ; plus chère, elle est sautée.`),
      );
      const markInput = h('input', { type: 'number', className: 'a-in a-num', min: '0', max: '100', value: String(cfg.markupPct), disabled: running });
      markInput.onclick = (ev) => ev.stopPropagation();
      markInput.onchange = () => (this.app.setConfig({ markupPct: Math.min(100, Math.max(0, Number(markInput.value) || 0)) }), this.renderBuy());
      const desc = {
        keep: 'Les cartes vont au club. Coût = prix payé.',
        relist: 'Remise en vente au prix payé. Coût = taxe EA de 5 %.',
        markup: 'Remise en vente un peu au-dessus du prix payé : couvre la plus grande partie de la taxe, vente un peu plus lente.',
      };
      const opts = Object.entries(X.AFTER_BUY).map(([k, lbl]) =>
        h(
          'div',
          { className: `a-opt${cfg.afterBuy === k ? ' active' : ''}`, onclick: () => !running && (this.app.setConfig({ afterBuy: k }), this.renderBuy()) },
          h('span', { className: 'a-radio' }),
          h('div', { className: 'a-grow' }, h('div', { className: 'a-row' }, h('b', { textContent: lbl }), k === 'markup' ? h('span', { className: 'a-row', style: 'gap:.3rem' }, '+', markInput, '%') : null), cfg.afterBuy === k ? hint(desc[k]) : null),
        ),
      );
      const afterBlock = block('Après achat', ...opts);
      const foot = h('div', { className: 'a-buyfoot' });
      if (running) {
        const q = a.queue;
        const done = q.filter((x) => !isOpen(x)).length;
        foot.append(
          ...[
            h('div', { className: 'a-kv' }, h('b', { textContent: a.mode === 'check' ? 'Vérification des prix' : 'Achat des cartes' }), h('span', { textContent: a.mode === 'buy' ? `${done} / ${q.length}` : '' })),
            a.mode === 'buy' ? h('div', { className: 'a-bar' }, h('span', { className: 'ac', style: `width:${q.length ? (done / q.length) * 100 : 0}%` })) : null,
            btn('Arrêter les achats', () => a.stop(a.mode === 'check' ? 'Vérification arrêtée' : 'Achats arrêtés', true), 'big danger'),
          ].filter(Boolean),
        );
      } else if (this.buyRan) {
        const q = a.queue;
        const bought = q.filter((x) => x.price > 0).length;
        const listed = q.filter((x) => x.status === 'listed').length;
        const failed = q.filter(isFailed).length;
        const skipped = q.filter((x) => x.status === 'moved' && x.seen > 0);
        const open = q.filter(isOpen).length;
        const missing = q.filter((x) => isFailed(x)).map((x) => x.defId);
        foot.append(
          ...[
            h('div', { className: 'a-cta-sub', style: 'color:#fff;font-size:.82rem', textContent: `Achetés ${bought} · mis en vente ${listed} · échecs ${failed}${skipped.length ? ` · sautés ${skipped.length}` : ''}${open ? ' · arrêté avant la fin' : ''}` }),
            skipped.length ? btn(`Racheter ${skipped.length} carte(s) sautée(s) au prix vu`, () => void a.retrySkipped(), 'big primary') : null,
            open ? btn(`Reprendre (${open} restante(s))`, () => void a.runQueue(), 'big primary') : null,
            missing.length ? btn(`🎯 Sniper les ${missing.length} carte(s) non achetée(s)`, () => (this.closeBuy(), this.app.snipeSelection(missing)), 'big') : null,
            btn('Terminé', () => this.closeBuy(), `big${skipped.length || open ? '' : ' primary'}`),
          ].filter(Boolean),
        );
      } else {
        const n = on.length;
        const lbl = pk.unpriced.length ? `Vérifier${relist ? ', acheter & remettre en vente' : ' & acheter'} ${n} carte(s)` : relist ? `Acheter & remettre en vente ${n} carte(s)` : `Acheter ${n} carte(s) · ${fmt(pk.spend)}`;
        foot.append(btn(lbl, () => void this.runBuy(on.map((r) => r.id)), 'big primary', { disabled: !n }), h('div', { className: 'a-cta-sub', textContent: `~${fmt(pk.spend)} crédits${this.sniper.running ? ' · le sniper est suspendu pendant les achats puis reprend' : ''}` }));
      }
      const top = this.buyBody?.scrollTop ?? 0;
      this.buyBody = h('div', { className: 'a-buybody' }, listBlock, showRun ? null : summary, showRun ? null : tolBlock, showRun ? null : afterBlock);
      this.buyInner.replaceChildren(head, this.buyBody, foot);
      this.buyBody.scrollTop = top;
    }
    async checkRows(ids) {
      if (!ids.length) return;
      await this.album.checkPrices(false, ids);
      this.renderBuy();
    }

    // ================= Ventes =================

    buildSalesTab() {
      this.relistBtn = btn('', () => (this.sniper.task === 'relist' ? this.sniper.stop('Relister arrêté', false) : this.app.relist()), 'big primary');
      this.pileEl = h('div', { className: 'a-block-hint' });
      this.snipeTiles = h('div', { className: 'tiles' });
      this.albumHero = h('div', { className: 'hero' });
      this.albumTiles = h('div', { className: 'tiles' });
      this.salesEl = h('div', { className: 'salelist' });
      this.onSaleEl = h('div', { className: 'salelist' });
      this.refreshBtn = h('button', { type: 'button', className: 'a-link', textContent: '↻ Actualiser', title: 'Relit la liste de transferts chez EA', onclick: () => this.app.refreshPile() });
      const resetS = h('button', { type: 'button', className: 'a-link', textContent: 'Réinitialiser', onclick: () => confirm('Remettre à zéro le suivi du sniper (totaux, sessions, joueurs, jours) ?') && this.sniper.resetSession() });
      this.sessionsEl = h('div');
      this.playersEl = h('div');
      this.daysEl = h('div');
      this.psort = 'profit';
      this.psortSeg = h(
        'div',
        { className: 'a-seg' },
        ...[
          ['profit', 'Profit'],
          ['snipes', 'Snipes'],
          ['last', 'Récents'],
        ].map(([k, l]) => h('button', { type: 'button', value: k, textContent: l, onclick: () => ((this.psort = k), this.renderSales()) })),
      );
      const copyP = h('button', { type: 'button', className: 'a-link', textContent: 'Copier (CSV)' });
      copyP.onclick = async () => {
        const ok = await copyText(this.playersCsv());
        copyP.textContent = ok ? 'Copié' : 'Échec';
        setTimeout(() => (copyP.textContent = 'Copier (CSV)'), 1500);
      };
      const resetA = h('button', { type: 'button', className: 'a-link', textContent: 'Réinitialiser', onclick: () => confirm('Remettre à zéro dépensé, vendus, perte réalisée et taxe de la Galerie ?') && this.album.resetTotals() });
      const title = (t, extra) => h('div', { className: 'a-row' }, h('span', { className: 'a-block-title a-grow', textContent: t }), extra);
      return h(
        'div',
        { className: 'a-sec' },
        block('Liste de transferts', this.relistBtn, hint('Encaisse les ventes, puis remet en vente chaque invendu un palier sous la moins chère du marché (prix vérifié par joueur). Jamais sous le prix d’achat : taxe comprise pour un snipe, prix payé pour une carte Galerie.'), this.pileEl),
        h('div', { className: 'a-block' }, title('Sniper', resetS), this.snipeTiles),
        h('div', { className: 'a-block' }, title('Sessions du sniper'), hint('Une session couvre le fonctionnement continu du sniper, rechargements et tâches Galerie compris ; plus de 30 min d’interruption en ouvre une nouvelle. Profit rattaché à la session d’achat.'), this.sessionsEl),
        h('div', { className: 'a-block' }, title('Par joueur', h('span', { className: 'a-row' }, copyP, this.psortSeg)), this.playersEl),
        h('div', { className: 'a-block' }, title('Par jour'), this.daysEl),
        h('div', { className: 'a-block' }, title('Galerie (achat direct)', resetA), this.albumHero, this.albumTiles),
        block('Dernières ventes', this.salesEl),
        h('div', { className: 'a-block' }, title('Cartes Galerie en vente', this.refreshBtn), hint('Cartes achetées en direct pour la Galerie, recalées sur la liste de transferts à chaque lecture.'), this.onSaleEl),
      );
    }
    renderSales() {
      const s = this.sniper;
      const a = this.album;
      const now = Date.now();
      const relisting = s.task === 'relist';
      const unsold = Object.values(a.bought).filter(isUnsold).length;
      this.relistBtn.className = `a-btn big ${relisting ? 'danger' : 'primary'}`;
      this.relistBtn.textContent = relisting ? 'Arrêter' : `Relister les invendus${unsold ? ` (${unsold} Galerie)` : ''}`;
      this.relistBtn.disabled = (s.running && !relisting) || a.running;
      this.relistBtn.title = s.running && !relisting ? 'Arrête d’abord le sniper (les invendus du sniper sont remis en vente seuls pendant ses pauses)' : '';
      this.refreshBtn.disabled = a.running || relisting;
      const p = a.pile;
      this.pileEl.textContent = p ? `Lue à ${hm(p.at)} : ${p.active} en vente, ${p.unsold} invendu(s), ${p.sold} vente(s) encaissée(s).` : '';
      // Sniper
      const ses = s.session;
      const pend = s.pending();
      const snipe = s.running && s.task === 'snipe';
      const active = ses.activeMs + (snipe ? now - s.lastTick : 0);
      const total = ses.realized + pend.expected;
      this.snipeTiles.replaceChildren(
        tile('Profit réel', fmtSigned(ses.realized), `${ses.sales} vente(s)${ses.sales ? ` · ${fmtSigned(Math.round(ses.realized / ses.sales))} / vente` : ''}`, ses.realized > 0 ? 'pos' : ses.realized < 0 ? 'neg' : ''),
        tile('Profit / h', perH(perHour(ses.realized, active)), `estimé ${perH(perHour(total, active))} · total ${fmtSigned(total)}`),
        tile('En attente de vente', String(pend.count), pend.count ? `${fmt(pend.invested)} investis · ${pend.listed} en vente, ${fmtSigned(pend.expected)} attendus` : ''),
        tile('Snipes', String(ses.snipes), `${ses.misses} raté(s) de peu${rate(ses.snipes, ses.misses)}`),
        tile('Recherches', fmt(ses.searches), `+ ${fmt(ses.otherSearches)} vérif. de prix${ses.snipes ? ` · 1 snipe / ${fmt(Math.round(ses.searches / ses.snipes))}` : ''}`),
        tile('Temps de fonctionnement', fmtClock(active), ses.since ? `depuis le ${new Date(ses.since).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''),
        ...this.statTiles(),
      );
      this.renderSessions(now);
      this.renderPlayers();
      this.renderDays();
      // Galerie
      const t = a.total;
      const pl = a.pendingLoss();
      const real = t.lost + pl + (t.keptSpent ?? 0);
      this.albumHero.replaceChildren(
        h('span', { textContent: 'Coût réel' }),
        h('b', { className: real > 0 ? 'neg' : real < 0 ? 'pos' : '', textContent: real < 0 ? `+${fmt(-real)}` : fmt(real) }),
        h('small', { textContent: `réalisé ${t.lost < 0 ? `+${fmt(-t.lost)}` : fmt(t.lost)} · en attente ${fmt(pl)}${t.keptSpent ? ` · club ${fmt(t.keptSpent)}` : ''}` }),
      );
      const items = Object.values(a.bought);
      const value = items.reduce((v, b) => v + (b.sell || b.price), 0);
      this.albumTiles.replaceChildren(
        tile('En vente', `${items.length}`, `valeur ${fmt(value)}${unsold ? `, ${unsold} invendu(s)` : ''}`, unsold ? 'warn' : ''),
        tile('Vendus', `${fmt(t.sold)} / ${fmt(t.bought)}`, `récupéré ${fmt(t.received)}`),
        tile('Dépensé', fmt(t.spent), `taxe payée ${fmt(t.tax)}${t.kept ? `, ${fmt(t.kept)} au club` : ''}`),
      );
      // Ventes
      this.salesEl.replaceChildren(
        ...(s.sales.length
          ? s.sales.slice(0, 30).map((x) =>
              h(
                'div',
                { className: 'sale', title: x.buy === null ? 'Carte non achetée par l’extension' : `Acheté ${fmt(x.buy)}, vendu ${fmt(x.price)}${x.held ? ` en ${dur(x.held)}` : ''}` },
                h('span', { className: 'm', textContent: hm(x.at) }),
                h('span', { className: 'n', textContent: `${x.label}${x.album ? ' · Galerie' : ''}` }),
                h('span', { className: 'm', textContent: x.buy === null ? fmt(x.price) : `${fmt(x.buy)} → ${fmt(x.price)}` }),
                h('b', { className: x.profit === null ? 'm' : x.profit >= 0 ? 'pos' : 'neg', textContent: x.profit === null ? '—' : fmtSigned(x.profit) }),
              ),
            )
          : [h('div', { className: 'a-empty', textContent: 'Aucune vente constatée. Les ventes sont lues pendant les pauses du sniper ou à l’ouverture de la liste de transferts.' })]),
      );
      const sorted = items.sort((x, y) => Number(isUnsold(y)) - Number(isUnsold(x)) || (y.at ?? 0) - (x.at ?? 0));
      this.onSaleEl.replaceChildren(
        ...(sorted.length
          ? sorted.map((b) => {
              const sell = b.sell || b.price;
              const loss = b.price - netOf(sell);
              return h(
                'div',
                { className: `sale${isUnsold(b) ? ' unsold' : ''}` },
                h('span', { className: 'm', textContent: isUnsold(b) ? 'invendu' : 'en vente' }),
                h('span', { className: 'n', textContent: b.name || `#${b.defId}` }),
                h('span', { className: 'm', textContent: `${fmt(b.price)} → ${fmt(sell)}` }),
                h('b', { className: loss > 0 ? 'neg' : 'pos', textContent: loss > 0 ? `−${fmt(loss)}` : `+${fmt(-loss)}` }),
              );
            })
          : [h('div', { className: 'a-empty', textContent: 'Aucune carte Galerie en vente.' })]),
      );
    }

    statTiles() {
      const st = this.sniper.stats;
      const t = Object.values(st.players).reduce((o, p) => ((o.realized += p.realized), (o.gross += p.gross), (o.revenue += p.revenue), (o.holdMs += p.holdMs), (o.sales += p.sales), o), { realized: 0, gross: 0, revenue: 0, holdMs: 0, sales: 0 });
      const cost = t.revenue - t.realized;
      const d = st.days[X.dayOf(Date.now())];
      return [
        tile('Rendement', cost > 0 ? `${((100 * t.realized) / cost).toFixed(1).replace('.', ',')} %` : '—', t.sales ? `sur ${fmt(cost)} de cartes vendues · taxe EA ${fmt(t.gross - t.revenue)}` : 'aucune vente suivie', sign(t.realized)),
        tile('Délai de vente moyen', t.sales ? dur(t.holdMs / t.sales) : '—', t.sales ? `entre le snipe et la vente · ${t.sales} vente(s)` : ''),
        tile('Aujourd’hui', fmtSigned(d?.realized ?? 0), d ? `${d.snipes} snipe(s) · ${d.sales} vente(s) · ${dur(d.ms)}` : 'aucune activité', sign(d?.realized ?? 0)),
      ];
    }
    renderSessions(now) {
      const s = this.sniper;
      const st = s.stats;
      const pend = s.pendingBy((x) => x.sid);
      const live = s.running && s.task === 'snipe';
      const list = [...(st.current ? [st.current] : []), ...st.sessions];
      if (!list.length) return this.sessionsEl.replaceChildren(h('div', { className: 'a-empty', textContent: 'Aucune session enregistrée. Le suivi commence au prochain lancement du sniper.' }));
      const rows = list.map((x) => {
        const cur = x === st.current;
        const ms = x.ms + (cur && live ? now - s.lastTick : 0);
        const p = pend.get(x.id);
        const total = x.realized + (p?.expected ?? 0);
        const top = Object.entries(x.targets ?? {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, v]) => `${k} (${fmt(v)})`)
          .join(', ');
        const title = `${when(x.start)} → ${cur ? 'en cours' : when(x.last)} · hors pauses ${dur(x.workMs)} · investi ${fmt(x.spent)}${top ? ` · recherches : ${top}` : ''}`;
        return [
          [
            h('span', {}, cell(when(x.start), 'n'), cur ? cell(' · en cours', 'm') : null),
            dur(ms),
            fmt(x.searches),
            h('span', {}, `${x.snipes}`, cell(` / ${x.misses}`, 'm')),
            cell(fmtSigned(x.realized), sign(x.realized)),
            p ? h('span', {}, `${p.count}`, cell(` · ${fmtSigned(p.expected)}`, 'm')) : cell('—', 'm'),
            cell(perH(perHour(total, ms)), 'm'),
          ],
          cur ? 'cur' : '',
          title,
        ];
      });
      const keep = this.sessionsEl.firstChild?.scrollTop ?? 0;
      this.sessionsEl.replaceChildren(table('minmax(0,1.6fr) repeat(6, minmax(0,1fr))', ['Début', 'Durée', 'Recherches', 'Snipes / ratés', 'Profit réel', 'En attente', 'Profit / h'], rows));
      this.sessionsEl.firstChild.scrollTop = keep;
    }
    renderPlayers() {
      const s = this.sniper;
      const pend = s.pendingBy((x) => X.playerKey(x.defId, x.label));
      const all = Object.entries(s.stats.players).map(([k, p]) => ({ ...p, pend: pend.get(k) }));
      for (const b of this.psortSeg.children) b.classList.toggle('active', b.value === this.psort);
      if (!all.length) return this.playersEl.replaceChildren(h('div', { className: 'a-empty', textContent: 'Aucun joueur suivi pour l’instant.' }));
      const by = { profit: (p) => p.realized + (p.pend?.expected ?? 0), snipes: (p) => p.snipes, last: (p) => p.last }[this.psort];
      const rows = all
        .sort((a, b) => by(b) - by(a))
        .slice(0, 100)
        .map((p) => {
          const title = [
            p.searches ? `${fmt(p.searches)} recherche(s) ciblée(s)${p.snipes ? ` · 1 snipe / ${fmt(Math.round(p.searches / p.snipes))}` : ''}` : '',
            `investi ${fmt(p.spent)}`,
            p.best !== null ? `meilleure vente ${fmtSigned(p.best)}` : '',
            p.pend ? `${p.pend.count} en attente (${fmt(p.pend.invested)} investis, ${fmtSigned(p.pend.expected)} attendus)` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return [
            [
              cell(p.label || `#${p.defId}`, 'n'),
              h('span', {}, `${p.snipes}`, cell(` / ${p.misses}`, 'm')),
              fmt(p.sales),
              cell(fmtSigned(p.realized), sign(p.realized)),
              cell(p.sales ? fmtSigned(Math.round(p.realized / p.sales)) : '—', 'm'),
              cell(p.sales ? dur(p.holdMs / p.sales) : '—', 'm'),
              p.pend ? `${p.pend.count}` : cell('—', 'm'),
            ],
            '',
            title,
          ];
        });
      const keep = this.playersEl.firstChild?.scrollTop ?? 0;
      this.playersEl.replaceChildren(table('minmax(0,1.8fr) repeat(6, minmax(0,1fr))', ['Joueur', 'Snipes / ratés', 'Ventes', 'Profit réel', 'Moy. / vente', 'Délai moyen', 'En attente'], rows));
      this.playersEl.firstChild.scrollTop = keep;
    }
    renderDays() {
      const days = Object.entries(this.sniper.stats.days)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .slice(0, 14);
      if (!days.length) return this.daysEl.replaceChildren(h('div', { className: 'a-empty', textContent: 'Aucune journée enregistrée.' }));
      const max = Math.max(1, ...days.map(([, d]) => Math.abs(d.realized)));
      const rows = days.map(([k, d]) => [
        [
          cell(new Date(`${k}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' }), 'n'),
          dur(d.ms),
          fmt(d.searches),
          h('span', {}, `${d.snipes}`, cell(` / ${d.misses}`, 'm')),
          fmt(d.sales),
          cell(fmtSigned(d.realized), sign(d.realized)),
          h('div', { className: 'bar' }, h('span', { className: d.realized < 0 ? 'neg' : '', style: `width:${(100 * Math.abs(d.realized)) / max}%` })),
        ],
        '',
        `investi ${fmt(d.spent)} · ${perH(perHour(d.realized, d.ms))}`,
      ]);
      this.daysEl.replaceChildren(table('minmax(0,1.2fr) repeat(5, minmax(0,1fr)) minmax(0,1.4fr)', ['Jour', 'Durée', 'Recherches', 'Snipes / ratés', 'Ventes', 'Profit réel', ''], rows));
    }
    playersCsv() {
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const pend = this.sniper.pendingBy((x) => X.playerKey(x.defId, x.label));
      const head = ['joueur', 'defId', 'recherches', 'snipes', 'rates', 'investi', 'ventes', 'profit_reel', 'ventes_brutes', 'delai_moyen_min', 'en_attente'];
      const lines = Object.entries(this.sniper.stats.players).map(([k, p]) =>
        [q(p.label), p.defId, p.searches, p.snipes, p.misses, p.spent, p.sales, p.realized, p.gross, p.sales ? Math.round(p.holdMs / p.sales / 6e4) : '', pend.get(k)?.count ?? 0].join(';'),
      );
      return [head.join(';'), ...lines].join('\n');
    }

    // ================= Journal =================

    eventRow(ev) {
      const icons = { buy: '✓', sell: '€', list: '↗', miss: '✗', lock: '⏸', error: '!', warn: '!', info: '•', step: '·' };
      const tm = new Date(ev.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      return h('div', { className: `ev ${ev.type}${ev.major ? ' major' : ''}` }, h('span', { className: 'tm', textContent: tm }), h('span', { className: 'ic', textContent: icons[ev.type] ?? '•' }), h('span', { textContent: ev.msg }));
    }
    eventMatches(ev) {
      const f = this.jfilter;
      if (f === 'all') return true;
      if (f === 'main') return ev.type !== 'step';
      if (f === 'trade') return ev.type === 'buy' || ev.type === 'sell' || ev.type === 'list';
      return ev.type === 'miss' || ev.type === 'error' || ev.type === 'warn' || ev.type === 'lock';
    }
    renderEvents(full = false) {
      const evs = X.journal.events;
      const newest = evs[0]?.id ?? 0;
      if (full || newest < this.shownEventId) this.jList.replaceChildren(...evs.filter((ev) => this.eventMatches(ev)).slice(0, 300).map((ev) => this.eventRow(ev)));
      else {
        const fresh = evs.filter((ev) => ev.id > this.shownEventId).reverse();
        if (fresh.length) this.jList.querySelector('.a-empty')?.remove();
        for (const ev of fresh) if (this.eventMatches(ev)) this.jList.prepend(this.eventRow(ev));
        while (this.jList.childElementCount > 300) this.jList.lastChild.remove();
      }
      if (!evs.length) this.jList.replaceChildren(h('div', { className: 'a-empty', textContent: 'Journal vide.' }));
      this.shownEventId = newest;
    }
    buildLogTab() {
      this.jList = h('div', { className: 'jlist' });
      const chips = [
        ['all', 'Tout'],
        ['main', 'Essentiel'],
        ['trade', 'Achats / ventes'],
        ['issues', 'Problèmes'],
      ].map(([id, label]) => {
        const b = btn(label, () => {
          this.jfilter = id;
          for (const c of chips) c.classList.toggle('primary', c === b);
          this.renderEvents(true);
        }, `small${id === 'all' ? ' primary' : ''}`);
        return b;
      });
      const copy = btn('Copier', async () => {
        const ok = await copyText(X.journal.events.map((ev) => `${new Date(ev.t).toLocaleString()} [${ev.type}] ${ev.msg}`).join('\n'));
        copy.textContent = ok ? 'Copié' : 'Échec';
        setTimeout(() => (copy.textContent = 'Copier'), 1500);
      }, 'small');
      const clear = btn('Effacer', () => (X.journal.clear(), this.renderEvents(true)), 'small');
      return h('div', { className: 'a-sec', style: 'max-width:none' }, h('div', { className: 'jtools' }, ...chips, h('span', { className: 'a-grow' }), copy, clear), this.jList);
    }

    // ================= Réglages =================

    renderSettings() {
      if (this.typing(this.settingsSec)) return;
      const c = this.cfg;
      const set = (patch) => (this.app.setConfig(patch), setTimeout(() => this.renderSettings()));
      const select = (k, presets) => {
        const s = h('select', { className: 'a-in' }, ...Object.entries(presets).map(([v, p]) => h('option', { value: v, textContent: `${p.label} : ${p.info}`, selected: c[k] === v })));
        s.onchange = () => set({ [k]: s.value });
        return s;
      };
      const num = (k, min = 0, max = Infinity) => {
        const i = h('input', { type: 'number', className: 'a-in a-num', min: String(min), value: String(c[k]) });
        i.onchange = () => set({ [k]: Math.min(max, Math.max(min, Math.floor(Number(i.value) || 0))) });
        return i;
      };
      const row = (label, sub, control) => setting(label, sub, control);
      this.settingsSec.replaceChildren(
        block(
          'Rythme',
          row('Délai entre recherches', 'Normal conseillé. Risqué / Dangereux : à utiliser rarement, risque de captcha.', select('delayPreset', X.DELAY_PRESETS)),
          row('Pauses du sniper', 'Fréquence et durée des pauses, pour imiter un joueur.', select('breakPreset', X.BREAK_PRESETS)),
          row('Limites anti-ban', 'Plafond de recherches et d’achats, communs au sniper et à la Galerie.', select('limitsPreset', X.LIMIT_PRESETS)),
          hint('Captcha ou limite EA : pause de 30 à 60 min puis reprise automatique (doublée si ça se répète dans les 24 h, 4 h max). Hésitation : 8 % des recherches, +0,5 à 1,5 s.'),
        ),
        block(
          'Sniper',
          row('Profit minimum par carte', '0 = 2 % du prix, 150 minimum', num('minProfit')),
          row('Achats max par recherche', '1 à 5', num('maxBuysPerSearch', 1, 5)),
          row('Revérifier les prix toutes les N recherches', '0 = jamais (toujours toutes les 15 min et après un snipe)', num('recheckEvery')),
          row('Prévention des erreurs', 'Pas d’achat si la recherche renvoie plus de 15 résultats', toggle(c.mistakePrevention, (v) => set({ mistakePrevention: v }))),
          row('Son à chaque snipe', '', toggle(c.snipeSound, (v) => (set({ snipeSound: v }), v && X.beep()))),
        ),
        block('Galerie', row('Importer tous les sets fut.gg à l’ouverture', 'Au plus toutes les 6 h', toggle(c.autoCatalog, (v) => set({ autoCatalog: v }))), hint('Écart max et « Après achat » se règlent dans la fenêtre d’achat direct.')),
      );
    }

    // --- Mise à jour depuis les moteurs (regroupée par image) ---

    update() {
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => {
        this.queued = false;
        this.refresh();
      });
    }
    refresh() {
      if ((X.journal.events[0]?.id ?? 0) !== this.shownEventId) this.renderEvents();
      this.renderLauncher();
      if (!this.isOpen) return void this.tick();
      this.renderHead();
      this.renderStrip();
      const a = this.album;
      const s = this.sniper;
      const sig = `${a.mode}|${a.version}|${this.setKey ? '' : `${a.catalog.text}|${X.coins()}|${X.galleryLive?.score}|${this.cfg.levelScore}|${this.cfg.levelTarget}|${this.cfg.levelBudget}|${this.cfg.afterBuy}`}|${s.running}|${s.task}|${s.idx}|${this.cfg.snipeFilters}|${this.cfg.rotate}`;
      if (sig !== this.lastSig && !this.typing()) {
        this.lastSig = sig;
        if (this.tab === 'gallery' || this.tab === 'snipe') this.renderBody();
      }
      if (this.tab === 'sales') this.renderSales();
      if (this.buyKey && !this.typing(this.buyLayer)) this.renderBuy();
    }
  };
})();
