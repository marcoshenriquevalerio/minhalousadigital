// Funções compartilhadas pelo backend (Vercel Functions).
// Variáveis de ambiente necessárias na Vercel:
//   FIREBASE_SERVICE_ACCOUNT  -> JSON da conta de serviço do Firebase (uma linha)
//   OWNER_EMAIL (opcional)    -> e-mail dono do painel (padrão: excellentservices.excel@gmail.com)
//   SITE_URL (opcional)       -> padrão: https://minhalousadigital.vercel.app
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  let sa;
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || ""); }
  catch (e) { throw new Error("Variável FIREBASE_SERVICE_ACCOUNT ausente ou inválida."); }
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}
const db = admin.firestore();
const auth = admin.auth();

const OWNER = String(process.env.OWNER_EMAIL || "excellentservices.excel@gmail.com").trim().toLowerCase();
const SITE = String(process.env.SITE_URL || "https://minhalousadigital.vercel.app").replace(/\/+$/, "");
const lc = (s) => String(s || "").trim().toLowerCase();

/* ---------- configuração guardada no Firestore (só o servidor lê/escreve) ---------- */
const cfgRef = (n) => db.collection("_config").doc(n);
async function getBilling() {
  const s = await cfgRef("billing").get();
  const d = s.exists ? s.data() : {};
  return { price: Number(d.price) > 0 ? Number(d.price) : 19.9, reason: d.reason || "Lousa Digital Pro", updatedAt: d.updatedAt || 0 };
}
async function getMp() {
  const s = await cfgRef("mp").get();
  const d = s.exists ? s.data() : {};
  return { accessToken: d.accessToken || "", webhookSecret: d.webhookSecret || "", publicKey: d.publicKey || "" };
}
async function getAdmins() {
  const s = await cfgRef("admins").get();
  return s.exists && Array.isArray(s.data().emails) ? s.data().emails.map(lc) : [];
}


/* ---------- recursos de cada plano (o dono liga/desliga no painel) ---------- */
// id, texto que aparece no card do plano, padrão no Grátis e no Pro
const CATALOG = [
  { id: "wg_clock",    label: "Widget de relógio",                  free: true,  pro: true },
  { id: "wg_calendar", label: "Widget de calendário do mês",        free: true,  pro: true },
  { id: "wg_timer",    label: "Widget de temporizador",             free: false, pro: true },
  { id: "wg_games",    label: "Minijogos (dinossauro, cobra, sinuca...)", free: false, pro: true },
  { id: "agenda",      label: "Calendário e planner de 7 dias",     free: true,  pro: true },
  { id: "images",      label: "Imagens nas lousas",                 free: false, pro: true },
  { id: "stickers",    label: "Adesivos",                           free: false, pro: true },
  { id: "finance",     label: "Finanças (tabelas, cards e gráficos)", free: false, pro: true },
  { id: "sharing",     label: "Equipe ao vivo e compartilhamento",  free: false, pro: true }
];
const BASICS = ["Listas, setas e post-its", "Giz ou canetão"];
function defaultPlans() {
  const mk = (k, max) => ({ maxBoards: max, features: Object.fromEntries(CATALOG.map((c) => [c.id, !!c[k]])) });
  return { free: mk("free", 2), pro: mk("pro", 0) };
}
function cleanPlans(p) {
  const d = defaultPlans(), out = {};
  ["free", "pro"].forEach((k) => {
    const src = (p && p[k]) || {};
    const mb = Math.floor(Number(src.maxBoards));
    out[k] = { maxBoards: mb >= 0 && mb <= 999 ? mb : d[k].maxBoards, features: {} };
    CATALOG.forEach((c) => {
      const v = src.features && src.features[c.id];
      out[k].features[c.id] = typeof v === "boolean" ? v : d[k].features[c.id];
    });
  });
  return out;
}
async function getPlans() {
  const s = await cfgRef("plans").get();
  return cleanPlans(s.exists ? s.data() : null);
}
// linhas que aparecem no card de cada plano
function bullets(plan, key) {
  const out = [plan.maxBoards > 0 ? plan.maxBoards + " quadros" : "Quadros ilimitados"].concat(BASICS);
  CATALOG.forEach((c) => { if (plan.features[c.id]) out.push(c.label); });
  if (key === "pro") out.push("Cancele quando quiser");
  return out;
}

/* ---------- autenticação ---------- */
async function getUser(req) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!tok) { const e = new Error("Não autenticado."); e.status = 401; throw e; }
  let dec;
  try { dec = await auth.verifyIdToken(tok); }
  catch (e) { const er = new Error("Sessão inválida. Entre novamente."); er.status = 401; throw er; }
  return { uid: dec.uid, email: lc(dec.email), verified: dec.email_verified !== false, name: dec.name || dec.email || "" };
}
async function isAdminEmail(email) {
  email = lc(email);
  return email === OWNER || (await getAdmins()).includes(email);
}
async function requireAdmin(req) {
  const u = await getUser(req);
  if (!u.verified || !(await isAdminEmail(u.email))) { const e = new Error("Acesso restrito."); e.status = 403; throw e; }
  u.owner = u.email === OWNER;
  return u;
}

/* ---------- Mercado Pago ---------- */
async function mp(path, opts = {}) {
  const { accessToken } = await getMp();
  if (!accessToken) { const e = new Error("Chave do Mercado Pago não configurada no painel."); e.status = 400; throw e; }
  const r = await fetch("https://api.mercadopago.com" + path, {
    method: opts.method || "GET",
    headers: Object.assign({ Authorization: "Bearer " + accessToken, "Content-Type": "application/json" }, opts.headers || {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const txt = await r.text();
  let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: txt }; }
  if (!r.ok) { const e = new Error(j.message || j.error || ("Mercado Pago respondeu " + r.status)); e.status = 502; e.mp = j; throw e; }
  return j;
}

/* ---------- assinaturas: subscriptions/{uid} ---------- */
const subRef = (uid) => db.collection("subscriptions").doc(uid);

// Traz o estado atual da assinatura no Mercado Pago e grava em subscriptions/{uid}
async function syncPreapproval(preapprovalId, uidHint) {
  const p = await mp("/preapproval/" + encodeURIComponent(preapprovalId));
  const uid = p.external_reference || uidHint;
  if (!uid) return null;
  const ref = subRef(uid);
  const prev = (await ref.get()).data() || {};
  let next = p.next_payment_date ? Date.parse(p.next_payment_date) : (prev.nextPayment || 0);
  if (p.status === "cancelled" && Number(prev.pixUntil) > next) next = Number(prev.pixUntil);   // dias já pagos por Pix nunca se perdem
  const upd = {
    preapprovalId: p.id,
    status: p.status,                       // pending | authorized | paused | cancelled
    amount: p.auto_recurring ? Number(p.auto_recurring.transaction_amount) : prev.amount || 0,
    payerEmail: lc(p.payer_email || prev.payerEmail),
    nextPayment: next || 0,
    updatedAt: Date.now()
  };
  // Assinatura nova no cartão: só vale quando a 1ª cobrança foi aprovada de verdade.
  if (p.status === "authorized" && prev.needsPay) {
    const r0 = await paymentsInfo(p.id), r = r0.state;
    if (r === "approved") { upd.needsPay = false; upd.lastPaidAt = Date.now(); for (const x of r0.list) await recordAp(uid, x).catch(() => {}); }
    else upd.status = "pending";
  }
  if (upd.status === "authorized" && !prev.startedAt) upd.startedAt = Date.now();
  await ref.set(upd, { merge: true });
  return Object.assign({ uid }, prev, upd);
}

// A 1ª cobrança do cartão foi aprovada? -> "approved" | "rejected" | "unknown"
async function paymentsInfo(preapprovalId) {
  let list = [];
  try {
    const r = await mp("/authorized_payments/search?preapproval_id=" + encodeURIComponent(preapprovalId));
    list = Array.isArray(r.results) ? r.results : [];
  } catch (e) { console.warn("firstPayment:", e.message); return { state: "unknown", list }; }
  if (list.some((x) => x.payment && x.payment.status === "approved")) return { state: "approved", list };
  if (list.length && list.every((x) => x.payment && ["rejected", "cancelled"].includes(x.payment.status))) return { state: "rejected", list };
  return { state: "unknown", list };
}
async function firstPayment(preapprovalId) { return (await paymentsInfo(preapprovalId)).state; }

/* ---------- histórico de pagamentos: subscriptions/{uid}/payments/{id} ---------- */
const TERMS_VERSION = "2026-10-10";   // ao mudar os termos: copie termos.html para termos-AAAA-MM-DD.html e troque aqui
const payRef = (uid, id) => subRef(uid).collection("payments").doc(String(id));
// ap = cobrança automática do cartão (authorized_payment do Mercado Pago)
async function recordAp(uid, ap) {
  if (!uid || !ap || !ap.id) return;
  const pay = ap.payment || {};
  let status = "";
  if (ap.status === "processed" && pay.status === "approved") status = "approved";
  else if (ap.status === "recycling" || ["rejected", "cancelled"].includes(pay.status)) status = "rejected";
  if (!status) return;
  await payRef(uid, "ap_" + ap.id).set({
    method: "card", status, amount: Number(ap.transaction_amount) || 0,
    paidAt: Date.parse(ap.last_modified || ap.debit_date) || Date.now(),
    mpPaymentId: pay.id ? String(pay.id) : "", mpChargeId: String(ap.id), statusDetail: pay.status_detail || ""
  }, { merge: true });
}

/* ---------- Pix: pagamento avulso de 30 dias, confirmado pelo Mercado Pago ---------- */
const PIX_DAYS = 30, pixRef = (id) => db.collection("pixPayments").doc(String(id));
// Confere o pagamento direto no Mercado Pago e, se foi aprovado (e ainda não contado), libera +30 dias.
// Se a pessoa tinha cartão ativo, cancela a cobrança automática para o cartão nunca mais ser debitado.
async function syncPix(paymentId) {
  const ref = pixRef(paymentId), rec = await ref.get();
  if (!rec.exists) return { found: false };
  const r = rec.data();
  if (r.applied) return { found: true, applied: true, until: r.until || 0 };
  const p = await mp("/v1/payments/" + encodeURIComponent(paymentId));
  if (p.external_reference !== r.uid || p.payment_method_id !== "pix") return { found: true, applied: false, status: "invalid" };
  if (p.status !== "approved") return { found: true, applied: false, status: p.status };
  if (Number(p.transaction_amount) + 0.001 < Number(r.amount)) return { found: true, applied: false, status: "amount" };
  const s = (await subRef(r.uid).get()).data() || {};
  if (s.preapprovalId && ["authorized", "pending", "paused"].includes(s.status)) {
    await mp("/preapproval/" + encodeURIComponent(s.preapprovalId), { method: "PUT", body: { status: "cancelled" } });
  }
  const now = Date.now();
  let until = 0;
  await db.runTransaction(async (t) => {
    const cur = await t.get(ref);
    if (cur.data().applied) { until = cur.data().until || 0; return; }
    const sd = (await t.get(subRef(r.uid))).data() || {};
    const base = Math.max(now, Number(sd.nextPayment) || 0, Number(sd.pixUntil) || 0);
    until = base + PIX_DAYS * DAY;
    t.set(subRef(r.uid), {
      status: "cancelled", method: "pix", cancelReason: "", cancelledAt: now, needsPay: false,
      pixUntil: until, nextPayment: until, amount: Number(r.amount), lastPaidAt: now,
      startedAt: sd.startedAt || now, payerEmail: r.email || sd.payerEmail || "", termsAcceptedAt: r.termsAcceptedAt || sd.termsAcceptedAt || 0, termsVersion: r.termsVersion || sd.termsVersion || "", updatedAt: now
    }, { merge: true });
    t.set(ref, { applied: true, appliedAt: now, until }, { merge: true });
    t.set(payRef(r.uid, "pix_" + paymentId), {
      method: "pix", status: "approved", amount: Number(p.transaction_amount) || Number(r.amount),
      paidAt: Date.parse(p.date_approved) || now, mpPaymentId: String(paymentId),
      periodStart: base, periodEnd: until, payerEmail: r.email || ""
    }, { merge: true });
  });
  return { found: true, applied: true, until };
}

/* ---------- cobrança: situação, tolerância de 5 dias e corte automático ---------- */
const DAY = 864e5, GRACE_DAYS = 5, SOFT = 12 * 36e5;   // 12h de folga para o aviso do Mercado Pago chegar
// k: manual | ok | grace (atrasado, dentro dos 5 dias) | expired (passou dos 5 dias) | paused | cancelled | none
function billState(s, now) {
  now = now || Date.now();
  if (!s) return { k: "none" };
  if (s.manual === true) return { k: "manual" };
  const due = Number(s.nextPayment) || 0, entry = Number(s.startedAt || s.createdAt) || 0, GRACE = GRACE_DAYS * DAY;
  if (s.status === "cancelled") return { k: "cancelled", due, entry };
  if (s.status === "pending") {   // comprou e ainda não pagou: 5 dias a partir da compra
    const base = entry || due || Number(s.updatedAt) || now, limit = base + GRACE;
    return now <= limit ? { k: "grace", pending: true, limit, due, entry } : { k: "expired", pending: true, limit, due, entry };
  }
  if (s.status !== "authorized" && s.status !== "paused") return { k: "none" };
  if (!due) return { k: s.status === "paused" ? "paused" : "ok", due, entry };
  if (s.status === "authorized" && now <= due + SOFT) return { k: "ok", due, entry };
  if (s.status === "authorized" && Number(s.lastPaidAt) >= due - SOFT) return { k: "ok", due, entry };   // o pagamento deste ciclo já foi aprovado
  if (s.status === "paused" && due > now) return { k: "paused", due, entry };
  const limit = due + GRACE;   // a data da cobrança passou e o pagamento não foi registrado
  return now <= limit ? { k: "grace", limit, due, entry } : { k: "expired", limit, due, entry };
}

// O usuário tem acesso Pro? (liberado à mão; assinatura em dia ou dentro dos 5 dias de tolerância;
// ou cancelada mas ainda dentro do período já pago)
function proActive(s) {
  if (!s) return false;
  if (s.manual === true) return true;
  if (s.status === "authorized") return billState(s).k !== "expired";
  if ((s.status === "cancelled" || s.status === "paused") && Number(s.nextPayment) > Date.now()) return true;
  if (s.status === "paused") return billState(s).k === "grace";
  return false;
}

// Atrasou? Confere de verdade no Mercado Pago e, se passou dos 5 dias sem pagar, cancela a cobrança e corta o Pro.
// Nunca mexe em quem foi liberado à mão (manual): esses não têm cobrança.
async function enforce(uid, s) {
  if (!s || s.manual === true || !s.preapprovalId) return s;
  if (!["authorized", "pending", "paused"].includes(s.status)) return s;
  let b = billState(s);
  if (b.k !== "grace" && b.k !== "expired") return s;
  if (Date.now() - (Number(s.updatedAt) || 0) > 60000) {
    try { s = (await syncPreapproval(s.preapprovalId, uid)) || s; } catch (e) { console.warn("enforce sync:", e.message); }
    b = billState(s);
  }
  if (b.k !== "expired") return s;
  try { await mp("/preapproval/" + encodeURIComponent(s.preapprovalId), { method: "PUT", body: { status: "cancelled" } }); }
  catch (e) { console.warn("enforce cancel:", e.message); }
  const upd = { status: "cancelled", cancelReason: "unpaid", cancelledAt: Date.now(), updatedAt: Date.now() };
  await subRef(uid).set(upd, { merge: true });
  return Object.assign({}, s, upd);
}

/* ---------- utilidades de resposta ---------- */
function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) {
      const st = e.status || 500;
      if (st >= 500) console.error(e);
      res.status(st).json({ error: e.message || "Erro interno." });
    }
  };
}
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch (e) { return {}; }
}

module.exports = { CATALOG, getPlans, cleanPlans, bullets, admin, db, auth, OWNER, SITE, lc, getBilling, getMp, getAdmins, cfgRef, getUser, isAdminEmail, requireAdmin, mp, subRef, syncPreapproval, firstPayment, paymentsInfo, recordAp, payRef, TERMS_VERSION, syncPix, pixRef, PIX_DAYS, proActive, billState, enforce, wrap, body, crypto };
