"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import NotificationsBell from "./NotificationsBell";

interface User {
  username: string;
  name: string;
}

export default function NavBar() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    // Check session on mount
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => setUser(data.user))
      .catch(() => setUser(null));
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/login");
    router.refresh();
  };

  // Don't show nav on login page
  if (pathname === "/login") {
    return null;
  }

  const navLinks = [
    { href: "/", label: "Dashboard" },
    { href: "/pipeline", label: "Pipeline" },
    { href: "/inbox", label: "Inbox" },
    { href: "/historical", label: "Historical" },
    { href: "/analytics", label: "Analytics" },
    { href: "/connections", label: "Connections" },
  ];

  return (
    <nav className="bg-white shadow-sm border-b sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/" className="text-xl font-bold text-gray-900">
              Prime Champs
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 text-sm font-medium ${
                  pathname === link.href
                    ? "text-blue-600"
                    : "text-gray-800 hover:text-gray-900"
                }`}
              >
                {link.label}
              </Link>
            ))}

            {/* Notifications */}
            <div className="ml-2">
              <NotificationsBell />
            </div>

            {/* User menu */}
            {user && (
              <div className="flex items-center gap-3 ml-2 pl-4 border-l">
                <span className="text-sm text-gray-800">
                  Hi, <span className="font-medium">{user.name}</span>
                </span>
                <button
                  onClick={handleLogout}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
