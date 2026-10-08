// GET /api/public -> preço, recursos de cada plano e as linhas dos cards (usado no site, no login e na lousa)
const { getBilling, getPlans, bullets, CATALOG, wrap } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  const [b, plans] = await Promise.all([getBilling(), getPlans()]);
  res.setHeader("Cache-Control", "s-maxage=10");
  res.status(200).json({
    price: b.price,
    plans,
    catalog: CATALOG.map((c) => ({ id: c.id, label: c.label })),
    cards: { free: bullets(plans.free, "free"), pro: bullets(plans.pro, "pro") }
  });
});
