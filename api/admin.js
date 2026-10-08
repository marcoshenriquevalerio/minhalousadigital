// POST /api/admin  { action, ... }  -> tudo do painel de controle. Só dono e administradores autorizados.
const S = require("../lib/server");
const { CATALOG, getPlans, cleanPlans, admin, db, auth, OWNER, SITE, lc, getBilling, getMp, getAdmins, cfgRef, requireAdmin, mp, subRef, syncPreapproval, proActive, wrap, body } = S;

const mask = (t) => (t ? "••••••••" + String(t).slice(-4) : "");
const bad = (m, st = 400) => { const e = new Error(m); e.status = st; throw e; };

async function listAll() {
  const users = [];
  let page;
  do {
    const r = await auth.listUsers(1000, page);
    r.users.forEach((u) => users.push(u));
    page = r.pageToken;
  } while (page && users.length < 5000);
  const subs = {};
  (await db.collection("subscriptions").get()).forEach((d) => (subs[d.id] = d.data()));
  const admins = await getAdmins();
  return users.map((u) => {
    const s = subs[u.uid] || null, email = lc(u.email);
    return {
      uid: u.uid, email, name: u.displayName || "", photo: u.photoURL || "",
      created: Date.parse(u.metadata.creationTime) || 0,
      lastLogin: Date.parse(u.metadata.lastSignInTime) || 0,
      lastSeen: u.metadata.lastRefreshTime ? Date.parse(u.metadata.lastRefreshTime) : 0,
      disabled: !!u.disabled,
      admin: email === OWNER || admins.includes(email),
      sub: s ? { status: s.status || "", amount: s.amount || 0, nextPayment: s.nextPayment || 0, manual: !!s.manual, preapprovalId: s.preapprovalId || "" } : null,
      pro: proActive(s)
    };
  });
}

const actions = {
  async overview(u) {
    const [users, billing, m, admins, plans] = await Promise.all([listAll(), getBilling(), getMp(), getAdmins(), getPlans()]);
    const active = users.filter((x) => x.sub && x.sub.status === "authorized");
    const mrr = active.reduce((a, x) => a + (x.sub.amount || 0), 0);
    return {
      me: { email: u.email, owner: u.owner },
      stats: {
        users: users.length,
        pro: users.filter((x) => x.pro).length,
        active: active.length,
        pending: users.filter((x) => x.sub && x.sub.status === "pending").length,
        cancelled: users.filter((x) => x.sub && x.sub.status === "cancelled").length,
        mrr,
        online: users.filter((x) => Date.now() - Math.max(x.lastSeen, x.lastLogin) < 15 * 60 * 1000).length
      },
      users,
      billing: { price: billing.price, reason: billing.reason },
      plans,
      catalog: CATALOG.map((c) => ({ id: c.id, label: c.label })),
      mp: { hasToken: !!m.accessToken, tokenMask: mask(m.accessToken), hasSecret: !!m.webhookSecret, live: /^APP_USR-/.test(m.accessToken), webhookUrl: SITE + "/api/webhook" },
      admins: [OWNER].concat(admins.filter((e) => e !== OWNER))
    };
  },

  async saveMp(u, b) {
    if (!u.owner) bad("Só o dono do painel altera as chaves.", 403);
    const upd = {};
    if (typeof b.accessToken === "string" && b.accessToken.trim()) {
      const t = b.accessToken.trim();
      if (!/^(APP_USR|TEST)-/.test(t)) bad("O Access Token do Mercado Pago começa com APP_USR- (produção) ou TEST-.");
      upd.accessToken = t;
    }
    if (typeof b.webhookSecret === "string" && b.webhookSecret.trim()) upd.webhookSecret = b.webhookSecret.trim();
    if (b.clearSecret) upd.webhookSecret = "";
    if (!Object.keys(upd).length) bad("Nada para salvar.");
    await cfgRef("mp").set(Object.assign(upd, { updatedAt: Date.now(), updatedBy: u.email }), { merge: true });
    return { ok: true };
  },

  async testMp() {
    const r = await mp("/users/me");
    return { ok: true, nickname: r.nickname || "", email: r.email || "", site: r.site_id || "" };
  },

  async setPrice(u, b) {
    const price = Math.round(Number(String(b.price).replace(",", ".")) * 100) / 100;
    if (!(price >= 1 && price <= 10000)) bad("Informe um valor válido (mínimo R$ 1,00).");
    await cfgRef("billing").set({ price, reason: String(b.reason || "Lousa Digital Pro").slice(0, 120), updatedAt: Date.now(), updatedBy: u.email }, { merge: true });
    let updated = 0, failed = 0;
    if (b.applyToActive) {
      // atualiza o valor da cobrança mensal de quem já assina, direto no Mercado Pago
      const snap = await db.collection("subscriptions").where("status", "in", ["authorized", "paused"]).get();
      for (const d of snap.docs) {
        const s = d.data();
        if (!s.preapprovalId || s.manual) continue;
        try {
          await mp("/preapproval/" + encodeURIComponent(s.preapprovalId), { method: "PUT", body: { auto_recurring: { transaction_amount: price, currency_id: "BRL" } } });
          await d.ref.set({ amount: price, updatedAt: Date.now() }, { merge: true });
          updated++;
        } catch (e) { failed++; console.warn("preço", d.id, e.message); }
      }
    }
    return { ok: true, price, updated, failed };
  },

  async savePlans(u, b) {
    if (!b.plans || typeof b.plans !== "object") bad("Dados inválidos.");
    const plans = cleanPlans(b.plans);
    await cfgRef("plans").set(Object.assign({}, plans, { updatedAt: Date.now(), updatedBy: u.email }));
    return { ok: true, plans };
  },

  async syncAll() {
    const snap = await db.collection("subscriptions").get();
    let n = 0, failed = 0;
    for (const d of snap.docs) {
      const s = d.data();
      if (!s.preapprovalId || s.manual) continue;
      try { await syncPreapproval(s.preapprovalId, d.id); n++; } catch (e) { failed++; }
    }
    return { ok: true, synced: n, failed };
  },

  async grant(u, b) {
    if (!b.uid) bad("Usuário inválido.");
    if (b.on) await subRef(b.uid).set({ manual: true, status: "manual", grantedBy: u.email, updatedAt: Date.now() }, { merge: true });
    else await subRef(b.uid).set({ manual: false, updatedAt: Date.now() }, { merge: true });
    return { ok: true };
  },

  async cancelSub(u, b) {
    const s = (await subRef(b.uid).get()).data();
    if (!s || !s.preapprovalId) bad("Esta pessoa não tem assinatura no Mercado Pago.");
    await mp("/preapproval/" + encodeURIComponent(s.preapprovalId), { method: "PUT", body: { status: "cancelled" } });
    await syncPreapproval(s.preapprovalId, b.uid);
    return { ok: true };
  },

  async disableUser(u, b) {
    const t = await auth.getUser(b.uid);
    if (lc(t.email) === OWNER) bad("O dono do painel não pode ser bloqueado.");
    await auth.updateUser(b.uid, { disabled: !!b.disabled });
    if (b.disabled) await auth.revokeRefreshTokens(b.uid);
    return { ok: true };
  },

  async addAdmin(u, b) {
    if (!u.owner) bad("Só o dono do painel autoriza novas contas.", 403);
    const email = lc(b.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad("E-mail inválido.");
    await cfgRef("admins").set({ emails: admin.firestore.FieldValue.arrayUnion(email) }, { merge: true });
    return { ok: true };
  },

  async removeAdmin(u, b) {
    if (!u.owner) bad("Só o dono do painel remove acessos.", 403);
    const email = lc(b.email);
    if (email === OWNER) bad("O dono não pode ser removido.");
    await cfgRef("admins").set({ emails: admin.firestore.FieldValue.arrayRemove(email) }, { merge: true });
    return { ok: true };
  }
};

module.exports = wrap(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  const u = await requireAdmin(req);
  const b = body(req);
  const fn = actions[b.action];
  if (!fn) bad("Ação desconhecida.");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(await fn(u, b));
});
