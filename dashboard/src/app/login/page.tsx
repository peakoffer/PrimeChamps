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
    <div className="grid min-h-[calc(100vh-3rem)] place-items-center py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl shadow-slate-200/60 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:block">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-blue-300">
                Prime Champs CRM
              </p>
              <h1 className="mt-6 max-w-md text-4xl font-semibold leading-tight">
                Every relationship, one organized conversation.
              </h1>
              <p className="mt-5 max-w-md text-base leading-7 text-slate-300">
                Research athletes, coordinate outreach, and keep every connected account
                tied to the teammate who owns it.
              </p>
            </div>
            <div className="space-y-4 text-sm text-slate-300">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-300" />
                Per-user accounts and encrypted provider tokens
              </div>
              <div className="flex items-center gap-3">
                <LockKeyhole className="h-5 w-5 text-blue-300" />
                Invite-only access for the Prime Champs team
              </div>
            </div>
          </div>
        </div>

        <div className="p-7 sm:p-12">
          <div className="mx-auto max-w-sm">
            <p className="text-sm font-semibold text-blue-600">Welcome back</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Sign in to Prime Champs
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Use your Prime Champs Microsoft account. Your Microsoft password is never shared with Prime Champs.
            </p>

            {error || queryError ? (
              <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error || queryError}
              </div>
            ) : null}

            <a
              href={microsoftHref}
              className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <MicrosoftMark />
              Continue with Microsoft
              <ArrowRight className="h-4 w-4" />
            </a>

            <div className="my-6 flex items-center gap-3 text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              Secure fallback
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <details className="group rounded-xl border border-slate-200 bg-slate-50/70">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700 marker:content-none">
                Use email and password
                <span className="text-xs font-medium text-slate-400 transition group-open:rotate-180">⌄</span>
              </summary>
              <form onSubmit={handleSubmit} className="space-y-5 border-t border-slate-200 bg-white p-4">
                <label className="block text-sm font-medium text-slate-800" htmlFor="email">
                  Email
                  <span className="relative mt-2 block">
                    <Mail className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="block w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
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
                      className="block w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-slate-950 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                      placeholder="Enter your password"
                      autoComplete="current-password"
                      required
                    />
                  </span>
                </label>

                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Signing in…" : "Sign in"}
                  {!loading ? <ArrowRight className="h-4 w-4" /> : null}
                </button>
              </form>
            </details>

            <div className="mt-5 flex items-start gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-800">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Microsoft sign-in uses the same Prime Champs account that owns your connected Exchange inbox.
            </div>

            {bootstrapAvailable ? (
              <div className="mt-7 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="font-semibold">Setting up Zac first?</p>
                <p className="mt-1 leading-5 text-blue-800">
                  Convert the current Zac login into the first secure team account.
                </p>
                <Link href="/setup" className="mt-3 inline-flex items-center gap-1 font-semibold text-blue-700 hover:text-blue-900">
                  Start Zac setup <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : null}
          </div>
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
