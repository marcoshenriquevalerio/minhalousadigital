// Mercado Pago -> POST /api/webhook : avisa quando a assinatura é autorizada, pausada, cancelada etc.
// Cadastre em: Mercado Pago > Suas integrações > (sua aplicação) > Webhooks
//   URL: https://minhalousadigital.vercel.app/api/webhook   Eventos: "Planos e assinaturas"
const { getMp, syncPreapproval, crypto, wrap, body } = require("../lib/server");

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

  if (type.includes("subscription_preapproval") && !type.includes("plan")) {
    await syncPreapproval(String(dataId));
  } else if (type.includes("authorized_payment")) {
    // cobrança mensal: busca a assinatura ligada e atualiza a próxima data
    const { mp } = require("../lib/server");
    const ap = await mp("/authorized_payments/" + encodeURIComponent(dataId));
    if (ap.preapproval_id) await syncPreapproval(String(ap.preapproval_id));
  }
  res.status(200).json({ ok: true });
});
