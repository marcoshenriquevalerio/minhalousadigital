// GET /api/public -> preço, recursos de cada plano e as linhas dos cards (usado no site, no login e na lousa)
const { getBilling, getPlans, getMp, bullets, CATALOG, wrap, cfgRef } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  const [b, plans, m, up] = await Promise.all([getBilling(), getPlans(), getMp(), cfgRef("update").get()]);
  const u = up.exists ? up.data() : {};
  res.setHeader("Cache-Control", "s-maxage=10");
  res.status(200).json({
    price: b.price,
    mpKey: m.publicKey || "",   // chave pública (pode ser exibida): usada pelo formulário de cartão
    plans,
    // aviso de atualização enviado pelo painel (id vazio = nenhum aviso ativo)
    update: u.id ? { id: String(u.id), title: u.title || "", message: u.message || "", at: u.at || 0 } : null,
    catalog: CATALOG.map((c) => ({ id: c.id, label: c.label })),
    cards: { free: bullets(plans.free, "free"), pro: bullets(plans.pro, "pro") }
  });
});
