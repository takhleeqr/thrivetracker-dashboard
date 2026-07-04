"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useBrandName } from "@/components/brand-provider";
import { Button, Card, Input } from "@/components/ui";
import { loadAdminProfile } from "@/lib/dashboard-data";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const brandName = useBrandName();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError("Could not sign in. Check the email and password.");
      setIsLoading(false);
      return;
    }

    const profile = await loadAdminProfile(supabase);
    if (!profile || profile.role !== "admin" || !profile.is_active) {
      await supabase.auth.signOut();
      setError("Dashboard access is for active administrators only.");
      setIsLoading(false);
      return;
    }

    router.replace("/");
  }

  return (
    <main className="auth-shell">
      <Card className="auth-card">
        <p className="eyebrow">{brandName}</p>
        <h1>Admin Sign In</h1>
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <Input autoComplete="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </label>
          <label>
            Password
            <Input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <Button disabled={isLoading} type="submit">
            {isLoading ? "Signing In..." : "Sign In"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
