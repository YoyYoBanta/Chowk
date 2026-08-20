import { PRODUCT_NAME } from "@/config/branding";
import { loginAction } from "./actions";

// Plain object type rather than Next's generated PageProps — see
// src/app/layout.tsx for why (no prior `.next/types` build to generate
// against). searchParams is a Promise per the App Router's async dynamic
// APIs (Next 15+).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main>
      <h1>Log in to {PRODUCT_NAME}</h1>
      {error && <p role="alert">{error}</p>}
      <form action={loginAction}>
        <label>
          Email
          <input type="email" name="email" required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
          />
        </label>
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}
