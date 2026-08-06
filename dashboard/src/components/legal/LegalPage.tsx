import Link from "next/link";
import type { ReactNode } from "react";

type LegalSection = {
  title: string;
  content: ReactNode;
};

export default function LegalPage({
  eyebrow,
  title,
  summary,
  updated,
  sections,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <div className="mx-auto max-w-4xl py-8 sm:py-14">
      <header className="overflow-hidden rounded-3xl bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-10 sm:py-14">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
            {eyebrow}
          </p>
          <p className="text-xs text-slate-400">Last updated {updated}</p>
        </div>
        <h1 className="mt-8 max-w-3xl text-4xl font-semibold tracking-tight sm:text-6xl">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
          {summary}
        </p>
      </header>

      <div className="mt-8 rounded-3xl border border-slate-200 bg-white px-6 py-4 shadow-sm sm:px-10">
        {sections.map((section) => (
          <section
            key={section.title}
            className="border-b border-slate-200 py-7 last:border-b-0"
          >
            <h2 className="text-xl font-semibold tracking-tight text-slate-950">
              {section.title}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-7 text-slate-700 sm:text-base">
              {section.content}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-8 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-100 px-6 py-5 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between">
        <p>Prime Champs is a trade name of VisionWave Agency LLC.</p>
        <nav className="flex gap-4" aria-label="Legal pages">
          <Link className="font-semibold text-blue-700 hover:text-blue-900" href="/privacy">
            Privacy
          </Link>
          <Link className="font-semibold text-blue-700 hover:text-blue-900" href="/terms">
            Terms
          </Link>
          <Link className="font-semibold text-blue-700 hover:text-blue-900" href="/data-deletion">
            Data deletion
          </Link>
        </nav>
      </footer>
    </div>
  );
}
