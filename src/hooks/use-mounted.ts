"use client";

import { useEffect, useState } from "react";

/**
 * True only after the first client render. Used to gate browser-only APIs
 * (`navigator.share`, `matchMedia`) so server and client markup match.
 */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
