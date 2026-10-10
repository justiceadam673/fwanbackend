# FWAN Backend (Express · Node.js · MongoDB) with Offline Demo Mode

Server for the FWAN agricultural marketplace: accounts and roles, produce listings, offers and counter-offers, payments (Paystack, verified on the server), orders, delivery tracking, notifications (live), revenue, prices, image uploads and an admin area.

**Two ways to run it**

| Mode | Database | Payments | Internet needed? | Command |
|---|---|---|---|---|
| **Online** | MongoDB (Atlas or local) | Paystack (or `mock`) | Yes | `npm start` |
| **Offline demo** | JSON files in `data/offline/` | Simulated | **No** (after the one-time `npm install`) | `npm run offline` |

Requires Node.js 18 or newer (https://nodejs.org). `node_modules` is included in this zip, so you can usually skip `npm install`; run it if Node complains about a missing package.

---
## 1. Offline demo (no internet)
```
cd fwan-backend
npm run offline
```
It prints local and Wi-Fi addresses and these demo logins (password `Demo@1234`): `farmer@fwan.demo`, `farmer2@fwan.demo`, `buyer@fwan.demo`, `buyer2@fwan.demo`, `admin@fwan.demo`. Demo data includes listings, a pending offer, an accepted offer (ready to pay), a paid order with a tracking record, a review and notifications.

* Payments ask "DEMO PAYMENT, pay ₦…?" and complete instantly; no money moves.
* Tracking: farmer presses the demo button and the vehicle moves for about 90 seconds, then the order shows Delivered.
* Reset the demo: stop the server, delete `data/offline/`, start again (or `npm run seed:offline`).
* **Full app on one address, even with no internet:** in the React project run `npm run build`, copy everything inside `dist/` into this project's `public/` folder, set `VITE_API_URL=` (empty) before building, then run `npm run offline` and open `http://localhost:5000`. Other phones/laptops on the same Wi-Fi or phone hotspot can open the Network address it prints.
* Offline caveats you should know before a live defence: fonts/icons/map tiles that your front end loads from the internet (Google Fonts, Iconify, OpenStreetMap tiles) will not load without internet. Test the screens once while offline. The Leaflet map will show markers and the route line but may have a blank background.

## 2. Online mode on your computer
1. Make a free MongoDB Atlas cluster (https://www.mongodb.com/atlas): create a database user, under *Network Access* allow your IP (or 0.0.0.0/0 while testing), click *Connect → Drivers* and copy the connection string, e.g. `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/fwan`. (Or install MongoDB locally and use `mongodb://127.0.0.1:27017/fwan`.)
2. `copy .env.example .env` (Windows) or `cp .env.example .env`, then edit `.env`: set `MONGODB_URI`, a long random `JWT_SECRET` (command in the file), and `PAYMENT_MODE=mock` for now.
3. `npm start`, then open `http://localhost:5000/api/health`: it should say `"database":"mongo"`.
4. Optional demo data in MongoDB: `npm run seed`.
5. Safety net for demos: set `DB_FALLBACK_TO_FILE=true` and, if MongoDB cannot be reached, the server continues with the offline file database instead of stopping.

## 3. Connect your React app
Follow `frontend-integration/INTEGRATION.md` (copy `api.js`, `useApi.js`, `AuthContext.jsx`, then replace Firebase calls file by file; the guide lists every file). Set `VITE_API_URL` in the React `.env`.

## 4. Real Paystack payments
1. Paystack dashboard → Settings → API Keys: copy the **secret** key (test key `sk_test_…` first) into the backend `.env` as `PAYSTACK_SECRET_KEY`, and set `PAYMENT_MODE=paystack`. Never put the secret key in the React app. Rotate any key that was in the old archive.
2. In the React app `index.html` use `<script src="https://js.paystack.co/v2/inline.js"></script>`.
3. Paystack dashboard → Settings → API Keys & Webhooks → set *Webhook URL* to `https://YOUR-BACKEND/api/payments/webhook` (so a payment completes even if the buyer closes the browser).
4. Test with Paystack test cards, check the order appears, then switch to live keys.
The server decides the amount from the stored offer, checks the amount and currency Paystack reports, makes the confirmation idempotent (no double orders) and flags mismatches for review (`GET /api/admin/payments`).

## 5. Hosting (free-tier friendly)
**Backend on Render** (https://render.com):
1. Put this folder in a GitHub repository (the `.gitignore` already excludes `node_modules` and `.env`).
2. Render → New → Web Service → connect the repo. Build: `npm install`. Start: `npm start`. (Or use the included `render.yaml`.)
3. Environment variables: `NODE_ENV=production`, `TRUST_PROXY=true`, `MONGODB_URI`, `JWT_SECRET` (48+ random characters), `PAYMENT_MODE`, `PAYSTACK_SECRET_KEY`, `CORS_ORIGINS=https://your-frontend-domain` (comma-separated, no trailing slash), `FRONTEND_URL`, `PUBLIC_URL=https://your-backend.onrender.com`, `AUTO_VERIFY_EMAIL=true` (or configure `SMTP_URL`).
4. In Atlas *Network Access* allow Render's outbound addresses (simplest: 0.0.0.0/0 with a strong database password).
5. Check `https://your-backend.onrender.com/api/health`.
Railway, Fly.io, Koyeb or any VPS work the same way (`npm start`, set the same variables).

**Front end on Vercel/Netlify:** set `VITE_API_URL=https://your-backend.onrender.com`, build, deploy; then add that address to `CORS_ORIGINS` on the backend.

Hosting limits to be aware of:
* Free Render servers sleep when idle (first request is slow) and have an **ephemeral disk**: images uploaded through `/api/uploads` are lost on redeploy. For production attach a persistent disk and set `DATA_DIR` to it, or keep using ImgBB/Cloudinary for images.
* Run **one instance**: stock locks, live updates (SSE) and the tracking demo run in memory.
* Without `SMTP_URL`/nodemailer, verification and reset links are only printed in the server log. Use `AUTO_VERIFY_EMAIL=true` for a demo, or a real SMTP service (e.g. Brevo, Resend SMTP, Gmail app password) for production.

## 6. API overview  (all under `/api`; send `Authorization: Bearer <token>`)
Responses: `{ data, meta? }` or `{ error: { code, message, details? } }`.

| Area | Endpoints |
|---|---|
| Health | `GET /health` |
| Auth | `POST /auth/register` · `/auth/login` · `/auth/verify-email` · `/auth/resend-verification` · `/auth/forgot-password` · `/auth/reset-password` · `/auth/change-password` · `GET /auth/me` |
| Users | `GET/PATCH /users/me` · `GET /users/:id/public` · `POST /uploads/image` |
| Listings | `GET /listings` (q, product, farmerId, status, minPrice, maxPrice, sort, page, limit) · `GET /listings/mine` · `GET/PATCH/DELETE /listings/:id` · `POST /listings` · `GET/POST /listings/:id/reviews` · `DELETE /listings/:id/reviews/:rid` |
| Offers | `GET /offers` · `GET /offers/:id` · `POST /offers` · farmer: `POST /offers/:id/accept` `/reject` `/counter` `/delivery` · buyer: `/accept-counter` `/cancel` `/confirm-receipt` · compat: `PATCH /offers/:id/status` |
| Payments | `GET /payments/config` · `POST /payments/initialize` · `GET /payments/verify/:reference` · `POST /payments/mock/confirm` (demo only) · `POST /payments/webhook` (Paystack) · `GET /payments/mine` |
| Orders | `GET /orders` · `GET /orders/:id` |
| Notifications | `GET /notifications` · `GET /notifications/unread-count` · `PATCH /notifications/:id/read` · `POST /notifications/read-all` · `DELETE /notifications/:id` |
| Revenue / dashboard | `GET /revenue/summary?year=` · `GET/POST /revenue` · `DELETE /revenue/:id` · `GET /dashboard` |
| Tracking | `GET /tracking` · `GET /tracking/:orderId` · `POST /tracking/:orderId/location` (real GPS) · `POST /tracking/:orderId/simulate/start|stop` (demo) |
| Prices | `GET /prices` · `PUT /prices` (admin) |
| Live | `GET /stream?token=…` (Server-Sent Events: `notification`, `tracking`) |
| Admin | `GET /admin/stats` · `GET /admin/users` · `PATCH /admin/users/:id/active` · `GET /admin/payments` |

**Offer lifecycle:** `Pending → Accepted | Rejected | Countered | Cancelled`; `Countered → Accepted | Rejected | Cancelled`; `Accepted → Paid | Cancelled`; `Paid → Completed` (delivery: Processing → Shipped → Delivered, then the buyer confirms). Accepted, Paid and Completed offers reserve stock, so a listing cannot be oversold; it flips to "Sold Out" automatically.

To become admin: set `ADMIN_EMAIL` in `.env`, register that email in the app (and verify it), restart the server.

## 7. What replaced your Firestore rules
| Old rule | Now enforced by |
|---|---|
| role cannot change; users edit only themselves | `PATCH /users/me` refuses `role`/`email`; JWT identifies the user |
| only the owning farmer writes a listing | `listings` routes check `farmerId === user` |
| any signed-in user may read listings | `GET /listings` is readable by everyone (browse before sign-up) |
| buyer creates offers only as themselves | `POST /offers` requires a buyer; buyer/farmer/product/total come from the database, not from the browser |
| farmer may change only status / delivery | dedicated accept/reject/counter/delivery routes with allowed transitions |
| buyer may mark Paid only from Accepted | **nobody** can set Paid from the browser; only a server-verified payment does |
| orders, notifications, tracking, revenue owner-only | each route filters by the signed-in user |

## 8. Security built in
Passwords hashed with bcrypt; JWT sessions; login lock-out after 5 failures; rate limits; Helmet headers; strict CORS list; MongoDB-operator-injection guard on every request; input validation on every write; upload content checked by file signature (PNG/JPEG/GIF/WebP, 5 MB); webhook signature (HMAC-SHA512) check; atomic status changes; no secrets in responses.

## 9. Tests and honest limits
`npm test` runs 18 end-to-end tests (sign-up, roles, listings, stock limits, offers, counter-offers, payment idempotency, orders, tracking, revenue, reviews, notifications, uploads, password reset, injection, SSE) on the offline database: all pass.
**Not tested in the build environment** (no MongoDB server or Paystack access there): the live MongoDB driver path and real Paystack calls. They use standard driver/API calls, but run the checklist below once on your machine before your defence:
1. `GET /api/health` shows `"database":"mongo"`.
2. Register, sign in, create a listing, make an offer, accept it.
3. Pay with a Paystack **test** card and confirm the offer becomes Paid and an order appears.
Also: Firestore data is not migrated automatically (start fresh or re-enter); the tracking demo restarts if the server restarts; email sending requires SMTP.
