import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// Simple user store - in production use a database
const USERS: Record<string, { password: string; name: string }> = {
  dylan: { password: "dylan", name: "Dylan" },
  zac: { password: "zac", name: "Zac" },
};

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "prime-champs-secret-key-change-in-production"
);

const SESSION_COOKIE = "prime-champs-session";

export interface User {
  username: string;
  name: string;
}

export async function login(username: string, password: string): Promise<User | null> {
  const user = USERS[username.toLowerCase()];
  if (!user || user.password !== password.toLowerCase()) {
    return null;
  }

  // Create JWT token
  const token = await new SignJWT({ username: username.toLowerCase(), name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(JWT_SECRET);

  // Set cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });

  return { username: username.toLowerCase(), name: user.name };
}

export async function logout(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<User | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;

    if (!token) {
      return null;
    }

    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      username: payload.username as string,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}

export async function requireAuth(): Promise<User> {
  const session = await getSession();
  if (!session) {
    throw new Error("Not authenticated");
  }
  return session;
}
