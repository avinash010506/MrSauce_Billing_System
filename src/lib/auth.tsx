import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { store } from "./storage";
import type { Role, User } from "./types";

// Client-side SHA-256 password hash helper
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// Fallback admin credential.
const DEFAULT_ADMIN = {
  username: "mrsauce",
  // SHA-256 hash of Mrsauce@124
  passwordHash: "33f09c941ae4ed78a99e6613da2a8f8157f6f3e3fdb737cff3b55ada6179bbb1",
  name: "Mr Sauce",
  role: "admin" as const,
  email: "mrsaucereport@gmail.com"
};

interface AuthCtx {
  user: User | null;
  verifyCredentials: (username: string, password: string) => Promise<{ ok: boolean; error?: string; user?: User; email?: string }>;
  login: (user: User) => void;
  logout: () => void;
  hasRole: (...r: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const s = store.getSession();
    if (s) setUser({ username: s.username, name: s.name, role: s.role as Role, email: s.email });
  }, []);

  const verifyCredentials = async (username: string, password: string) => {
    const hashedInput = await hashPassword(password);
    const settings = store.getSettings();
    const customUsers = settings.users || [];
    const allUsers = [...customUsers];

    // Ensure default admin exists
    const hasDefaultAdmin = allUsers.some(
      (x) => x.username.toLowerCase() === DEFAULT_ADMIN.username.toLowerCase()
    );
    if (!hasDefaultAdmin) {
      allUsers.push({
        username: DEFAULT_ADMIN.username,
        name: DEFAULT_ADMIN.name,
        role: DEFAULT_ADMIN.role,
        email: DEFAULT_ADMIN.email,
        password: DEFAULT_ADMIN.passwordHash,
      });
    }

    const u = allUsers.find((x) => {
      if (x.username.toLowerCase() !== username.toLowerCase()) return false;
      
      const isHash = x.password && x.password.length === 64 && /^[a-f0-9]{64}$/i.test(x.password);
      if (isHash) {
        return x.password === hashedInput;
      }
      // plain text fallback for backward compatibility
      return x.password === password;
    });

    if (!u) return { ok: false, error: "Invalid username or password" };
    return { 
      ok: true, 
      user: { username: u.username, name: u.name, role: u.role, email: u.email }, 
      email: u.email 
    };
  };

  const login = (sess: User) => {
    store.setSession(sess);
    setUser(sess);
  };

  const logout = () => {
    store.clearSession();
    setUser(null);
  };

  const hasRole = (...r: Role[]) => !!user && r.includes(user.role);

  return (
    <Ctx.Provider value={{ user, verifyCredentials, login, logout, hasRole }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
};
