/**
 * File: LoginPanel.tsx
 * Purpose:
 *   Shows email/password and Google login controls.
 *
 * Why this file exists:
 *   Login must exist on day one so auth is not painfully bolted on later.
 */

import { useState } from "react";
import { getSupabase } from "../../lib/supabase.js";

/**
 * Renders login controls and handles Supabase auth actions.
 */
export function LoginPanel() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  /**
   * Signs in or creates a user with email/password.
   */
  async function signInWithEmail() {
    setMessage(null);
    const supabase = getSupabase();
    const result = await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      const signup = await supabase.auth.signUp({ email, password });
      setMessage(signup.error ? signup.error.message : "Check your email if confirmation is enabled.");
      return;
    }

    setMessage("Logged in.");
  }

  /**
   * Starts Google OAuth login.
   */
  async function signInWithGoogle() {
    const supabase = getSupabase();
    await supabase.auth.signInWithOAuth({ provider: "google" });
  }

  return (
    <section className="panel">
      <h2>Login</h2>
      <input placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <input placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button onClick={signInWithEmail}>Email Login / Sign Up</button>
      <button onClick={signInWithGoogle}>Continue with Google</button>
      {message ? <p>{message}</p> : null}
    </section>
  );
}
