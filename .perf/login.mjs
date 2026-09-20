// Produces a real authenticated cookie header, using the same @supabase/ssr
// cookie encoding the app itself reads. No shortcuts: this is a genuine
// password sign-in against the real project.
import { readFileSync, writeFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const captured = [];
const supabase = createServerClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [],
      setAll: (list) => captured.push(...list),
    },
  },
);

const { data, error } = await supabase.auth.signInWithPassword({
  email: env.DEV_TEST_EMAIL,
  password: env.DEV_TEST_PASSWORD,
});

if (error) {
  console.error("sign-in failed:", error.message);
  process.exit(1);
}

const header = captured.map((c) => `${c.name}=${c.value}`).join("; ");
writeFileSync(".perf/cookies.txt", header);
console.log("signed in as", data.user?.email);
console.log("cookie names:", captured.map((c) => c.name).join(", "));
console.log("header bytes:", header.length);
