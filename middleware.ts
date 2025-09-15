import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function middleware(request: NextRequest) {
  // Check if the request is for the admin routes
  if (request.nextUrl.pathname.startsWith("/admin")) {
    // Get the session from Supabase
    const requestUrl = new URL(request.url)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_ANON_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const {
      data: { session },
    } = await supabase.auth.getSession()

    // If no session, redirect to login
    if (!session) {
      return NextResponse.redirect(new URL("/login", request.url))
    }

    // Optional: Check for admin role
    // const { data: { user } } = await supabase.auth.getUser()
    // if (!user?.app_metadata?.role === 'admin') {
    //   return NextResponse.redirect(new URL('/', request.url))
    // }
  }

  return NextResponse.next()
}

// Only run middleware on admin routes
export const config = {
  matcher: "/admin/:path*",
}
