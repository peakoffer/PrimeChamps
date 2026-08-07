"use client";

import { usePathname } from "next/navigation";
import NavBar from "@/components/NavBar";

const PUBLIC_ROUTES = new Set([
  "/login",
  "/setup",
  "/privacy",
  "/terms",
  "/data-deletion",
]);

export function WorkspaceShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC_ROUTES.has(pathname);

  if (isPublic) {
    return <main className="public-workspace">{children}</main>;
  }

  return (
    <div className="app-frame">
      <NavBar />
      <main className="app-workspace">
        <div className="app-workspace-inner">{children}</div>
      </main>
    </div>
  );
}
