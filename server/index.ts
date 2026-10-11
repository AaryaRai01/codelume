import "dotenv/config";
import express from "express";
import cors from "cors";
import { handleDemo } from "./routes/demo";

export function createServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Production frontend proxy. Only the Codelume API routes are forwarded.
  app.use("/api", async (req, res, next) => {
    if (!((req.method === "GET" && /^\/(health|analysis\/[a-zA-Z0-9-]+)$/.test(req.path)) || (req.method === "POST" && (["/analyze", "/chat"].includes(req.path) || /^\/analysis\/[a-zA-Z0-9-]+\/retry-ai$/.test(req.path))))) return next();
    try {
      const base = (process.env.CODELUME_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
      const result = await fetch(base + req.path, { method: req.method, headers: { "Content-Type": "application/json" }, ...(req.method === "POST" ? { body: JSON.stringify(req.body) } : {}), signal: AbortSignal.timeout(90000) });
      res.status(result.status).type("application/json").send(await result.text());
    } catch {
      res.status(503).json({ detail: "FastAPI is unavailable. Start the Codelume backend and retry." });
    }
  });

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  return app;
}
