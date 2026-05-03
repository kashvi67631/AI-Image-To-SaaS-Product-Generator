import "dotenv/config";
import cors from "cors";
import express from "express";
import multer from "multer";
import { ZodError } from "zod";
import { imageToStructuredReact } from "./gemini.js";
import { streamPromptGenerateToResponse } from "./prompt-stream.js";

const PORT = Number(process.env.PORT || 8080) || 8080;

/** Comma-separated list with safe local defaults + optional production frontend URL. */
const defaultCorsOrigins = [
  "http://localhost:3000", // Next.js dev (explicit; keep for CORS)
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3002",
];
const productionFrontendUrl =
  process.env.PRODUCTION_FRONTEND_URL?.trim() ||
  process.env.FRONTEND_URL?.trim() ||
  process.env.VERCEL_PRODUCTION_URL?.trim() ||
  "";
const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
/** Union: always include local dev ports; append env + production URL (no accidental CORS lockout). */
const corsOrigins = [...defaultCorsOrigins, ...fromEnv, productionFrontendUrl]
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i);
const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() ||
  process.env.GEMINI_MODEL_NAME?.trim() ||
  "gemini-1.5-flash";
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

app.use(express.json({ limit: "4mb" }));

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
    allowedHeaders: ["Content-Type", "Accept", "Authorization", "X-Requested-With"],
    credentials: true,
    optionsSuccessStatus: 204,
  }),
);

app.post("/api/generate", async (req, res): Promise<void> => {
  console.log("[api/generate] request", { origin: req.headers.origin });
  await streamPromptGenerateToResponse(req.body, res);
});

app.get("/health", (req, res) => {
  console.log("[/health] request received", {
    method: req.method,
    url: req.url,
    host: req.headers.host,
    "user-agent": req.headers["user-agent"]?.slice(0, 80),
  });
  /** Read at request time so a restarted process always reflects the current `process.env`. */
  if (!process.env.GEMINI_API_KEY?.trim()) {
    res.status(503).json({
      ok: false,
      error: "GEMINI_API_KEY is missing",
      message:
        "Set GEMINI_API_KEY in backend .env and restart the Express server after rotating the key.",
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

    if (!process.env.GEMINI_API_KEY?.trim()) {
      console.error("[api/image-to-react] GEMINI_API_KEY missing");
      res.status(500).json({
        error: "Server misconfiguration: GEMINI_API_KEY is not set",
      });
      return;
    }

    const geminiApiKey = process.env.GEMINI_API_KEY.trim();

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
        apiKey: geminiApiKey,
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

/** `0.0.0.0` — all interfaces; frontend can still use http://127.0.0.1:PORT */
console.log(
  `[server] app.listen(${PORT}, "0.0.0.0") — process.env.PORT=${process.env.PORT === undefined ? "(unset)" : JSON.stringify(process.env.PORT)}`,
);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend is ALIVE — bound to 0.0.0.0:${PORT} (all IPv4 interfaces; not 127.0.0.1-only)`);
  console.log(`Reachable from this machine at http://127.0.0.1:${PORT} and http://localhost:${PORT}`);
  console.log(`Model: ${GEMINI_MODEL}`);
  if (!isGeminiConfigured) {
    console.error(
      "[CONFIG ERROR] GEMINI_API_KEY is not set. Requests to /api/image-to-react will fail.",
    );
  }
});

