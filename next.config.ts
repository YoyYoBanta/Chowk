import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @whiskeysockets/baileys optionally, dynamically imports `jimp`/`sharp`
  // at runtime (lib/Utils/messages-media.js), wrapped in its own
  // `.catch(() => {})` for when neither is installed — image-media
  // thumbnail generation, irrelevant to this milestone's text-only send.
  // Neither package is a dependency of this project (out of scope until
  // M6/media). Turbopack's static bundler otherwise tries to resolve those
  // dynamic imports at build time and fails hard since they're genuinely
  // absent from node_modules. Marking the whole package external makes
  // Next require() it at runtime instead of bundling it, which is exactly
  // where baileys's own try/catch already handles the missing-optional-dep
  // case gracefully. See TODO-VERIFY.md's M4 section.
  serverExternalPackages: ["@whiskeysockets/baileys"],
};

export default nextConfig;
