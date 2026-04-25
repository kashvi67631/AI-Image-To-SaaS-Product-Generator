import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { ZodError } from "zod";
import { imageToStructuredReact } from "./gemini.js";

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST?.trim() || "0.0.0.0";

/** Comma-separated list; defaults allow the Next.js dev server on port 3001. */
const corsOrigins = (
  process.env.ALLOWED_ORIGINS ?? "http://localhost:3001,http://127.0.0.1:3001"
).split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim();
const isGeminiConfigured = Boolean(GEMINI_API_KEY);

const allowedMime = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

const app = express();

console.log("[server] CORS allowed origins:", corsOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = origin.replace(/\/$/, "");
      const isAllowed = corsOrigins.includes(normalized);
      callback(isAllowed ? null : new Error(`CORS blocked for origin: ${origin}`), isAllowed);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    credentials: false,
    optionsSuccessStatus: 204,
  }),
);

app.get("/health", (_req, res) => {
  if (!isGeminiConfigured) {
    res.status(503).json({
      ok: false,
      error: "GEMINI_API_KEY is missing",
      message:
        "Set GEMINI_API_KEY in your backend .env before calling /api/image-to-react.",
    });
    return;
  }
  res.json({ ok: true, model: GEMINI_MODEL });
});

app.post(
  "/api/image-to-react",
  upload.single("image"),
  async (req, res): Promise<void> => {
    console.log("[api/image-to-react] request received", {
      origin: req.headers.origin,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
    });

    if (!GEMINI_API_KEY) {
      console.error("[api/image-to-react] GEMINI_API_KEY missing");
      res.status(500).json({
        error: "Server misconfiguration: GEMINI_API_KEY is not set",
      });
      return;
    }

    const file = req.file;
    if (!file?.buffer?.length) {
      console.warn("[api/image-to-react] no file parsed — check multipart field name 'image' and Content-Type boundary");
      res.status(400).json({
        error: "Expected multipart field \"image\" with image bytes",
      });
      return;
    }

    console.log("[api/image-to-react] file ok", {
      fieldname: file.fieldname,
      mimetype: file.mimetype,
      size: file.size,
    });

    const mimeType = file.mimetype;
    if (!allowedMime.has(mimeType)) {
      res.status(400).json({
        error: `Unsupported image type: ${mimeType}`,
      });
      return;
    }

    try {
      console.log("[api/image-to-react] calling Gemini...");
      const result = await imageToStructuredReact({
        apiKey: GEMINI_API_KEY,
        model: GEMINI_MODEL,
        imageBase64: file.buffer.toString("base64"),
        mimeType,
      });
      console.log("[api/image-to-react] Gemini ok", { componentName: result.componentName });
      res.json(result);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(502).json({
          error: "Model JSON did not match the expected schema",
          details: err.flatten(),
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: message });
    }
  },
);

app.listen(PORT, HOST, () => {
  const displayHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Listening on http://${displayHost}:${PORT}`);
  console.log(`Bound host: ${HOST}`);
  console.log(`Model: ${GEMINI_MODEL}`);
  if (!isGeminiConfigured) {
    console.error(
      "[CONFIG ERROR] GEMINI_API_KEY is not set. Requests to /api/image-to-react will fail.",
    );
  }
});

