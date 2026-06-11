import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// Fail hard if the signing secret is missing — never fall back to a known
// literal, which would make every session cookie forgeable.
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET is missing or too short (min 32 chars). Set it in the environment before starting."
    );
  }
  return new TextEncoder().encode(secret);
}

// Credentials come from the environment, never source.
// Format: AUTH_USERS="zac:plaintextpw:Zac,dylan:plaintextpw:Dylan"
// (username:password:displayName, comma-separated). Falls back to the single
// AUTH_USERNAME / AUTH_PASSWORD pair if AUTH_USERS is unset.
interface StoredUser {
  password: string;
  name: string;
}

function loadUsers(): Record<string, StoredUser> {
  const users: Record<string, StoredUser> = {};
  const raw = process.env.AUTH_USERS;
  if (raw) {
    for (const entry of raw.split(",")) {
      const [username, password, name] = entry.split(":");
      if (username && password) {
        users[username.trim().toLowerCase()] = {
          password: password.trim(),
          name: (name || username).trim(),
        };
      }
    }
  } else if (process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD) {
    const username = process.env.AUTH_USERNAME.trim().toLowerCase();
    users[username] = {
      password: process.env.AUTH_PASSWORD,
      name: process.env.AUTH_DISPLAY_NAME?.trim() || process.env.AUTH_USERNAME,
    };
  }
  return users;
}

const SESSION_COOKIE = "prime-champs-session";

export interface User {
  username: string;
  name: string;
}

export async function login(username: string, password: string): Promise<User | null> {
  const users = loadUsers();
  const key = username.toLowerCase();
  const user = users[key];
  // Compare against the real password (or a decoy when the user is unknown) so
  // timing doesn't reveal whether a username exists.
  const expected = user?.password ?? "\0invalid";
  const matches = timingSafeEqualStr(password, expected);
  if (!user || !matches) {
    return null;
  }

  // Create JWT token
  const token = await new SignJWT({ username: key, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());

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

    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      username: payload.username as string,
      name: payload.name as string,
    };
  } catch {
    return null;
  }
}

// Constant-time string comparison that tolerates length differences.
function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export async function requireAuth(): Promise<User> {
  const session = await getSession();
  if (!session) {
    throw new Error("Not authenticated");
  }
  return session;
}
