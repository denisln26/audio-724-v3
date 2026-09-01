import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabase = null;

export function getSupabase() {
    if (supabase) return supabase;
    if (!supabaseUrl || !supabaseAnonKey) return null;
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    return supabase;
}

export function isSupabaseConfigured() {
    return !!(supabaseUrl && supabaseAnonKey);
}

// ========== AUTH ==========
export async function authSignUp(email, password) {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw error;
    return data;
}

export async function authSignIn(email, password) {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function authSignOut() {
    const sb = getSupabase();
    if (!sb) return;
    await sb.auth.signOut();
}

export async function authUpdatePassword(newPassword) {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
}

export async function authGetUser() {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.auth.getUser();
    return data?.user || null;
}

// ========== USERS PROFILE ==========
export async function fetchUserProfile(userId) {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.from('users').select('*').eq('id', userId).single();
    return data;
}

export async function upsertUserProfile(profile) {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('users').upsert(profile, { onConflict: 'id' }).select().single();
    if (error) throw error;
    return data;
}

export async function fetchAllUsers() {
    const sb = getSupabase();
    if (!sb) return [];
    const { data, error } = await sb.from('users').select('*').order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
}

export async function updateUserProfile(userId, updates) {
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.from('users').update(updates).eq('id', userId);
    return !error;
}

export async function deleteUserProfile(userId) {
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.from('users').delete().eq('id', userId);
    return !error;
}

export async function saveUserSettings(userId, settings) {
    const sb = getSupabase();
    if (!sb) return false;
    const { error } = await sb.from('users').update({ settings }).eq('id', userId);
    return !error;
}

export async function loadUserSettings(userId) {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb.from('users').select('settings').eq('id', userId).single();
    return data?.settings || null;
}

// ========== SITE CONFIG (satu lokasi untuk semua device) ==========
export async function loadSiteConfig() {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('site_config').select('*').eq('id', 1).single();
    if (error) return null;
    return data;
}
export async function saveSiteConfig(patch) {
    const sb = getSupabase();
    if (!sb) return false;
    const payload = { id: 1, ...patch, updated_at: new Date().toISOString() };
    const { error } = await sb.from('site_config').upsert(payload, { onConflict: 'id' });
    return !error;
}
