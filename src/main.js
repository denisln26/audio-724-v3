import { getSupabase, isSupabaseConfigured, authSignIn, authSignUp, authSignOut, authUpdatePassword, authGetUser, fetchUserProfile, upsertUserProfile, fetchAllUsers, updateUserProfile, deleteUserProfile, saveUserSettings, loadUserSettings } from './lib/supabase.js';

// ========== HIJRI ==========
function gregorianToHijri(gY,gM,gD){const jd=Math.floor(365.25*(gY+4716))+Math.floor(30.6001*(gM<3?gM+13:gM+1))+gD-1524.5;const l=Math.floor(jd-1948439.5+10632);const n=Math.floor((l-1)/10631);const r=l-10631*n+354;const j=Math.floor((10985-r)/5316)*Math.floor((50*r)/17719)+Math.floor(r/5670)*Math.floor((43*r)/15238);const rr=r-Math.floor((30-j)/15)*Math.floor((17719*j)/50)-Math.floor(j/16)*Math.floor((15238*j)/43)+29;const hm=Math.floor((24*rr)/709);const hd=rr-Math.floor((709*hm)/24);const hy=30*n+j-30;return{year:hy,month:hm,day:hd}}
const HIJRI_M=['Muharram','Safar','Rabiul Awal','Rabiul Akhir','Jumadil Awal','Jumadil Akhir','Rajab','Syakban','Ramadhan','Syawal','Dzulqa\'dah','Dzulhijjah'];

// ========== STATE ==========
let currentUser=null, tracks=[], playlists=[], upacaras=[], schedules=[];
let currentPlaylist=[], currentPlaylistIndex=-1, isPlaying=false, isPrayerTime=false, autoPlayEnabled=false, pausedPosition=0, stopAfterPlaylist=false, loopPlaylist=false, silencedUntil=0;
let adzanPlayedToday={};
let prayerTimes={}, editingId=null, editingType='';
let activeScheduleId=null, manualPauseKey=null, activeScheduleVolumePct=100;
let isIndoRayaActive=false;
let irAudio=null,irAudioUrl=null,irResumeTimer=null,irCooldownUntil=0;
let manualOverrideUntil=0;
let _dashTick=0;
const audio=new Audio();
const DAY_NAMES=['Min','Sen','Sel','Rab','Kam','Jum','Sab'];
const PRAYER_NAMES=['Imsak','Subuh','Terbit','Dzuhur','Ashar','Maghrib','Isya'];
const DEFAULT_PASSWORD='12345678';
let settings={volume:70,shuffle:false,repeat:false,lat:-6.2088,lng:106.8456,timeOffset:0,prayerOffsets:{Imsak:0,Subuh:0,Terbit:0,Dzuhur:0,Ashar:0,Maghrib:0,Isya:0},adzanSubuhVolume:90,adzanUmumVolume:80,doaVolume:70,doaEnabled:false,playAfterAdzan:false,afterAdzanDelay:10,adzanSubuhTrackId:null,adzanUmumTrackId:null,doaTrackId:null,indoRayaTrackId:null,autoPlay:true};

// ========== UTILS ==========
const $=id=>document.getElementById(id);
const formatTime=s=>{if(!s||isNaN(s))return'0:00';const m=Math.floor(s/60);return m+':'+(Math.floor(s%60)+'').padStart(2,'0')};
const formatSize=b=>(b/1048576).toFixed(2)+' MB';
const genId=()=>crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).substr(2,9);
const toast=m=>{const t=$('toast');t.textContent=m;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2500)};
function closeModal(id){const m=$(id);if(m)m.classList.remove('active')}
window.closeModal=closeModal;

// ========== LOCAL STORAGE ==========
const LS={
    get:(k,d)=>{try{const v=localStorage.getItem('mp_'+k);return v?JSON.parse(v):d}catch{return d}},
    set:(k,v)=>{try{localStorage.setItem('mp_'+k,JSON.stringify(v));return true}catch(e){console.warn('LocalStorage tidak bisa menyimpan (kuota penuh?):',k,e);return false}},
    del:k=>{try{localStorage.removeItem('mp_'+k)}catch(e){}}
};

// ========== INDEXEDDB (local media blobs, unlimited) ==========
const MP_DB='musikpintar_db', MP_STORE='offline_blobs';
function openBlobDB(){return new Promise((res,rej)=>{const r=indexedDB.open(MP_DB,1);r.onupgradeneeded=e=>{if(!e.target.result.objectStoreNames.contains(MP_STORE))e.target.result.createObjectStore(MP_STORE)};r.onsuccess=e=>res(r.result);r.onerror=e=>rej(r.error)})}
async function putBlob(id,blob){const db=await openBlobDB();return new Promise((res,rej)=>{const tx=db.transaction(MP_STORE,'readwrite');tx.objectStore(MP_STORE).put(blob,id);tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error)})}
async function getBlob(id){const db=await openBlobDB();return new Promise((res,rej)=>{const tx=db.transaction(MP_STORE,'readonly');const rq=tx.objectStore(MP_STORE).get(id);rq.onsuccess=()=>res(rq.result||null);rq.onerror=()=>rej(rq.error)})}
async function deleteBlob(id){const db=await openBlobDB();return new Promise((res)=>{const tx=db.transaction(MP_STORE,'readwrite');tx.objectStore(MP_STORE).delete(id);tx.oncomplete=()=>res()})}

// ========== AUTH (Supabase Auth) ==========
async function doLogin(){
    const input=$('loginEmail').value.trim();
    const password=$('loginPassword').value;
    if(!input||!password){toast('Isi email/username & password');return}
    if(!isSupabaseConfigured()){toast('Supabase belum dikonfigurasi');return}
    try{
        let email=input;
        // Jika input bukan email (tidak ada @), cari email dari username
        if(!input.includes('@')){
            const sb=getSupabase();
            const {data:found}=await sb.from('users').select('email').eq('username',input).single();
            if(!found||!found.email){toast('Username tidak ditemukan');return}
            email=found.email;
        }
        const authData=await authSignIn(email,password);
        const profile=await fetchUserProfile(authData.user.id);
        if(!profile){
            await upsertUserProfile({id:authData.user.id,email,username:input,name:input,role:'user',storage_limit:0,force_change_password:false});
            currentUser={id:authData.user.id,email,username:input,name:input,role:'user',storage_limit:0,force_change_password:false};
        }else{
            currentUser={id:profile.id,email:profile.email||email,username:profile.username||input,name:profile.name,role:profile.role,storage_limit:profile.storage_limit||0,force_change_password:profile.force_change_password};
        }
        LS.set('currentUser',currentUser);
        if(currentUser.force_change_password){showChangePasswordModal();return}
        onLoginSuccess();
    }catch(e){toast('Login gagal: '+e.message)}
}
window.doLogin=doLogin;

function showChangePasswordModal(){
    toast('Anda harus mengubah password');
    $('changePasswordModal').classList.add('active');
    $('changePasswordNew').value='';
    $('changePasswordConfirm').value='';
}
window.showChangePasswordModal=showChangePasswordModal;

async function doChangePassword(){
    const newP=$('changePasswordNew').value;
    const confirmP=$('changePasswordConfirm').value;
    if(!newP||!confirmP){toast('Semua field wajib diisi');return}
    if(newP.length<6){toast('Password minimal 6 karakter');return}
    if(newP!==confirmP){toast('Password baru tidak cocok');return}
    try{
        await authUpdatePassword(newP);
        await updateUserProfile(currentUser.id,{force_change_password:false});
        currentUser.force_change_password=false;
        LS.set('currentUser',currentUser);
        closeModal('changePasswordModal');
        toast('Password berhasil diubah');
        onLoginSuccess();
    }catch(e){toast('Gagal: '+e.message)}
}
window.doChangePassword=doChangePassword;

function onLoginSuccess(){
    $('loginPage').style.display='none';
    $('appPage').style.display='';
    document.querySelector('.sidebar').style.display='';
    document.querySelector('.main-content header').style.display='';
    updateUI();
    syncData().then(()=>{
        loadSettingsUI();renderTracks();renderPlaylists();renderUpacaras();renderSchedules();renderPrayerGrid();renderDashboard();
        showPage('dashboard');
    });
    toast('Selamat datang, '+currentUser.name);
}

async function logout(){
    try{bcStopAdminRealtime()}catch(e){}
    try{hsStopHostSession()}catch(e){}
    currentUser=null;LS.del('currentUser');
    if(isSupabaseConfigured())await authSignOut();
    $('appPage').style.display='none';
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    $('loginPage').style.display='';
    document.querySelector('.sidebar').style.display='none';
    document.querySelector('.main-content header').style.display='none';
    audio.pause();isPlaying=false;
}
window.logout=logout;

function updateUI(){
    if(!currentUser)return;
    $('sidebarUserName').textContent=currentUser.name||currentUser.email||'User';
    $('sidebarUserRole').textContent=currentUser.role==='admin'?'Administrator':'User';
    $('sidebarAvatar').textContent=(currentUser.name||currentUser.email||'U').substring(0,2).toUpperCase();
    $('navAdmin').style.display=currentUser.role==='admin'?'':'none';
}

// ========== DATA SYNC ==========
async function syncData(){
    if(!currentUser)return;
    if(isSupabaseConfigured()){
        try{
            const sb=getSupabase();
            const uid=currentUser.id;
            const [t,p,u,s]=await Promise.all([
                sb.from('tracks').select('*').eq('owner',uid),
                sb.from('playlists').select('*').eq('owner',uid),
                sb.from('upacaras').select('*').eq('owner',uid),
                sb.from('schedules').select('*').eq('owner',uid)
            ]);
            tracks=t.data||[];playlists=p.data||[];upacaras=u.data||[];schedules=s.data||[];
        }catch(e){console.error('Sync error:',e)}
        // Pengaturan dimuat TERPISAH agar tetap ter-load walau salah satu tabel error
        try{
            const dbSettings=await loadUserSettings(currentUser.id);
            if(dbSettings&&Object.keys(dbSettings).length)settings={...settings,...dbSettings};
        }catch(e){console.error('Settings load error:',e)}
        for(const t of tracks){
            if(t.type==='offline'){
                t.src='';
                const b=await getBlob(t.id);
                if(b){t.src=URL.createObjectURL(b);t._localAvailable=true}
                else{t._localAvailable=false}
            }
        }
        await updateAdzanAvailability();
        ensureTrackDurations();
    }else{
        tracks=LS.get('tracks_'+currentUser.id,[]);
        playlists=LS.get('playlists_'+currentUser.id,[]);
        upacaras=LS.get('upacaras_'+currentUser.id,[]);
        schedules=LS.get('schedules_'+currentUser.id,[]);
        for(const t of tracks){if(t.type==='offline'&&(!t.src||t.src==='')){const b=await getBlob(t.id);if(b){t.src=URL.createObjectURL(b);t._localAvailable=true}else{t._localAvailable=false}}}
        settings=LS.get('settings_'+currentUser.id,settings);
        await updateAdzanAvailability();
        ensureTrackDurations();
    }
    // Saklar Putar Otomatis disimpan di pengaturan (tersimpan ke database), default AKTIF
    autoPlayEnabled=settings.autoPlay!==false;
}
let _saveTimer=null;
function saveLocal(){
    if(!currentUser)return;
    LS.set('settings_'+currentUser.id,settings);
    if(isSupabaseConfigured()){
        if(_saveTimer)clearTimeout(_saveTimer);
        _saveTimer=setTimeout(()=>_syncToSupabase(),500);
        return;
    }
    const safeTracks=tracks.map(t=>t.type==='offline'&&t.src&&t.src.startsWith('blob:')?{...t,src:'',_localAvailable:undefined}:t);
    LS.set('tracks_'+currentUser.id,safeTracks);
    LS.set('playlists_'+currentUser.id,playlists);
    LS.set('upacaras_'+currentUser.id,upacaras);
    LS.set('schedules_'+currentUser.id,schedules);
}
// Simpan pengaturan user ke database SEKARANG (tanpa debounce), hasilnya true/false.
async function saveUserSettingsNow(){
    if(!currentUser||!isSupabaseConfigured())return true;
    if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null}
    try{
        const ok=await saveUserSettings(currentUser.id,settings);
        if(!ok)console.error('Settings sync gagal (cek kolom users.settings / RLS)');
        return !!ok;
    }catch(e){console.error('Settings sync error:',e);return false}
}
async function _syncToSupabase(){await saveUserSettingsNow()}

// ========== SETTINGS ==========
function saveSettings(){
    settings.timeOffset=parseInt($('timeOffset')?.value)||0;
    if($('latInput')&&$('lngInput')){const la=parseFloat($('latInput').value),ln=parseFloat($('lngInput').value);if(!isNaN(la)&&!isNaN(ln)){settings.lat=la;settings.lng=ln;prayerTimes=calcPrayerTimes(la,ln);renderPrayerGrid();updateCountdown(new Date())}}
    settings.adzanSubuhVolume=parseInt($('adzanSubuhVol')?.value)||90;
    settings.adzanUmumVolume=parseInt($('adzanUmumVol')?.value)||80;
    settings.doaVolume=parseInt($('doaVol')?.value)||70;
    settings.doaEnabled=$('doaEnabled')?.checked||false;
    settings.playAfterAdzan=$('playAfterAdzan')?.checked||false;
    settings.afterAdzanDelay=Math.max(0,parseInt($('afterAdzanDelay')?.value)||0);
    settings.adzanSubuhTrackId=$('adzanSubuhTrack')?.value||null;
    settings.adzanUmumTrackId=$('adzanUmumTrack')?.value||null;
    settings.doaTrackId=$('doaTrack')?.value||null;
    settings.indoRayaTrackId=$('indoRayaTrack')?.value||null;
    if($('adzanSubuhVolVal'))$('adzanSubuhVolVal').textContent=settings.adzanSubuhVolume+'%';
    if($('adzanUmumVolVal'))$('adzanUmumVolVal').textContent=settings.adzanUmumVolume+'%';
    if($('doaVolVal'))$('doaVolVal').textContent=settings.doaVolume+'%';
    if($('doaEnabledLabel'))$('doaEnabledLabel').textContent=settings.doaEnabled?'Aktif':'Nonaktif';
    if($('playAfterAdzanLabel'))$('playAfterAdzanLabel').textContent=settings.playAfterAdzan?'Aktif':'Nonaktif';
    updateAdzanStatus();
    saveLocal();
}
// Tombol "Simpan Pengaturan Jadwal Sholat": beri indikator Menyimpan... -> ✓ Tersimpan / Gagal
async function saveSholatSettings(btn){
    const lbl=btn.querySelector('span');const old='Simpan Pengaturan Jadwal Sholat';
    btn.disabled=true;if(lbl)lbl.textContent='Menyimpan...';
    try{saveSettings()}catch(e){console.error('Save settings error:',e)}
    const dbOk=await saveUserSettingsNow();
    btn.disabled=false;
    const st=$('sholatSaveStatus');
    if(dbOk){
        if(lbl)lbl.textContent='✓ Tersimpan';
        setTimeout(()=>{if(btn.isConnected&&lbl)lbl.textContent=old},2000);
        if(st){st.classList.remove('hidden');st.style.color='#16a34a';st.textContent=(isSupabaseConfigured()?'Tersimpan ke database • ':'Tersimpan di perangkat ini • ')+new Date().toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
        toast('Pengaturan jadwal sholat tersimpan');
    }else{
        if(lbl)lbl.textContent='Gagal simpan';
        btn.style.background='#ef4444';
        setTimeout(()=>{if(btn.isConnected){if(lbl)lbl.textContent=old;btn.style.background='#50C878'}},2500);
        if(st){st.classList.remove('hidden');st.style.color='#ef4444';st.textContent='Tersimpan lokal, tapi GAGAL ke database — cek koneksi / kolom users.settings'}
        toast('Tersimpan lokal, GAGAL ke database');
    }
}
window.saveSholatSettings=saveSholatSettings;
function loadSettingsUI(){
    if($('latInput'))$('latInput').value=settings.lat;
    if($('lngInput'))$('lngInput').value=settings.lng;
    if($('timeOffset'))$('timeOffset').value=settings.timeOffset;
    if($('adzanSubuhVol'))$('adzanSubuhVol').value=settings.adzanSubuhVolume;
    if($('adzanUmumVol'))$('adzanUmumVol').value=settings.adzanUmumVolume;
    if($('doaVol'))$('doaVol').value=settings.doaVolume;
    if($('doaVolVal'))$('doaVolVal').textContent=settings.doaVolume+'%';
    if($('masterVolume'))$('masterVolume').value=settings.volume;
    if($('doaEnabled'))$('doaEnabled').checked=settings.doaEnabled;
    if($('doaEnabledLabel'))$('doaEnabledLabel').textContent=settings.doaEnabled?'Aktif':'Nonaktif';
    if($('playAfterAdzan'))$('playAfterAdzan').checked=settings.playAfterAdzan;
    if($('playAfterAdzanLabel'))$('playAfterAdzanLabel').textContent=settings.playAfterAdzan?'Aktif':'Nonaktif';
    if($('afterAdzanDelay'))$('afterAdzanDelay').value=settings.afterAdzanDelay;
    populateAdzanSelectors();
    updateShuffleRepeatBtn();
}
function populateAdzanSelectors(){
    const map=[['adzanSubuhTrack',settings.adzanSubuhTrackId],['adzanUmumTrack',settings.adzanUmumTrackId],['doaTrack',settings.doaTrackId],['indoRayaTrack',settings.indoRayaTrackId]];
    const ut=getUserTracks();
    for(const[id,sel]of map){const el=$(id);if(!el)continue;el.innerHTML='<option value="">— pilih dari library —</option>'+ut.map(t=>`<option value="${t.id}">${t.name}${t.type==='online'?' (Online)':''}</option>`).join('');if(sel)el.value=sel;}
}
function toggleShuffle(){settings.shuffle=!settings.shuffle;updateShuffleRepeatBtn();saveLocal()}
window.toggleShuffle=toggleShuffle;
function toggleRepeat(){settings.repeat=!settings.repeat;updateShuffleRepeatBtn();saveLocal()}
window.toggleRepeat=toggleRepeat;
function updateShuffleRepeatBtn(){
    const sb=$('shuffleBtn'),rb=$('repeatBtn');
    if(sb)sb.style.background=settings.shuffle?'#50C878':'';
    if(sb)sb.style.color=settings.shuffle?'#fff':'';
    if(rb)rb.style.background=settings.repeat?'#50C878':'';
    if(rb)rb.style.color=settings.repeat?'#fff':'';
}

// ========== NAVIGATION ==========
function showPage(page){
    document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('nav-active'));
    const el=$('page-'+page);if(el)el.classList.add('active');
    const nav=document.querySelector(`[data-page="${page}"]`);if(nav)nav.classList.add('nav-active');
    if(page==='library')renderTracks();
    if(page==='playlist')renderPlaylists();
    if(page==='upacara'){activeUpacaraId=null;renderUpacaras();}
    if(page==='jadwal')renderSchedules();
    if(page==='sholat')renderPrayerGrid();
    if(page==='admin')renderAdmin();
    if(page==='dashboard')renderDashboard();
}
window.showPage=showPage;
document.querySelectorAll('.nav-item').forEach(item=>{item.addEventListener('click',e=>{e.preventDefault();showPage(item.getAttribute('data-page'))})});

// ========== CLOCK ==========
function updateClock(){
    const now=new Date();
    const hc=$('headerClock');if(hc)hc.textContent=now.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    const hd=$('headerDate');if(hd)hd.textContent=now.toLocaleDateString('id-ID',{weekday:'short',day:'numeric',month:'short'});
    const dd=$('dashDate');if(dd)dd.textContent=now.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const h=now.getHours();let g='Selamat Datang';if(h>=4&&h<12)g='Selamat Pagi';else if(h>=12&&h<17)g='Selamat Siang';else if(h>=17&&h<20)g='Selamat Sore';else g='Selamat Malam';
    const gt=$('greetingText');if(gt)gt.textContent=`${g}, ${currentUser?.name||''}`;
    const hi=$('hijriDate');if(hi){const hd2=gregorianToHijri(now.getFullYear(),now.getMonth()+1,now.getDate());hi.textContent=`${hd2.day} ${HIJRI_M[hd2.month-1]} ${hd2.year} H`;}
    const ct=$('connectionText');if(ct)ct.textContent=navigator.onLine?'Online':'Offline';
    const cb=$('connectionBadge');if(cb){const ic=cb.querySelector('.material-symbols-outlined');if(ic)ic.textContent=navigator.onLine?'cloud_done':'cloud_off';}
    checkAutoPlay(now);
    enforceScheduleWindows(now);
    checkPrayerTime(now);
    checkIndoRaya(now);
    updateCountdown(now);
    // Refresh kartu jadwal aktif di dashboard tiap ~15 detik agar status ikon/waktu terkini
    _dashTick++;if(_dashTick%15===0&&$('page-dashboard')?.classList.contains('active')){
        const ad=$('activeSchedulesDash');
        const dragging=document.activeElement&&document.activeElement.type==='range'&&ad&&ad.contains(document.activeElement);
        if(!dragging)renderDashboard();
    }
}

// ========== PRAYER TIMES ==========
function calcPrayerTimes(lat,lng){
    const off=settings.timeOffset||0;
    const po=settings.prayerOffsets||{};
    const base={Imsak:[4,35],Subuh:[4,45],Terbit:[6,5],Dzuhur:[11,55],Ashar:[15,10],Maghrib:[17,55],Isya:[19,10]};
    const lo=(lng-106.8456)/15,la=(lat+6.2088)*2;
    const t={};
    for(const[n,[h,m]]of Object.entries(base)){
        let v=h*60+m+lo*60+la+off+(po[n]||0);if(n==='Imsak')v-=10;if(n==='Terbit')v+=10;
        t[n]=`${(Math.floor(v/60)+24)%24}`.padStart(2,'0')+':'+`${Math.floor(v%60)}`.padStart(2,'0');
    }
    return t;
}
function renderPrayerGrid(){
    prayerTimes=calcPrayerTimes(settings.lat,settings.lng);
    const now=new Date(),nm=now.getHours()*60+now.getMinutes();
    let nextP=null,nextM=Infinity;
    for(const[n,time]of Object.entries(prayerTimes)){const[hh,mm]=time.split(':').map(Number);const p=hh*60+mm;if(p>nm&&p<nextM){nextM=p;nextP=n}}
    if(!nextP)nextP='Subuh';
    $('prayerGrid').innerHTML=PRAYER_NAMES.map(n=>{
        const ov=(settings.prayerOffsets||{})[n]||0;
        const sign=ov>0?'+':'';
        return`<div class="glass-card rounded-lg p-2 text-center prayer-card ${n===nextP?'next':''}"><p class="text-[10px] text-on-surface-variant">${n}</p><p class="text-sm font-bold prayer-time">${prayerTimes[n]||'--:--'}</p><div class="flex items-center justify-center gap-1 mt-1"><button class="w-5 h-5 rounded bg-gray-100 flex items-center justify-center hover:bg-gray-200 text-[10px] font-bold" onclick="adjustPrayerOffset('${n}',-1)">-</button><span class="text-[10px] w-6 text-on-surface-variant">${sign}${ov}</span><button class="w-5 h-5 rounded bg-gray-100 flex items-center justify-center hover:bg-gray-200 text-[10px] font-bold" onclick="adjustPrayerOffset('${n}',1)">+</button></div></div>`;
    }).join('');
    const c=$('dashPrayerTimes');if(!c)return;
    c.innerHTML=PRAYER_NAMES.filter(n=>n!=='Imsak'&&n!=='Terbit').map(n=>{
        const isNext=n===nextP;
        if(isNext)return`<div class="flex justify-between items-center py-3 px-4 rounded-lg border my-1.5 font-bold shadow-sm" style="color:#50C878;border-color:#50C878;background:rgba(80,200,120,.06)"><div class="flex items-center gap-2.5"><span class="w-2 h-2 rounded-full animate-pulse" style="background:#50C878"></span><span>${n}</span></div><span>${prayerTimes[n]||'--:--'}</span></div>`;
        return`<div class="flex justify-between items-center p-3 rounded-lg hover:bg-gray-100 transition-colors text-on-surface-variant border border-transparent"><span class="text-sm">${n}</span><span class="text-sm font-medium">${prayerTimes[n]||'--:--'}</span></div>`;
    }).join('');
}
function adjustPrayerOffset(name,delta){
    if(!settings.prayerOffsets)settings.prayerOffsets={};
    settings.prayerOffsets[name]=(settings.prayerOffsets[name]||0)+delta;
    saveLocal();renderPrayerGrid();
}
window.adjustPrayerOffset=adjustPrayerOffset;
function updateCountdown(now){
    const nowSec=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
    let nextSec=Infinity,nextN='';
    for(const[n,time]of Object.entries(prayerTimes)){const[hh,mm]=time.split(':').map(Number);const p=hh*3600+mm*60;if(p>nowSec&&p<nextSec){nextSec=p;nextN=n}}
    if(nextSec===Infinity)nextSec=24*3600;
    const d=nextSec-nowSec;
    const cd=$('countdownDisplay');if(cd)cd.textContent=`${Math.floor(d/3600)}j ${Math.floor((d%3600)/60)}m ${d%60}s`;
    const cl=$('countdownLabel');if(cl)cl.textContent=`hingga ${nextN} jam ${prayerTimes[nextN]||'--:--'}`;
    const nb=$('nextPrayerBadge');if(nb)nb.textContent=nextN||'--';
}
function autoDetectLocation(){if(!navigator.geolocation){toast('Tidak didukung');return}toast('Mendeteksi...');navigator.geolocation.getCurrentPosition(async p=>{settings.lat=p.coords.latitude;settings.lng=p.coords.longitude;saveLocal();if($('latInput'))$('latInput').value=settings.lat;if($('lngInput'))$('lngInput').value=settings.lng;prayerTimes=calcPrayerTimes(settings.lat,settings.lng);renderPrayerGrid();let place=`${settings.lat.toFixed(4)}, ${settings.lng.toFixed(4)}`;try{const r=await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${settings.lat}&longitude=${settings.lng}&localityLanguage=id`);const d=await r.json();place=d.city||d.locality||d.principalSubdivision||place;if(d.locality&&d.city&&d.city!==d.locality)place=d.locality+', '+d.city;else if(d.city)place=d.city;else if(d.locality)place=d.locality}catch(e){}if($('locationStatus'))$('locationStatus').textContent='Lokasi: '+place;toast('Lokasi terdeteksi: '+place)},e=>toast('Gagal: '+e.message))}
window.autoDetectLocation=autoDetectLocation;

// ========== ADZAN ==========
// Semua audio adzan/doa bersumber dari LIBRARY. Yang tersimpan ke DATABASE hanya ID/judul track-nya.
const getAdzanKind=t=>t==='subuh'?'subuh':t==='umum'?'umum':'doa';
const getAdzanTrackId=k=>k==='subuh'?settings.adzanSubuhTrackId:k==='umum'?settings.adzanUmumTrackId:settings.doaTrackId;
// Bersihkan sisa file adzan lama (base64) dari localStorage versi sebelumnya,
// agar kuota localStorage tidak penuh dan pengaturan tetap bisa tersimpan ke database.
let _legacyAdzanCleaned=false;
async function cleanupLegacyAdzanAudio(){
    if(_legacyAdzanCleaned)return;_legacyAdzanCleaned=true;
    let changed=false;
    for(const k of ['adzan_subuh','adzan_umum','adzan_doa']){if(LS.get(k,null)!==null){LS.del(k);changed=true}}
    if(changed)saveLocal();
}
async function updateAdzanAvailability(){try{await cleanupLegacyAdzanAudio()}catch(e){}updateAdzanStatus()}
// status: 'none' = belum diatur | 'ok' = siap diputar | 'localMissing' = judul ada tapi file tidak ada di perangkat ini
async function resolveAdzan(kind){
    const id=getAdzanTrackId(kind);
    if(id){
        let t=tracks.find(x=>x.id===id);
        if(!t&&isSupabaseConfigured()){try{t=(await getSupabase().from('tracks').select('*').eq('id',id).single()).data}catch(e){}}
        if(t){
            if(t.type==='online'&&t.src)return{src:t.src,status:'ok'};
            let b=null;try{b=await getBlob(id)}catch(e){}
            return b?{src:URL.createObjectURL(b),status:'ok'}:{src:null,status:'localMissing'};
        }
    }
    return{src:null,status:'none'};
}
async function resolveAdzanSrc(kind){return(await resolveAdzan(kind)).src}
// ========== INDONESIA RAYA (1 MENIT SEBELUM JADWAL) ==========
// Centang "Indonesia Raya" pada jadwal musik akan:
//   T-1 menit : SEMUA musik di-JEDA (posisi diingat)
//   T-1 s.d. mulai : lagu Indonesia Raya diputar dari library
//   Selesai+1 menit : musik yang terjeda dilanjutkan OTOMATIS
const getIndoRayaTrackId=()=>settings.indoRayaTrackId;
async function resolveIndoRaya(){
    const id=getIndoRayaTrackId();
    if(!id)return{src:null,status:'none'};
    let t=tracks.find(x=>x.id===id);
    if(!t&&isSupabaseConfigured()){try{t=(await getSupabase().from('tracks').select('*').eq('id',id).single()).data}catch(e){}}
    if(!t)return{src:null,status:'localMissing'};
    if(t.type==='online'&&t.src)return{src:t.src,status:'ok'};
    let b=null;try{b=await getBlob(id)}catch(e){}
    return b?{src:URL.createObjectURL(b),status:'ok'}:{src:null,status:'localMissing'};
}
const IR_DONE_KEY='indoRayaDone';
function isIrDone(id){const d=new Date().toDateString();const m=LS.get(IR_DONE_KEY,null);return!!(m&&m._d===d&&Array.isArray(m.l)&&m.l.includes(id))}
function markIrDone(id){const d=new Date().toDateString();let m=LS.get(IR_DONE_KEY,null);if(m&&m._d===d&&Array.isArray(m.l)){if(!m.l.includes(id))m.l.push(id)}else m={_d:d,l:[id]};LS.set(IR_DONE_KEY,m)}
function checkIndoRaya(now){
    if(isIndoRayaActive||Date.now()<irCooldownUntil)return;
    const td=now.getDay(),sod=now.getHours()*3600+now.getMinutes()*60+now.getSeconds();
    for(const s of schedules){
        if(!s.enabled||!s.indonesia_raya||!s.days.includes(td))continue;
        const win=scheduleWindow(s),startSec=win.sM*60;
        if(sod<Math.max(startSec-60,0)||sod>=startSec)continue;
        if(isIrDone(s.id))continue;
        triggerIndonesiaRaya(s);
        return;
    }
}
async function triggerIndonesiaRaya(s){
    if(isIndoRayaActive)return;
    isIndoRayaActive=true;updatePlayPauseBtn();
    try{
        const r=await resolveIndoRaya();
        // gagal → buka kunci lagi + cooldown 20 dtk agar bisa dicoba ulang dalam jendela yang sama
        const fail=msg=>{isIndoRayaActive=false;updatePlayPauseBtn();irCooldownUntil=Date.now()+20000;toast(msg)};
        if(r.status==='none'){fail('Pilih lagu Indonesia Raya di Pengaturan Adzan & Doa');return}
        if(!r.src){updateAdzanStatus();fail('File lokal tidak tersedia (Indonesia Raya)');return}
        const hadPlayback=isPlaying;
        if(hadPlayback){pausedPosition=audio.currentTime;audio.pause();isPlaying=false}
        updatePlayPauseBtn();toast('Indonesia Raya');
        // matikan pemutar IR sebelumnya (anti dobel audio & anti GC)
        if(irAudio){try{irAudio.onended=irAudio.onerror=null;irAudio.pause()}catch(e){}}
        if(irAudioUrl&&/^blob:/.test(irAudioUrl)){try{URL.revokeObjectURL(irAudioUrl)}catch(e){}}
        irAudioUrl=r.src;
        const a=new Audio(r.src);irAudio=a;
        a.volume=settings.volume/100;
        let done=false;
        const finish=()=>{
            if(done)return;done=true;irAudio=null;
            isIndoRayaActive=false;updatePlayPauseBtn();
            scheduleIrResume(hadPlayback);
        };
        a.onended=finish;a.onerror=finish;
        try{
            await a.play();
            markIrDone(s.id);           // tandai selesai HANYA setelah benar-benar mulai bunyi
            toast('🇮🇩 Indonesia Raya diputar');
        }catch(err){
            finish();
            toast('Gagal memutar Indonesia Raya');
        }
    }catch(e){isIndoRayaActive=false;updatePlayPauseBtn()}
}
// Lanjut OTOMATIS tepat +60 detik pasca-Indonesia Raya.
// Bila pada momen itu sedang jam hening sholat, diulang tiap 10 detik (maks 6 menit).
function scheduleIrResume(hadPlayback){
    if(irResumeTimer)clearInterval(irResumeTimer);
    const openAt=Date.now()+60000,deadline=Date.now()+360000;
    irResumeTimer=setInterval(()=>{
        if(Date.now()>deadline||isPlaying){clearInterval(irResumeTimer);irResumeTimer=null;return}
        if(Date.now()<openAt)return;
        if(isPrayerTime||Date.now()<silencedUntil)return;
        clearInterval(irResumeTimer);irResumeTimer=null;
        if(hadPlayback&&currentPlaylist.length>0&&currentPlaylistIndex>=0){resumePlaying();toast('Melanjutkan musik')}
        else if(!hadPlayback&&autoPlayEnabled&&!isPlaying)checkAutoPlay(new Date());
    },10000);
}
// ========== PENGAMAN BATAS JADWAL ==========
// Musik milik jadwal yang melewati window-nya dimatikan otomatis:
//   Loop ON    -> berhenti TEPAT pukul "Jam Selesai"
//   Tanpa loop -> tetap berhenti ketika durasi musik habis (perilaku lama)
// Playlist yg dimainkan MANUAL oleh pengguna tidak diganggu selama 2 jam
// sejak sentuhan manual terakhir (manualOverrideUntil).
function enforceScheduleWindows(now){
    if(!isPlaying||isIndoRayaActive||!activeScheduleId)return;
    if(manualOverrideUntil&&Date.now()<manualOverrideUntil)return;
    const s=schedules.find(x=>x.id===activeScheduleId);
    if(!s)return;
    const nm=now.getHours()*60+now.getMinutes(),td=now.getDay();
    const win=scheduleWindow(s);
    if(s.enabled&&s.days.includes(td)&&nm>=win.sM&&nm<win.eM)return;
    const title=s.title||'Jadwal';
    pausedPosition=0;audio.pause();isPlaying=false;
    activeScheduleId=null;loopPlaylist=false;stopAfterPlaylist=false;
    currentPlaylist=[];currentPlaylistIndex=-1;
    updatePlayPauseBtn();renderTracks();renderUpacaras();
    toast('⏰ Jam selesai — "'+title+'" dihentikan otomatis');
}

function updateAdzanStatus(){
    const s=$('adzanStatus');if(!s)return;
    const rows=[['subuh','Adzan Subuh'],['umum','Adzan Umum'],['doa','Doa'],['ira','Indonesia Raya']];
    s.innerHTML=rows.map(([k,label])=>{
        const id=k==='ira'?getIndoRayaTrackId():getAdzanTrackId(k);
        if(!id)return '<span style="color:#94a3b8">'+label+': belum dipilih dari library</span>';
        const t=tracks.find(x=>x.id===id);
        if(!t||(t.type!=='online'&&t._localAvailable===false))return '<span style="color:#ef4444">'+label+': '+(t?t.name+' &mdash; ':'')+'file lokal tidak tersedia di perangkat ini</span>';
        return '<span style="color:#16a34a">'+label+': '+((t&&t.name)||'dari library')+(t&&t.type==='online'?' (Online)':'')+'</span>';
    }).join('<br>');
}
let _previewAudio=null;
async function previewAdzan(type){
    if(_previewAudio){_previewAudio.pause();_previewAudio=null;toast('Stop preview');return}
    const kind=getAdzanKind(type);
    const vol=(type==='subuh'?settings.adzanSubuhVolume:type==='umum'?settings.adzanUmumVolume:settings.doaVolume)/100;
    const r=await resolveAdzan(kind);
    if(r.status==='none'){toast('Belum ada file / belum pilih dari library');return}
    if(!r.src){toast('File lokal tidak tersedia');updateAdzanStatus();return}
    _previewAudio=new Audio(r.src);_previewAudio.volume=vol;_previewAudio.play();toast('Preview (klik Test lagi untuk stop)');
    _previewAudio.onended=()=>{_previewAudio=null};
}
window.previewAdzan=previewAdzan;

// ========== PRAYER CHECK (5 MENIT SEBELUM ADZAN) ==========
function checkPrayerTime(now){
    const nm=now.getHours()*60+now.getMinutes();
    for(const[n,time]of Object.entries(prayerTimes)){
        if(n==='Imsak'||n==='Terbit')continue;
        const[hh,mm]=time.split(':').map(Number);const pM=hh*60+mm;
        if(nm>=pM-5&&nm<pM+15){
            if(nm===pM){const k=n+'_'+now.toDateString();if(!adzanPlayedToday[k]){adzanPlayedToday[k]=true;LS.set('adzanPlayed',adzanPlayedToday);playAdzanForPrayer(n)}}
            isPrayerTime=true;
            if(isPlaying&&nm>=pM-5){
                pausedPosition=audio.currentTime;audio.pause();isPlaying=false;updatePlayPauseBtn();toast('Musik berhenti untuk sholat');
            }
            setSilenceUntil(pM);
            return;
        }
    }
    if(isPrayerTime){isPrayerTime=false;}
}
function setSilenceUntil(pM){
    if(settings.playAfterAdzan){
        const d=new Date();d.setHours(Math.floor(pM/60),pM%60,0,0);
        silencedUntil=d.getTime()+(settings.afterAdzanDelay||0)*60000;
    }else{
        const endMs=getCurrentScheduleEndMs();
        silencedUntil=endMs||Date.now();
    }
}
function getCurrentScheduleEndMs(){
    const now=new Date();const nm=now.getHours()*60+now.getMinutes(),td=now.getDay();
    let endMs=0;
    for(const s of schedules){
        if(!s.enabled||!s.days.includes(td))continue;
        const win=scheduleWindow(s);
        if(nm>=win.sM&&nm<win.eM){const d=new Date();d.setHours(0,0,0,0);const ms=d.getTime()+win.eM*60000;if(ms>endMs)endMs=ms;}
    }
    return endMs;
}
function playAdzanForPrayer(name){
    const kind=name==='Subuh'?'subuh':'umum';
    resolveAdzan(kind).then(r=>{
        if(r.status==='localMissing'){toast('File lokal tidak tersedia ('+(name==='Subuh'?'Adzan Subuh':'Adzan')+')');return}
        if(r.status!=='ok'||!r.src)return;
        const a=new Audio(r.src);
        a.volume=(name==='Subuh'?settings.adzanSubuhVolume:settings.adzanUmumVolume)/100;
        a.onended=()=>{
            if(!settings.doaEnabled)return;
            resolveAdzanSrc('doa').then(ds=>{
                if(!ds)return;
                setTimeout(()=>{
                    const d=new Audio(ds);d.volume=settings.doaVolume/100;
                    d.play().catch(()=>{});toast('Doa setelah adzan');
                },2000);
            });
        };
        a.play().catch(()=>toast('Adzan '+name+' gagal diputar (browser memblokir suara otomatis)'));
        toast('Adzan '+name);
    });
}

// ========== LIBRARY TABS ==========
function switchLibTab(t,btn){document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');$('libTabOffline').style.display=t==='offline'?'':'none';$('libTabOnline').style.display=t==='online'?'':'none'}
window.switchLibTab=switchLibTab;

// ========== SUPABASE UPLOAD ==========
async function uploadToSupabase(input){
    const f=input.files[0];if(!f)return;
    if(!isSupabaseConfigured()){toast('Supabase belum dikonfigurasi');return}
    
    // Cek storage limit user
    if(currentUser.storage_limit>0){
        const usedSize=tracks.filter(t=>t.type==='online'&&t.owner===currentUser.id).reduce((acc,t)=>{const s=parseFloat(t.size)||0;return acc+s},0);
        const fileSize=parseFloat(formatSize(f.size));
        if(usedSize+fileSize>currentUser.storage_limit){
            toast(`Storage penuh! Limit: ${currentUser.storage_limit}MB, Terpakai: ${usedSize.toFixed(1)}MB`);
            return;
        }
    }
    
    $('supabaseStatus').textContent='Uploading...';
    const sb=getSupabase();
    const path=`${currentUser.id}/${Date.now()}_${f.name}`;
    try{
        const {error}=await sb.storage.from('music').upload(path,f,{contentType:f.type});
        if(error)throw error;
        const {data:u}=sb.storage.from('music').getPublicUrl(path);
        const track={id:genId(),name:f.name.replace(/\.[^/.]+$/,''),src:u.publicUrl,type:'online',duration:0,size:formatSize(f.size),owner:currentUser.id};
        await sb.from('tracks').insert(track);
        tracks.unshift(track);ensureTrackDurations();
        renderTracks();$('supabaseStatus').textContent='Berhasil: '+f.name;toast('Upload berhasil');
    }catch(e){toast('Gagal: '+e.message);$('supabaseStatus').textContent='Error: '+e.message}
    input.value='';
}
window.uploadToSupabase=uploadToSupabase;
function addOnlineTrack(){const url=$('onlineUrlInput').value.trim();const name=$('onlineNameInput').value.trim()||'Online Track';if(!url){toast('Masukkan URL');return}const track={id:genId(),name,src:url,type:'online',duration:0,size:'Online',owner:currentUser.id};if(isSupabaseConfigured())getSupabase().from('tracks').upsert(track);tracks.unshift(track);saveLocal();renderTracks();$('onlineUrlInput').value='';$('onlineNameInput').value='';toast('Ditambahkan');ensureTrackDurations()}
window.addOnlineTrack=addOnlineTrack;

// ========== OFFLINE FILE UPLOAD ==========
const fileInput=$('fileInput'),uploadZone=$('uploadZone');
fileInput.addEventListener('change',e=>handleFiles(e.target.files));
uploadZone.addEventListener('dragover',e=>{e.preventDefault();uploadZone.classList.add('dragover')});
uploadZone.addEventListener('dragleave',()=>uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop',e=>{e.preventDefault();uploadZone.classList.remove('dragover');handleFiles(e.dataTransfer.files)});
function handleFiles(files){
    Array.from(files).forEach(async f=>{
        const id=genId();
        try{await putBlob(id,f);}catch(err){toast('Gagal simpan lokal: '+f.name);return}
        const objUrl=URL.createObjectURL(f);
        const a=new Audio(objUrl);
        a.onloadedmetadata=async()=>{
            const track={id,name:f.name.replace(/\.[^/.]+$/,''),src:objUrl,type:'offline',duration:a.duration,size:formatSize(f.size),owner:currentUser.id,volume:100,_localAvailable:true};
            tracks.unshift(track);saveLocal();renderTracks();renderDashboard();toast(f.name+' ditambahkan ('+track.size+')');
            if(isSupabaseConfigured()){try{await getSupabase().from('tracks').upsert({id:track.id,name:track.name,src:'',type:'offline',duration:track.duration,size:track.size,owner:track.owner,volume:track.volume})}catch(e){console.error('Track sync:',e)}}
        };
        a.onerror=()=>{toast('Format tidak didukung: '+f.name)};
    });
}

// ========== TRACK DURATION MEASUREMENT ==========
// Durasi track online/upload lama bisa 0 karena tidak pernah diukur.
// Fungsi ini mengukur otomatis (metadata saja) lalu menyimpan hasilnya ke database.
function measureAudioDuration(src){
    return new Promise(res=>{
        let done=false;
        const fin=d=>{if(done)return;done=true;d=(typeof d==='number'&&isFinite(d)&&d>0)?d:0;res(d)};
        try{
            const a=new Audio();a.preload='metadata';
            a.onloadedmetadata=()=>fin(a.duration);
            a.onerror=()=>fin(0);
            setTimeout(()=>fin(a.duration||0),8000);
            a.src=src;
        }catch(e){fin(0)}
    });
}
let _durEnsuring=false;
async function ensureTrackDurations(){
    if(_durEnsuring)return;_durEnsuring=true;
    try{
        const need=tracks.filter(t=>!(t.duration>0)&&(t.type==='online'?!!t.src:t._localAvailable!==false));
        for(const t of need){
            let src=t.src;
            if(t.type!=='online'){
                let b=null;try{b=await getBlob(t.id)}catch(e){}
                if(!b)continue;
                src=URL.createObjectURL(b);
            }
            const d=await measureAudioDuration(src);
            if(d>0){
                t.duration=d;
                if(isSupabaseConfigured()){try{await getSupabase().from('tracks').update({duration:d}).eq('id',t.id)}catch(e){}}
                renderTracks();
                const m=$('scheduleModal');if(m&&m.classList.contains('active'))updateScheduleDurationInfo();
            }
        }
    }finally{_durEnsuring=false}
}

// ========== RENDER TRACKS =========
function getUserTracks(){if(!currentUser)return[];if(currentUser.role==='admin')return tracks;return tracks.filter(t=>t.owner===currentUser.id)}
function renderTracks(){
    const list=$('trackList');const ut=getUserTracks();$('trackCount').textContent=ut.length;
    if(!ut.length){list.innerHTML='<div class="text-center py-6 text-on-surface-variant"><span class="material-symbols-outlined text-3xl block mb-1">music_note</span><p class="text-xs">Belum ada lagu</p></div>';return}
    list.innerHTML=ut.map((t,i)=>{
        const gi=tracks.indexOf(t);
        const playing=currentPlaylist.length&&currentPlaylist[currentPlaylistIndex]?.id===t.id;
        const icon=t.type==='offline'?'<span class="type-icon type-offline"><span class="material-symbols-outlined" style="font-size:12px">computer</span></span>':'<span class="type-icon type-online"><span class="material-symbols-outlined" style="font-size:12px">cloud</span></span>';
        if(playing){
            return`<div class="track-item track-row playing flex flex-col gap-1.5 p-2.5 rounded-lg bg-green-50 border-l-3 border-green-500" id="playingTrack">
                <div class="flex items-center gap-2.5">
                    <div class="w-7 h-7 rounded bg-green-100 flex items-center justify-center animate-pulse">${icon}</div>
                    <div class="flex-1 min-w-0"><p class="text-sm font-bold text-green-700 truncate">${t.name}</p><p class="text-[11px] text-on-surface-variant" id="playingTime">${formatTime(audio.currentTime||0)} / ${formatTime(audio.duration||0)}</p></div>
                    <div class="flex items-center gap-0.5">
                        <button class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200" onclick="event.stopPropagation();prevTrack()"><span class="material-symbols-outlined text-[14px]">skip_previous</span></button>
                        <button class="w-8 h-8 rounded-full flex items-center justify-center text-white" style="background:#50C878" onclick="event.stopPropagation();togglePlayPause()"><span class="material-symbols-outlined text-[16px]" id="playPauseIcon">pause</span></button>
                        <button class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200" onclick="event.stopPropagation();nextTrack()"><span class="material-symbols-outlined text-[14px]">skip_next</span></button>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="player-progress flex-1" onclick="event.stopPropagation();seekTrack(event)" style="height:4px"><div class="player-progress-fill" id="playerProgressFill"></div></div>
                    <div class="flex items-center gap-1">
                        <span class="material-symbols-outlined text-[12px]">volume_up</span>
                        <input type="range" min="0" max="100" value="${settings.volume}" class="w-16" onclick="event.stopPropagation()" oninput="setMasterVolume(this.value)">
                        <button class="w-5 h-5 rounded flex items-center justify-center hover:bg-gray-200 ${settings.shuffle?'text-green-600':''}" onclick="event.stopPropagation();toggleShuffle()"><span class="material-symbols-outlined text-[12px]">shuffle</span></button>
                        <button class="w-5 h-5 rounded flex items-center justify-center hover:bg-gray-200 ${settings.repeat?'text-green-600':''}" onclick="event.stopPropagation();toggleRepeat()"><span class="material-symbols-outlined text-[12px]">repeat</span></button>
                    </div>
                </div>
            </div>`;
        }
        const unavailable=t.type==='offline'&&t._localAvailable===false;
        if(unavailable){
            return`<div class="track-item flex items-center gap-2.5 p-2.5 rounded-lg bg-red-50/50 opacity-70">
            <div class="w-7 h-7 rounded-full flex items-center justify-center bg-gray-200 shrink-0"><span class="material-symbols-outlined text-[14px] text-gray-400">block</span></div>
            <span class="shrink-0 cursor-default" title="Musik lokal (PC)">${icon}</span>
            <div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${t.name}</p><p class="text-[11px] text-red-400">File lokal tidak tersedia • ${t.size}</p></div>
            <button class="w-6 h-6 rounded flex items-center justify-center hover:bg-gray-100 text-on-surface-variant" onclick="event.stopPropagation();removeTrack(${gi})"><span class="material-symbols-outlined text-[14px]">delete</span></button>
        </div>`;
        }
        return`<div class="track-item flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer" onclick="playTrack(${gi})">
            <button class="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0" style="background:#50C878" onclick="event.stopPropagation();playTrack(${gi})"><span class="material-symbols-outlined text-[14px]">play_arrow</span></button>
            <span class="shrink-0 cursor-default" title="${t.type==='offline'?'Musik lokal (PC)':'Musik online'}">${icon}</span>
            <div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${t.name}</p><p class="text-[11px] text-on-surface-variant">${t.type==='online'?((t.duration>0)?formatTime(t.duration)+' • ':'')+'Online':formatTime(t.duration)+' • '+t.size}</p></div>
            <div class="flex items-center gap-1.5" onclick="event.stopPropagation()"><input type="range" min="0" max="100" value="${t.volume||100}" class="w-16" onchange="setTrackVol(${gi},this.value)"><span class="text-[10px] w-7">${t.volume||100}%</span></div>
            <button class="w-6 h-6 rounded flex items-center justify-center hover:bg-gray-100 text-on-surface-variant" onclick="event.stopPropagation();removeTrack(${gi})"><span class="material-symbols-outlined text-[14px]">delete</span></button>
        </div>`;
    }).join('');
}
function setTrackVol(i,v){tracks[i].volume=parseInt(v);saveLocal();renderTracks();if(currentPlaylist[currentPlaylistIndex]?.id===tracks[i].id)audio.volume=v/100*settings.volume/100}
window.setTrackVol=setTrackVol;
async function removeTrack(i){if(!confirm('Hapus?'))return;const t=tracks[i];if(t.type==='offline'){try{await deleteBlob(t.id)}catch(e){}}if(isSupabaseConfigured()){await getSupabase().from('tracks').delete().eq('id',t.id)}tracks.splice(i,1);saveLocal();renderTracks();toast('Dihapus')}
window.removeTrack=removeTrack;
function playTrack(i){const t=tracks[i];if(!t)return;if(t.type==='offline'&&t._localAvailable===false){toast('File lokal tidak tersedia di perangkat ini');return}stopAfterPlaylist=false;loopPlaylist=false;activeScheduleId=null;manualPauseKey=null;activeScheduleVolumePct=100;manualOverrideUntil=Date.now()+7200000;currentPlaylist=getUserTracks().filter(x=>x._localAvailable!==false);currentPlaylistIndex=currentPlaylist.indexOf(t);if(currentPlaylistIndex<0)currentPlaylistIndex=0;loadAndPlay()}
window.playTrack=playTrack;
function playAllTracks(){const ut=getUserTracks().filter(x=>x._localAvailable!==false);if(!ut.length)return;stopAfterPlaylist=false;loopPlaylist=false;activeScheduleId=null;manualPauseKey=null;activeScheduleVolumePct=100;manualOverrideUntil=Date.now()+7200000;currentPlaylist=settings.shuffle?[...ut].sort(()=>Math.random()-.5):[...ut];currentPlaylistIndex=0;loadAndPlay()}
window.playAllTracks=playAllTracks;

// ========== PLAYER ==========
function loadAndPlay(resumePos){
    if(currentPlaylistIndex<0||currentPlaylistIndex>=currentPlaylist.length)return;
    const t=currentPlaylist[currentPlaylistIndex];
    audio.src=t.src;audio.volume=(activeScheduleVolumePct/100)*(t.volume||100)/100*(settings.volume/100);
    audio.onloadedmetadata=()=>{if(resumePos&&resumePos>0&&resumePos<audio.duration){audio.currentTime=resumePos}const cur=currentPlaylist[currentPlaylistIndex];if(cur&&!(cur.duration>0)&&audio.duration>0){cur.duration=audio.duration;if(isSupabaseConfigured()){try{getSupabase().from('tracks').update({duration:cur.duration}).eq('id',cur.id)}catch(e){}}}};
    audio.play().catch(()=>{});isPlaying=true;
    updatePlayPauseBtn();renderTracks();renderUpacaras();
}
function resumePlaying(){
    if(currentPlaylistIndex<0||currentPlaylistIndex>=currentPlaylist.length)return;
    const t=currentPlaylist[currentPlaylistIndex];
    audio.src=t.src;audio.volume=(activeScheduleVolumePct/100)*(t.volume||100)/100*(settings.volume/100);
    audio.onloadedmetadata=()=>{if(pausedPosition>0&&pausedPosition<audio.duration){audio.currentTime=pausedPosition}};
    audio.play().catch(()=>{});isPlaying=true;
    updatePlayPauseBtn();renderTracks();renderUpacaras();
}
function togglePlayPause(){
    manualOverrideUntil=Date.now()+7200000;
    if(isPlaying){
        audio.pause();isPlaying=false;pausedPosition=audio.currentTime;
        manualPauseKey=new Date().toDateString()+'|'+(activeScheduleId||'-');
    }else{
        manualPauseKey=null;
        if(currentPlaylist.length>0&&currentPlaylistIndex>=0){resumePlaying()}
        else{audio.play().catch(()=>{});isPlaying=true}
    }
    updatePlayPauseBtn();
}
window.togglePlayPause=togglePlayPause;
function updatePlayPauseBtn(){
    const pi=$('playPauseIcon');if(pi)pi.textContent=isPlaying?'pause':'play_arrow';
    document.querySelectorAll('[data-sched-icon]').forEach(el=>{el.textContent=(isPlaying&&activeScheduleId===el.getAttribute('data-sched-icon'))?'pause':'play_arrow'});
    renderUpacaras();
}
function nextTrack(){if(currentPlaylistIndex<currentPlaylist.length-1){currentPlaylistIndex++;pausedPosition=0;loadAndPlay()}else if(settings.repeat||loopPlaylist){currentPlaylistIndex=0;pausedPosition=0;loadAndPlay()}else{isPlaying=false;stopAfterPlaylist=false;loopPlaylist=false;updatePlayPauseBtn();renderUpacaras()}}
window.nextTrack=nextTrack;
function prevTrack(){if(audio.currentTime>3){audio.currentTime=0;return}if(currentPlaylistIndex>0){currentPlaylistIndex--;pausedPosition=0;loadAndPlay()}}
window.prevTrack=prevTrack;
function seekTrack(e){
    const bar=e.currentTarget;
    const rect=bar.getBoundingClientRect();
    const pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    if(audio.duration){audio.currentTime=pct*audio.duration;pausedPosition=0}
}
window.seekTrack=seekTrack;
function setMasterVolume(v){settings.volume=parseInt(v);if(currentPlaylist[currentPlaylistIndex])audio.volume=(currentPlaylist[currentPlaylistIndex].volume||100)/100*(v/100);saveLocal()}
window.setMasterVolume=setMasterVolume;
audio.ontimeupdate=()=>{if(audio.duration){const pf=$('playerProgressFill');if(pf)pf.style.width=(audio.currentTime/audio.duration*100)+'%';const pc=$('playingTime');if(pc)pc.textContent=formatTime(audio.currentTime)+' / '+formatTime(audio.duration);const dpf=$('dashPlayerFill');if(dpf)dpf.style.width=(audio.currentTime/audio.duration*100)+'%';const dpt=$('dashPlayerTime');if(dpt)dpt.textContent=formatTime(audio.currentTime)+' / '+formatTime(audio.duration)}const dptr=$('dashPlayerTrack');if(dptr){const cur=currentPlaylist[currentPlaylistIndex];if(cur&&dptr.textContent!==cur.name)dptr.textContent=cur.name}};
// Lanjutkan otomatis ke lagu berikutnya ketika satu lagu selesai diputar (library/playlist/jadwal)
audio.onended=()=>{if(isIndoRayaActive||isPrayerTime)return;nextTrack()};

// ========== PLAYLIST ==========
function openPlaylistModal(id){
    editingType='playlist';editingId=id||null;
    $('playlistModalTitle').textContent=id?'Edit Playlist':'Buat Playlist';
    $('playlistNameInput').value=id?playlists.find(p=>p.id===id)?.name||'':'';
    const c=$('playlistTrackSelect');const ut=getUserTracks();
    if(!ut.length){c.innerHTML='<p class="text-xs text-on-surface-variant">Upload lagu dulu</p>';return}
    const ex=id?playlists.find(p=>p.id===id)?.track_ids||[]:[];
    c.innerHTML=ut.map(t=>`<label class="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer text-xs"><input type="checkbox" value="${t.id}" ${ex.includes(t.id)?'checked':''}> ${t.name}</label>`).join('');
    $('playlistModal').classList.add('active');
}
window.openPlaylistModal=openPlaylistModal;
async function savePlaylist(){
    const name=$('playlistNameInput').value.trim();if(!name){toast('Nama harus diisi');return}
    const ids=Array.from($('playlistTrackSelect').querySelectorAll('input:checked')).map(c=>c.value);
    if(!ids.length){toast('Pilih minimal 1 lagu');return}
    if(editingId){
        if(isSupabaseConfigured())await getSupabase().from('playlists').update({name,track_ids:ids}).eq('id',editingId);
        const p=playlists.find(p=>p.id===editingId);if(p){p.name=name;p.track_ids=ids}
    }else{
        const pl={id:genId(),name,track_ids:ids,owner:currentUser.id};
        if(isSupabaseConfigured()){await getSupabase().from('playlists').insert(pl);playlists.unshift(pl)}
        else playlists.push(pl);
    }
    saveLocal();renderPlaylists();closeModal('playlistModal');toast('Tersimpan');
}
window.savePlaylist=savePlaylist;
function renderPlaylists(){
    const c=$('playlistList');
    const up=currentUser?.role==='admin'?playlists:playlists.filter(p=>p.owner===currentUser.id);
    if(!up.length){c.innerHTML='<div class="glass-card rounded-xl p-6 text-center text-on-surface-variant"><p class="text-xs">Belum ada playlist</p></div>';return}
    c.innerHTML=up.map(p=>{
        const tn=p.track_ids.map(id=>tracks.find(t=>t.id===id)?.name||'?').join(', ');
        return`<div class="glass-card rounded-xl p-4"><div class="flex justify-between items-center mb-2"><h3 class="text-sm font-bold">${p.name}</h3><span class="text-[11px] text-on-surface-variant">${p.track_ids.length} lagu</span></div><p class="text-[11px] text-on-surface-variant mb-2 truncate">${tn}</p><div class="flex gap-1.5"><button class="text-[11px] font-bold px-2.5 py-1 rounded text-white" style="background:#50C878" onclick="playPlaylist('${p.id}')">Putar</button><button class="text-[11px] px-2.5 py-1 rounded border border-outline-variant" onclick="openPlaylistModal('${p.id}')">Edit</button><button class="text-[11px] px-2.5 py-1 rounded border border-red-300 text-red-500" onclick="removePlaylist('${p.id}')">Hapus</button></div></div>`;
    }).join('');
}
function playPlaylist(id){const p=playlists.find(p=>p.id===id);if(!p)return;const plTracks=p.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean).filter(x=>x.type==='online'||x._localAvailable!==false);if(!plTracks.length){toast('Kosong / file lokal tidak tersedia');return}stopAfterPlaylist=false;loopPlaylist=false;activeScheduleId=null;manualPauseKey=null;activeScheduleVolumePct=100;manualOverrideUntil=Date.now()+7200000;currentPlaylist=settings.shuffle?[...plTracks].sort(()=>Math.random()-.5):[...plTracks];currentPlaylistIndex=0;loadAndPlay();toast('Putar: '+p.name)}
window.playPlaylist=playPlaylist;
async function removePlaylist(id){if(!confirm('Hapus?'))return;if(isSupabaseConfigured())await getSupabase().from('playlists').delete().eq('id',id);playlists=playlists.filter(p=>p.id!==id);saveLocal();renderPlaylists();toast('Dihapus')}
window.removePlaylist=removePlaylist;

// ========== UPACARA ==========
function openUpacaraModal(id){
    editingType='upacara';editingId=id||null;
    $('upacaraModalTitle').textContent=id?'Edit Nama Upacara':'Buat Upacara';
    $('upacaraName').value=id?upacaras.find(u=>u.id===id)?.name||'':'';
    $('upacaraModal').classList.add('active');
}
window.openUpacaraModal=openUpacaraModal;
async function saveUpacara(){
    const name=$('upacaraName').value.trim();if(!name){toast('Nama harus diisi');return}
    if(editingId){
        if(isSupabaseConfigured())await getSupabase().from('upacaras').update({name}).eq('id',editingId);
        const u=upacaras.find(u=>u.id===editingId);if(u)u.name=name;
    }else{
        const up={id:genId(),name,track_ids:[],play_once:true,owner:currentUser.id};
        if(isSupabaseConfigured()){await getSupabase().from('upacaras').insert(up);upacaras.unshift(up)}
        else upacaras.push(up);
        activeUpacaraId=up.id;
    }
    saveLocal();renderUpacaras();closeModal('upacaraModal');toast('Tersimpan');
}
window.saveUpacara=saveUpacara;
let upacaraAddTarget=null;
let activeUpacaraId=null;
function openUpacara(uid){activeUpacaraId=uid;renderUpacaras();}
window.openUpacara=openUpacara;
function backFromUpacara(){activeUpacaraId=null;renderUpacaras();}
window.backFromUpacara=backFromUpacara;
function setTrackVolById(tid,v){const gi=tracks.findIndex(t=>t.id===tid);if(gi>=0){setTrackVol(gi,v);renderUpacaras();}}
window.setTrackVolById=setTrackVolById;
function openAddSongToUpacara(uid){upacaraAddTarget=uid;$('upacaraTrackModal').classList.add('active');renderUpacaraSongPicker(uid)}
window.openAddSongToUpacara=openAddSongToUpacara;
function renderUpacaraSongPicker(uid){
    const u=upacaras.find(u=>u.id===uid);const ex=new Set(u?.track_ids||[]);
    const ut=getUserTracks();const c=$('upacaraSongPicker');
    if(!ut.length){c.innerHTML='<p class="text-xs text-on-surface-variant">Belum ada lagu di library</p>';return}
    c.innerHTML=ut.map(t=>`<label class="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer text-xs"><input type="checkbox" value="${t.id}" ${ex.has(t.id)?'checked':''}> ${t.name}</label>`).join('');
}
window.renderUpacaraSongPicker=renderUpacaraSongPicker;
async function addSongsToUpacara(){
    const u=upacaras.find(u=>u.id===upacaraAddTarget);if(!u)return;
    const ids=Array.from($('upacaraSongPicker').querySelectorAll('input:checked')).map(c=>c.value);
    const merged=Array.from(new Set([...u.track_ids,...ids]));
    u.track_ids=merged;
    if(isSupabaseConfigured())await getSupabase().from('upacaras').update({track_ids:merged}).eq('id',u.id);
    saveLocal();closeModal('upacaraTrackModal');renderUpacaras();toast('Lagu ditambahkan');
}
window.addSongsToUpacara=addSongsToUpacara;
function removeSongFromUpacara(uid,tid){
    const u=upacaras.find(u=>u.id===uid);if(!u)return;
    u.track_ids=u.track_ids.filter(id=>id!==tid);
    if(isSupabaseConfigured())getSupabase().from('upacaras').update({track_ids:u.track_ids}).eq('id',uid);
    saveLocal();renderUpacaras();
}
window.removeSongFromUpacara=removeSongFromUpacara;
function toggleUpacaraSong(uid,tid){
    const u=upacaras.find(u=>u.id===uid);if(!u)return;
    const list=u.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);
    const idx=list.findIndex(t=>t.id===tid);
    const currentlyPlaying=isPlaying&&currentPlaylist.length&&currentPlaylist[currentPlaylistIndex]?.id===tid&&stopAfterPlaylist;
    if(currentlyPlaying){audio.pause();isPlaying=false;pausedPosition=audio.currentTime;updatePlayPauseBtn();renderUpacaras();return}
    if(idx<0)return;
    stopAfterPlaylist=true;loopPlaylist=false;activeScheduleId=null;manualPauseKey=null;activeScheduleVolumePct=100;currentPlaylist=list;currentPlaylistIndex=idx;pausedPosition=0;loadAndPlay();renderUpacaras();
}
window.toggleUpacaraSong=toggleUpacaraSong;
function renderUpacaras(){
    const c=$('upacaraList');
    if(activeUpacaraId){
        const u=upacaras.find(u=>u.id===activeUpacaraId);
        if(!u){activeUpacaraId=null;return renderUpacaras();}
        const list=u.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);
        const songs=list.length?list.map(t=>{
            const playingThis=isPlaying&&currentPlaylist.length&&currentPlaylist[currentPlaylistIndex]?.id===t.id&&stopAfterPlaylist;
            const vol=t.volume||100;
            return`<div class="flex items-center gap-2 p-2 rounded-lg" style="background:#eef6f0">
                <button class="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0" style="background:#50C878" onclick="toggleUpacaraSong('${u.id}','${t.id}')"><span class="material-symbols-outlined text-[16px]">${playingThis?'pause':'play_arrow'}</span></button>
                <div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${t.name}</p><p class="text-[11px] text-on-surface-variant">${t.type==='online'?'Online':formatTime(t.duration)}</p></div>
                <div class="flex items-center gap-1" onclick="event.stopPropagation()"><input type="range" min="0" max="100" value="${vol}" class="w-16" onchange="setTrackVolById('${t.id}',this.value)"><span class="text-[10px] w-7">${vol}%</span></div>
                <button class="w-6 h-6 rounded flex items-center justify-center hover:bg-gray-100 text-on-surface-variant" onclick="removeSongFromUpacara('${u.id}','${t.id}')"><span class="material-symbols-outlined text-[14px]">delete</span></button>
            </div>`;
        }).join(''):'<p class="text-xs text-on-surface-variant py-2">Belum ada lagu. Klik "+ Lagu" untuk menambah.</p>';
        c.innerHTML=`<div class="flex items-center gap-2 mb-3">
                <button class="text-sm flex items-center gap-1 text-on-surface-variant" onclick="backFromUpacara()"><span class="material-symbols-outlined text-[18px]">arrow_back</span>Kembali</button>
                <button class="ml-auto text-[11px] px-2.5 py-1 rounded border border-outline-variant" onclick="openUpacaraModal('${u.id}')">Edit Nama</button>
            </div>
            <div class="glass-card rounded-xl p-4 mb-3">
                <h3 class="text-base font-bold mb-1">${u.name}</h3>
                <p class="text-[11px] text-on-surface-variant mb-3">${list.length} lagu • 1x putar (tanpa loop)</p>
                <div class="space-y-1.5 mb-3">${songs}</div>
                <div class="flex flex-wrap gap-1.5">
                    <button class="text-[11px] font-bold px-3 py-1.5 rounded text-white" style="background:#50C878" onclick="playUpacara('${u.id}')">Putar Semua (1x)</button>
                    <button class="text-[11px] px-3 py-1.5 rounded border border-outline-variant" onclick="openAddSongToUpacara('${u.id}')">+ Lagu</button>
                </div>
            </div>`;
        return;
    }
    const uu=currentUser?.role==='admin'?upacaras:upacaras.filter(u=>u.owner===currentUser.id);
    if(!uu.length){c.innerHTML='<div class="glass-card rounded-xl p-6 text-center text-on-surface-variant"><p class="text-xs">Belum ada upacara. Klik "+ Buat Upacara", lalu klik kartu untuk masuk dan menambah lagu.</p></div>';return}
    c.innerHTML=uu.map(u=>{
        const n=u.track_ids.length;
        return`<div class="glass-card rounded-xl p-4 cursor-pointer hover:shadow-md transition" onclick="openUpacara('${u.id}')">
            <div class="flex justify-between items-center">
                <div><h3 class="text-sm font-bold">${u.name}</h3><p class="text-[11px] text-on-surface-variant">${n} lagu • 1x putar</p></div>
                <div class="flex gap-1.5" onclick="event.stopPropagation()">
                    <button class="text-[11px] px-2.5 py-1 rounded border border-outline-variant" onclick="openUpacaraModal('${u.id}')">Edit</button>
                    <button class="text-[11px] px-2.5 py-1 rounded border border-red-300 text-red-500" onclick="removeUpacara('${u.id}')">Hapus</button>
                </div>
            </div>
        </div>`;
    }).join('');
}
window.renderUpacaras=renderUpacaras;
function playUpacara(id){const u=upacaras.find(u=>u.id===id);if(!u)return;const ut=u.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean);if(!ut.length){toast('Kosong, tambah lagu dulu');return}stopAfterPlaylist=true;loopPlaylist=false;activeScheduleId=null;manualPauseKey=null;activeScheduleVolumePct=100;manualOverrideUntil=Date.now()+7200000;currentPlaylist=ut;currentPlaylistIndex=0;pausedPosition=0;loadAndPlay();toast('Putar (1x): '+u.name)}
window.playUpacara=playUpacara;
async function removeUpacara(id){if(!confirm('Hapus?'))return;if(isSupabaseConfigured())await getSupabase().from('upacaras').delete().eq('id',id);upacaras=upacaras.filter(u=>u.id!==id);if(activeUpacaraId===id)activeUpacaraId=null;saveLocal();renderUpacaras();toast('Dihapus')}
window.removeUpacara=removeUpacara;

// ========== SCHEDULES ==========
function openScheduleModal(id){
    editingType='schedule';editingId=id||null;
    $('scheduleModalTitle').textContent=id?'Edit Jadwal Musik':'Tambah Jadwal Musik';
    const s=id?schedules.find(s=>s.id===id):null;
    $('scheduleTitle').value=s?.title||'';
    $('scheduleStart').value=s?.start_time||'08:00';
    $('scheduleEnd').value=s?.end_time||'17:00';
    $('scheduleLoop').checked=s?.loop??true;
    $('scheduleIndoRaya').checked=s?.indonesia_raya??false;
    const svol=typeof s?.volume==='number'?s.volume:100;
    if($('scheduleVolume'))$('scheduleVolume').value=svol;
    if($('scheduleVolumeVal'))$('scheduleVolumeVal').textContent=svol+'%';
    $('scheduleSourceType').value=s?.source_type||'single';
    updateScheduleSourceUI();
    updateScheduleLoopUI();
    if(s)setTimeout(()=>{$('scheduleSourceId').value=s.source_id||'';updateScheduleDurationInfo()},50);
    const days=s?.days||[1,2,3,4,5];
    document.querySelectorAll('.day-check').forEach(c=>c.checked=days.includes(parseInt(c.value)));
    $('scheduleModal').classList.add('active');
}
window.openScheduleModal=openScheduleModal;
function updateScheduleSourceUI(){
    const type=$('scheduleSourceType').value;const sel=$('scheduleSourceId');
    const ut=getUserTracks();
    if(type==='single')sel.innerHTML=ut.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')||'<option value="">(Belum ada lagu)</option>';
    else sel.innerHTML=playlists.filter(p=>p.owner===currentUser.id||currentUser?.role==='admin').map(p=>`<option value="${p.id}">${p.name}</option>`).join('')||'<option value="">(Belum ada playlist)</option>';
    updateScheduleDurationInfo();
}
window.updateScheduleSourceUI=updateScheduleSourceUI;
function getSourceIds(type,id){
    if(type==='single')return id?[id]:[];
    if(type==='playlist'){const p=playlists.find(p=>p.id===id);return p?[...p.track_ids]:[]}
    const u=upacaras.find(u=>u.id===id);return u?[...u.track_ids]:[];
}
function computeSourceDuration(type,id){
    return getSourceIds(type,id).reduce((a,tid)=>a+((tracks.find(t=>t.id===tid)?.duration)||0),0);
}
function updateScheduleLoopUI(){
    const loop=!$('scheduleLoop')||$('scheduleLoop').checked;
    const end=$('scheduleEnd');
    if(end){end.disabled=!loop;end.style.display=loop?'':'none'}
    const note=$('loopStopNote');if(note)note.style.display=loop?'none':'';
    updateScheduleDurationInfo();
}
window.updateScheduleLoopUI=updateScheduleLoopUI;
function updateScheduleDurationInfo(){
    const info=$('scheduleDurationInfo');if(!info)return;
    if(!$('scheduleLoop')||$('scheduleLoop').checked){info.textContent='Loop aktif — musik diulang hingga Jam Selesai.';info.style.color='';return}
    const type=$('scheduleSourceType').value,id=$('scheduleSourceId').value;
    if(!id){info.textContent='Pilih lagu / playlist / upacara terlebih dahulu.';info.style.color='#d97706';return}
    const ids=getSourceIds(type,id);
    const dur=computeSourceDuration(type,id);
    const unknown=ids.filter(tid=>{const t=tracks.find(x=>x.id===tid);return !(t&&t.duration>0)}).length;
    if(!dur){
        info.textContent='Durasi belum diketahui — sedang diukur otomatis dari file...';
        info.style.color='#d97706';
        ensureTrackDurations();
        return;
    }
    const[sh,sm]=($('scheduleStart').value||'00:00').split(':').map(Number);
    // dur dalam DETIK -> konversi ke menit sebelum dijumlahkan ke jam mulai
    const durMin=Math.max(Math.round(dur/60),1);
    const total=sh*60+sm+durMin;
    const eh=Math.floor(total/60)%24,em=total%60;
    let txt=`Durasi ${formatTime(dur)} • Selesai ${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
    if(unknown>0){txt+=` (+${unknown} durasi belum diketahui)`;info.style.color='#d97706';ensureTrackDurations()}
    else info.style.color='';
    info.textContent=txt;
}
window.updateScheduleDurationInfo=updateScheduleDurationInfo;
async function saveSchedule(){
    const title=$('scheduleTitle').value.trim();if(!title){toast('Judul harus diisi');return}
    const days=Array.from(document.querySelectorAll('.day-check:checked')).map(c=>parseInt(c.value));
    if(!days.length){toast('Pilih minimal 1 hari');return}
    const type=$('scheduleSourceType').value,sid=$('scheduleSourceId').value,startT=$('scheduleStart').value;
    const loop=$('scheduleLoop').checked;
    let endT=$('scheduleEnd').value;
    if(!loop){
        // Tanpa loop: hitung perkiraan jam berhenti dari durasi musik (otomatis berhenti saat musik selesai)
        const[sh2,sm2]=(startT||'00:00').split(':').map(Number);
        const total=sh2*60+sm2+Math.max(Math.round(computeSourceDuration(type,sid)/60),1);
        const eh2=Math.floor(total/60)%24,em2=total%60;
        endT=`${String(eh2).padStart(2,'0')}:${String(em2).padStart(2,'0')}`;
    }
    const data={title,start_time:startT,end_time:endT,days,source_type:type,source_id:sid,loop,indonesia_raya:$('scheduleIndoRaya').checked,volume:Math.max(0,parseInt($('scheduleVolume')?.value)||100),enabled:true,owner:currentUser.id};
    if(editingId){
        if(isSupabaseConfigured())await getSupabase().from('schedules').update(data).eq('id',editingId);
        const s=schedules.find(s=>s.id===editingId);if(s)Object.assign(s,data);
    }else{
        data.id=genId();
        if(isSupabaseConfigured()){await getSupabase().from('schedules').insert(data);schedules.unshift(data)}
        else schedules.push(data);
    }
    saveLocal();renderSchedules();closeModal('scheduleModal');toast('Tersimpan');
}
window.saveSchedule=saveSchedule;
function renderSchedules(){
    const c=$('scheduleList');
    const tg=$('autoPlayToggle');if(tg)tg.checked=autoPlayEnabled;
    const us=currentUser?.role==='admin'?schedules:schedules.filter(s=>s.owner===currentUser.id);
    if(!us.length){c.innerHTML='<div class="glass-card rounded-xl p-6 text-center text-on-surface-variant"><p class="text-xs">Belum ada jadwal</p></div>';return}
    const now=new Date();
    c.innerHTML=us.map(s=>{
        const win=scheduleWindow(s);
        const nm=now.getHours()*60+now.getMinutes();
        const active=s.enabled&&s.days.includes(now.getDay())&&nm>=win.sM&&nm<win.eM;
        const sc=active?'badge-active':s.enabled?'badge-waiting':'badge-disabled';
        const st=active?'Aktif':s.enabled?'Menunggu':'Nonaktif';
        let sourceName='?';
        if(s.source_type==='single')sourceName=tracks.find(t=>t.id===s.source_id)?.name||'?';
        else if(s.source_type==='playlist')sourceName=playlists.find(p=>p.id===s.source_id)?.name||'?';
        else if(s.source_type==='upacara')sourceName=upacaras.find(u=>u.id===s.source_id)?.name||'? (upacara)';
        return`<div class="glass-card rounded-xl p-4"><div class="flex justify-between items-center mb-1.5"><h4 class="text-sm font-bold">${s.title}</h4><div class="flex gap-1.5 items-center">${s.indonesia_raya?'<span class="text-[9px] px-1.5 py-0.5 rounded badge-indo font-bold">🇮🇩 RAYA</span>':''}<span class="text-[10px] px-2 py-0.5 rounded-full font-bold ${sc}">${st}</span></div></div><p class="text-[11px] text-on-surface-variant">${s.start_time}${s.loop===false?' • berhenti saat musik selesai':' - '+s.end_time} • ${s.loop?'Loop':'1x'} • ${sourceName}</p><div class="flex gap-0.5 my-1.5">${[0,1,2,3,4,5,6].map(d=>`<span class="text-[9px] px-1 py-0.5 rounded ${s.days.includes(d)?'bg-black text-white':'bg-gray-100 text-on-surface-variant'}">${DAY_NAMES[d]}</span>`).join('')}</div><div class="flex gap-1.5 items-center"><label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" ${s.enabled?'checked':''} class="sr-only peer" onchange="toggleSchedule('${s.id}',this.checked)"><div class="w-8 h-4 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all"></div></label><button class="text-[11px] px-2 py-0.5 rounded border border-outline-variant" onclick="openScheduleModal('${s.id}')">Edit</button><button class="text-[11px] px-2 py-0.5 rounded border border-red-300 text-red-500" onclick="removeSchedule('${s.id}')">Hapus</button></div></div>`;
    }).join('');
}
function toggleSchedule(id,en){const s=schedules.find(s=>s.id===id);if(s){s.enabled=en;saveLocal();renderSchedules();renderDashboard()}}
window.toggleSchedule=toggleSchedule;
async function removeSchedule(id){if(!confirm('Hapus?'))return;if(isSupabaseConfigured())await getSupabase().from('schedules').delete().eq('id',id);schedules=schedules.filter(s=>s.id!==id);saveLocal();renderSchedules();toast('Dihapus')}
window.removeSchedule=removeSchedule;

// ========== AUTO PLAY ==========
function toggleAutoPlay(){autoPlayEnabled=$('autoPlayToggle')?.checked||false;settings.autoPlay=autoPlayEnabled;saveLocal();if(autoPlayEnabled)checkAutoPlay(new Date())}
window.toggleAutoPlay=toggleAutoPlay;
// Jendela aktif jadwal: kalau Loop ON pakai jam mulai–selesai,
// kalau Loop OFF otomatis berhenti saat musik selesai (durasi dari library).
function scheduleWindow(s){
    const[sh,sm]=(s.start_time||'00:00').split(':').map(Number),sM=sh*60+sm;
    if(s.loop!==false){const[eh,em]=(s.end_time||s.start_time||'00:00').split(':').map(Number);return{sM,eM:eh*60+em}}
    const durMin=Math.max(Math.round(computeSourceDuration(s.source_type,s.source_id)/60),1);
    return{sM,eM:sM+durMin};
}
const schedPauseKey=s=>new Date().toDateString()+'|'+(s?.id||'-');
function checkAutoPlay(now){
    if(!autoPlayEnabled||isPrayerTime||Date.now()<silencedUntil||isIndoRayaActive)return;
    const nm=now.getHours()*60+now.getMinutes(),td=now.getDay();
    for(const s of schedules){
        if(!s.enabled||!s.days.includes(td))continue;
        const win=scheduleWindow(s);
        if(nm<win.sM||nm>=win.eM)continue;
        // Jangan lanjut otomatis jika pengguna menjeda jadwal ini secara manual hari ini
        if(manualPauseKey&&manualPauseKey===schedPauseKey(s))continue;
        if(!isPlaying||!currentPlaylist.length){
            let sourceTracks=[];
            if(s.source_type==='single'){const t=tracks.find(t=>t.id===s.source_id);if(t&&(t.type==='online'||t._localAvailable!==false))sourceTracks=[t]}
            else if(s.source_type==='playlist'){const p=playlists.find(p=>p.id===s.source_id);if(p)sourceTracks=p.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean).filter(x=>x.type==='online'||x._localAvailable!==false)}
            else{const u=upacaras.find(u=>u.id===s.source_id);if(u)sourceTracks=u.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean).filter(x=>x.type==='online'||x._localAvailable!==false)}
            if(sourceTracks.length){
                currentPlaylist=s.loop?(settings.shuffle?[...sourceTracks].sort(()=>Math.random()-.5):sourceTracks):sourceTracks;
                loopPlaylist=!!s.loop;stopAfterPlaylist=!s.loop;activeScheduleId=s.id;activeScheduleVolumePct=(typeof s.volume==='number'?s.volume:100);
                if(!isPlaying){
                    manualPauseKey=null;
                    if(pausedPosition>0){resumePlaying();toast('Lanjut: '+s.title)}
                    else{currentPlaylistIndex=0;loadAndPlay();toast('Auto: '+s.title)}
                }
            }
        }
        return;
    }
}

// ========== ADMIN - USER MANAGEMENT ==========
let allUsersList=[];
async function renderAdmin(){
    $('statTracks').textContent=tracks.length;$('statPlaylist').textContent=playlists.length;$('statUpacara').textContent=upacaras.length;$('statSchedules').textContent=schedules.length;
    allUsersList=await fetchAllUsers();
    $('userTableBody').innerHTML=allUsersList.map(u=>{
        const onlineTracks=tracks.filter(t=>t.owner===u.id&&t.type==='online');
        const usedSize=onlineTracks.reduce((a,t)=>a+(parseFloat(t.size)||0),0);
        return`<tr class="border-b border-outline-variant"><td class="py-2 font-bold text-sm">${u.name||'-'}</td><td class="py-2 text-xs text-on-surface-variant">${u.username||'-'}</td><td class="py-2"><span class="text-[10px] px-1.5 py-0.5 rounded ${u.role==='admin'?'bg-black text-white':'bg-gray-100'}">${u.role||'user'}</span></td><td class="py-2 text-xs">${(u.storage_limit||0)===0?'Unlimited':u.storage_limit+' MB'}</td><td class="py-2 text-xs">${usedSize.toFixed(1)} MB</td><td class="py-2 flex gap-1 flex-wrap"><button class="text-[10px] px-1.5 py-0.5 rounded border border-outline-variant" onclick="editUser('${u.id}')">Edit</button><button class="text-[10px] px-1.5 py-0.5 rounded border border-yellow-300 text-yellow-600" onclick="resetUserPassword('${u.id}')">Reset PW</button><button class="text-[10px] px-1.5 py-0.5 rounded border border-red-300 text-red-500" onclick="removeUser('${u.id}')">Hapus</button></td></tr>`;
    }).join('');
}
function openUserModal(userId){
    editingType='user';editingId=userId||null;
    $('userModalTitle').textContent=userId?'Edit User':'Tambah User';
    if(userId){
        const u=allUsersList.find(u=>u.id===userId);
        $('userModalFullname').value=u?.name||'';$('userModalUsername').value=u?.username||'';
        $('userModalPassword').value='';$('userModalPassword').placeholder='Kosongkan jika tidak diubah';
        $('userModalRole').value=u?.role||'user';$('userModalStorage').value=u?.storage_limit||0;
    }else{
        $('userModalFullname').value='';$('userModalUsername').value='';
        $('userModalPassword').value='';$('userModalPassword').placeholder='Wajib diisi';
        $('userModalRole').value='user';$('userModalStorage').value=500;
    }
    $('userModal').classList.add('active');
}
window.openUserModal=openUserModal;
function editUser(id){openUserModal(id)}
window.editUser=editUser;

async function saveUser(){
    const name=$('userModalFullname').value.trim(),username=$('userModalUsername').value.trim(),password=$('userModalPassword').value,role=$('userModalRole').value,storageLimit=parseInt($('userModalStorage').value)||0;
    if(!name||!username){toast('Nama & username wajib');return}
    const email=username.toLowerCase()+'@musikpintar.app';
    if(editingId){
        const updates={name,username,role,storage_limit:storageLimit};
        const ok=await updateUserProfile(editingId,updates);
        if(ok)toast('Tersimpan');else toast('Gagal update');
    }else{
        if(!password){toast('Password wajib');return}
        if(allUsersList.some(u=>u.username===username)){toast('Username sudah dipakai');return}
        try{
            const authData=await authSignUp(email,password);
            if(!authData?.user){toast('Gagal buat akun (cek email/RLS)');return}
            await upsertUserProfile({id:authData.user.id,email,username,name,role,storage_limit:storageLimit});
            toast('User dibuat: '+username);
        }catch(e){toast('Gagal: '+e.message);return}
    }
    renderAdmin();closeModal('userModal');
}
window.saveUser=saveUser;

async function resetUserPassword(userId){
    const u=allUsersList.find(u=>u.id===userId);
    if(!u)return;
    if(!confirm(`Reset password user "${u.username}" ke default (12345678)? User akan dipaksa ubah password saat login.`))return;
    const ok=await updateUserProfile(userId,{force_change_password:true});
    if(ok){toast('Reset berhasil - user akan ubah password saat login');renderAdmin()}
    else toast('Gagal reset');
}
window.resetUserPassword=resetUserPassword;

async function removeUser(userId){
    const u=allUsersList.find(u=>u.id===userId);
    if(!u)return;
    if(!confirm(`Hapus profil ${u.email}? (Akun Supabase Auth tetap ada)`))return;
    const ok=await deleteUserProfile(userId);
    if(ok){toast('Profil dihapus');renderAdmin()}
    else toast('Gagal hapus');
}
window.removeUser=removeUser;

// ========== CLEAR ==========
function clearAllData(){if(!confirm('Hapus SEMUA data?'))return;tracks=[];playlists=[];upacaras=[];schedules=[];saveLocal();audio.pause();isPlaying=false;currentPlaylist=[];renderTracks();renderPlaylists();renderUpacaras();renderSchedules();renderDashboard();toast('Semua data dihapus')}
window.clearAllData=clearAllData;

// ========== DASHBOARD ==========
const RING_LEN=289; // keliling lingkaran r=46 (2*PI*46≈289)
function setStorageRing(ratio,color){
    const ring=$('storageRing');if(!ring)return;
    ratio=Math.max(0,Math.min(ratio||0,1));
    ring.setAttribute('stroke',color);
    ring.style.strokeDashoffset=String(RING_LEN*(1-ratio));
}
function renderStorageCard(){
    const ut=getUserTracks();
    const onlineMB=ut.filter(t=>t.type==='online').reduce((a,t)=>a+(parseFloat(t.size)||0),0);
    const localMB=ut.filter(t=>t.type!=='online').reduce((a,t)=>a+(parseFloat(t.size)||0),0);
    if($('storageLocalSize'))$('storageLocalSize').textContent=localMB.toFixed(1)+' MB';
    if($('storageOnlineSize'))$('storageOnlineSize').textContent=onlineMB.toFixed(1)+' MB';
    const onlineMode=isSupabaseConfigured()&&currentUser&&(currentUser.storage_limit||0)>0;
    let usedMB=0;
    if(onlineMode){
        usedMB=tracks.filter(t=>t.type==='online'&&t.owner===currentUser.id).reduce((a,t)=>a+(parseFloat(t.size)||0),0);
    }else{
        usedMB=tracks.reduce((a,t)=>a+(parseFloat(t.size)||0),0);
    }
    const lim=currentUser?.storage_limit||0;
    if(onlineMode){
        const remaining=Math.max(lim-usedMB,0);
        const ratio=lim>0?Math.min(usedMB/lim,1):0;
        $('storageUsedText').textContent=usedMB.toFixed(1)+' MB Terpakai';
        $('storageMaxLabel').textContent='Kuota '+lim+' MB • Sisa '+remaining.toFixed(1)+' MB';
        setStorageRing(ratio,ratio>0.9?'#ef4444':'#50C878');
        $('storageModeLabel').textContent='Online (Supabase)';
        $('storageIcon').textContent='cloud';
    }else{
        const ratio=Math.min(usedMB/2000,1);
        $('storageUsedText').textContent=usedMB.toFixed(1)+' MB Terpakai';
        $('storageMaxLabel').textContent='Tanpa Batas';
        setStorageRing(Math.max(ratio,0.04),'#50C878');
        $('storageModeLabel').textContent='Offline • Tanpa batas kuota';
        $('storageIcon').textContent='cloud';
    }
}
function renderDashboard(){
    renderStorageCard();
    const c=$('activeSchedulesDash');if(!c)return;
    const now=new Date(),nm=now.getHours()*60+now.getMinutes(),td=now.getDay();
    const isActive=s=>{if(!s.enabled||!s.days.includes(td))return false;const[sh,sm]=s.start_time.split(':').map(Number),[eh,em]=s.end_time.split(':').map(Number);return nm>=sh*60+sm&&nm<eh*60+em};
    const as=schedules.filter(isActive);
    const srcLabel=s=>{
        if(s.source_type==='single'){const t=tracks.find(t=>t.id===s.source_id);return t?t.name:'Lagu'}
        if(s.source_type==='playlist'){const p=playlists.find(p=>p.id===s.source_id);return p?'Playlist: '+p.name:'Playlist'}
        const u=upacaras.find(u=>u.id===s.source_id);return u?'Upacara: '+u.name:'Upacara';
    };
    if(!as.length){c.innerHTML='<div class="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-outline-variant rounded-lg text-on-surface-variant opacity-60"><span class="material-symbols-outlined mb-2">add_task</span><p class="text-xs">Tidak ada jadwal musik aktif</p></div>';return}
    c.innerHTML=as.map(s=>{
        const playing=isPlaying&&activeScheduleId===s.id;
        const vol=typeof s.volume==='number'?s.volume:100;
        const vIcon=vol==0?'volume_off':(vol<50?'volume_down':'volume_up');
        let mini='';
        if(playing){
            const ct=currentPlaylist[currentPlaylistIndex];
            const pct=(ct&&audio.duration)?(audio.currentTime/audio.duration*100):0;
            mini=`<div class="mt-3"><div class="flex justify-between items-center gap-2 mb-1.5"><span class="text-[10px] font-medium text-on-surface truncate" id="dashPlayerTrack">${ct?ct.name:''}</span><span class="text-[10px] text-on-surface-variant shrink-0 tabular-nums" id="dashPlayerTime">${formatTime(audio.currentTime||0)} / ${formatTime(audio.duration||0)}</span></div><div class="player-progress" style="height:5px" onclick="event.stopPropagation();seekDash(event)"><div class="player-progress-fill" id="dashPlayerFill" style="width:${pct.toFixed(1)}%"></div></div></div>`;
        }
        return`<div class="group rounded-lg border transition-colors p-4 ${playing?'border-green-400 bg-green-50/40':'bg-white border-outline-variant hover:border-black'}"><div class="flex items-center justify-between gap-3"><div class="flex items-center gap-4 min-w-0"><div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-on-surface-variant group-hover:text-black transition-colors shrink-0"><span class="material-symbols-outlined">music_note</span></div><div class="min-w-0"><p class="font-bold text-sm text-on-surface truncate">${s.title}${s.loop?' <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-900 text-white align-middle">LOOP</span>':' <span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-on-surface-variant align-middle">1X</span>'}${s.indonesia_raya?' <span class="badge-indo text-[9px] font-bold px-1 py-0.5 rounded align-middle">INDONESIA RAYA</span>':''}</p><p class="text-[11px] text-on-surface-variant truncate mt-0.5">${srcLabel(s)}</p></div></div><div class="flex items-center gap-3 shrink-0"><button onclick="toggleSchedulePlay('${s.id}')" title="${playing?'Jeda':'Putar'}" class="w-9 h-9 rounded-full text-white flex items-center justify-center hover:scale-105 transition-transform" style="background:#50C878"><span class="material-symbols-outlined text-sm" data-sched-icon="${s.id}">${playing?'pause':'play_arrow'}</span></button><div class="text-right leading-tight"><p class="font-bold text-sm text-on-surface">${s.start_time}</p><p class="text-[10px] text-on-surface-variant whitespace-nowrap">${s.loop!==false?('s.d. '+s.end_time):'musik selesai'}</p></div></div></div>${mini}<div class="${mini?'mt-2.5':'mt-3'} flex items-center gap-2"><span class="material-symbols-outlined text-[15px] text-on-surface-variant">${vIcon}</span><input type="range" min="0" max="100" value="${vol}" class="flex-1" onchange="setScheduleVolume('${s.id}',this.value)" onclick="event.stopPropagation()"><span class="text-[10px] w-8 text-right font-bold text-on-surface-variant shrink-0">${vol}%</span></div></div>`;
    }).join('');
}
function playScheduleNow(id){
    const s=schedules.find(x=>x.id===id);if(!s)return;
    let sourceTracks=[];
    if(s.source_type==='single'){const t=tracks.find(t=>t.id===s.source_id);if(t)sourceTracks=[t]}
    else if(s.source_type==='playlist'){const p=playlists.find(p=>p.id===s.source_id);if(p)sourceTracks=p.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean)}
    else{const u=upacaras.find(u=>u.id===s.source_id);if(u)sourceTracks=u.track_ids.map(id=>tracks.find(t=>t.id===id)).filter(Boolean)}
    sourceTracks=sourceTracks.filter(x=>x.type==='online'||x._localAvailable!==false);
    if(!sourceTracks.length){toast('File lokal tidak tersedia / daftar kosong');return}
    stopAfterPlaylist=false;loopPlaylist=false;activeScheduleId=id;manualPauseKey=null;activeScheduleVolumePct=(typeof s.volume==='number'?s.volume:100);
    manualOverrideUntil=Date.now()+7200000;
    currentPlaylist=settings.shuffle?[...sourceTracks].sort(()=>Math.random()-.5):[...sourceTracks];
    currentPlaylistIndex=0;loadAndPlay();toast('Putar: '+s.title);
}
function toggleSchedulePlay(id){
    if(activeScheduleId===id&&currentPlaylist.length>0&&currentPlaylistIndex>=0){togglePlayPause();return}
    playScheduleNow(id);
}
window.toggleSchedulePlay=toggleSchedulePlay;
// Volume per-jadwal: disimpan ke database & langsung mengubah suara jika jadwal ini sedang diputar
async function setScheduleVolume(id,v){
    const s=schedules.find(x=>x.id===id);if(!s)return;
    s.volume=Math.max(0,parseInt(v)||0);
    if(isSupabaseConfigured()){try{await getSupabase().from('schedules').update({volume:s.volume}).eq('id',id)}catch(e){}}
    saveLocal();
    if(activeScheduleId===id){
        activeScheduleVolumePct=s.volume;
        const t=currentPlaylist[currentPlaylistIndex];
        if(t)audio.volume=(activeScheduleVolumePct/100)*((t.volume||100)/100)*(settings.volume/100);
    }
}
window.setScheduleVolume=setScheduleVolume;
// Seek pada mini player dashboard
function seekDash(e){
    const bar=e.currentTarget,rect=bar.getBoundingClientRect();
    const pct=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
    if(audio.duration){audio.currentTime=pct*audio.duration;pausedPosition=0}
}
window.seekDash=seekDash;
window.playScheduleNow=playScheduleNow;

// ========== INIT ==========
const savedUser=LS.get('currentUser',null);
if(savedUser){
    currentUser=savedUser;
    $('loginPage').style.display='none';
    $('appPage').style.display='';
    updateUI();
    syncData().then(()=>{loadSettingsUI();renderTracks();renderPlaylists();renderUpacaras();renderSchedules();renderPrayerGrid();renderDashboard();showPage('dashboard')});
}else{
    document.querySelector('.sidebar').style.display='none';
    document.querySelector('.main-content header').style.display='none';
}
setInterval(updateClock,1000);updateClock();
document.querySelectorAll('.modal-overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)o.classList.remove('active')}));
const today=new Date().toDateString();if(LS.get('adzanDay','')!==today){adzanPlayedToday={};LS.set('adzanDay',today);LS.set('adzanPlayed',adzanPlayedToday)}
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
window.addEventListener('online',()=>{$('connectionText').textContent='Online';$('connectionBadge').querySelector('.material-symbols-outlined').textContent='cloud_done'});
window.addEventListener('offline',()=>{$('connectionText').textContent='Offline';$('connectionBadge').querySelector('.material-symbols-outlined').textContent='cloud_off'});

// ==================================================================
// BROADCAST CONTROL SYSTEM (fitur internal - Admin + Mode Host)
// Admin : halaman side-menu "Broadcast" (user login = pemilik host)
// Host  : overlay layar penuh tanpa login (#hostScreen)
// ==================================================================
const BC={hosts:[],sel:new Set(),ch:null,tick:null,offMs:null,offAt:0};
const HS={active:false,row:null,name:'',ch:null,hbT:null,reT:null,player:null,driveEl:null,driveSrc:null,curType:null,curUrl:null,playingVid:null,pending:new Map(),vol:null,muted:false,mediaShown:false};
const bcSb=()=>isSupabaseConfigured()?getSupabase():null;
function bcEsc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

// --- estimasi waktu server (fondasi Play serentak) ---
const BC_ENV=(import.meta.env||{});
const bcRestUrl=()=>(BC_ENV.VITE_SUPABASE_URL||'').replace(/\/$/,'')+'/rest/v1';
async function bcServerNow(){
    if(BC.offMs!==null&&Date.now()-BC.offAt<300000)return Date.now()+BC.offMs;
    const key=BC_ENV.VITE_SUPABASE_ANON_KEY;
    if(bcRestUrl()&&key){try{
        const t0=Date.now();
        const res=await fetch(bcRestUrl()+'/broadcast_hosts?select=id&limit=1',{headers:{apikey:key,Authorization:'Bearer '+key}});
        const srv=new Date(res.headers.get('date')).getTime();
        if(!isNaN(srv)){BC.offMs=srv-t0;BC.offAt=Date.now()}
    }catch(e){}}
    return Date.now()+(BC.offMs||0);
}
// --- YouTube IFrame API (dimuat hanya saat dibutuhkan) ---
let _ytLoading=null;
function loadYouTubeAPI(){
    if(window.YT&&window.YT.Player)return Promise.resolve();
    if(_ytLoading)return _ytLoading;
    _ytLoading=new Promise(res=>{
        const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';document.head.appendChild(s);
        const iv=setInterval(()=>{if(window.YT&&window.YT.Player){clearInterval(iv);res()}},200);
    });
    return _ytLoading;
}
// --- parser URL media ---
function parseBroadcastUrl(u){
    u=(u||'').trim();if(!u)return null;
    let m=u.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|live\/|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if(m)return{type:'youtube',id:m[1]};
    m=u.match(/[?&]list=([\w-]+)/);
    if(m&&/youtube\.com/.test(u))return{type:'youtube_playlist',id:m[1]};
    m=u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
    if(m)return{type:'drive',id:'https://drive.google.com/file/d/'+m[1]+'/preview'};
    return{type:'url',id:u};
}

// =========================== ADMIN ===========================
const bcIsOnline=h=>!!h.last_seen&&(Date.now()-new Date(h.last_seen).getTime())<45000;
function bcUpsertLocal(row){const i=BC.hosts.findIndex(h=>h.id===row.id);if(i>=0)BC.hosts[i]={...BC.hosts[i],...row};else BC.hosts.push({...row,_on:bcIsOnline(row)})}
async function bcFetchHosts(){
    const sb=bcSb();if(!sb||!currentUser)return;
    const {data}=await sb.from('broadcast_hosts').select('*').eq('owner_id',currentUser.id).order('created_at');
    if(data){BC.hosts=data.map(h=>({...h,_on:bcIsOnline(h)}));
        const valid=new Set(data.map(h=>h.id));BC.sel=new Set([...BC.sel].filter(id=>valid.has(id)));
        renderBcHosts();
    }
}
function bcEnsureAdminRealtime(){
    const sb=bcSb();
    $('bcNoSupabase').classList.toggle('hidden',!!sb);
    if(!sb||!currentUser)return;
    if(!BC.ch){
        BC.ch=sb.channel('bc-admin')
            .on('postgres_changes',{event:'*',schema:'public',table:'broadcast_hosts',filter:'owner_id=eq.'+currentUser.id},p=>{
                if(p.eventType==='DELETE')bcFetchHosts();
                else{bcUpsertLocal(p.new);renderBcHosts()}
            })
            .subscribe(st=>{if(st==='SUBSCRIBED')bcFetchHosts()});
        BC.tick=setInterval(()=>{
            if(!$('page-broadcast')?.classList.contains('active'))return;
            let ch=false;
            BC.hosts.forEach(h=>{const on=bcIsOnline(h);if(!!h._on!==on){h._on=on;ch=true}});
            if(ch)renderBcHosts();
            else if(new Date().getSeconds()<12)bcFetchHosts();
        },10000);
    }else bcFetchHosts();
}
function bcStopAdminRealtime(){
    clearInterval(BC.tick);BC.tick=null;
    try{if(BC.ch&&isSupabaseConfigured())getSupabase().removeChannel(BC.ch)}catch(e){}
    BC.ch=null;
}
function renderBcHosts(){
    const g=$('bcHostGrid');if(!g)return;
    $('bcHostCount').textContent=BC.hosts.length;
    if(!BC.hosts.length){
        g.innerHTML='<div class="col-span-full text-center py-10"><span class="material-symbols-outlined text-4xl text-on-surface-variant">desktop_access_disabled</span><p class="text-xs text-on-surface-variant mt-3 leading-relaxed">Belum ada Host.<br>Buka <b>📟 Mode Host</b> di PC tujuan, lalu masukkan kode 6 digitnya di atas.</p></div>';
        return;
    }
    g.innerHTML=BC.hosts.map(h=>{
        const dot=h._on?'background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)':'background:#e2e8f0';
        const ms=!h._on?'<span style="color:#94a3b8">OFFLINE</span>':h.media_status==='playing'?'<span style="color:#059669">▶ PLAYING</span>':h.media_status==='paused'?'<span style="color:#f59e0b">⏸ PAUSED</span>':'<span style="color:#64748b">⏹ SIAGA</span>';
        const v=h.muted?'🔇 MUTE':'🔊 '+(h.volume??70)+'%';
        return `<div class="border border-outline-variant rounded-xl p-4 bg-white ${BC.sel.has(h.id)?'ring-2 ring-black':''}" style="transition:box-shadow .15s">
            <div class="flex items-start justify-between gap-2">
                <label class="flex items-center gap-2 min-w-0 cursor-pointer">
                    <input type="checkbox" class="accent-black w-4 h-4 shrink-0" ${BC.sel.has(h.id)?'checked':''} onchange="bcToggleSel('${h.id}',this.checked)">
                    <div class="min-w-0"><p class="text-sm font-bold truncate">${bcEsc(h.host_name||'(Belum dinamai)')}</p>
                    <p class="text-[10px] text-on-surface-variant font-mono tracking-widest">${bcEsc(h.host_code||'')}</p></div>
                </label>
                <span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 transition-all" style="${dot}"></span>
            </div>
            <div class="flex items-center justify-between mt-3 pt-2.5 border-t border-outline-variant text-[11px] font-bold"><span>${ms}</span><span class="text-on-surface-variant">${v}</span></div>
            <div class="flex gap-2 mt-2.5">
                <button class="flex-1 py-1.5 rounded-lg text-[11px] font-bold border border-outline-variant hover:bg-gray-50" onclick="bcRename('${h.id}')">✏️ Nama</button>
                ${h._on?`<button class="flex-1 py-1.5 rounded-lg text-[11px] font-bold border border-outline-variant hover:bg-gray-50" onclick="bcSendCommand('fullscreen','${h.id}')">⛶ Layar</button>`:''}
                <button class="py-1.5 px-3 rounded-lg text-[11px] font-bold border border-red-200 text-red-600 hover:bg-red-50" title="Lepas host" onclick="bcDelete('${h.id}')">🗑️</button>
            </div>
        </div>`;
    }).join('');
}
window.bcToggleSel=(id,on)=>{on?BC.sel.add(id):BC.sel.delete(id);renderBcHosts()};
window.bcSelectMode=m=>{BC.sel.clear();if(m==='all')BC.hosts.forEach(h=>BC.sel.add(h.id));renderBcHosts()};
window.bcClaimHost=async()=>{
    const sb=bcSb();if(!sb){toast('Supabase belum dikonfigurasi');return}
    const inp=$('bcPairCode');const code=inp.value.replace(/\D/g,'');
    if(code.length!==6){toast('Masukkan kode 6 digit yang tampil di Mode Host');return}
    const {data:cand}=await sb.from('broadcast_hosts').select('*').eq('host_code',code).order('created_at').limit(2);
    const h=cand&&cand[0];
    if(!h){toast('❌ Kode tidak ditemukan (atau sudah dipasang ulang)');inp.value='';return}
    if(h.owner_id&&h.owner_id!==currentUser.id){toast('❌ Host sudah diklaim akun lain');inp.value='';return}
    await sb.from('broadcast_hosts').update({owner_id:currentUser.id,status:'online'}).eq('id',h.id);
    try{await sb.from('broadcast_sessions').insert({admin_id:currentUser.id,host_id:h.id,status:'active'})}catch(e){}
    inp.value='';
    bcUpsertLocal({...h,owner_id:currentUser.id});renderBcHosts();
    toast('✅ "'+(h.host_name||'Host baru')+'" berhasil ditambahkan');
};
window.bcRename=async id=>{
    const h=BC.hosts.find(x=>x.id===id);if(!h)return;
    const name=prompt('Nama untuk Host ini:',h.host_name||'');
    if(name===null)return;
    const sb=bcSb();if(!sb)return;
    await sb.from('broadcast_hosts').update({host_name:name.trim()}).eq('id',id);
    bcUpsertLocal({id,host_name:name.trim()});renderBcHosts();toast('Nama disimpan');
};
window.bcDelete=async id=>{
    if(!confirm('Lepaskan host ini dari daftar Anda?\n(Host dapat ditambahkan ulang dengan kode yang sama)'))return;
    const sb=bcSb();if(!sb)return;
    await sb.from('broadcast_hosts').update({owner_id:null,host_name:'',status:'offline',media_status:'stopped'}).eq('id',id);
    BC.sel.delete(id);bcFetchHosts();toast('Host dilepas');
};
let _bcVolT=null;
window.bcVolumeChange=()=>{
    const v=+$('bcVolSlider').value;$('bcVolLabel').textContent=v+'%';
    clearTimeout(_bcVolT);_bcVolT=setTimeout(()=>bcSendCommand('volume'),400);
};
window.bcSendCommand=async(cmd,target)=>{
    const sb=bcSb();if(!sb||!currentUser)return;
    const ids=target?[target]:[...BC.sel];
    const targets=BC.hosts.filter(h=>ids.includes(h.id));
    if(!targets.length){toast('Pilih minimal satu Host terlebih dahulu');return}
    let vol=null,mediaType=null,mediaUrl=null,startAt=null;
    if(cmd==='volume')vol=+$('bcVolSlider').value;
    if(cmd==='load'){
        const p=parseBroadcastUrl($('bcMediaUrl').value);
        if(!p){toast('URL tidak dikenali. Gunakan link YouTube atau Google Drive.');return}
        mediaType=p.type;
        mediaUrl=p.type==='youtube'?('https://www.youtube.com/watch?v='+p.id):p.type==='youtube_playlist'?('https://www.youtube.com/watch?v=&list='+p.id):p.id;
    }
    if(cmd==='play')startAt=new Date(await bcServerNow()+2000).toISOString();
    const rows=targets.map(h=>({host_id:h.id,command:cmd,media_type:mediaType,media_url:mediaUrl,volume:vol,start_at:startAt,created_by:'admin:'+currentUser.id}));
    const {error}=await sb.from('broadcast_commands').insert(rows);
    if(error){toast('Gagal mengirim perintah: '+error.message);return}
    targets.forEach(h=>{
        if(mediaType){h.media_type=mediaType;h.media_url=mediaUrl}
        if(cmd==='play')h.media_status='playing';
        else if(cmd==='pause')h.media_status='paused';
        else if(cmd==='stop')h.media_status='stopped';
        else if(cmd==='mute')h.muted=!h.muted;
        else if(cmd==='volume'){h.volume=vol;h.muted=false}
    });
    renderBcHosts();
    toast('📡 '+cmd.toUpperCase()+' terkirim ke '+targets.length+' host'+(startAt?' • eksekusi bersamaan dalam 2 detik':''));
};
window.bcLoadMedia=()=>bcSendCommand('load');

// =========================== MODE HOST (tanpa login) ===========================
const HS_KEY='broadcastHostDevice';
function hsGetDevKey(){
    let d=LS.get(HS_KEY,null);
    if(d&&d.devKey)return d.devKey;
    d={devKey:(crypto.randomUUID?crypto.randomUUID():'dev-'+Math.random().toString(36).slice(2)+Date.now().toString(36))};
    LS.set(HS_KEY,d);return d.devKey;
}
async function hsAcquireRow(){
    const sb=bcSb();if(!sb)return null;
    const devKey=hsGetDevKey();
    // 1. resume: perangkat ini sudah punya baris host
    let {data:h}=await sb.from('broadcast_hosts').select('*').eq('device_key',devKey).maybeSingle();
    if(h&&h.owner_id)return h; // masih terpasang dengan admin -> pakai apa adanya
    if(h&&!h.owner_id){await sb.from('broadcast_hosts').update({status:'connecting',last_seen:new Date().toISOString()}).eq('id',h.id);return h}
    if(h)return h;
    // 2. buat baru dengan kode unik
    for(let i=0;i<7;i++){
        const code=String(Math.floor(Math.random()*900000)+100000);
        const dup=await sb.from('broadcast_hosts').select('id').eq('host_code',code).maybeSingle();
        if(dup.data)continue;
        const {data:n,error:e}=await sb.from('broadcast_hosts')
            .insert({host_code:code,device_key:devKey,host_name:'',status:'connecting',last_seen:new Date().toISOString()})
            .select().single();
        if(n)return n;
        if(e&&!/duplicate/i.test(e.message||''))break;
    }
    return null;
}
window.openHostScreen=async()=>{
    const sb=bcSb();
    if(!sb){toast('Mode Host membutuhkan konfigurasi Supabase (.env)');return}
    if(HS.active){$('hostScreen').style.display='block';return}
    HS.active=true;
    // hindari dobel audio: musik utama dijeda dulu bila sedang diputar
    try{if(isPlaying||!audio.paused){pausedPosition=audio.currentTime;audio.pause();isPlaying=false;updatePlayPauseBtn()}}catch(e){}
    $('hostScreen').style.display='block';
    $('hsWaiting').style.display='flex';$('hsPlayerWrap').style.display='none';$('hsFsBtn').classList.add('hidden');
    $('hsStatusPill').classList.add('hidden');$('hsStatusPill').classList.remove('flex');
    $('hsCode').textContent='······';$('hsWaitLabel').textContent='Menghubungkan ke server…';$('hsConnState').textContent='';
    const row=await hsAcquireRow();
    if(!row){HS.active=false;$('hostScreen').style.display='none';toast('Gagal mendapatkan kode host. Periksa koneksi/schema.');return}
    HS.row=row;HS.name=row.host_name||'';
    $('hsCode').textContent=row.host_code;
    $('hsWaitLabel').textContent=row.owner_id?'Terpasang ✔ Menunggu perintah dari Admin…':'Menunggu kode ini ditambahkan di halaman Broadcast Admin…';
    hsStartHeartbeat();
    hsSubscribeChannel(false);
    try{localStorage.setItem('musik-pintar-host-open','1')}catch(e){}
};
window.closeHostScreen=()=>{
    hsStopHostSession();
    $('hostScreen').style.display='none';
    try{if(document.fullscreenElement)document.exitFullscreen()}catch(e){}
};
window.resetHostDevice=async()=>{
    if(!confirm('Pasang ulang kode BARU?\nKode lama tidak berlaku lagi dan host akan dilepas dari daftar Admin.'))return;
    try{localStorage.removeItem(HS_KEY)}catch(e){}
    hsStopHostSession();
    $('hostScreen').style.display='none';
    setTimeout(()=>openHostScreen(),350);
};
function hsSetOnline(st){
    const sb=bcSb();if(!sb||!HS.row)return;
    sb.from('broadcast_hosts').update({last_seen:new Date().toISOString(),status:st||'online'}).eq('id',HS.row.id).then();
}
function hsStartHeartbeat(){
    clearInterval(HS.hbT);
    hsSetOnline(HS.row&&HS.row.owner_id?'online':'connecting');
    HS.hbT=setInterval(()=>hsSetOnline(HS.row&&HS.row.owner_id?'online':'connecting'),20000);
}
function hsSubscribeChannel(isRetry){
    const sb=bcSb();if(!sb||!HS.row)return;
    clearTimeout(HS.reT);
    if(HS.ch)sb.removeChannel(HS.ch).catch(()=>{});
    HS.ch=sb.channel('bc-host-'+HS.row.id)
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'broadcast_commands',filter:'host_id=eq.'+HS.row.id},p=>hsExec(p.new))
        .subscribe(async st=>{
            if(st==='SUBSCRIBED'){
                $('hsConnState').textContent='';
                hsSetOnline('online');
                // replay perintah yang terlewat saat putus koneksi (max 30 detik ke belakang)
                try{
                    const since=new Date(Date.now()-30000).toISOString();
                    const {data:rows}=await sb.from('broadcast_commands').select('*').eq('host_id',HS.row.id).gte('created_at',since);
                    if(rows)for(const c of rows.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)))hsExec(c);
                }catch(e){}
            }else if(st==='CHANNEL_ERROR'||st==='TIMED_OUT'||st==='CLOSED'){
                $('hsConnState').textContent='Koneksi terputus — menyambung ulang otomatis…';
                clearTimeout(HS.reT);HS.reT=setTimeout(()=>hsSubscribeChannel(true),2500);
            }
        });
}
async function hsExec(c){
    if(!c||!c.command||HS.pending.has(c.id)||!HS.active)return;
    HS.pending.set(c.id,true);
    setTimeout(()=>HS.pending.delete(c.id),60000);
    const cmd=c.command;
    if(cmd==='load'){
        HS.curType=c.media_type;HS.curUrl=c.media_url;
        loadYouTubeAPI().catch(()=>{});           // preload API
        hsPatchRow({media_type:c.media_type,media_url:c.media_url});
        if(c.start_at){/* load via play dengan start_at */}
        return;
    }
    if(cmd==='volume'&&c.volume!==null&&c.volume!==undefined){
        HS.vol=+c.volume;if(HS.player&&HS.player.setVolume)hsApplyVolYT();if(HS.driveEl)hsApplyVolHTML();
        return;
    }
    if(cmd==='mute'){
        HS.muted=!HS.muted;
        if(HS.player&&HS.player.mute)hsApplyVolYT();
        if(HS.driveEl)hsApplyVolHTML();
        return;
    }
    if(cmd==='fullscreen'){hsEnterFs();return}
    if(cmd==='play'){
        if(!HS.curUrl){$('hsConnState').textContent='Belum ada media dimuat oleh Admin.';return}
        let delay=0;
        try{if(c.start_at){const sn=await bcServerNow();delay=new Date(c.start_at).getTime()-sn}}catch(e){}
        delay>60?setTimeout(hsPlay,delay):hsPlay();
        return;
    }
    if(cmd==='pause'){hsPauseMedia();hsMarkStatus('paused');return}
    if(cmd==='stop'){hsStopMedia();$('hsPlayerWrap').style.display='none';$('hsWaiting').style.display='flex';$('hsFsBtn').classList.add('hidden');hsMarkStatus('stopped');return}
}
function hsPatchRow(patch){const sb=bcSb();if(sb&&HS.row)sb.from('broadcast_hosts').update(patch).eq('id',HS.row.id).then();if(HS.row&&patch.media_status!==undefined)HS.row.media_status=patch.media_status}
function hsMarkStatus(st){
    if(HS.row)HS.row.media_status=st;
    hsPatchRow({media_status:st});
    hsUpdatePill();
}
function hsYTof(url){const m=(url||'').match(/(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{6,})/);return m?m[1]:null}
function hsListIdOf(url){const m=(url||'').match(/[?&]list=([\w-]+)/);return m?m[1]:null}
async function hsPlay(){
    HS.mediaShown=true;
    $('hsPlayerWrap').style.display='block';$('hsWaiting').style.display='none';
    $('hsFsBtn').classList.remove('hidden');
    if(['youtube','youtube_playlist'].includes(HS.curType)){
        await loadYouTubeAPI().catch(()=>{});
        const listId=HS.curType==='youtube_playlist'?hsListIdOf(HS.curUrl):null;
        const vid=HS.curType==='youtube'?hsYTof(HS.curUrl):null;
        const pv={autoplay:1,controls:0,disablekb:1,rel:0,playsinline:1,fs:0,modestbranding:1};
        if(listId){pv.listType='playlist';pv.list=listId}
        const go=()=>{try{hsApplyVolYT();HS.player.playVideo()}catch(e){}};
        try{
            if(!HS.player||!HS.player.getPlayerState){
                HS.player=new YT.Player('hsYTPlayer',{width:'100%',height:'100%',playerVars:pv,
                    videoId:listId?undefined:vid,
                    events:{
                        onReady:go,
                        onStateChange:e=>{if(e.data===0)hsMarkStatus('stopped');hsUpdatePill()},
                        onError:()=>{hsMarkStatus('stopped');$('hsConnState').textContent='Gagal memutar video (private/regional?)'}
                    }});
                return; // onReady memanggil go()
            }
            if(listId)HS.player.loadPlaylist({list:listId,listType:'playlist'});
            else{const v2=vid||HS.playingVid;if(v2)HS.player.loadVideoById(v2)}
            setTimeout(go,250);
        }catch(e){setTimeout(go,250)}
        HS.playingVid=vid;
    }else{ // drive preview / url video langsung
        try{
            if(!HS.driveEl||HS.driveSrc!==HS.curUrl){
                if(HS.driveEl)HS.driveEl.remove();
                HS.driveEl=document.createElement('video');
                HS.driveEl.style.cssText='position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;z-index:5';
                HS.driveEl.autoplay=true;HS.driveEl.controls=false;
                HS.driveEl.addEventListener('ended',()=>hsMarkStatus('stopped'));
                $('hsPlayerWrap').appendChild(HS.driveEl);
                HS.driveSrc=HS.curUrl;HS.driveEl.src=HS.curUrl;
                hsApplyVolHTML();
                await HS.driveEl.play().catch(()=>{});
            }else{
                hsApplyVolHTML();
                await HS.driveEl.play().catch(()=>{});
            }
        }catch(e){}
    }
    hsMarkStatus('playing');
}
function hsPauseMedia(){try{if(HS.player&&HS.player.pauseVideo)HS.player.pauseVideo()}catch(e){}if(HS.driveEl)try{HS.driveEl.pause()}catch(e){}}
function hsStopMedia(){try{if(HS.player&&HS.player.stopVideo)HS.player.stopVideo()}catch(e){}if(HS.driveEl)try{HS.driveEl.pause()}catch(e){}}
function hsApplyVolYT(){try{if(!HS.player)return;HS.player.setVolume(HS.vol??70);HS.muted?HS.player.mute():HS.player.unMute()}catch(e){}}
function hsApplyVolHTML(){try{if(!HS.driveEl)return;HS.driveEl.volume=(HS.vol??70)/100;HS.driveEl.muted=!!HS.muted}catch(e){}}
function hsUpdatePill(){
    const p=$('hsStatusPill');
    if(!p||!HS.active)return;
    if(!HS.mediaShown){p.classList.add('hidden');return}
    const st=(HS.row&&HS.row.media_status)||'stopped';
    const map={playing:['▶ PLAYING','#22c55e'],paused:['⏸ PAUSED','#f59e0b'],stopped:['⏹ SIAGA','#ffffff']};
    const [txt,col]=map[st]||map.stopped;
    p.classList.remove('hidden');p.classList.add('flex');p.style.color='#fff';
    p.innerHTML='<span style="color:'+col+'">●</span> '+txt+(HS.name?' • '+bcEsc(HS.name):'');
}
function hsEnterFs(){
    const el=$('hostScreen');
    try{(el.requestFullscreen||el.webkitRequestFullscreen).call(el)}catch(e){}
}
window.hsToggleFullscreen=()=>{try{document.fullscreenElement?document.exitFullscreen():hsEnterFs()}catch(e){}};
function hsStopHostSession(){
    clearInterval(HS.hbT);clearTimeout(HS.reT);
    try{if(HS.ch&&isSupabaseConfigured())getSupabase().removeChannel(HS.ch)}catch(e){}
    HS.ch=null;
    try{if(HS.player&&HS.player.destroy)HS.player.destroy()}catch(e){}
    HS.player=null;
    try{if(HS.driveEl)HS.driveEl.remove()}catch(e){}
    HS.driveEl=null;HS.driveSrc=null;HS.curType=null;HS.curUrl=null;HS.playingVid=null;
    HS.mediaShown=false;
    if(HS.row&&isSupabaseConfigured()){
        getSupabase().from('broadcast_hosts').update({status:'offline',media_status:'stopped'}).eq('id',HS.row.id).catch(()=>{});
    }
    HS.row=null;HS.active=false;
    try{localStorage.removeItem('musik-pintar-host-open')}catch(e){}
}
// --- boot broadcast ---
(function bcBoot(){
    // buka channel realtime admin saat menu Broadcast diklik
    document.addEventListener('click',e=>{
        const a=e.target&&e.target.closest&&e.target.closest('.nav-item[data-page="broadcast"]');
        if(a)setTimeout(()=>{try{if(currentUser)bcEnsureAdminRealtime()}catch(err){}},80);
    },true);
    // pulihkan Mode Host bila halaman di-refresh saat masih jadi host
    try{
        if(localStorage.getItem('musik-pintar-host-open')==='1')
            setTimeout(()=>{try{openHostScreen()}catch(e){}},1200);
    }catch(e){}
})();
