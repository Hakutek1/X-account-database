/**
 * Build-only binding stub for Vercel. Preview API requests are intercepted by
 * middleware; reaching a Cloudflare route is an error and must never fall back
 * to a real database or bucket.
 */
export const env = new Proxy({} as { DB?: never; R2?: never }, {
  get(_target, binding: string | symbol) {
    throw new Error(`Cloudflare binding ${String(binding)} is unavailable in the synthetic Vercel preview.`);
  },
});
