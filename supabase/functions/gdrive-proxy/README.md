# gdrive-proxy

Edge Function ini dipakai agar lagu dari Google Drive bisa diputar di aplikasi.

Google sengaja memblokir pemutaran file Google Drive langsung di tag `<audio>`
dari browser (akses cross-origin diblokir, `MEDIA_ERR_SRC_NOT_SUPPORTED`).
Solusinya: file diunduh dari sisi server Edge Function lalu di-streaming balik
dengan header CORS + dukungan `Range` sehingga seek / maju-mundur tetap jalan.

## URL di frontend

```
${SUPABASE_URL}/functions/v1/gdrive-proxy?id=<FILE_ID>
```

Bisa juga menerima link share penuh lewat `?url=`.

## Deploy

Prasyarat: sudah login Supabase CLI (`supabase login`) & terhubung ke project
(`supabase link --project-ref ppwfvmixnzgecamruwyv`).

```bash
supabase functions deploy gdrive-proxy --no-verify-jwt
```

- `--no-verify-jwt`: tanpa ini, dan tanpa header `Authorization`, request pemutar
  audio (yang polos, tanpa token) akan ditolak 401. Karena pemutar butuh akses
  publik/autoplay, disarankan pakai flag ini.

Setelah deploy, coba di browser:

```
https://ppwfvmixnzgecamruwyv.supabase.co/functions/v1/gdrive-proxy?id=1BIfd3Btp_OZcqVJ91pee6BFkdgqUV5q2
```

Seharusnya mengembalikan audio (bukan JSON error).
