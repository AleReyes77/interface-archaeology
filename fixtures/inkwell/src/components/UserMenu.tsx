"use client";
import { useState } from "react";
import { useSession } from "@/context/SessionContext";

export function UserMenu() {
  const { user, signOut } = useSession();
  const [open, setOpen] = useState(false);

  if (!user) return <a href="/login">Sign in</a>;

  return (
    <div className="user-menu">
      <button type="button" onClick={() => setOpen(!open)}>
        {user.name}
      </button>
      {open && (
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      )}
    </div>
  );
}
