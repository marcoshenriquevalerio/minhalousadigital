// POST /api/me -> quem sou eu? sou admin? tenho acesso Pro? e como está meu pagamento?
const { getUser, isAdminEmail, subRef, syncPreapproval, enforce, proActive, OWNER, wrap } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  const u = await getUser(req);
  const admin = u.verified && (await isAdminEmail(u.email));
  let s = (await subRef(u.uid).get()).data() || null;
  // Voltou do checkout e o aviso (webhook) ainda não chegou? Confere direto no Mercado Pago.
  if (s && s.preapprovalId && s.status === "pending") {
    try { s = (await syncPreapproval(s.preapprovalId, u.uid)) || s; } catch (e) { console.warn("sync:", e.message); }
  }
  // Pagamento atrasado: o sistema confere sozinho e, passados os 5 dias de tolerância, cancela e corta o Pro.
  if (s && !admin) { try { s = await enforce(u.uid, s); } catch (e) { console.warn("enforce:", e.message); } }
  res.status(200).json({
    admin, owner: u.email === OWNER,
    pro: admin || proActive(s),
    sub: s ? {
      status: s.status, nextPayment: s.nextPayment || 0, amount: s.amount || 0, manual: !!s.manual,
      startedAt: s.startedAt || 0, createdAt: s.createdAt || 0, lastPaidAt: s.lastPaidAt || 0,
      initPoint: s.status === "pending" ? (s.initPoint || "") : ""
    } : null
  });
});
