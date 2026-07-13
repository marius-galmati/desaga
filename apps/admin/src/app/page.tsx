"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ensureSession } from "@/lib/auth";

// Root is a pure dispatcher: restore the session if possible, then land on
// the demo sandbox or the login screen.
export default function IndexPage() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void ensureSession().then((ok) => {
      if (!cancelled) router.replace(ok ? "/demo" : "/login");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <p className="eyebrow">Se încarcă…</p>;
}
