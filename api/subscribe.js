// POST /api/subscribe -> cria a assinatura recorrente no Mercado Pago e devolve o link de pagamento.
// O Mercado Pago cobra assim que a pessoa autoriza (mesmo dia) e depois todo mês nesse mesmo dia, sozinho.
const { getUser, getBilling, mp, subRef, proActive, SITE, wrap, body } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  const u = await getUser(req);
  const cur = (await subRef(u.uid).get()).data();
  if (cur && cur.status === "authorized") return res.status(200).json({ already: true });
  const b = await getBilling();
  const input = body(req), token = String(input.token || "").trim();
  // Com token do cartão (formulário dentro do site) a assinatura já nasce autorizada e cobra na hora.
  // Sem token, cai no modo antigo: devolve o link do checkout do Mercado Pago.
  const p = await mp("/preapproval", {
    method: "POST",
    body: {
      reason: b.reason,
      external_reference: u.uid,
      payer_email: String(input.email || u.email).trim().toLowerCase(),
      back_url: SITE + "/?mp=retorno",
      status: token ? "authorized" : "pending",
      ...(token ? { card_token_id: token } : {}),
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: b.price, currency_id: "BRL" }
    }
  });
  if (token && p.status !== "authorized") {
    const e = new Error("O pagamento não foi aprovado. Confira os dados do cartão ou use outro cartão."); e.status = 402; throw e;
  }
  await subRef(u.uid).set({
    preapprovalId: p.id, status: "pending", amount: b.price, payerEmail: u.email, name: u.name,
    nextPayment: (p.next_payment_date && Date.parse(p.next_payment_date)) || (cur && cur.nextPayment) || 0,
    createdAt: Date.now(), updatedAt: Date.now(),
    initPoint: p.init_point || "", startedAt: token ? Date.now() : 0, lastPaidAt: token ? Date.now() : 0, cancelReason: "", cancelledAt: 0
  }, { merge: true });
  res.status(200).json(token ? { ok: true, status: p.status } : { url: p.init_point });
});
