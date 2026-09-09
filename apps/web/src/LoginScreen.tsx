import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getGoogleAuthConfig,
  login,
  loginWithGoogle,
  register,
} from "./api";
import { loadGoogleIdentityScript, renderGoogleButton } from "./googleSignIn";
import type { AuthUser } from "@radion2/shared";

type LoginScreenProps = {
  onSuccess: (user: AuthUser, token: string) => void;
  onClose: () => void;
  onOpenPrivacy?: () => void;
};

type Mode = "login" | "register";

export function LoginScreen({ onSuccess, onClose, onOpenPrivacy }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const googleBtnRef = useRef<HTMLDivElement | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await getGoogleAuthConfig();
        if (cancelled || !config.enabled || !config.clientId) return;
        await loadGoogleIdentityScript();
        if (!cancelled) setGoogleClientId(config.clientId);
      } catch {
        if (!cancelled) setGoogleClientId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleBtnRef.current) return;
    try {
      renderGoogleButton(googleBtnRef.current, googleClientId, (credential) => {
        void (async () => {
          setLoading(true);
          setError(null);
          try {
            const result = await loginWithGoogle(credential);
            onSuccessRef.current(result.user, result.token);
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Google sign-in failed",
            );
          } finally {
            setLoading(false);
          }
        })();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google sign-in unavailable");
      setGoogleClientId(null);
    }
  }, [googleClientId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result =
        mode === "login"
          ? await login(email, password)
          : await register(name, email, password);
      onSuccess(result.user, result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <div className="login-screen__panel">
        <button
          type="button"
          className="login-screen__close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>

        <p className="login-screen__brand">RadiOn Online</p>
        <h1 id="login-title" className="login-screen__title">
          {mode === "login" ? "Welcome back" : "Create account"}
        </h1>
        <p className="login-screen__lede">
          Login is optional. Sign in to sync favorites across sessions.
        </p>

        {googleClientId && (
          <>
            <div className="login-screen__google" ref={googleBtnRef} />
            <div className="login-screen__divider" role="separator">
              <span>or</span>
            </div>
          </>
        )}

        <form className="login-screen__form" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label>
              <span>Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                minLength={2}
              />
            </label>
          )}
          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
              minLength={6}
            />
          </label>

          {error && <p className="login-screen__error">{error}</p>}

          <button type="submit" className="login-screen__submit" disabled={loading}>
            {loading
              ? "Please wait…"
              : mode === "login"
                ? "Log in"
                : "Create account"}
          </button>
        </form>

        <p className="login-screen__switch">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button type="button" onClick={() => setMode("register")}>
                Register
              </button>
            </>
          ) : (
            <>
              Already registered?{" "}
              <button type="button" onClick={() => setMode("login")}>
                Log in
              </button>
            </>
          )}
        </p>

        {onOpenPrivacy && (
          <p className="login-screen__privacy">
            <button type="button" onClick={onOpenPrivacy}>
              Privacy policy
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
