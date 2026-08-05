"use client";

import { useCallback, useEffect, useState } from "react";
import { MailPlus, ShieldCheck, UserRound, UsersRound } from "lucide-react";

type Member = {
  userId: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "invited" | "active" | "suspended";
};

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [canInvite, setCanInvite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/team", { cache: "no-store" });
    const data = (await response.json()) as { members?: Member[]; canInvite?: boolean; error?: string };
    if (!response.ok) throw new Error(data.error || "Could not load the team");
    setMembers(data.members || []);
    setCanInvite(Boolean(data.canInvite));
  }, []);

  useEffect(() => {
    fetch("/api/team", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { members?: Member[]; canInvite?: boolean; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load the team");
        setMembers(data.members || []);
        setCanInvite(Boolean(data.canInvite));
      })
      .catch((loadError) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, []);

  const invite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/team/invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        role: form.get("role"),
      }),
    });
    const data = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(data.error || "Invitation failed");
      return;
    }
    event.currentTarget.reset();
    setSuccess("Invitation sent. Their provider accounts will stay private to their user.");
    await load();
  };

  return (
    <div className="space-y-8 pb-12">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Prime Champs workspace</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Your team, one workspace</h1>
        <p className="mt-2 max-w-2xl text-slate-600">Start with Zac now. Invite Dylan and Josiah when ready; each person connects and controls their own mailbox and social accounts.</p>
      </header>

      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {success ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</div> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><UsersRound className="h-5 w-5 text-blue-700" /><p className="mt-4 text-3xl font-semibold text-slate-950">{loading ? "—" : members.length}</p><p className="mt-1 text-sm text-slate-500">workspace members</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><ShieldCheck className="h-5 w-5 text-emerald-700" /><p className="mt-4 font-semibold text-slate-950">Per-user ownership</p><p className="mt-1 text-sm leading-6 text-slate-500">Tokens and sends belong to the person who connected the account.</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5"><UserRound className="h-5 w-5 text-violet-700" /><p className="mt-4 font-semibold text-slate-950">Team visibility</p><p className="mt-1 text-sm leading-6 text-slate-500">Owners can review team conversations without sending as someone else.</p></div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">Members</h2></div>
          <div className="divide-y divide-slate-100">
            {members.map((member) => (
              <div key={member.userId} className="flex items-center justify-between gap-4 px-5 py-4">
                <div><p className="font-medium text-slate-950">{member.name}</p><p className="text-sm text-slate-500">{member.email}</p></div>
                <div className="text-right"><p className="text-sm font-medium capitalize text-slate-700">{member.role}</p><p className={`text-xs capitalize ${member.status === "active" ? "text-emerald-700" : "text-amber-700"}`}>{member.status}</p></div>
              </div>
            ))}
            {!loading && members.length === 0 ? <p className="px-5 py-10 text-center text-sm text-slate-500">No team members yet.</p> : null}
          </div>
        </section>

        {canInvite ? (
          <form onSubmit={invite} className="rounded-2xl border border-slate-200 bg-white p-5">
            <MailPlus className="h-5 w-5 text-blue-700" />
            <h2 className="mt-4 font-semibold text-slate-950">Invite a teammate</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">Use this for Dylan later. They’ll create a password, then connect their own accounts.</p>
            <label className="mt-5 block text-sm font-medium text-slate-700">Name<input name="name" required className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label>
            <label className="mt-4 block text-sm font-medium text-slate-700">Work email<input name="email" type="email" required className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100" /></label>
            <label className="mt-4 block text-sm font-medium text-slate-700">Role<select name="role" className="mt-2 block w-full rounded-xl border border-slate-300 px-3 py-2.5"><option value="member">Member</option><option value="admin">Admin</option></select></label>
            <button type="submit" disabled={submitting} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{submitting ? "Sending…" : "Send invitation"}</button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
