// FWAN API client. Copy to src/api.js in your React app.
// .env of the React app:  VITE_API_URL=http://localhost:5000      (leave empty when the backend serves the app itself)
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const KEY = "fwan_token";

export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed (${status})`);
    this.status = status; this.code = body?.error?.code; this.details = body?.error?.details;
  }
}

async function request(method, path, body, { auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, { error: { code: "network", message: "Cannot reach the FWAN server. Check your connection or that the backend is running." } });
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && getToken()) { setToken(null); window.dispatchEvent(new Event("fwan:logout")); }
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}
const get = (p) => request("GET", p), post = (p, b = {}) => request("POST", p, b), patch = (p, b) => request("PATCH", p, b), del = (p) => request("DELETE", p);
const qs = (o = {}) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")).toString(); return s ? `?${s}` : ""; };

// Firestore used Timestamp.toDate(); the API sends ISO strings. Use toDate(x) instead of x.toDate().
export const toDate = (v) => (v ? new Date(v?.toDate ? v.toDate() : v) : null);

export const api = {
  auth: {
    register: (b) => request("POST", "/auth/register", b, { auth: false }),
    login: async (b) => { const r = await request("POST", "/auth/login", b, { auth: false }); setToken(r.token); return r; },
    logout: () => setToken(null),
    me: () => get("/auth/me").then((r) => r.user),
    verifyEmail: (token) => request("POST", "/auth/verify-email", { token }, { auth: false }),
    resendVerification: (email) => request("POST", "/auth/resend-verification", { email }, { auth: false }),
    forgotPassword: (email) => request("POST", "/auth/forgot-password", { email }, { auth: false }),
    resetPassword: (token, password) => request("POST", "/auth/reset-password", { token, password }, { auth: false }),
    changePassword: (currentPassword, newPassword) => post("/auth/change-password", { currentPassword, newPassword }),
  },
  users: { updateMe: (b) => patch("/users/me", b).then((r) => r.data), publicProfile: (id) => get(`/users/${id}/public`).then((r) => r.data) },
  uploads: { image: (dataUrl) => post("/uploads/image", { dataUrl }).then((r) => r.data.url) },
  listings: {
    list: (params) => get(`/listings${qs(params)}`),                 // { data, meta }
    mine: () => get("/listings/mine").then((r) => r.data),
    get: (id) => get(`/listings/${id}`).then((r) => r.data),
    create: (b) => post("/listings", b).then((r) => r.data),
    update: (id, b) => patch(`/listings/${id}`, b).then((r) => r.data),
    remove: (id) => del(`/listings/${id}`),
    reviews: (id) => get(`/listings/${id}/reviews`).then((r) => r.data),
    addReview: (id, b) => post(`/listings/${id}/reviews`, b).then((r) => r.data),
  },
  offers: {
    list: (params) => get(`/offers${qs(params)}`).then((r) => r.data),   // buyer: own offers, farmer: offers received
    get: (id) => get(`/offers/${id}`).then((r) => r.data),
    create: (b) => post("/offers", b).then((r) => r.data),
    accept: (id) => post(`/offers/${id}/accept`).then((r) => r.data),
    reject: (id, reason) => post(`/offers/${id}/reject`, { reason }).then((r) => r.data),
    counter: (id, offerPrice, message) => post(`/offers/${id}/counter`, { offerPrice, message }).then((r) => r.data),
    acceptCounter: (id) => post(`/offers/${id}/accept-counter`).then((r) => r.data),
    cancel: (id) => post(`/offers/${id}/cancel`).then((r) => r.data),
    setDelivery: (id, deliveryStatus) => post(`/offers/${id}/delivery`, { deliveryStatus }).then((r) => r.data),
    confirmReceipt: (id) => post(`/offers/${id}/confirm-receipt`).then((r) => r.data),
  },
  payments: {
    config: () => get("/payments/config").then((r) => r.data),
    initialize: (offerId) => post("/payments/initialize", { offerId }).then((r) => r.data),
    verify: (reference) => get(`/payments/verify/${reference}`).then((r) => r.data),
    mockConfirm: (reference) => post("/payments/mock/confirm", { reference }).then((r) => r.data),
  },
  orders: { list: () => get("/orders").then((r) => r.data) },
  notifications: {
    list: (params) => get(`/notifications${qs(params)}`),            // { data, meta: { unread } }
    unread: () => get("/notifications/unread-count").then((r) => r.data.unread),
    read: (id) => patch(`/notifications/${id}/read`, {}),
    readAll: () => post("/notifications/read-all"),
  },
  revenue: { summary: (year) => get(`/revenue/summary${qs({ year })}`).then((r) => r.data), list: () => get("/revenue").then((r) => r.data), add: (b) => post("/revenue", b).then((r) => r.data), remove: (id) => del(`/revenue/${id}`) },
  dashboard: () => get("/dashboard").then((r) => r.data),
  tracking: {
    list: () => get("/tracking").then((r) => r.data),
    get: (orderId) => get(`/tracking/${orderId}`).then((r) => r.data),
    sendLocation: (orderId, lat, lng) => post(`/tracking/${orderId}/location`, { lat, lng }).then((r) => r.data),
    startDemo: (orderId) => post(`/tracking/${orderId}/simulate/start`).then((r) => r.data),
    stopDemo: (orderId) => post(`/tracking/${orderId}/simulate/stop`).then((r) => r.data),
  },
  prices: () => get("/prices").then((r) => r.data),
  health: () => request("GET", "/health", undefined, { auth: false }),
};

// ---- Live updates (replaces Firestore onSnapshot). Returns an unsubscribe function.
export function subscribeLive({ onNotification, onTracking, onOpen } = {}) {
  if (!getToken()) return () => {};
  const es = new EventSource(`${BASE}/api/stream?token=${encodeURIComponent(getToken())}`);
  es.addEventListener("ready", () => onOpen?.());
  es.addEventListener("notification", (e) => onNotification?.(JSON.parse(e.data)));
  es.addEventListener("tracking", (e) => onTracking?.(JSON.parse(e.data)));
  return () => es.close();   // EventSource reconnects by itself when the network returns
}

// ---- Pay for an accepted offer. Works with real Paystack and with the offline/demo mode.
export async function payForOffer(offer, { onSuccess, onCancel, onError } = {}) {
  try {
    const init = await api.payments.initialize(offer.id);
    const finish = async () => { try { onSuccess?.(await api.payments.verify(init.reference)); } catch (e) { onError?.(e); } };
    if (init.mode === "mock") {
      if (!window.confirm(`DEMO PAYMENT\n\nPay ₦${Number(init.amount).toLocaleString()} for ${offer.product}?\n(No real money is charged.)`)) return onCancel?.();
      return onSuccess?.(await api.payments.mockConfirm(init.reference));
    }
    if (window.PaystackPop?.prototype?.resumeTransaction) {          // Paystack inline v2 script
      new window.PaystackPop().resumeTransaction(init.accessCode, { onSuccess: finish, onCancel: () => onCancel?.() });
    } else if (init.authorizationUrl) {                                // fallback: Paystack hosted page
      window.location.href = init.authorizationUrl;
    } else throw new Error("Paystack script is not loaded. Use https://js.paystack.co/v2/inline.js in index.html");
  } catch (e) { onError?.(e); }
}
