import axios from "axios";
import type { ApiResponse } from "@/types/generation";

const IMAGE_UPLOAD_PATH = "/api/image-to-react";
const BACKOFF_BASE_DELAY_MS = 1000;
const MAX_503_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffDelayMs(retryCount: number): number {
  const exponentialDelay = 2 ** retryCount * BACKOFF_BASE_DELAY_MS;
  const jitterRange = exponentialDelay * 0.2;
  const randomJitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(exponentialDelay + randomJitter));
}

const uploadClient = axios.create({
  timeout: 120000,
  headers: { Accept: "application/json" },
});

uploadClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!axios.isAxiosError(error)) {
      return Promise.reject(error);
    }
    const status = error.response?.status;
    const cfg = error.config;
    if ((status !== 503 && status !== 429) || !cfg) {
      return Promise.reject(error);
    }
    const retries = Number((cfg as { __retryCount?: number }).__retryCount ?? 0);
    if (retries >= MAX_503_RETRIES) {
      return Promise.reject(error);
    }
    (cfg as { __retryCount?: number }).__retryCount = retries + 1;
    await sleep(getBackoffDelayMs(retries));
    return uploadClient.request(cfg);
  },
);

/** Same-origin proxy → Express /api/image-to-react (see app/api/image-to-react/route.ts). */
export async function postImageToReact(file: File): Promise<ApiResponse> {
  const formData = new FormData();
  formData.append("image", file);
  const result = await uploadClient.post<ApiResponse>(IMAGE_UPLOAD_PATH, formData);
  return result.data;
}

export { IMAGE_UPLOAD_PATH };
