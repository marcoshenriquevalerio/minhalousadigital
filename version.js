// GET /api/version -> "impressão digital" da versão publicada.
// Calculada a partir do CONTEÚDO dos arquivos do site (html, js, api, lib): qualquer arquivo substituído no GitHub
// muda o valor no deploy seguinte, sem depender de variáveis da Vercel. O site compara com a versão que a pessoa abriu.
// Para conferir: abra https://minhalousadigital.vercel.app/api/version (o valor "v" muda a cada atualização).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = process.cwd();
const EXT = /\.(html|js|json|css|svg|png|jpg|webp|ico)$/i;
const SKIP = /^(node_modules|\.git|\.vercel|\.next)$/;
let cached = null;

function walk(dir, out, depth) {
  if (depth > 3) return;
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const it of items) {
    if (SKIP.test(it.name)) continue;
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out, depth + 1);
    else if (EXT.test(it.name)) out.push(p);
  }
}
function fingerprint() {
  const files = [];
  walk(ROOT, files, 0);
  files.sort();
  const h = crypto.createHash("sha1");
  let n = 0;
  for (const f of files) {
    if (/package-lock\.json$/.test(f)) continue;
    try { h.update(path.relative(ROOT, f)); h.update(fs.readFileSync(f)); n++; } catch (e) {}
  }
  return n >= 5 ? h.digest("hex").slice(0, 14) : null;   // poucos arquivos = não deu para ler o site
}

module.exports = (req, res) => {
  // CDN guarda por 30 s (e é limpo a cada novo deploy): milhares de abas não geram milhares de execuções.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=30");
  if (cached === null) cached = fingerprint() || "";
  const env = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || "";
  res.status(200).json({ v: cached || env || "dev", src: cached ? "files" : env ? "env" : "none" });
};
