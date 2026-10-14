// GET /api/siteconfig            -> conteúdo editável do site (textos, cards extras, fundo do topo). Público.
// GET /api/siteconfig?img=ID     -> imagem enviada pelo painel
const S = require("../lib/server");
const { cfgRef, wrap } = S;

module.exports = wrap(async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Método não permitido." });
  const img = req.query && req.query.img;
  if (img) {
    if (!/^[a-z0-9]{6,24}$/.test(img)) return res.status(404).end();
    const d = await cfgRef("siteimg_" + img).get();
    const m = d.exists && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(String(d.data().data || ""));
    if (!m) return res.status(404).end();
    res.setHeader("Content-Type", m[1]);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    return res.status(200).send(Buffer.from(m[2], "base64"));
  }
  const d = await cfgRef("site").get();
  const s = d.exists ? d.data() : {};
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  res.status(200).json({ texts: s.texts || {}, fs: s.fs || {}, cards: s.cards || [], hero: s.hero || {}, cardW: s.cardW || 230, mq: s.mq || {}, mv: s.mv || {}, fc: s.fc || {} });
});
