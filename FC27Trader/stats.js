// Suivi du sniper : sessions (fonctionnement continu, rechargements et tâches Galerie compris), par joueur, par jour
(function () {
  const X = globalThis.__fc27;
  const { load, save, net } = X;
  const K_STATS = `${X.SNIPE_NS}:stats`;
  // Plus de 30 min sans fonctionnement : la reprise ouvre une nouvelle session
  const GAP_MS = 18e5;
  const MAX_SESSIONS = 30;
  const MAX_DAYS = 30;
  const MAX_PLAYERS = 300;
  const SAVE_MS = 2e3;
  const pad = (n) => String(n).padStart(2, '0');
  const dayOf = (t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const counts = () => ({ searches: 0, snipes: 0, misses: 0, spent: 0, sales: 0, realized: 0 });
  const empty = (seq = 0) => ({ seq, current: null, sessions: [], players: {}, days: {} });
  X.dayOf = dayOf;
  X.playerKey = (defId, label) => (defId ? String(defId) : `n:${label}`);

  X.SnipeStats = class {
    data = { ...empty(), ...load(K_STATS, {}) };
    timer = null;

    constructor() {
      addEventListener('pagehide', () => this.flush());
    }
    get current() {
      return this.data.current;
    }
    // Sessions terminées, la plus récente d'abord
    get sessions() {
      return this.data.sessions;
    }
    get players() {
      return this.data.players;
    }
    get days() {
      return this.data.days;
    }

    begin(now = Date.now()) {
      const c = this.data.current;
      if (c && now - c.last > GAP_MS) this.end();
      this.data.current ??= { id: ++this.data.seq, start: now, last: now, ms: 0, workMs: 0, ...counts(), targets: {} };
      this.touch();
      return this.data.current;
    }
    end() {
      const c = this.data.current;
      if (!c) return;
      this.data.current = null;
      if (c.searches || c.snipes || c.sales) this.data.sessions = [c, ...this.data.sessions].slice(0, MAX_SESSIONS);
      this.touch();
    }
    find(id) {
      if (!id) return null;
      return this.data.current?.id === id ? this.data.current : (this.data.sessions.find((s) => s.id === id) ?? null);
    }
    day(t = Date.now()) {
      return (this.data.days[dayOf(t)] ??= { ms: 0, ...counts() });
    }
    player(defId, label) {
      const p = (this.data.players[X.playerKey(defId, label)] ??= { defId: defId || 0, label, ...counts(), gross: 0, revenue: 0, holdMs: 0, best: null, last: 0 });
      if (label) p.label = label;
      p.last = Date.now();
      return p;
    }
    tick(ms, working) {
      const c = this.data.current;
      if (!c || !(ms > 0)) return;
      c.ms += ms;
      if (working) c.workMs += ms;
      c.last = Date.now();
      this.day().ms += ms;
      this.touch();
    }
    search(f) {
      const c = this.data.current;
      if (c) {
        c.searches++;
        c.targets[f.label] = (c.targets[f.label] ?? 0) + 1;
      }
      this.day().searches++;
      if (f.defId) this.player(f.defId, f.label).searches++;
      this.touch();
    }
    // Retourne l'identifiant de session à garder avec le snipe (profit rattaché à la session d'achat)
    snipe(defId, label, price) {
      for (const o of [this.data.current, this.day(), this.player(defId, label)])
        if (o) {
          o.snipes++;
          o.spent += price;
        }
      this.touch();
      return this.data.current?.id ?? 0;
    }
    miss(defId, label) {
      for (const o of [this.data.current, this.day(), this.player(defId, label)]) if (o) o.misses++;
      this.touch();
    }
    sale(sn, soldPrice, now = Date.now()) {
      const profit = net(soldPrice) - sn.price;
      for (const o of [this.find(sn.sid) ?? this.data.current, this.day(now)])
        if (o) {
          o.sales++;
          o.realized += profit;
        }
      const p = this.player(sn.defId, sn.label);
      p.sales++;
      p.realized += profit;
      p.gross += soldPrice;
      p.revenue += net(soldPrice);
      p.holdMs += sn.at ? Math.max(0, now - sn.at) : 0;
      if (p.best === null || profit > p.best) p.best = profit;
      this.touch();
      return profit;
    }
    reset() {
      this.data = empty(this.data.seq);
      this.flush();
    }
    touch() {
      this.timer ??= setTimeout(() => this.flush(), SAVE_MS);
    }
    flush() {
      clearTimeout(this.timer);
      this.timer = null;
      const d = this.data;
      const keys = Object.keys(d.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete d.days[k];
      const ps = Object.entries(d.players);
      if (ps.length > MAX_PLAYERS) for (const [k] of ps.sort((a, b) => a[1].last - b[1].last).slice(0, ps.length - MAX_PLAYERS)) delete d.players[k];
      save(K_STATS, d);
    }
  };
})();
