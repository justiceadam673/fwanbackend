export class HttpError extends Error {
  constructor(status, message, code = "error", details) {
    super(message); this.status = status; this.code = code; this.details = details;
  }
}
export const badRequest = (m, details) => new HttpError(400, m, "bad_request", details);
export const unauthorized = (m = "Authentication required") => new HttpError(401, m, "unauthorized");
export const forbidden = (m = "You are not allowed to do that") => new HttpError(403, m, "forbidden");
export const notFound = (m = "Not found") => new HttpError(404, m, "not_found");
export const conflict = (m) => new HttpError(409, m, "conflict");
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
