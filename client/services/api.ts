import type { AnalysisResponse, ChatResponse } from "@/types";

// /api is proxied to FastAPI by Vite locally and Express in production.
const baseUrl = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
export const apiConfigured = true;
export class ApiError extends Error {
  constructor(public code: string, public detail: string) { super(code); }
}
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.detail : "Could not reach Codelume. Start the backend and try again.";
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${baseUrl}${path}`, { ...init, signal: controller.signal, headers: { "Content-Type": "application/json", ...init?.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof data.detail === "string" ? data.detail : "The service could not complete this request. Check the backend and try again.";
      throw new ApiError(response.status === 429 ? "RATE_LIMITED" : response.status === 404 ? "REPOSITORY_INACCESSIBLE" : response.status === 422 || response.status === 400 ? "INVALID_REPOSITORY" : "API_ERROR", detail);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("NETWORK", "Could not reach Codelume, or the request timed out. Make sure the FastAPI backend is running.");
  } finally { window.clearTimeout(timer); }
}
export const analyzeRepository = (repository_url: string) => request<{ analysis_id: string }>("/analyze", { method: "POST", body: JSON.stringify({ repository_url }) });
export const getAnalysis = (id: string) => request<AnalysisResponse>(`/analysis/${encodeURIComponent(id)}`);
export const askQuestion = (analysis_id: string, message: string, history: { role: string; content: string }[]) => request<ChatResponse>("/chat", { method: "POST", body: JSON.stringify({ analysis_id, message, history: history.slice(-12).map(m => ({ ...m, content: m.content.slice(0, 4000) })) }) });

export const retryAnalysisAI = (id: string) => request<{ analysis_id: string }>(`/analysis/${encodeURIComponent(id)}/retry-ai`, { method: "POST" });
