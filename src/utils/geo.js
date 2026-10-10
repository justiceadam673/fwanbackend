// Approximate coordinates for common Nigerian towns, used to place tracking routes without internet geocoding.
export const PLACES = {
  jos: [9.8965, 8.8583], bauchi: [10.3158, 9.8442], kano: [12.0022, 8.592], kaduna: [10.5105, 7.4165],
  abuja: [9.0765, 7.3986], lagos: [6.5244, 3.3792], ibadan: [7.3775, 3.947], "port harcourt": [4.8156, 7.0498],
  enugu: [6.4584, 7.5464], maiduguri: [11.8333, 13.15], sokoto: [13.0059, 5.2476], ilorin: [8.4966, 4.5421],
  minna: [9.6139, 6.5569], makurdi: [7.7337, 8.5214], gombe: [10.2897, 11.1673], yola: [9.2035, 12.4954],
  jalingo: [8.8937, 11.3596], lafia: [8.4939, 8.5153], benin: [6.335, 5.6037], owerri: [5.4836, 7.0333],
  onitsha: [6.1498, 6.7857], abeokuta: [7.1475, 3.3619], akure: [7.2526, 5.1931], calabar: [4.9757, 8.3417],
};
export const DEFAULT_ORIGIN = PLACES.jos;

export function coordsFor(text, fallback = DEFAULT_ORIGIN) {
  if (!text) return fallback;
  const t = String(text).toLowerCase();
  for (const [name, c] of Object.entries(PLACES)) if (t.includes(name)) return c;
  return fallback;
}

export function haversineKm([lat1, lon1], [lat2, lon2]) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
