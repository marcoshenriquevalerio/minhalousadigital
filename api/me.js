// POST /api/me -> quem sou eu? sou admin? tenho acesso Pro?
const { getUser, isAdminEmail, subRef, syncPreapproval, proActive, OWNER, wrap } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  const u = await getUser(req);
  const admin = u.verified && (await isAdminEmail(u.email));
  let s = (await subRef(u.uid).get()).data() || null;
  // Voltou do checkout e o aviso (webhook) ainda não chegou? Confere direto no Mercado Pago.
  if (s && s.preapprovalId && s.status === "pending") {
    try { s = (await syncPreapproval(s.preapprovalId, u.uid)) || s; } catch (e) { console.warn("sync:", e.message); }
  }
  res.status(200).json({
    admin, owner: u.email === OWNER,
    pro: admin || proActive(s),
    sub: s ? { status: s.status, nextPayment: s.nextPayment || 0, amount: s.amount || 0, manual: !!s.manual } : null
  });
});
