const PANEL = location.pathname.split('/').filter(Boolean)[1] || 'koi'; // koi/dbo/aoi
const PANEL_TITLE = {koi:'Ksatria Panel',dbo:'DragonBoy Panel',aoi:'AOI Panel'}[PANEL] || 'Panel';
const API = location.origin.replace(/\/$/,'');
let token = localStorage.getItem('rawverse_token') || localStorage.getItem('koi_token') || '', me=null, accounts=[], users=[], owner=null, timer;
const $=x=>document.getElementById(x), esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function msg(x){ let t=$('toast'); t.textContent=x; t.classList.add('on'); setTimeout(()=>t.classList.remove('on'),2200) }
async function api(path,opt={}){
  let h={'Content-Type':'application/json',...(opt.headers||{})};
  if(token) h.Authorization='Bearer '+token;
  let r=await fetch(API+path,{...opt,headers:h}), d=null;
  try{ d=await r.json() }catch{}
  if(r.status===401){ logout(false); throw Error('Sesi habis') }
  if(!r.ok) throw Error(d?.detail||d?.msg||'Request gagal');
  return d;
}
function loginPage(){
  $('app').innerHTML=`<div class="login"><div class="box">
    <h1>${esc(PANEL_TITLE)}</h1><p class="muted">Masuk ke panel bot</p>
    <form onsubmit="login(event)">
      <div class="field"><label>Username</label><input id="lu" required autocomplete="username"></div>
      <div class="field"><label>Password</label><input id="lp" type="password" required autocomplete="current-password"></div>
      <button class="primary">LOGIN</button>
      <p id="le" style="color:#c44747;margin-top:8px"></p>
    </form>
    <p class="muted" style="margin-top:12px;font-size:12px">Default: admin / admin123 — ganti setelah login</p>
  </div></div>`;
}
async function login(e){
  e.preventDefault();
  try{
    let r=await fetch(API+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('lu').value,password:$('lp').value})}), d=await r.json();
    if(!r.ok) throw Error(d.detail||'Login gagal');
    token=d.token; localStorage.setItem('rawverse_token',token); boot();
  }catch(x){ $('le').textContent=x.message }
}
function logout(show=true){ token=''; localStorage.removeItem('rawverse_token'); localStorage.removeItem('koi_token'); clearInterval(timer); loginPage(); if(show) msg('Logout') }
async function boot(){
  try{
    me=await api('/api/me');
    await load();
    clearInterval(timer); timer=setInterval(load,5000);
  }catch(x){ logout(false) }
}
async function load(){
  accounts=await api('/api/accounts?panel='+PANEL);
  if(me.is_admin) users=await api('/api/users');
  render();
}
function shown(){
  return me.is_admin ? (owner ? accounts.filter(a=>a.owner_id===owner) : accounts.filter(a=>a.owner_id===me.uid)) : accounts;
}
function uname(id){ return users.find(u=>u.id===id)?.username || (id===me.uid ? me.username : 'User') }
const BOSS_NAME={koi:['Lubu','Small Axe','Tiny Snow','Pocong','Yeti'],dbo:['Boss DBO 1','Boss DBO 2'],aoi:['Boss AOI']}[PANEL]||['Boss 1'];
function render(){
  let a=shown(), run=a.filter(x=>x.status==='running'||x.status==='reconnecting').length;
  let total=a.length;
  $('app').innerHTML=`
  <header class="header">
    <div class="top"><div class="title">${esc(PANEL_TITLE)}</div><button class="menu" onclick="menu()">⋮</button></div>
    <div class="welcome">Selamat datang</div><div class="name">${esc(me.username)}</div>
    <div class="hg"><div><div class="label">Batas akun</div><div class="value">${me.is_admin?'∞':a.length+' / '+me.max_accounts}</div></div>
    <div><div class="label">Status panel</div><div class="value online">● ONLINE</div></div></div>
    <div class="progress"><i style="width:${me.is_admin?100:Math.min(100,a.length/(me.max_accounts||1)*100)}%"></i></div>
  </header>
  <main class="main">
    <div class="stats">
      <div class="stat"><b>${a.length}</b><span>TOTAL</span></div>
      <div class="stat"><b class="g">${run}</b><span>RUNNING</span></div>
      <div class="stat"><b class="b">${a.filter(x=>x.boss_idx!=null).length}</b><span>BOSS</span></div>
    </div>
    <div class="head"><h2>Akun ${owner?esc(uname(owner)):'kamu'}</h2></div>
    <div class="scroll"><div class="list">${a.length ? a.map(card).join('') : '<div class="card" style="text-align:center;color:#7d8493">Belum ada akun. Tekan + untuk tambah.</div>'}</div></div>
  </main>
  <button class="fab" onclick="addAcc()">+</button>`;
}
function card(a){
  let s=a.status||'stopped', bd=s==='running'?'RUNNING':s==='reconnecting'?'RECONNECTING':s==='error'?'ERROR':'STOPPED';
  let boss=BOSS_NAME[a.boss_idx]||BOSS_NAME[0];
  return `<article class="card">
    <div class="ct"><div><div class="cn">${esc(a.label||a.username)}</div><div class="cu">@${esc(a.username)} • ⚔️ ${esc(boss)}</div></div>
    <div class="badge ${s==='stopped'?'stop':s==='error'?'error':s==='reconnecting'?'reconnecting':''}">● ${bd}</div></div>
    <div class="info">📍 ${esc(a.current_map_name||'Desa Serigala')} / ${esc(a.current_area_name||'Area 1')}<br>⏱ ${up(a.uptime||0)}${a.last_error?` • <span style="color:#c44">${esc(a.last_error)}</span>`:''}</div>
    <div class="actions">
      <button onclick="act(${a.id},'start')">START</button>
      <button onclick="act(${a.id},'stop')">STOP</button>
      <button onclick="pickBoss(${a.id})">BOSS</button>
      <button onclick="move(${a.id})">PINDAH</button>
      <button class="red" onclick="del(${a.id})">HAPUS</button>
    </div>
  </article>`;
}
function up(s){ s=+s||0; if(s<60) return s+'d'; let m=Math.floor(s/60),h=Math.floor(m/60); m%=60; return h?h+'j '+m+'m':m+'m' }
async function act(id,x){ try{ let d=await api('/api/accounts/'+id+'/'+x,{method:'POST'}); msg(d.msg||'Berhasil'); load() }catch(e){ msg(e.message) } }
async function del(id){ if(!confirm('Hapus akun ini?')) return; try{ await api('/api/accounts/'+id,{method:'DELETE'}); msg('Dihapus'); load() }catch(e){ msg(e.message) } }
function sheet(s){ let o=document.createElement('div'); o.className='overlay'; o.id='ov'; o.innerHTML='<div class="sheet">'+s+'</div>'; o.onclick=e=>{ if(e.target===o) close() }; document.body.appendChild(o) }
function close(){ document.getElementById('ov')?.remove() }
function menu(){
  if(!me.is_admin){
    sheet(`<h3>Menu</h3>
      <button class="secondary" style="width:100%;margin-bottom:9px" onclick="actAll('start-all')">▶ Start semua</button>
      <button class="secondary" style="width:100%;margin-bottom:9px" onclick="actAll('stop-all')">■ Stop semua</button>
      <button class="danger" style="width:100%" onclick="close();logout()">Logout</button>`);
    return;
  }
  sheet(`<h3>Kelola User</h3><div class="users" id="ul">Memuat...</div>
    <div class="row" style="margin-top:12px"><button class="secondary" onclick="newUser()">+ User</button><button class="danger" onclick="close();logout()">Logout</button></div>`);
  setTimeout(()=>{
    let z=$('ul');
    z.innerHTML=`<div class="user"><div><b>Admin sendiri</b><br><small>${accounts.filter(a=>a.owner_id===me.uid).length} akun</small></div><button onclick="pick('${me.uid}')">Lihat</button></div>`
      + users.filter(u=>u.id!==me.uid).map(u=>`<div class="user"><div><b>${esc(u.username)}${u.is_admin?' • ADMIN':''}</b><br><small>${u.account_count} / ${u.max_accounts??'∞'} akun</small></div><button onclick="pick('${u.id}')">Lihat</button></div>`).join('');
  },0);
}
function pick(id){ owner=id; close(); render(); msg('Menampilkan '+uname(id)) }
async function actAll(x){ try{ await api('/api/accounts/'+x,{method:'POST'}); close(); msg('Berhasil'); load() }catch(e){ msg(e.message) } }
function addAcc(){
  let opts=BOSS_NAME.map((n,i)=>`<option value="${i}">${esc(n)}</option>`).join('');
  sheet(`<h3>Tambah akun</h3>
    <div class="field"><label>Label</label><input id="al" placeholder="Akun 1"></div>
    <div class="field"><label>Username game</label><input id="au" required></div>
    <div class="field"><label>Password game</label><input id="ap" type="password" required></div>
    <div class="field"><label>Boss target</label><select id="ab">${opts}</select></div>
    <div class="row"><button class="secondary" onclick="close()">Batal</button><button class="primary" onclick="saveAcc()">Tambah</button></div>`);
}
async function saveAcc(){
  try{ await api('/api/accounts',{method:'POST',body:JSON.stringify({panel:PANEL,label:$('al').value,username:$('au').value,password:$('ap').value,boss_idx:+$('ab').value})}); close(); msg('Akun ditambah'); load() }catch(e){ msg(e.message) }
}
function newUser(){
  sheet(`<h3>Tambah user</h3>
    <div class="field"><label>Username</label><input id="nu"></div>
    <div class="field"><label>Password min 6</label><input id="np" type="password"></div>
    <div class="field"><label>Batas akun</label><input id="nm" type="number" value="5" min="1" max="1000"></div>
    <div class="row"><button class="secondary" onclick="close()">Batal</button><button class="primary" onclick="saveUser()">Buat</button></div>`);
}
async function saveUser(){ try{ await api('/api/users',{method:'POST',body:JSON.stringify({username:$('nu').value,password:$('np').value,is_admin:false,max_accounts:+$('nm').value})}); close(); msg('User dibuat'); load() }catch(e){ msg(e.message) } }
async function move(id){
  let maps=[]; try{ maps=await api('/api/maps?panel='+PANEL) }catch{}; maps=Array.isArray(maps)?maps:(maps.maps||[]);
  sheet(`<h3>Pindah akun</h3>
    <div class="field"><label>Map</label><select id="mm">${maps.map(m=>`<option value="${m.map_id}">${esc(m.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Area</label><select id="ma">${Array.from({length:40},(_,i)=>`<option value="${i}">Area ${i+1}</option>`).join('')}</select></div>
    <div class="row"><button class="secondary" onclick="close()">Batal</button><button class="primary" onclick="saveMove(${id})">Pindahkan</button></div>`);
}
async function saveMove(id){ try{ await api('/api/accounts/'+id+'/pindah',{method:'POST',body:JSON.stringify({panel:PANEL,map_id:+$('mm').value,area_id:+$('ma').value})}); close(); msg('Dipindahkan'); load() }catch(e){ msg(e.message) } }
function pickBoss(id){
  let opts=BOSS_NAME.map((n,i)=>`<option value="${i}">${esc(n)}</option>`).join('');
  sheet(`<h3>Pilih Boss</h3>
    <div class="field"><label>Boss target</label><select id="bp">${opts}</select></div>
    <div class="row"><button class="secondary" onclick="close()">Batal</button><button class="primary" onclick="saveBoss(${id})">Simpan</button></div>`);
}
async function saveBoss(id){ try{ await api('/api/accounts/'+id+'/boss',{method:'POST',body:JSON.stringify({panel:PANEL,boss_idx:+$('bp').value})}); close(); msg('Boss disimpan'); load() }catch(e){ msg(e.message) } }
loginPage(); if(token) boot();
