import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// ================== KONFIGURASI AKUN ==================
// Default sesuai permintaan. Bisa juga dioverride via argumen CLI:
//   node create-admin.mjs <email> <password> "<nama>" <username> [role]
const EMAIL    = process.argv[2] || 'Deni26@gmail.com';
const PASSWORD = process.argv[3] || 'Ronaldo07@';
const NAME     = process.argv[4] || 'deni s';
const USERNAME = process.argv[5] || 'deni26';
const ROLE     = process.argv[6] || 'admin';

// Baca kredensial proyek dari .env.local
const env = readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
    const [key, val] = line.split('=');
    if (key && val) acc[key.trim()] = val.trim();
    return acc;
}, {});

if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    console.error('❌ .env.local harus berisi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY');
    process.exit(1);
}
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function ensureProfile(userId) {
    const payload = {
        id: userId,
        email: EMAIL,
        name: NAME,
        username: USERNAME,
        role: ROLE,
        storage_limit: 0,
        force_change_password: false,
        created_at: new Date().toISOString()
    };
    const { error } = await supabase.from('users').upsert(payload, { onConflict: 'id' });
    if (error) {
        console.error('❌ Gagal simpan profil:', error.message);
        console.log('Pastikan tabel users sudah dibuat dari sql/schema.sql');
        return false;
    }
    console.log(`✅ Profil disimpan → nama:"${NAME}" | username:"${USERNAME}" | role:${ROLE}`);
    return true;
}

async function main() {
    console.log(`Memproses akun: ${EMAIL} (nama:"${NAME}", username:"${USERNAME}", role:${ROLE})`);

    // 1. Coba daftarkan akun di Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email: EMAIL,
        password: PASSWORD,
        options: { data: { name: NAME } }
    });

    let userId = null;
    if (authError) {
        const msg = authError.message || '';
        if (/already/i.test(msg)) {
            console.log('ℹ️ Akun sudah terdaftar → login untuk sinkronisasi profil...');
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
            if (loginError) {
                console.error('❌ Login gagal:', loginError.message);
                process.exit(1);
            }
            userId = loginData.user.id;
            console.log('✅ Login berhasil! User ID:', userId);
        } else {
            console.error('❌ Gagal buat akun:', msg);
            process.exit(1);
        }
    } else {
        userId = authData?.user?.id;
        console.log('✅ Akun Auth siap. User ID:', userId);
    }

    // 2. Simpan/perbarui profil di tabel users (dengan username & role)
    if (userId) await ensureProfile(userId);

    // 3. Verifikasi akhir: pastikan benar-benar bisa login
    const { error: vErr } = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (vErr) {
        if (/confirm/i.test(vErr.message)) {
            console.log('');
            console.log('⚠️  Konfirmasi email AKTIF di Supabase.');
            console.log('   Nonaktifkan: Authentication → Providers → Email → matikan "Confirm email", lalu jalankan lagi.');
        } else {
            console.log('⚠️ Verifikasi login gagal:', vErr.message);
        }
        process.exit(1);
    }
    console.log('');
    console.log('✅✅ Selesai! Login dapat memakai:');
    console.log(`      Email    : ${EMAIL}   atau`);
    console.log(`      Username : ${USERNAME}`);
    console.log(`      Password : (sesuai yang Anda berikan)`);
    console.log(`      Role     : ${ROLE} → menu Admin & semua fitur terbuka`);
}
main();
