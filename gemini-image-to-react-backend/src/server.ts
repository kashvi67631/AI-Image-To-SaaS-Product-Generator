import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";

/** Resolve `.env` from package root (works for `tsx src/server.ts` and `node dist/server.js`). */
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config({ path: path.join(backendRoot, ".env.local"), override: true });
import multer from "multer";
import { ZodError } from "zod";
import { imageToStructuredReact } from "./gemini.js";
import { streamPromptGenerateToResponse } from "./prompt-stream.js";

const PORT = Number(process.env.PORT || 8080) || 8080;
/** Bind all IPv4 interfaces so 127.0.0.1 and LAN work; avoids “localhost” resolving to ::1 only. */
const LISTEN_HOST = (process.env.LISTEN_HOST ?? process.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";

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

/** Strict allowlist only when NODE_ENV=production (npm run dev / tsx usually unset → permissive). */
const isProduction = process.env.NODE_ENV === "production";

/** Local dev (e.g. Next on :3001): reflect browser origin + cookies if needed. */
const corsDevelopment = cors({
  origin: true,
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204,
});

console.log(
  "[server] CORS:",
  isProduction ? `production allowlist (${corsOrigins.length} origins)` : "development: { origin: true, credentials: true }",
);

app.use(
  isProduction
    ? cors({
        origin: (origin, callback) => {
          if (!origin) {
            callback(null, true);
            return;
          }
          const normalized = origin.replace(/\/$/, "");
          const isAllowed = corsOrigins.includes(normalized);
          callback(
            isAllowed ? null : new Error(`CORS blocked for origin: ${origin}`),
            isAllowed,
          );
        },
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Accept", "Authorization", "X-Requested-With"],
        credentials: true,
        optionsSuccessStatus: 204,
      })
    : corsDevelopment,
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
  /**
   * Always 200 when this process is serving — liveness for Next.js proxy.
   * Gemini readiness is a separate flag so missing API key is not confused with “Express unreachable”.
   */
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY?.trim());
  res.status(200).json({
    ok: true,
    alive: true,
    geminiConfigured,
    model: geminiConfigured ? GEMINI_MODEL : null,
  });
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

console.log(
  `[server] app.listen(${PORT}, ${JSON.stringify(LISTEN_HOST)}) — PORT env=${process.env.PORT === undefined ? "(unset)" : JSON.stringify(process.env.PORT)}`,
);
app.listen(PORT, LISTEN_HOST, () => {
  console.log(
    `Backend is ALIVE — bound to ${LISTEN_HOST}:${PORT} (use 0.0.0.0 for all IPv4; frontend BACKEND_URL can stay http://127.0.0.1:${PORT})`,
  );
  console.log(`Reachable from this machine at http://127.0.0.1:${PORT} and http://localhost:${PORT}`);
  console.log(`Model: ${GEMINI_MODEL}`);
  if (!isGeminiConfigured) {
    console.error(
      "[CONFIG ERROR] GEMINI_API_KEY is not set. Requests to /api/image-to-react will fail.",
    );
  }
});

