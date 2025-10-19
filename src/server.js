require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const dayjs = require("dayjs");
require("dayjs/locale/nl-be"); // 🇳🇱 locale
dayjs.locale("nl-be");
const puppeteer = require("puppeteer");
const OpenAI = require("openai");
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));
const { quoteTemplate } = require("./templates/quoteTemplate");

// ---------- CONFIG ----------
const app = express();
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const OUTPUT_DIR = path.join(process.cwd(), "output");

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const NANO_BANANA_KEY = process.env.NANO_BANANA_API_KEY;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;
const NANO_CALLBACK_URL =
  process.env.NANO_CALLBACK_URL || "https://example.com/callback";

// 👉 NEW: default response mode (dev=file, prod=buffer), overridable per request
const RESPONSE_MODE_DEFAULT =
  process.env.RESPONSE_MODE ||
  (process.env.NODE_ENV === "production" ? "buffer" : "file");

// Brand & logo (runtime download)
const BRAND_COLOR = "#eb5c25";
const LOGO_URL =
  "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcStNNa-sklLwVkBAUB9v6_oXXD6UPf76pgMug&s";

if (!OPENAI_KEY) console.warn("⚠️  OPENAI_API_KEY not set");
if (!NANO_BANANA_KEY) console.warn("⚠️  NANO_BANANA_API_KEY not set");
if (!PUBLIC_BASE_URL)
  console.warn(
    "⚠️  PUBLIC_BASE_URL not set (required for NanoBanana to fetch your images)"
  );

fs.ensureDirSync(UPLOADS_DIR);
fs.ensureDirSync(OUTPUT_DIR);

// ---------- CLIENTS ----------
const openai = new OpenAI({ apiKey: OPENAI_KEY });

// ---------- UPLOADS ----------
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
    cb(null, `${base}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---------- HELPERS ----------
const toDataURI = async (p) => {
  const abs = path.resolve(p);
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
  const buf = await fs.readFile(abs);
  return `data:${mime};base64,${buf.toString("base64")}`;
};

async function downloadFile(url, destPath) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed: ${r.status} ${r.statusText}`);
  const buf = await r.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buf));
  return destPath;
}

// ---------- LLM: NL QUOTE BULLETS (short, readable) ----------
async function generateDutchBullets(bulletPoints) {
  const prompt = `
Je bent een professionele copywriter voor een dakrenovatiebedrijf. Zet de volgende kernpunten om naar 4–7 korte, heldere opsommingstekens in het Nederlands (geen lange alinea). Schrijf in de toekomende tijd en vermijd marketingtaal. Elke bullet één zin.

Kernpunten:
${bulletPoints.join("\n")}

Vereisten:
- Houd het concreet en begrijpelijk voor een particuliere klant.
- Gebruik geen sub-bullets, geen emojis.
- Geen inleidende of afsluitende alinea; enkel bullets.
`.trim();

  const response = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      {
        role: "system",
        content:
          "Je schrijft korte, duidelijke Nederlandstalige werkomschrijvingen voor offertes van dakrenovaties.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.6,
  });

  const text = response.choices[0].message.content.trim();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
  return lines.length ? lines : bulletPoints; // fallback
}

// ---------- LLM: EDITING PROMPT for NanoBanana (NL) ----------
async function generateAfterEditPrompt({ bulletPoints, beforeImagePublicUrl }) {
  const msg = [
    {
      role: "system",
      content:
        "Je schrijft precieze image-editing prompts voor dakrenovaties. Realistisch, behoud perspectief en geometrie.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Maak een beknopte, uitvoerbare edit-prompt (max. 120 woorden) om de BEFORE-foto te transformeren naar een realistische AFTER-foto op basis van onderstaande scope.`,
        },
        { type: "text", text: `BEFORE URL: ${beforeImagePublicUrl}` },
        {
          type: "text",
          text: `Scope:
${bulletPoints.map((b) => "- " + b).join("\n")}

Eisen:
- Zelfde camerahoek, dakhelling en gebouwvolume behouden.
- Pas enkel zichtbare elementen aan volgens de scope (nieuwe pannen, goten, dakramen, etc.). Interne isolatie niet zichtbaar maken.
- Opgeruimde werf, afgewerkt resultaat.
- Natuurlijk daglicht, realistische materialen/kleuren.
- Beschrijf wat te wijzigen en wat te behouden; geen marketingzin.`,
        },
      ],
    },
  ];

  const r = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: msg,
    temperature: 0.5,
  });

  return r.choices[0].message.content.trim();
}

// ---------- NanoBanana: submit + poll ----------
async function submitNanoBananaTask({
  prompt,
  imageUrl,
  imageSize = "4:3",
  numImages = 1,
}) {
  const body = {
    prompt,
    type: "IMAGETOIMAGE",
    imageUrls: [imageUrl],
    numImages,
    image_size: imageSize,
    callBackUrl: NANO_CALLBACK_URL,
  };

  const resp = await fetch(
    "https://api.nanobananaapi.ai/api/v1/nanobanana/generate",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NANO_BANANA_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(
      `NanoBanana submit failed: ${resp.status} ${resp.statusText} — ${txt}`
    );
  }
  const data = await resp.json();
  if (data?.code !== 200 || !data?.data?.taskId) {
    throw new Error(`NanoBanana unexpected response: ${JSON.stringify(data)}`);
  }
  return data.data.taskId;
}

async function pollNanoBananaTask(taskId, opts = {}) {
  const { timeoutMs = 120000, intervalMs = 2500 } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const url = new URL(
      "https://api.nanobananaapi.ai/api/v1/nanobanana/record-info"
    );
    url.searchParams.set("taskId", taskId);

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${NANO_BANANA_KEY}` },
    });
    if (!resp.ok)
      throw new Error(
        `NanoBanana poll failed: ${resp.status} ${resp.statusText}`
      );
    const json = await resp.json();

    const flag = json?.data?.successFlag;
    if (flag === 1) {
      const resultUrl = json?.data?.response?.resultImageUrl;
      if (!resultUrl)
        throw new Error("NanoBanana: success but no resultImageUrl");
      return { resultUrl };
    }
    if (flag === 2 || flag === 3) {
      const err = json?.data?.errorMessage || "generation failed";
      throw new Error(`NanoBanana task failed: ${err}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("NanoBanana task polling timed out");
}

// ---------- ROUTES ----------
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post(
  "/quote",
  upload.fields([
    { name: "before", maxCount: 1 },
    { name: "after", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const beforeFile = req.files?.before?.[0];
      const afterFile = req.files?.after?.[0];
      const {
        description,
        clientName,
        siteAddress,
        quoteId,
        generateAfter = "true",
      } = req.body || {};

      if (!beforeFile)
        return res
          .status(400)
          .json({ error: "Ontbrekende vereiste: bestand 'before'." });
      if (!description || !String(description).trim())
        return res
          .status(400)
          .json({ error: "Ontbrekende vereiste: veld 'description'." });

      // Load and enrich company config
      const company = await fs.readJSON(
        path.join(__dirname, "config", "company.json")
      );
      company.brandColor = BRAND_COLOR;
      try {
        const logoPath = path.join(UPLOADS_DIR, "brand-logo.png");
        await downloadFile(LOGO_URL, logoPath);
        company.logo = logoPath;
      } catch (e) {
        console.warn("Logo download failed, proceeding without:", e.message);
      }

      // Parse bullets ➜ LLM NL bullets
      const baseBullets = String(description || "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean);

      const projectBulletsNL = await generateDutchBullets(baseBullets);

      // BEFORE image
      const beforeLocalPath = beforeFile.path;
      const beforeImgDataURI = await toDataURI(beforeLocalPath);

      // AFTER image (uploaded or AI-generated)
      let afterImgDataURI = null;
      if (afterFile) {
        afterImgDataURI = await toDataURI(afterFile.path);
      } else if (
        String(generateAfter).toLowerCase() === "true" &&
        PUBLIC_BASE_URL &&
        NANO_BANANA_KEY
      ) {
        const beforePublicUrl = `${PUBLIC_BASE_URL}/uploads/${path.basename(
          beforeLocalPath
        )}`;
        const editPrompt = await generateAfterEditPrompt({
          bulletPoints: projectBulletsNL,
          beforeImagePublicUrl: beforePublicUrl,
        });
        const taskId = await submitNanoBananaTask({
          prompt: editPrompt,
          imageUrl: beforePublicUrl,
          imageSize: "4:3",
          numImages: 1,
        });
        const { resultUrl } = await pollNanoBananaTask(taskId);
        const afterPath = path.join(UPLOADS_DIR, `after-${Date.now()}.jpg`);
        await downloadFile(resultUrl, afterPath);
        afterImgDataURI = await toDataURI(afterPath);
      }

      // Meta
      const now = dayjs();
      const id = String(quoteId || `Q-${now.format("YYYYMMDD-HHmmss")}`);
      const meta = {
        quoteId: id,
        date: now.format("D MMMM YYYY"),
        clientName: clientName || "",
        siteAddress: siteAddress || "",
      };

      // HTML
      const html = quoteTemplate({
        company,
        meta,
        projectBulletsNL,
        beforeImgDataURI,
        afterImgDataURI,
        showAfterPlaceholder: !afterImgDataURI,
      });

      // ---------- PDF (dual mode) ----------
      const browser = await puppeteer.launch({
        headless: "new",
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote",
        ],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      await page.emulateMediaType("screen");

      const fileName = `${id}.pdf`;
      const responseMode = String(
        req.query.response || req.body.response || RESPONSE_MODE_DEFAULT
      )
        .toLowerCase()
        .trim();

      // Always render a buffer; write to disk only in "file" mode
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
      });

      await browser.close();

      if (responseMode === "buffer") {
        // Hosted / direct download mode
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${fileName}"`
        );
        return res.send(pdfBuffer);
      } else {
        // Local / file mode
        const pdfPath = path.join(OUTPUT_DIR, fileName);
        await fs.writeFile(pdfPath, pdfBuffer);
        return res.json({
          ok: true,
          fileName,
          pdfPath,
          url: `/output/${encodeURIComponent(fileName)}`,
          responseMode: "file",
        });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Aanmaken van de PDF-offerte is mislukt.",
        details: String(err.message || err),
      });
    }
  }
);

// Static
app.use("/output", express.static(OUTPUT_DIR));
app.use("/uploads", express.static(UPLOADS_DIR));

app.listen(PORT, () => {
  console.log(`✅ Roof Quotes API draait op http://localhost:${PORT}`);
  if (PUBLIC_BASE_URL) {
    console.log(`🌐 Public base URL: ${PUBLIC_BASE_URL}`);
    console.log(`   BEFORE afbeeldingen: ${PUBLIC_BASE_URL}/uploads/<bestand>`);
  } else {
    console.log(
      "ℹ️  Stel PUBLIC_BASE_URL in om BEFORE-afbeeldingen publiek toegankelijk te maken."
    );
  }
  console.log(
    `↔️  Standaard response mode: ${RESPONSE_MODE_DEFAULT} (override per request met ?response=buffer|file)`
  );
});
