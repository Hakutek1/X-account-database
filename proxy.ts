import { NextResponse } from "next/server";
import { handleVercelPreviewRequest } from "./lib/vercel-preview";

export function proxy(request: Request) {
  if (import.meta.env.MODE === "vercel-preview") {
    const response = handleVercelPreviewRequest(request);
    if (response) return response;
  }

  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
