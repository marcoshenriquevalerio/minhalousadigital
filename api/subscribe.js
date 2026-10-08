// POST /api/subscribe -> cria a assinatura recorrente no Mercado Pago e devolve o link de pagamento.
// O Mercado Pago cobra assim que a pessoa autoriza (mesmo dia) e depois todo mês nesse mesmo dia, sozinho.
const { getUser, getBilling, mp, subRef, proActive, SITE, wrap } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  const u = await getUser(req);
  const cur = (await subRef(u.uid).get()).data();
  if (cur && cur.status === "authorized") return res.status(200).json({ already: true });
  const b = await getBilling();
  const p = await mp("/preapproval", {
    method: "POST",
    body: {
      reason: b.reason,
      external_reference: u.uid,
      payer_email: u.email,
      back_url: SITE + "/?mp=retorno",
      status: "pending",
      auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: b.price, currency_id: "BRL" }
    }
  });
  await subRef(u.uid).set({
    preapprovalId: p.id, status: "pending", amount: b.price, payerEmail: u.email, name: u.name,
    nextPayment: (cur && cur.nextPayment) || 0, createdAt: Date.now(), updatedAt: Date.now()
  }, { merge: true });
  res.status(200).json({ url: p.init_point });
});
