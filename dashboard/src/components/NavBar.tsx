"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart3,
  Blocks,
  BriefcaseBusiness,
  Database,
  FlaskConical,
  Inbox,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Network,
  Users,
  X,
} from "lucide-react";
import NotificationsBell from "./NotificationsBell";

interface User {
  id: string;
  email: string;
  username: string;
  name: string;
  role: "owner" | "admin" | "member";
  organizationId: string;
  organizationName: string;
}

const NAV_GROUPS = [
  {
    label: "Work",
    links: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/pipeline/research", label: "Research", icon: FlaskConical },
      { href: "/pipeline", label: "Pipeline", icon: Network },
      { href: "/inbox", label: "Inbox", icon: Inbox },
      { href: "/athletes", label: "Athletes", icon: Users },
      { href: "/brand-opportunities", label: "Brand briefs", icon: BriefcaseBusiness },
    ],
  },
  {
    label: "Intelligence",
    links: [
      { href: "/historical", label: "Historical", icon: Database },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Workspace",
    links: [
      { href: "/connections", label: "Connections", icon: Blocks },
      { href: "/team", label: "Team", icon: Users },
    ],
  },
] as const;

function PrimeChampsMark() {
  return (
    <span className="pc-wordmark" aria-label="Prime Champs">
      <span>PRIME</span>
      <small>CHAMPS</small>
    </span>
  );
}

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/pipeline/research") return pathname.startsWith("/pipeline/research");
  if (href === "/pipeline") return pathname.startsWith("/pipeline") && !pathname.startsWith("/pipeline/research");
  return pathname.startsWith(href);
}

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null);
  const [outboundSendingEnabled, setOutboundSendingEnabled] = useState(false);
  const mobileOpen = mobileOpenPath === pathname;

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    fetch("/api/system/safety", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setOutboundSendingEnabled(data.outboundSendingEnabled === true))
      .catch(() => setOutboundSendingEnabled(false));
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpenPath(null);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileOpen]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
    router.refresh();
  };

  const navigation = (
    <div className="pc-nav-scroll">
      {NAV_GROUPS.map((group) => (
        <section key={group.label} className="pc-nav-group" aria-label={group.label}>
          <p className="pc-nav-label">{group.label}</p>
          <div className="pc-nav-links">
            {group.links.map((link) => {
              const active = isActivePath(pathname, link.href);
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`pc-nav-link ${active ? "is-active" : ""}`}
                  onClick={() => setMobileOpenPath(null)}
                >
                  <Icon aria-hidden="true" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );

  const account = (
    <div className="pc-account">
      <div className="pc-account-row">
        <span className="pc-avatar" aria-hidden="true">
          {(user?.name || "Z").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <strong>{user?.name || "Prime Champs"}</strong>
          <small>{user?.role || "workspace"}</small>
        </span>
      </div>
      <button type="button" onClick={handleLogout} className="pc-logout">
        <LogOut aria-hidden="true" />
        Sign out
      </button>
    </div>
  );

  const safetyStatus = (
    <div className={`pc-safety-status ${outboundSendingEnabled ? "is-live" : ""}`}>
      <LockKeyhole aria-hidden="true" />
      <span>{outboundSendingEnabled ? "Live sends enabled" : "Draft only · sends off"}</span>
    </div>
  );

  return (
    <>
      <header className="pc-mobile-bar">
        <Link href="/" className="pc-mobile-logo"><PrimeChampsMark /></Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="pc-icon-button"
            onClick={() => setMobileOpenPath((openPath) => openPath === pathname ? null : pathname)}
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <div className="pc-global-notifications">
        <NotificationsBell />
      </div>

      <aside className="pc-sidebar" aria-label="Workspace navigation">
        <Link href="/" className="pc-sidebar-logo"><PrimeChampsMark /></Link>
        <p className="pc-sidebar-kicker">Partnership operations</p>
        {safetyStatus}
        {navigation}
        {account}
      </aside>

      {mobileOpen && (
        <div className="pc-mobile-drawer" role="dialog" aria-modal="true" aria-label="Navigation">
          {safetyStatus}
          {navigation}
          {account}
        </div>
      )}
    </>
  );
}
