// POST /api/subscribe -> assinatura recorrente no cartão, dentro do site.
// Com { token } (formulário de cartão): cobra na hora e SÓ libera o Pro se a 1ª cobrança foi aprovada.
// Sem token: devolve o link do checkout do Mercado Pago (modo antigo, caso o formulário não carregue).
const { getUser, getBilling, mp, subRef, firstPayment, SITE, wrap, body } = require("../lib/server");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = wrap(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  const u = await getUser(req);
  const cur = (await subRef(u.uid).get()).data();
  if (cur && cur.manual === true) return res.status(200).json({ already: true });
  if (cur && cur.status === "authorized") return res.status(200).json({ already: true });
  const input = body(req), token = String(input.token || "").trim();
  const b = await getBilling();
  const now = Date.now();
  // Já pagou por Pix e ainda tem dias? O cartão só começa a cobrar quando esses dias acabarem.
  const pixLeft = cur && Number(cur.pixUntil) > now + 864e5 ? Number(cur.pixUntil) : 0;
  const rec = { frequency: 1, frequency_type: "months", transaction_amount: b.price, currency_id: "BRL" };
  if (token && pixLeft) rec.start_date = new Date(pixLeft).toISOString();
  const p = await mp("/preapproval", {
    method: "POST",
    body: Object.assign({
      reason: b.reason,
      external_reference: u.uid,
      payer_email: String(input.email || u.email).trim().toLowerCase(),
      back_url: SITE + "/?mp=retorno",
      status: token ? "authorized" : "pending",
      auto_recurring: rec
    }, token ? { card_token_id: token } : {})
  });
  const base = {
    preapprovalId: p.id, amount: b.price, payerEmail: u.email, name: u.name, updatedAt: now,
    initPoint: p.init_point || "", cancelReason: "", cancelledAt: 0
  };
  if (!token) {
    await subRef(u.uid).set(Object.assign(base, { status: "pending", createdAt: now, startedAt: 0, lastPaidAt: 0, nextPayment: (cur && cur.nextPayment) || 0 }), { merge: true });
    return res.status(200).json({ url: p.init_point });
  }
  const nextPayment = (p.next_payment_date && Date.parse(p.next_payment_date)) || pixLeft || 0;
  if (pixLeft) {   // cartão validado; a 1ª cobrança será quando o Pix acabar
    if (p.status !== "authorized") { const e = new Error("Não foi possível validar o cartão. Use outro cartão."); e.status = 402; throw e; }
    await subRef(u.uid).set(Object.assign(base, { status: "authorized", method: "card", nextPayment, startedAt: (cur && cur.startedAt) || now }), { merge: true });
    return res.status(200).json({ ok: true, status: "authorized", scheduled: pixLeft });
  }
  // Confere de verdade se a cobrança foi aprovada (até ~9s)
  let pay = "unknown";
  for (let i = 0; i < 6 && pay === "unknown"; i++) { await sleep(i ? 1500 : 800); pay = await firstPayment(p.id); }
  if (pay === "rejected" || p.status === "cancelled") {
    try { await mp("/preapproval/" + encodeURIComponent(p.id), { method: "PUT", body: { status: "cancelled" } }); } catch (e) {}
    const e = new Error("O pagamento não foi aprovado. Confira os dados do cartão ou use outro cartão."); e.status = 402; throw e;
  }
  if (pay === "approved") {
    await subRef(u.uid).set(Object.assign(base, { status: "authorized", method: "card", needsPay: false, nextPayment, createdAt: now, startedAt: now, lastPaidAt: now }), { merge: true });
    return res.status(200).json({ ok: true, status: "authorized" });
  }
  // Ainda sem resposta do banco (ex.: análise antifraude): NÃO libera. O aviso do Mercado Pago confirma depois.
  await subRef(u.uid).set(Object.assign(base, { status: "pending", method: "card", needsPay: true, nextPayment, createdAt: now, startedAt: 0, lastPaidAt: 0 }), { merge: true });
  res.status(200).json({ ok: true, status: "pending" });
});
