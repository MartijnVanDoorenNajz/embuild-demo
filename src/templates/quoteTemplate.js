const fs = require("fs");
const path = require("path");

function imageFileToDataURI(filePath) {
  try {
    if (!filePath) return null;
    const abs = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    if (!fs.existsSync(abs)) return null;
    const ext = path.extname(abs).toLowerCase().replace(".", "");
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "png"
        ? "image/png"
        : ext === "webp"
        ? "image/webp"
        : ext === "svg"
        ? "image/svg+xml"
        : "application/octet-stream";
    const data = fs.readFileSync(abs).toString("base64");
    return `data:${mime};base64,${data}`;
  } catch {
    return null;
  }
}

/**
 * NL A4-offerte (compact, 1 kolom, bullets, merk-kleur #eb5c25)
 * @param {Object} params
 * @param {Object} params.company  (expects .brandColor and optional .logo local path)
 * @param {Object} params.meta     { quoteId, date, clientName, siteAddress }
 * @param {String[]} params.projectBulletsNL
 * @param {String|null} params.beforeImgDataURI
 * @param {String|null} params.afterImgDataURI
 * @param {Boolean} params.showAfterPlaceholder
 */
function quoteTemplate({
  company,
  meta,
  projectBulletsNL,
  beforeImgDataURI,
  afterImgDataURI,
  showAfterPlaceholder,
}) {
  const logoDataURI = imageFileToDataURI(company.logo);
  const escape = (s) =>
    String(s || "").replace(
      /[&<>"]/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
        }[c])
    );

  const bulletsHTML = (projectBulletsNL || [])
    .map((b) => `<li>${escape(b)}</li>`)
    .join("");

  const wayHTML = (company.wayOfWorking || [])
    .map((w) => `<li>${escape(w)}</li>`)
    .join("");
  const termsHTML = (company.terms || [])
    .map((t) => `<li>${escape(t)}</li>`)
    .join("");

  const brand = company.brandColor || "#eb5c25";

  return /* html */ `
<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8" />
<title>Offerte ${escape(meta.quoteId)} - ${escape(company.name)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { size: A4; margin: 12mm; } /* iets strakker */
  :root {
    --fg: #141518;
    --muted: #5b6472;
    --accent: ${brand};
    --border: #e6e8ec;
    --bg-soft: #fafbfc;
    --chip: #fde8df; /* licht accent */
  }
  * { box-sizing: border-box; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
    color: var(--fg);
    line-height: 1.45;
    font-size: 10pt;              /* kleiner, zoals gevraagd */
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .logo { height: 36px; }
  .chip {
    background: var(--chip);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 999px;
    padding: 2px 10px;
    font-size: 9.2pt;
    font-weight: 600;
  }
  .company {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-soft);
    margin-bottom: 10px;
  }
  .company h1 { font-size: 12.5pt; margin: 0 0 2px 0; }
  .company small { color: var(--muted); }
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    font-size: 9.6pt;
  }
  h2 {
    font-size: 11.5pt;           /* kleinere koppen */
    margin: 12px 0 6px 0;
    padding-bottom: 5px;
    border-bottom: 2px solid var(--accent);
  }
  .card {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
    background: white;
    margin-bottom: 10px;
  }
  ul { padding-left: 18px; margin: 6px 0 0 0; }
  ul li { margin: 2px 0; }
  .gallery {
    display: grid;
    grid-template-columns: 1fr 1fr; /* naast elkaar, zelfde pagina */
    gap: 10px;
    margin-top: 6px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  figure {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 6px;
    background: white;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  figure img {
    width: 100%;
    height: 195px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: #fff;
  }
  .placeholder {
    height: 195px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background: repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 10px,#f8fafc 10px,#f8fafc 20px);
    border: 1px dashed #cbd5e1;
    text-align: center;
    padding: 0 10px;
    color: #475569;
    font-size: 9.6pt;
  }
  figcaption {
    margin-top: 6px;
    font-size: 9.2pt;
    color: var(--muted);
    text-align: center;
  }
  footer {
    margin-top: 14px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    font-size: 9.2pt;
    color: var(--muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>

<header>
  ${
    logoDataURI
      ? `<img class="logo" src="${logoDataURI}" alt="${escape(
          company.name
        )} logo" />`
      : ""
  }
  <span class="chip">Offerte</span>
</header>

<section class="company">
  <div>
    <h1>${escape(company.name)}</h1>
    ${company.tagline ? `<small>${escape(company.tagline)}</small>` : ""}
    <div style="margin-top:6px;">
      ${escape(company.address)}<br/>
      BTW: ${escape(company.vat)}<br/>
      ${escape(company.phone)} · <a href="mailto:${escape(
    company.email
  )}">${escape(company.email)}</a><br/>
      <a href="${escape(company.website)}">${escape(company.website)}</a>
    </div>
  </div>
  <div class="meta">
    <div><strong>Offertenummer:</strong> ${escape(meta.quoteId)}</div>
    <div><strong>Datum:</strong> ${escape(meta.date)}</div>
    ${
      meta.clientName
        ? `<div><strong>Klant:</strong> ${escape(meta.clientName)}</div>`
        : ""
    }
    ${
      meta.siteAddress
        ? `<div><strong>Werf:</strong> ${escape(meta.siteAddress)}</div>`
        : ""
    }
  </div>
</section>

<section class="card">
  <h2>Projectoverzicht</h2>
  <ul>
    ${bulletsHTML}
  </ul>
</section>

<section>
  <h2>Voor &amp; Na — AI-impressie</h2>
  <div class="gallery">
    <figure>
      ${
        beforeImgDataURI
          ? `<img src="${beforeImgDataURI}" alt="Voor-foto" />`
          : `<div class="placeholder">Voor-foto niet beschikbaar</div>`
      }
      <figcaption>Voor</figcaption>
    </figure>
    <figure>
      ${
        afterImgDataURI
          ? `<img src="${afterImgDataURI}" alt="Na-foto" />`
          : `<div class="placeholder">${
              showAfterPlaceholder
                ? "Na-visual wordt gegenereerd en toegevoegd aan de definitieve offerte."
                : "Na-foto niet beschikbaar"
            }</div>`
      }
      <figcaption>Na</figcaption>
    </figure>
  </div>
</section>

<section class="card">
  <h2>Onze werkwijze</h2>
  <ul>${wayHTML}</ul>
</section>

<section class="card">
  <h2>${escape(company.termsTitle || "Voorwaarden")}</h2>
  <ul>${termsHTML}</ul>
</section>

<footer>
  <div>Opgesteld door ${escape(company.name)}</div>
  <div>Pagina 1 van 1</div>
</footer>

</body>
</html>
`;
}

module.exports = { quoteTemplate, imageFileToDataURI };
