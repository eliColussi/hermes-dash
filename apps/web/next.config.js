/** @type {import('next').NextConfig} */

// Security headers applied to every route. Kept conservative on purpose —
// a strict Content-Security-Policy needs per-route testing because Next's
// inline styles + RSC payloads can trip overly tight script-src rules.
// What's here is the "no false-positives" baseline that buyers' security
// questionnaires check for in the first five minutes:
//
// - HSTS forces HTTPS on repeat visits (Railway is HTTPS-only anyway).
// - CSP frame-ancestors 'none' blocks clickjacking; supersedes X-Frame-Options
//   on modern browsers but we set both for older clients.
// - nosniff prevents MIME-type confusion attacks.
// - Referrer-Policy keeps URLs from leaking to third parties.
// - Permissions-Policy disables sensors/camera/mic that this product never uses.
const SECURITY_HEADERS = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig = {
  output: "standalone",
  typedRoutes: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

module.exports = nextConfig;
