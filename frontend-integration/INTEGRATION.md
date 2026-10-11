# Connecting the React front end to this backend

Your current React code talks to Firebase directly (`firebase/auth`, `firebase/firestore`). The backend replaces all of that with one REST API, so the **front end must be edited once**. This kit makes each edit small. Do the steps in order and test after each one.

## 0. One-time setup
1. Copy `api.js` to `src/api.js`, `useApi.js` to `src/useApi.js`, and `AuthContext.jsx` over `src/context/AuthContext.jsx`.
2. Create `.env` in the React project (no secrets go here any more):
   ```
   VITE_API_URL=http://localhost:5000
   ```
   When the backend itself serves the built app (offline demo, single-server hosting) leave it empty: `VITE_API_URL=`
3. **Delete** `VITE_PAYSTACK_SECRET_KEY` and `VITE_IMGBB_API_KEY` from the front-end `.env`. The Paystack secret key now lives only in the backend `.env`. The old key was exposed in your archive; **generate a new one in the Paystack dashboard**.
4. In `index.html` replace the Paystack script with the v2 version:
   `<script src="https://js.paystack.co/v2/inline.js"></script>`
5. Date handling: Firestore gave you `Timestamp` objects (`x.toDate()`). The API sends ISO strings. Add `import { toDate } from "../api"` and replace `x.toDate()` with `toDate(x)`.

## 1. Authentication
| File | Replace | With |
|---|---|---|
| `AUTH/pages/FarmerSignUp.jsx`, `BuyerSignUp.jsx` | `createUserWithEmailAndPassword`, `getDoc`, `setDoc`, `sendEmailVerification`, `signOut` | `await signUp({ name, email, phone, password, role: "farmer" })` (use `"buyer"` in the buyer page). Show `result.message`. The server stores the role, rejects duplicates and (if `AUTO_VERIFY_EMAIL=false`) emails a link. |
| `AUTH/pages/FarmerSignIn.jsx`, `BuyerSignIn.jsx` | `signInWithEmailAndPassword`, role check via `getDoc` | `await signIn(email, password, "farmer")`. Catch `ApiError`; if `err.code === "email_not_verified"` show the verify message; any other `err.message` is already user-friendly. |
| same pages, "forgot password" | `sendPasswordResetEmail` | `api.auth.forgotPassword(email)` |
| `layouts/*SidebarLayout.jsx`, `*DashBoardLayout.jsx` | `signOut(auth)`, `onAuthStateChanged` | `const { user, signOut } = useAuth();` then `signOut(); navigate("/")` |
| `AUTH/components/ProtectedRoute.jsx` | login-only check | also check role: `if (allowedRole && role !== allowedRole) return <Navigate to="/" />` and pass `allowedRole="farmer"`/`"buyer"` in `App.jsx` (this closes the "buyer can open farmer URLs" gap). |

Email links open pages served by the backend itself (`/api/auth/verify-email`, `/api/auth/reset-password`), so no front-end page is required. After sign-up, show the message "Check your email to verify your account" with a "Resend verification email" button (`api.auth.resendVerification(email)`), and handle the sign-in error `email_not_verified` the same way.

## 2. Listings, marketplace, offers
| File | Replace | With |
|---|---|---|
| `FARMERS/pages/FarmersListings.jsx` | `getDocs` on `farmers_listings`/`offers`, `addDoc`, `deleteDoc`, `uploadToImgBB` | `const { data: listings, reload } = useApi(api.listings.mine, [], { live: true })`; create: `api.listings.create({ product, quantity, unit, price, tier, description, harvestDate, image })`; delete: `api.listings.remove(id)`. Each listing already has `soldQuantity`, `remainingQuantity`, `offers`, `status`, `rating`, so the per-listing offer queries disappear. |
| `FARMERS/utils/uploadToImgBB.js` | ImgBB call | `export default async (file) => api.uploads.image(await fileToDataUrl(file));` with `const fileToDataUrl = (f) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });` Images are stored by the backend (works offline). |
| `FARMERS/utils/calculateSoldQuantity.js` | offers query | not needed: use `listing.soldQuantity` |
| `BUYERS/modals/BuyersCollection.jsx` | 3 nested `getDocs` | `const { data } = useApi(() => api.listings.list({ q, product, page, sort }), [q, product, page])`; `data.data` is the array, `data.meta` has paging. Reviews: `api.listings.reviews(id)`. |
| `BUYERS/modals/MakeOffer.jsx` | `addDoc(offers)` with client-computed `totalValue` | `api.offers.create({ listingId, quantity, offerPrice, deliveryDate, deliveryLocation, messageToFarmer })`. The server fills farmer, buyer, product and total, and refuses more than the available stock. |
| `BUYERS/modals/AddListingModal.jsx` (reviews) | `addDoc(reviews)` | `api.listings.addReview(listingId, { rating, comment })` |
| `FARMERS/pages/FarmersOffers.jsx`, `FARMERS/utils/FarmersOfferTable.jsx` | `onSnapshot`, `updateDoc(status)` | `useApi(() => api.offers.list(), [], { live: true })`; buttons call `api.offers.accept(id)`, `api.offers.reject(id, reason)`, and (new) `api.offers.counter(id, newPrice)`. |
| `FARMERS/data/AddOffer.jsx`, `GENERAL-DATA/Test.jsx` | demo data writers | delete (use the seed data instead) |

## 3. Cart, payment, history
`BUYERS/pages/BuyersCart.jsx`: load with `useApi(() => api.offers.list(), [], { live: true })`. Replace the whole Paystack `setup(...)` block and `handlePaymentSuccess` with:
```jsx
import { payForOffer } from "../../../api";
<button onClick={() => payForOffer(offer, {
  onSuccess: () => { toast.success("Payment confirmed"); reload(); },
  onCancel:  () => toast.info("Payment cancelled"),
  onError:   (e) => toast.error(e.message),
})}>Complete payment</button>
```
The browser never writes "Paid" again: the server asks Paystack (or the demo gateway) and only then updates the offer, creates the order and tracking record, and notifies both parties. If the buyer closes the tab mid-payment, Paystack's webhook (`POST /api/payments/webhook`) still completes it. Also offer `api.offers.acceptCounter(id)` / `api.offers.cancel(id)` there.

`BUYERS/pages/BuyersHistory.jsx`, `FARMERS/pages/FarmersHistory.jsx`: `api.orders.list()` (or `api.offers.list({ status: "Paid,Completed" })`). Farmers can move delivery along with `api.offers.setDelivery(id, "Shipped")`; buyers close the order with `api.offers.confirmReceipt(id)`.

Dashboards (`FarmersDashboard.jsx`, `BuyersDashboard.jsx`): `useApi(api.dashboard, [], { live: true })` returns ready-made counts and totals.

## 4. Revenue
`FARMERS/data/RevenueChart.jsx`: `const { data } = useApi(() => api.revenue.summary(2026))`, then `data.months` is `[{ month: "Jan", total, orders, manual }, ...]`, ready for Recharts. `REvenueDashboard.jsx`/`RevenueForm.jsx` (manual entries): `api.revenue.add({ month: "Mar", year: 2026, amount })`, `api.revenue.list()`, `api.revenue.remove(id)`. Totals from paid orders are computed server-side and cannot be edited from the browser.

## 5. Notifications
`layouts/*NotificationBell.jsx` and `*NotificationPage.jsx`:
```jsx
const { data, reload } = useApi(() => api.notifications.list({ limit: 30 }), [], { live: true });
const unread = data?.meta?.unread ?? 0;
// mark read: await api.notifications.read(id); reload();   mark all: api.notifications.readAll()
```
Delete `src/service/notificationService.js` and the `functions/` folder: the server creates notifications itself and pushes them live.

## 6. Tracking (real GPS and demo)
`BUYERS/pages/BuyersTracking.jsx`, `FARMERS/pages/FarmersTracking.jsx`:
```jsx
const { data: trips } = useApi(api.tracking.list, [], { live: true });   // one record per paid order
// each trip: { orderId, position:{lat,lng}, origin, destination, progress (0-1), remainingKm, status, source }
```
Use `trip.position` for the Leaflet marker. `trip.source` is `"gps"`, `"simulated"` or `"none"`; show it so demonstrations are honest ("Demo route" badge when simulated).
- **Real GPS (farmer's phone):** `navigator.geolocation.watchPosition(p => api.tracking.sendLocation(orderId, p.coords.latitude, p.coords.longitude))`. Needs HTTPS or localhost.
- **Demo / offline:** a button calling `api.tracking.startDemo(orderId)` moves a vehicle from the farm town to the delivery town in about 90 seconds and marks the order Delivered on arrival. Delete `FARMERS/utils/VehicleSimulator.js`.
Towns are placed with a built-in Nigerian town table (`src/utils/geo.js`); add more towns there.

## 7. Profile, language, prices
- `*Profile.jsx`: `api.users.updateMe({ name, phone, address, city, state, photoURL, language })`; the avatar goes through `api.uploads.image(...)` first. Replace `getDoc(users)` with `useAuth().user`; call `refresh()` after saving.
- Language: the backend stores `language` ("en","ha","yo","ig"). To make the switcher actually translate, wrap visible text with `t("key")` from `useTranslation()` and fill the `yo`/`ig` JSON files.
- Prices: `api.prices()` returns `reference` (the static table from `productsData.js`) and `platformStats` (averages computed from real listings and paid orders). Use `platformStats` for honest "market insight".

## 8. Clean-up
After everything works: remove `firebase`, `firebase/*` imports, `FireBaseConfig.js`, `firestore.rules`, `functions/`, `index.js` (root dummy function), and `react-paystack` references. Run `npm run build` and test again.
