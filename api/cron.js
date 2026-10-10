// GET /api/cron -> roda todo dia (vercel.json). Confere as assinaturas atrasadas e cancela quem passou dos 5 dias sem pagar.
// Opcional: defina CRON_SECRET na Vercel e só a própria Vercel consegue chamar.
const { db, enforce, wrap } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  const sec = process.env.CRON_SECRET;
  if (sec && req.headers.authorization !== "Bearer " + sec) { const e = new Error("Não autorizado."); e.status = 401; throw e; }
  const snap = await db.collection("subscriptions").where("status", "in", ["authorized", "pending", "paused"]).get();
  let checked = 0, cancelled = 0, failed = 0;
  for (const d of snap.docs) {
    const s = d.data();
    if (s.manual === true || !s.preapprovalId) continue;
    checked++;
    try { const r = await enforce(d.id, s); if (r.status === "cancelled" && s.status !== "cancelled") cancelled++; }
    catch (e) { failed++; console.warn("cron", d.id, e.message); }
  }
  res.status(200).json({ ok: true, checked, cancelled, failed });
});
