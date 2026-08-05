"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [form, setForm] = useState({
    displayName: "Zac",
    email: "",
    password: "",
    legacyUsername: "zac",
    legacyPassword: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/bootstrap/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { available?: boolean }) => setAvailable(Boolean(data.available)))
      .catch(() => setAvailable(false));
  }, []);

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error || "Setup could not be completed");
        return;
      }

      router.push("/connections?welcome=zac");
      router.refresh();
    } catch {
      setError("Prime Champs could not finish setup. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (available === null) {
    return <div className="grid min-h-[70vh] place-items-center text-sm text-slate-500">Checking setup status…</div>;
  }

  if (!available) {
    return (
      <div className="grid min-h-[70vh] place-items-center">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-950">Setup is complete</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">Prime Champs already has an owner account. Sign in to continue.</p>
          <button onClick={() => router.push("/login")} className="mt-6 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">Go to sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-5xl items-center gap-10 py-10 lg:grid-cols-[0.8fr_1.2fr]">
      <div>
        <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
          <ShieldCheck className="h-4 w-4" /> Secure owner setup
        </div>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">Start with Zac.</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          This one-time step converts the existing Zac login into the first database-backed Prime Champs account and creates the company workspace.
        </p>
        <ul className="mt-7 space-y-3 text-sm text-slate-700">
          {["Creates Zac as the Prime Champs owner", "Keeps future email and social tokens private to Zac", "Unlocks invitations for Dylan and Josiah later"].map((item) => (
            <li key={item} className="flex gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />{item}</li>
          ))}
        </ul>
      </div>

      <form onSubmit={handleSubmit} className="rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-200/50 sm:p-9">
        <h2 className="text-xl font-semibold text-slate-950">Zac’s account</h2>
        <p className="mt-1 text-sm text-slate-600">Use your Prime Champs work email. Your new password can differ from the current preview password.</p>

        {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">Display name
            <input value={form.displayName} onChange={(event) => updateField("displayName", event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" required />
          </label>
          <label className="text-sm font-medium text-slate-800">Work email
            <input type="email" value={form.email} onChange={(event) => updateField("email", event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" placeholder="zac@primechamps.com" autoComplete="email" required />
          </label>
          <label className="text-sm font-medium text-slate-800 sm:col-span-2">New Prime Champs password
            <input type="password" minLength={10} value={form.password} onChange={(event) => updateField("password", event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" placeholder="At least 10 characters" autoComplete="new-password" required />
          </label>
        </div>

        <div className="my-7 border-t border-slate-200" />
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Confirm the current Zac login</p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">Current username
            <input value={form.legacyUsername} onChange={(event) => updateField("legacyUsername", event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" autoComplete="username" required />
          </label>
          <label className="text-sm font-medium text-slate-800">Current password
            <input type="password" value={form.legacyPassword} onChange={(event) => updateField("legacyPassword", event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" autoComplete="current-password" required />
          </label>
        </div>

        <button type="submit" disabled={loading} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          {loading ? "Creating Zac’s account…" : "Create owner account"}
          {!loading ? <ArrowRight className="h-4 w-4" /> : null}
        </button>
      </form>
    </div>
  );
}
