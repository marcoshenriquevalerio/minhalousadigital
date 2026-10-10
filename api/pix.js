// POST /api/pix  { action: "create" }            -> gera um Pix (QR Code + copia e cola) de 30 dias de Pro
// POST /api/pix  { action: "check", id }         -> confere no Mercado Pago se esse Pix foi pago
// O Pro só é liberado quando o Mercado Pago confirma o pagamento (aqui ou pelo webhook).
const crypto = require("crypto");
const { getUser, getBilling, mp, subRef, pixRef, syncPix, SITE, wrap, body, PIX_DAYS } = require("../lib/server");
const pad = (n) => String(n).padStart(2, "0");
function brTime(ms) {   // data com fuso -03:00, formato que o Mercado Pago aceita
  const d = new Date(ms - 3 * 36e5);
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()) + ".000-03:00";
}
module.exports = wrap(async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  const u = await getUser(req), b = body(req);
  if (b.action === "check") {
    const id = String(b.id || "");
    const rec = id && (await pixRef(id).get());
    if (!rec || !rec.exists || rec.data().uid !== u.uid) { const e = new Error("Pix não encontrado."); e.status = 404; throw e; }
    const r = await syncPix(id);
    return res.status(200).json({ paid: !!r.applied, status: r.status || (r.applied ? "approved" : "pending"), until: r.until || 0 });
  }
  const s = (await subRef(u.uid).get()).data();
  if (s && s.manual === true) return res.status(200).json({ already: true });
  const bill = await getBilling();
  const exp = Date.now() + 30 * 60000;
  const p = await mp("/v1/payments", {
    method: "POST",
    headers: { "X-Idempotency-Key": crypto.randomUUID() },
    body: {
      transaction_amount: bill.price,
      description: bill.reason + " - " + PIX_DAYS + " dias",
      payment_method_id: "pix",
      payer: { email: u.email },
      external_reference: u.uid,
      notification_url: SITE + "/api/webhook",
      date_of_expiration: brTime(exp)
    }
  });
  const td = (p.point_of_interaction && p.point_of_interaction.transaction_data) || {};
  if (!td.qr_code) { const e = new Error("Não foi possível gerar o Pix agora. Tente de novo."); e.status = 502; throw e; }
  await pixRef(p.id).set({ uid: u.uid, email: u.email, amount: bill.price, createdAt: Date.now(), expiresAt: exp, applied: false });
  res.status(200).json({ id: String(p.id), qr: td.qr_code, qrImage: td.qr_code_base64 || "", amount: bill.price, expiresAt: exp, days: PIX_DAYS });
});
