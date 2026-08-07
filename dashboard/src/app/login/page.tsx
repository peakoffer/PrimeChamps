"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ArrowRight, LockKeyhole, Mail, ShieldCheck } from "lucide-react";

function MicrosoftMark() {
  return (
    <span className="grid h-5 w-5 grid-cols-2 gap-0.5" aria-hidden="true">
      <span className="bg-[#f25022]" />
      <span className="bg-[#7fba00]" />
      <span className="bg-[#00a4ef]" />
      <span className="bg-[#ffb900]" />
    </span>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bootstrapAvailable, setBootstrapAvailable] = useState(false);

  useEffect(() => {
    fetch("/api/auth/bootstrap/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { available?: boolean }) =>
        setBootstrapAvailable(Boolean(data.available))
      )
      .catch(() => setBootstrapAvailable(false));
  }, []);

  const authError = searchParams.get("error");
  const queryError = authError === "invite_invalid"
    ? "That invitation link is invalid or expired. Ask an owner for a new invite."
    : authError === "microsoft_unavailable"
      ? "Microsoft sign-in is not available yet. Use your Prime Champs password below."
    : authError === "not_invited"
      ? "This Microsoft account has not been invited to Prime Champs yet. Ask an owner for access."
    : authError
      ? "We could not complete sign-in. Please try again."
      : "";
  const requestedNext = searchParams.get("next");
  const safeNext = requestedNext?.startsWith("/") && !requestedNext.startsWith("//")
    ? requestedNext
    : "/";
  const microsoftHref = `/api/auth/microsoft?next=${encodeURIComponent(safeNext)}`;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setError(data.error || "Sign-in failed");
        return;
      }

      const nextPath = searchParams.get("next");
      router.push(nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/");
      router.refresh();
    } catch {
      setError("Prime Champs could not be reached. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-brand-paper lg:grid-cols-[1.08fr_0.92fr]">
        <div className="relative hidden min-h-screen overflow-hidden bg-brand-ink p-12 text-white lg:block xl:p-16">
          <div className="absolute inset-x-0 top-0 h-px bg-brand-cyan" />
          <div className="absolute bottom-0 right-0 h-44 w-44 border-l border-t border-white/10 bg-[linear-gradient(rgba(61,230,239,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(61,230,239,.08)_1px,transparent_1px)] bg-[size:18px_18px]" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="pc-wordmark"><span>Prime</span><span>Champs</span><small>CRM</small></div>
              <p className="mt-12 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-brand-cyan">Athlete partnerships / command center</p>
              <h1 className="mt-6 max-w-xl font-display text-6xl font-bold uppercase leading-[0.88] tracking-[-0.025em] xl:text-7xl">
                Turn every relationship into momentum.
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-brand-chrome">
                Research athletes, coordinate outreach, and keep every connected account
                tied to the teammate who owns it.
              </p>
            </div>
            <div className="grid gap-px border border-white/10 bg-white/10 text-sm text-brand-chrome">
              <div className="flex items-center gap-3 bg-brand-raised p-4">
                <ShieldCheck className="h-5 w-5 text-brand-cyan" />
                Per-user accounts and encrypted provider tokens
              </div>
              <div className="flex items-center gap-3 bg-brand-raised p-4">
                <LockKeyhole className="h-5 w-5 text-brand-cyan" />
                Invite-only access for the Prime Champs team
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-screen place-items-center p-7 sm:p-12">
          <div className="mx-auto max-w-sm">
            <div className="mb-12 lg:hidden"><div className="pc-wordmark !text-brand-ink"><span>Prime</span><span>Champs</span><small>CRM</small></div></div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-brand-blue">Secure workspace</p>
            <h2 className="mt-3 font-display text-4xl font-bold uppercase leading-none tracking-tight text-brand-ink">
              Sign in to Prime Champs
            </h2>
            <p className="mt-4 text-sm leading-6 text-brand-muted">
              Use your Prime Champs Microsoft account. Your Microsoft password is never shared with Prime Champs.
            </p>

            {error || queryError ? (
              <div role="alert" className="mt-6 border border-brand-coral/30 bg-brand-coral/5 px-4 py-3 text-sm text-brand-coral">
                {error || queryError}
              </div>
            ) : null}

            <a
              href={microsoftHref}
              className="mt-8 inline-flex min-h-12 w-full items-center justify-center gap-3 bg-brand-ink px-4 font-mono text-[11px] font-bold uppercase tracking-wide text-white transition hover:bg-brand-raised"
            >
              <MicrosoftMark />
              Continue with Microsoft
              <ArrowRight className="h-4 w-4" />
            </a>

            <div className="my-6 flex items-center gap-3 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-brand-muted">
              <span className="h-px flex-1 bg-brand-chrome" />
              Secure fallback
              <span className="h-px flex-1 bg-brand-chrome" />
            </div>

            <details className="group border border-brand-chrome bg-brand-paper-bright">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-brand-ink marker:content-none">
                Use email and password
                <span className="text-xs font-medium text-slate-400 transition group-open:rotate-180">⌄</span>
              </summary>
              <form onSubmit={handleSubmit} className="space-y-5 border-t border-brand-chrome bg-white p-4">
                <label className="block text-sm font-medium text-slate-800" htmlFor="email">
                  Email
                  <span className="relative mt-2 block">
                    <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="block w-full border border-brand-chrome py-2.5 pl-10 pr-3 text-brand-ink outline-none transition focus:border-brand-blue focus:ring-4 focus:ring-brand-cyan/20"
                      placeholder="you@primechamps.com"
                      autoComplete="email"
                      required
                    />
                  </span>
                </label>

                <label className="block text-sm font-medium text-slate-800" htmlFor="password">
                  Password
                  <span className="relative mt-2 block">
                    <LockKeyhole className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="block w-full border border-brand-chrome py-2.5 pl-10 pr-3 text-brand-ink outline-none transition focus:border-brand-blue focus:ring-4 focus:ring-brand-cyan/20"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                    />
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 bg-brand-cyan px-4 font-mono text-[10px] font-bold uppercase tracking-wide text-brand-ink transition hover:bg-[#7aedf3] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Signing in…" : "Sign in"}
                  {!loading ? <ArrowRight className="h-4 w-4" /> : null}
                </button>
              </form>
            </details>

            <div className="mt-5 flex items-start gap-3 border-l-2 border-brand-cyan bg-white px-4 py-3 text-xs leading-5 text-brand-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Microsoft sign-in uses the same Prime Champs account that owns your connected Exchange inbox.
            </div>

            {bootstrapAvailable ? (
              <div className="mt-7 border border-brand-blue/25 bg-brand-blue/5 p-4 text-sm text-brand-ink">
                <p className="font-semibold">Setting up Zac first?</p>
                  <p className="mt-1 leading-5 text-brand-muted">
                  Convert the current Zac login into the first secure team account.
                </p>
                <Link href="/setup" className="mt-3 inline-flex items-center gap-1 font-semibold text-brand-blue hover:text-brand-ink">
                  Start Zac setup <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : null}
          </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[calc(100vh-3rem)]" />}>
      <LoginForm />
    </Suspense>
  );
}
