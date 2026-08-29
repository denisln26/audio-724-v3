// Supabase Edge Function: gdrive-proxy
// -------------- --------------------------------------------------
// Memungkinkan file audio dari Google Drive diputar di tag <audio>.
// Google memblokir akses cross-origin langsung dari browser, jadi
// file diunduh dari sisi server (Edge Function) lalu di-streaming
// balik dengan header CORS + dukungan Range agar seek bisa berjalan.
//
// Cara pakai dari frontend:
//   `${SUPABASE_URL}/functions/v1/gdrive-proxy?id=<FILE_ID>`
//   atau
//   `${SUPABASE_URL}/functions/v1/gdrive-proxy?url=<share_URL_or_file_URL>`
//
// Deploy:
//   supabase functions deploy gdrive-proxy --no-verify-jwt
//   (tanpa --no-verify-jwt, setiap request perlu Authorization;
//    untuk pemutar publik lebih mudah tanpa verifikasi JWT)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Origin, X-Requested-With, Content-Type, Accept, Authorization",
  "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length, Content-Disposition, Content-Type",
  "X-Content-Type-Options": "nosniff",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Ekstrak FILE_ID dari link share / URL Google Drive
function extractId(input: string): string {
  const s = (input || "").trim();
  let m = s.match(/\/file\/d\/([^/?#]+)/);
  if (m) return m[1];
  m = s.match(/[?&]id=([^&#]+)/);
  if (m) return m[1];
  m = s.match(/\/d\/([^/?#]+)/);
  if (m) return m[1];
  return s;
}

// Ikuti redirect + tangani halaman "virus scan" (confirm token) untuk file besar.
async function fetchWithRedirects(
  url: string,
  range: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    "Accept": "*/*",
    "Cache-Control": "no-cache",
  };
  if (range) headers["Range"] = range;

  let res = await fetch(url, { headers, redirect: "follow" });
  const ct = (res.headers.get("content-type") || "").toLowerCase();

  // Kalau Google balas halaman HTML virus-scan (file besar), ambil token confirm
  if (!ct.includes("audio") && !ct.includes("video") && !ct.includes("octet") &&
      !ct.includes("application/")) {
    const text = await res.text();
    const confirm = text.match(/name="confirm" value="([^"]+)"/)?.[1];
    const uuid = text.match(/name="uuid" value="([^"]+)"/)?.[1];
    if (confirm) {
      const u = new URL(url);
      u.searchParams.set("confirm", confirm);
      if (uuid) u.searchParams.set("uuid", uuid);
      return await fetch(u.toString(), { headers, redirect: "follow" });
    }
  }
  return res;
}

function handleOptions(): Response {
  return new Response("OK", { status: 204, headers: corsHeaders });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions();

  const url = new URL(req.url);
  const idParam = url.searchParams.get("id") || "";
  const rawUrl = url.searchParams.get("url") || "";
  const fileId = idParam ? idParam : extractId(rawUrl);
  if (!fileId) {
    return new Response(
      JSON.stringify({ error: "Parameter 'id' atau 'url' wajib diisi." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const range = req.headers.get("range");

  try {
    const gdrive = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
    const res = await fetchWithRedirects(gdrive, range);

    const headers: Record<string, string> = { ...corsHeaders };
    for (const h of [
      "content-type", "content-length", "content-range", "accept-ranges",
      "content-disposition", "cache-control", "etag", "last-modified",
      "content-encoding",
    ]) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    // pastikan selalu ada
    headers["Accept-Ranges"] = "bytes";

    const status = res.status === 206 ? 206 : res.ok ? 200 : res.status;
    return new Response(res.body, { status, headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String(e) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
