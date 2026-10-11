// GET /api/version -> identifica a versão publicada. Muda sozinha a cada deploy na Vercel (novo commit ou novo deploy).
// O site compara com a versão que a pessoa abriu e só avisa se ficou para trás.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(200).json({ v: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "dev" });
};
