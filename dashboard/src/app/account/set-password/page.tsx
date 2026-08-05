"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, LockKeyhole } from "lucide-react";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = (await response.json()) as { error?: string };
    setLoading(false);
    if (!response.ok) {
      setError(data.error || "Could not save password");
      return;
    }
    router.push("/connections?welcome=team");
    router.refresh();
  };

  return (
    <div className="grid min-h-[75vh] place-items-center">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/50">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-700"><LockKeyhole className="h-6 w-6" /></div>
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">Finish your account</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Choose a password for your individual Prime Champs login.</p>
        {error ? <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
        <label className="mt-6 block text-sm font-medium text-slate-800">Password
          <input type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" autoComplete="new-password" required />
        </label>
        <label className="mt-5 block text-sm font-medium text-slate-800">Confirm password
          <input type="password" minLength={10} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" autoComplete="new-password" required />
        </label>
        <button type="submit" disabled={loading} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          {loading ? "Saving…" : "Finish setup"}<CheckCircle2 className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
