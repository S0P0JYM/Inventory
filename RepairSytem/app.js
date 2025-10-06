/**
 * Vehicle Repair System - Frontend only (LocalStorage)
 * Works on Zebra TC touch computers with DataWedge (keystroke output).
 * NFC login via Web NFC on Chrome for Android (HTTPS context recommended).
 */

const DB = {
  seed() {
    if (!localStorage.getItem('vrs_users')) {
      const admin = {
        id: crypto.randomUUID(),
        name: 'Administrator',
        role: 'admin',
        pin: '1234', // CHANGE THIS
        nfcId: null  // set during enroll
      };
      localStorage.setItem('vrs_users', JSON.stringify([admin]));
    }
    if (!localStorage.getItem('vrs_repairs')) {
      localStorage.setItem('vrs_repairs', JSON.stringify([]));
    }
  },
  users() { return JSON.parse(localStorage.getItem('vrs_users') || '[]'); },
  saveUsers(arr){ localStorage.setItem('vrs_users', JSON.stringify(arr)); },
  repairs() { return JSON.parse(localStorage.getItem('vrs_repairs') || '[]'); },
  saveRepairs(arr){ localStorage.setItem('vrs_repairs', JSON.stringify(arr)); },
  sessionSet(u) { sessionStorage.setItem('vrs_session', JSON.stringify(u)); },
  sessionGet() { return JSON.parse(sessionStorage.getItem('vrs_session') || 'null'); },
  sessionClear(){ sessionStorage.removeItem('vrs_session'); }
};

function toast(msg, ms=2200){
  const t = document.createElement('div');
  t.className='toast'; t.textContent=msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), ms);
}

// ---------- Auth ----------
async function loginWithNFC() {
  if (!('NDEFReader' in window)) {
    throw new Error('Web NFC not supported on this device/browser.');
  }
  const reader = new NDEFReader();
  await reader.scan();
  return await new Promise((resolve, reject)=>{
    const timeout = setTimeout(()=>{
      reader.onreading = null;
      reject(new Error('NFC read timed out.'));
    }, 15000);
    reader.onreading = (event)=>{
      clearTimeout(timeout);
      try{
        let nfcId = null;
        for (const record of event.message.records) {
          if (record.recordType === 'text') {
            const text = new TextDecoder(record.encoding || 'utf-8').decode(record.data);
            const kv = text.split('=');
            if (kv.length === 2 && kv[0].trim().toLowerCase() === 'userid') {
              nfcId = kv[1].trim();
            }
          }
        }
        resolve(nfcId);
      }catch(e){ reject(e); }
    };
    reader.onerror = (e)=>{ clearTimeout(timeout); reject(e.error || e); };
  });
}

async function writeNFCUserId(userId) {
  if (!('NDEFReader' in window)) throw new Error('Web NFC not supported.');
  const writer = new NDEFReader();
  await writer.write({records:[{recordType:'text', data:`userid=${userId}`}]});
}

function loginByPin(pin){
  const u = DB.users().find(u=>u.pin === pin);
  if (!u) throw new Error('Invalid PIN');
  DB.sessionSet(u);
  return u;
}

function logout(){
  DB.sessionClear();
  location.href = 'NFCLogin.html';
}

// ---------- VIN Helpers ----------
const VIN = {
  sanitize(s){ return (s||'').toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/[IOQ]/g,''); },
  isComplete(s){ return VIN.sanitize(s).length === 17; }
};

// Capture DataWedge keystroke output into a field
function attachDataWedgeTo(inputEl, opts={}){
  // Assumes DW is configured to send ENTER at end of scan
  inputEl.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter') {
      e.preventDefault();
      inputEl.dispatchEvent(new CustomEvent('scancomplete'));
    }
  });
  inputEl.addEventListener('input',()=>{
    if (opts.autocomplete && VIN.isComplete(inputEl.value)) {
      inputEl.dispatchEvent(new CustomEvent('scancomplete'));
    }
  });
}

// ---------- UI Helpers ----------
function requireAuth(){
  const u = DB.sessionGet();
  if (!u) location.href = 'NFCLogin.html';
  return u;
}

function ensureAdmin(u){
  if (u.role !== 'admin') {
    toast('Admin only area'); location.href='Dashboard.html';
  }
}

// ---------- Repairs ----------
function addRepair(data){
  const arr = DB.repairs();
  const rec = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: 'Received',
    ...data
  };
  arr.unshift(rec); DB.saveRepairs(arr);
  return rec;
}

function updateRepair(id, patch){
  const arr = DB.repairs();
  const i = arr.findIndex(r=>r.id===id);
  if (i>=0){ arr[i] = {...arr[i], ...patch}; DB.saveRepairs(arr); }
}

function filterRepairs(query){
  const q = (query||'').trim().toUpperCase();
  return DB.repairs().filter(r=>!q || r.vin.includes(q) || (r.customer||'').toUpperCase().includes(q));
}

// ---------- Users ----------
function addUser({name, role, pin}){
  const arr = DB.users();
  const u = { id: crypto.randomUUID(), name, role, pin: pin||'', nfcId:null };
  arr.push(u); DB.saveUsers(arr); return u;
}
function setUserNFC(id, nfcId){
  const arr = DB.users();
  const i = arr.findIndex(u=>u.id===id);
  if (i>=0){ arr[i].nfcId = nfcId; DB.saveUsers(arr); }
}
function removeUser(id){
  DB.saveUsers(DB.users().filter(u=>u.id!==id));
}

// ---------- Page Bootstraps ----------
function mountLogin(){
  DB.seed();
  const pinForm = document.getElementById('pinForm');
  const pinInput = document.getElementById('pin');
  const nfcBtn = document.getElementById('nfcBtn');
  const simulateInput = document.getElementById('simulateNFC');

  pinForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    try{
      const user = loginByPin(pinInput.value.trim());
      toast(`Welcome ${user.name}`);
      location.href='Dashboard.html';
    }catch(err){ toast(err.message || 'Login failed'); }
  });

  nfcBtn.addEventListener('click', async ()=>{
    try{
      toast('Tap your NFC badge...');
      const nfcId = await loginWithNFC();
      if (!nfcId) throw new Error('Badge has no userid');
      const user = DB.users().find(u=>u.id === nfcId || u.nfcId === nfcId);
      if (!user) throw new Error('No user linked to this badge');
      DB.sessionSet(user);
      toast(`Welcome ${user.name}`);
      setTimeout(()=>location.href='Dashboard.html', 400);
    }catch(err){ toast(err.message || 'NFC login failed'); }
  });

  document.getElementById('simulateBtn').addEventListener('click', ()=>{
    const nfcId = simulateInput.value.trim();
    const user = DB.users().find(u=>u.id===nfcId || u.nfcId===nfcId);
    if (!user) { toast('No user found for that ID'); return; }
    DB.sessionSet(user); location.href='Dashboard.html';
  });
}

function mountDashboard(){
  const me = requireAuth();
  document.getElementById('whoami').textContent = me.name + ' ('+me.role+')';
  if (me.role !== 'admin') document.getElementById('adminLink').classList.add('hidden');

  const vin = document.getElementById('vin');
  const form = document.getElementById('repairForm');
  const list = document.getElementById('list');
  const search = document.getElementById('search');

  attachDataWedgeTo(vin, {autocomplete:true});

  vin.addEventListener('scancomplete', ()=>{
    vin.value = VIN.sanitize(vin.value);
    if (!VIN.isComplete(vin.value)) {
      toast('VIN must be 17 chars (I,O,Q not allowed)'); return;
    }
    toast('VIN scanned');
  });

  form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const data = {
      vin: VIN.sanitize(vin.value),
      customer: document.getElementById('customer').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      notes: document.getElementById('notes').value.trim()
    };
    if (!VIN.isComplete(data.vin)) return toast('VIN must be 17 characters');
    const rec = addRepair(data);
    form.reset(); vin.focus();
    render(filterRepairs(search.value));
    toast('Repair ticket created');
  });

  search.addEventListener('input', ()=> render(filterRepairs(search.value)));

  function render(rows){
    list.innerHTML = rows.map(r=>`<tr>
      <td><span class="kbd">${r.vin}</span></td>
      <td>${r.customer||''}</td>
      <td>${new Date(r.createdAt).toLocaleString()}</td>
      <td><span class="badge">${r.status}</span></td>
      <td class="right">
        <button data-id="${r.id}" class="small">Start</button>
        <button data-id="${r.id}" data-s="In Progress" class="small">In Progress</button>
        <button data-id="${r.id}" data-s="Ready" class="small success">Ready</button>
        <button data-id="${r.id}" data-s="Delivered" class="small warn">Delivered</button>
      </td>
    </tr>`).join('');
    list.querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', ()=>{
        updateRepair(b.dataset.id, {status: b.dataset.s || 'Started'});
        render(filterRepairs(search.value));
      });
    });
  }
  render(DB.repairs());
}

function mountAdmin(){
  const me = requireAuth(); ensureAdmin(me);
  const table = document.getElementById('users');
  const nameIn = document.getElementById('name');
  const roleIn = document.getElementById('role');
  const pinIn = document.getElementById('upin');
  const addBtn = document.getElementById('addUser');
  const enrollBtns = new Map();

  function render(){
    const users = DB.users();
    table.innerHTML = users.map(u=>`<tr>
      <td>${u.name}</td>
      <td>${u.role}</td>
      <td><span class="kbd">${u.pin||''}</span></td>
      <td><span class="kbd">${u.nfcId ? (u.nfcId.slice(0,8)+'…') : '—'}</span></td>
      <td class="right">
        <button class="enroll" data-id="${u.id}">Enroll NFC</button>
        <button class="del danger" data-id="${u.id}">Remove</button>
      </td>
    </tr>`).join('');
    table.querySelectorAll('.del').forEach(b=> b.addEventListener('click', ()=>{
      if (confirm('Remove user?')){ removeUser(b.dataset.id); render(); }
    }));
    table.querySelectorAll('.enroll').forEach(b=> b.addEventListener('click', async ()=>{
      try{
        const uid = b.dataset.id;
        toast('Hold badge to phone…');
        await writeNFCUserId(uid);
        setUserNFC(uid, uid);
        toast('Badge enrolled');
        render();
      }catch(err){ toast(err.message || 'Enroll failed'); }
    }));
  }

  addBtn.addEventListener('click', ()=>{
    const name = nameIn.value.trim();
    const role = roleIn.value;
    const pin = pinIn.value.trim();
    if (!name || !pin) return toast('Name and PIN required');
    addUser({name, role, pin});
    nameIn.value = ''; pinIn.value='';
    render();
  });

  render();
}

// ---------- Boot by page ----------
document.addEventListener('DOMContentLoaded', ()=>{
  const page = document.body.dataset.page;
  if (page === 'login') mountLogin();
  if (page === 'dashboard') mountDashboard();
  if (page === 'admin') mountAdmin();
});

// ---------- DataWedge Profile Hints (README also) ----------
window.DATAWEDGE_TIPS = `
Create a DataWedge profile:
- Associated app(s): Chrome (com.android.chrome) or your WebView wrapper.
- Input: Barcode
- Output: Keystroke, send ENTER suffix.
- Keystroke options: Focus the VIN input field.
- For NFC login, use Web NFC (Chrome on Android). If unavailable, use PIN fallback.
`;
