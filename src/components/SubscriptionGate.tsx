"use client";

import { useEffect, useState } from "react";

/**
 * SubscriptionGate wraps the app layout and redirects to /billing
 * if the org's subscription is expired/canceled. Checks once on mount.
 * Does NOT block rendering — shows children immediately and redirects
 * only if the check returns inactive.
 */
export function useSubscriptionCheck() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Skip check on billing page itself and login
    const path = window.location.pathname;
    if (path.startsWith("/billing") || path.startsWith("/login") || path.startsWith("/accept-invite")) {
      setChecked(true);
      return;
    }

    fetch("/api/billing")
      .then((r) => r.json())
      .then((d) => {
        if (d.active === false) {
          window.location.href = "/billing";
        } else {
          setChecked(true);
        }
      })
      .catch(() => {
        // On error, allow access (fail-open for the subscription check)
        setChecked(true);
      });
  }, []);

  return checked;
}
