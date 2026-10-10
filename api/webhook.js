// Mercado Pago -> POST /api/webhook : avisa quando a assinatura é autorizada, pausada, cancelada etc.
// Cadastre em: Mercado Pago > Suas integrações > (sua aplicação) > Webhooks
//   URL: https://minhalousadigital.vercel.app/api/webhook   Eventos: "Planos e assinaturas" e "Pagamentos recorrentes de assinaturas"
const { getMp, syncPreapproval, syncPix, crypto, wrap, body } = require("../lib/server");

function assinaturaOk(req, secret, dataId) {
  const sig = String(req.headers["x-signature"] || "");
  const parts = Object.fromEntries(sig.split(",").map((p) => p.trim().split("=")));
  if (!parts.ts || !parts.v1) return false;
  const reqId = req.headers["x-request-id"] || "";
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId);
  const manifest = "id:" + id + ";request-id:" + reqId + ";ts:" + parts.ts + ";";
  const h = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(parts.v1)); } catch (e) { return false; }
}

module.exports = wrap(async (req, res) => {
  const b = body(req), q = req.query || {};
  const type = String(b.type || q.type || q.topic || "");
  const dataId = (b.data && b.data.id) || q["data.id"] || q.id;
  if (!dataId) return res.status(200).json({ ok: true });
  const { webhookSecret } = await getMp();
  if (webhookSecret && !assinaturaOk(req, webhookSecret, dataId)) return res.status(401).json({ error: "Assinatura inválida." });

  if (type === "payment") {
    await syncPix(String(dataId));   // ignora pagamentos que não são Pix gerados pelo site
  } else if (type.includes("subscription_preapproval") && !type.includes("plan")) {
    await syncPreapproval(String(dataId));
  } else if (type.includes("authorized_payment")) {
    // cobrança mensal: busca a assinatura ligada, atualiza a próxima data e anota se o pagamento foi aprovado
    const { mp, subRef } = require("../lib/server");
    const ap = await mp("/authorized_payments/" + encodeURIComponent(dataId));
    if (ap.preapproval_id) {
      const r = await syncPreapproval(String(ap.preapproval_id));
      if (r && r.uid) {
        const pay = ap.payment || {}, upd = { updatedAt: Date.now() };
        if (ap.status === "processed" && pay.status === "approved") { if (r.needsPay) { upd.needsPay = false; upd.status = "authorized"; upd.startedAt = r.startedAt || Date.now(); } upd.lastPaidAt = Date.parse(ap.last_modified || ap.debit_date) || Date.now(); upd.failCount = 0; }
        else if (ap.status === "recycling" || ["rejected", "cancelled"].includes(pay.status)) { upd.lastFailAt = Date.now(); upd.failCount = (Number(r.failCount) || 0) + 1; }
        await subRef(r.uid).set(upd, { merge: true });
      }
    }
  }
  res.status(200).json({ ok: true });
});
