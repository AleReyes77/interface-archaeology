"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Session } from "@/types";

interface SessionValue {
  user: Session | null;
  signOut: () => void;
}

export const SessionContext = createContext<SessionValue>({ user: null, signOut: () => {} });

export function SessionProvider({ children, initialUser }: { children: ReactNode; initialUser?: Session | null }) {
  const [user, setUser] = useState<Session | null>(initialUser ?? null);
  const signOut = () => setUser(null);
  return <SessionContext.Provider value={{ user, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
