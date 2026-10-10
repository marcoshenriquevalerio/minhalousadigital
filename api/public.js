// GET /api/public -> preço, recursos de cada plano e as linhas dos cards (usado no site, no login e na lousa)
const { getBilling, getPlans, getMp, bullets, CATALOG, wrap } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  const [b, plans, m] = await Promise.all([getBilling(), getPlans(), getMp()]);
  res.setHeader("Cache-Control", "s-maxage=10");
  res.status(200).json({
    price: b.price,
    mpKey: m.publicKey || "",   // chave pública (pode ser exibida): usada pelo formulário de cartão
    plans,
    catalog: CATALOG.map((c) => ({ id: c.id, label: c.label })),
    cards: { free: bullets(plans.free, "free"), pro: bullets(plans.pro, "pro") }
  });
});
