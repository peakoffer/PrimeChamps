import { NextResponse } from "next/server";

const response = () => NextResponse.json(
  {
    error: "This legacy setup endpoint is retired. Apply versioned Supabase migrations instead.",
  },
  { status: 410 }
);

export const GET = response;
export const POST = response;
