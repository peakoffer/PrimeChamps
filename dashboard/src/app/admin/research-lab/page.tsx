import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ClipboardCheck, Compass, ShieldCheck } from "lucide-react";
import { getSession } from "@/lib/auth";

const TOOLS = [
  {
    href: "/pipeline/research/intelligence",
    title: "Recruiting thesis",
    description: "Turn weekly meetings into the guidance the research agent follows.",
    icon: Compass,
  },
  {
    href: "/pipeline/research/benchmark",
    title: "Accuracy checks",
    description: "Score the agent against past OnlyFans decisions before changing it.",
    icon: ClipboardCheck,
  },
  {
    href: "/pipeline/research/hardening",
    title: "Stress tests",
    description: "Paid cross-sport test campaigns with a hard spending cap.",
    icon: ShieldCheck,
  },
];

// Owner/admin tools for tuning the research agent. Nothing here changes the live pipeline.
export default async function ResearchLabPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (user.role !== "owner" && user.role !== "admin") notFound();
  return (
    <div className="space-y-6">
      <header className="pc-page-header">
        <div>
          <h1 className="pc-page-title">Research lab</h1>
          <p className="pc-page-description">Tools for tuning and testing the research agent. Test runs never touch the pipeline.</p>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {TOOLS.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="group border border-brand-ink/15 bg-brand-paper-bright p-5 transition hover:border-brand-ink/40">
            <Icon className="h-5 w-5 text-brand-blue" aria-hidden="true" />
            <h2 className="mt-3 text-base font-semibold text-brand-ink">{title}</h2>
            <p className="mt-1 text-sm text-brand-ink/60">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
