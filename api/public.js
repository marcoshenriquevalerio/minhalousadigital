// GET /api/public -> preço atual (usado no site e na tela de planos)
const { getBilling, wrap } = require("../lib/server");
module.exports = wrap(async (req, res) => {
  const b = await getBilling();
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
  res.status(200).json({ price: b.price });
});
