import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Baca .env.local
const env = readFileSync('.env.local', 'utf8').split('\n').reduce((acc, line) => {
    const [key, val] = line.split('=');
    if (key && val) acc[key.trim()] = val.trim();
    return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function createAdmin() {
    const email = 'Deni26@gmail.com';
    const password = 'Ronaldo07@';
    const name = 'Deni';

    console.log('Membuat akun:', email);

    // 1. Buat akun di Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } }
    });

    if (authError) {
        console.error('Gagal buat akun:', authError.message);
        if (authError.message.includes('already registered')) {
            console.log('Akun sudah ada, coba login...');
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
            if (loginError) { console.error('Login gagal:', loginError.message); return; }
            console.log('Login berhasil! User ID:', loginData.user.id);
            await createProfile(loginData.user.id, email, name, 'admin');
        }
        return;
    }

    console.log('Akun Auth dibuat! User ID:', authData.user.id);

    // 2. Buat profil di tabel users
    await createProfile(authData.user.id, email, name, 'admin');

    // 3. Coba login untuk pastikan bisa
    const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
    if (loginError) {
        console.log('');
        console.log('⚠️  Email confirmation aktif di Supabase.');
        console.log('Nonaktifkan dulu: Authentication → Providers → Email → matikan "Confirm email"');
        console.log('Lalu jalankan script ini lagi.');
    } else {
        console.log('');
        console.log('✅ Akun berhasil dibuat dan bisa login!');
        console.log('   Email:    Deni26@gmail.com');
        console.log('   Password: Ronaldo07@');
        console.log('   Role:     admin');
    }
}

async function createProfile(userId, email, name, role) {
    const { error } = await supabase.from('users').upsert({
        id: userId,
        email,
        name,
        role,
        storage_limit: 0,
        force_change_password: false,
        created_at: new Date().toISOString()
    }, { onConflict: 'id' });

    if (error) {
        console.error('Gagal buat profil:', error.message);
        console.log('Pastikan tabel users sudah dibuat dari sql/schema.sql');
    } else {
        console.log('Profil admin dibuat di tabel users');
    }
}

createAdmin();
