// Replaces src/context/AuthContext.jsx. Keeps the same shape components already use (user.uid, user.displayName, role, loading).
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, getToken, setToken } from "../api";

const AuthContext = createContext(null);
const shape = (u) => (u ? { ...u, uid: u.id, displayName: u.name, emailVerified: u.emailVerified } : null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());

  const refresh = useCallback(async () => {
    if (!getToken()) { setUser(null); setLoading(false); return null; }
    try { const u = shape(await api.auth.me()); setUser(u); return u; }
    catch { setToken(null); setUser(null); return null; }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const out = () => setUser(null);
    window.addEventListener("fwan:logout", out);
    return () => window.removeEventListener("fwan:logout", out);
  }, [refresh]);

  const signIn = async (email, password, role) => { const r = await api.auth.login({ email, password, role }); const u = shape(r.user); setUser(u); return u; };
  const signUp = (data) => api.auth.register(data);
  const signOut = () => { api.auth.logout(); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, role: user?.role ?? null, userData: user, loading, signIn, signUp, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
export default AuthContext;
