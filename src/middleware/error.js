import { env } from "../config/env.js";

export const notFoundHandler = (req, res) =>
  res.status(404).json({ error: { code: "not_found", message: `No route for ${req.method} ${req.originalUrl}` } });

export const errorHandler = (err, req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: { code: "bad_json", message: "Request body is not valid JSON" } });
  if (err.type === "entity.too.large") return res.status(413).json({ error: { code: "too_large", message: "Request body is too large" } });
  if (err.code === 11000) return res.status(409).json({ error: { code: "duplicate", message: "That record already exists" } });
  const status = err.status || 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  res.status(status).json({
    error: {
      code: err.code || "server_error",
      message: status >= 500 && env.isProd ? "Something went wrong on the server" : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
};
