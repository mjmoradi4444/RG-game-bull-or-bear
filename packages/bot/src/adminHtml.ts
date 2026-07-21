/**
 * Server-rendered admin dashboard markup (PRD-ADMIN-EMAIL §6.6). Plain HTML +
 * inline CSS + a small vanilla-JS SPA that talks to /admin/api/* — no React, no
 * build step, no second deploy target. All dynamic data is fetched client-side;
 * the only server interpolation is a JSON config island (safely embedded).
 *
 * The client script deliberately avoids template literals so this file needs no
 * `${}` escaping; all client strings use concatenation.
 */

const BRAND_CSS = `
:root{--bg:#101830;--surface:#171F3A;--border:#283154;--text:#fff;--muted:#8A94A6;
--blue:#0A78FF;--gold:#F5C451;--up:#16C784;--down:#EA3943}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
a{color:var(--gold);text-decoration:none}
h1,h2,h3{margin:0 0 .5em}
header{display:flex;align-items:center;gap:16px;padding:12px 20px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:10}
header .brand{font-weight:800}
header .sp{flex:1}
nav{display:flex;gap:4px;padding:0 12px;background:var(--surface);border-bottom:1px solid var(--border);flex-wrap:wrap}
nav button{background:none;border:none;color:var(--muted);padding:12px 14px;cursor:pointer;font:inherit;border-bottom:2px solid transparent}
nav button.active{color:var(--text);border-bottom-color:var(--gold)}
main{padding:20px;max-width:1200px;margin:0 auto}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.tile{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px}
.tile .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.tile .v{font-size:26px;font-weight:800;margin-top:4px}
.tile .s{color:var(--muted);font-size:12px;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);font-size:13px;white-space:nowrap}
th{color:var(--muted);font-weight:600;cursor:pointer;user-select:none}
tr.clickable{cursor:pointer}
tr.clickable:hover td{background:rgba(255,255,255,.03)}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600}
.pill.gold{background:rgba(245,196,81,.15);color:var(--gold)}
.pill.red{background:rgba(234,57,67,.15);color:var(--down)}
.pill.green{background:rgba(22,199,132,.15);color:var(--up)}
.pill.muted{background:rgba(138,148,166,.15);color:var(--muted)}
input,select,textarea,button.btn{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px}
button.btn{cursor:pointer}
button.btn.primary{background:linear-gradient(90deg,var(--blue),#2A4BFF);border:none}
button.btn.gold{background:linear-gradient(180deg,#FFE08A,var(--gold));color:#101830;border:none;font-weight:700}
button.btn.danger{border-color:var(--down);color:var(--down)}
button.btn:disabled{opacity:.4;cursor:not-allowed}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.toolbar input{min-width:220px}
.copy{cursor:pointer;color:var(--muted);margin-left:6px}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,92vw);background:var(--surface);border-left:1px solid var(--border);box-shadow:-8px 0 40px rgba(0,0,0,.5);overflow:auto;padding:20px;z-index:20;transform:translateX(100%);transition:transform .18s}
.drawer.open{transform:none}
.drawer .close{float:right;cursor:pointer;color:var(--muted)}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
.card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;margin:8px 0}
.rank1{color:var(--gold)}.rank2{color:#C7CEDA}.rank3{color:#CD8B5A}
.muted{color:var(--muted)}
.right{text-align:right}
label{display:block;font-size:12px;color:var(--muted);margin:8px 0 2px}
form.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.banner{background:rgba(245,196,81,.1);border:1px solid rgba(245,196,81,.4);border-radius:8px;padding:10px 12px;margin:8px 0;color:var(--gold)}
.err{color:var(--down)}
.login-wrap{max-width:340px;margin:12vh auto;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:14px}
.login-wrap input{width:100%;margin-bottom:10px}
.login-wrap button{width:100%}
`;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Safe JSON for embedding in a <script> (prevents </script> breakout). */
const safeJson = (v: unknown): string =>
  JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

export function loginPage(error?: string): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Bull or Bear — Admin</title><style>' + BRAND_CSS + '</style></head><body>' +
    '<div class="login-wrap"><h2>Admin sign-in</h2>' +
    (error ? '<p class="err">' + esc(error) + '</p>' : '') +
    '<form method="POST" action="/admin/login">' +
    '<label>Username</label><input name="username" autocomplete="username" autofocus>' +
    '<label>Password</label><input name="password" type="password" autocomplete="current-password">' +
    '<button class="btn primary" type="submit">Sign in</button></form></div></body></html>'
  );
}

export interface DashConfig {
  admin: string;
  activeSeason: string;
  prevSeason: string;
  backofficeUrl: string;
}

export function dashboardPage(cfg: DashConfig): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Bull or Bear — Admin</title><style>' + BRAND_CSS + '</style></head><body>' +
    '<header><span class="brand">Bull or Bear · Admin</span><span class="sp"></span>' +
    '<span class="muted">' + esc(cfg.admin) + '</span>' +
    '<form method="POST" action="/admin/logout" style="display:inline"><button class="btn" type="submit">Log out</button></form>' +
    '</header>' +
    '<nav id="nav">' +
    '<button data-view="overview" class="active">Overview</button>' +
    '<button data-view="players">Players</button>' +
    '<button data-view="season">Season</button>' +
    '<button data-view="prizes">Prizes</button>' +
    '<button data-view="tasks">Tasks</button>' +
    '<button data-view="flags">Flags</button>' +
    '<button data-view="audit">Audit</button></nav>' +
    '<main id="main"></main><div class="drawer" id="drawer"></div>' +
    '<script>window.__CFG=' + safeJson(cfg) + ';</script>' +
    '<script>' + DASH_JS + '</script></body></html>'
  );
}

// --- client SPA (no template literals; concatenation only) -------------------
const DASH_JS = String.raw`
(function(){
var CFG=window.__CFG||{};
var main=document.getElementById('main');
var drawer=document.getElementById('drawer');
var nav=document.getElementById('nav');
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function h(html){var d=document.createElement('div');d.innerHTML=html;return d;}
function api(path,opts){return fetch('/admin/api'+path,Object.assign({credentials:'same-origin',headers:{'Content-Type':'application/json'}},opts||{})).then(function(r){if(r.status===401){location.href='/admin/login';throw new Error('unauth');}return r.json();});}
function fmtTs(t){if(!t)return '—';var d=new Date(t);return d.toISOString().slice(0,16).replace('T',' ');}
function ago(t){if(!t)return '—';var s=(Date.now()-t)/1000;if(s<60)return Math.floor(s)+'s';if(s<3600)return Math.floor(s/60)+'m';if(s<86400)return Math.floor(s/3600)+'h';return Math.floor(s/86400)+'d';}
function copyBtn(v){return '<span class="copy" data-copy="'+esc(v)+'" title="Copy">⧉</span>';}
document.addEventListener('click',function(e){var c=e.target.getAttribute&&e.target.getAttribute('data-copy');if(c){navigator.clipboard&&navigator.clipboard.writeText(c);e.target.textContent='✓';setTimeout(function(){e.target.textContent='⧉';},900);}});

var VIEWS={};
function show(name){[].forEach.call(nav.children,function(b){b.classList.toggle('active',b.getAttribute('data-view')===name);});(VIEWS[name]||VIEWS.overview)();location.hash=name;}
[].forEach.call(nav.children,function(b){b.onclick=function(){show(b.getAttribute('data-view'));};});

// ---- Overview ----
VIEWS.overview=function(){main.innerHTML='<h2>Overview</h2><div class="tiles" id="tiles">Loading…</div>';
api('/overview').then(function(o){
var t=[
['Active players',o.activePlayers,''],
['Tokens spent today',o.tokensSpent+' / '+o.tokensGranted,'utilization '+(o.tokensGranted?Math.round(o.tokensSpent/o.tokensGranted*100):0)+'%'],
['Matches today',o.matchesToday,o.rankedToday+' ranked · '+o.practiceToday+' practice · '+o.aiFillToday+' AI'],
['Email capture',o.emailCaptureRate+'%','of active players'],
['Open flags',o.openFlags,''],
['Season',o.season.id,'ends '+fmtTs(o.season.endsAt)]
];
document.getElementById('tiles').innerHTML=t.map(function(x){return '<div class="tile"><div class="k">'+esc(x[0])+'</div><div class="v">'+esc(x[1])+'</div><div class="s">'+esc(x[2])+'</div></div>';}).join('');
});};

// ---- Players ----
var pState={q:'',filter:'',sort:'rp',page:1};
VIEWS.players=function(){main.innerHTML=
'<h2>Players</h2><div class="toolbar">'+
'<input id="pq" placeholder="Search name / Telegram ID / email" value="'+esc(pState.q)+'">'+
'<select id="pf"><option value="">All</option><option value="has_email">Has email</option><option value="no_email">No email</option><option value="duplicate">Duplicate email</option><option value="flagged">Flagged</option><option value="eligible">Eligible (20+)</option><option value="top50">Top 50</option></select>'+
'</div><div id="ptable">Loading…</div>';
document.getElementById('pf').value=pState.filter;
var qi=document.getElementById('pq');var to;qi.oninput=function(){clearTimeout(to);to=setTimeout(function(){pState.q=qi.value;pState.page=1;loadP();},300);};
document.getElementById('pf').onchange=function(e){pState.filter=e.target.value;pState.page=1;loadP();};
loadP();};
function loadP(){var el=document.getElementById('ptable');if(!el)return;el.textContent='Loading…';
api('/players?q='+encodeURIComponent(pState.q)+'&filter='+pState.filter+'&sort='+pState.sort+'&page='+pState.page).then(function(d){
var cols=[['rank','#'],['name','Name'],['u','TG ID'],['email','Email'],['emailStatus','Status'],['rp','RP'],['matches','M'],['wins','W'],['accuracy','Acc%'],['streakDays','Streak'],['tokensSpent','Tok'],['lastSeen','Seen'],['flags','Flags']];
var thead=cols.map(function(c){return '<th data-sort="'+c[0]+'">'+c[1]+'</th>';}).join('');
var rows=d.rows.map(function(r){
var status=r.emailStatus==='provided'?'<span class="pill green">ok</span>':r.emailStatus==='duplicate'?'<span class="pill red">dup</span>':r.emailStatus==='frozen'?'<span class="pill gold">frozen</span>':'<span class="pill muted">none</span>';
var fl=r.flags.map(function(f){return '<span class="pill red">'+esc(f)+'</span>';}).join(' ');
return '<tr class="clickable" data-u="'+r.u+'"><td>'+(r.rank||'—')+'</td><td>'+esc(r.name)+(r.banned?' <span class="pill red">ban</span>':'')+'</td><td class="mono">'+r.u+copyBtn(String(r.u))+'</td><td>'+(r.email?esc(r.email)+copyBtn(r.email):'<span class="muted">—</span>')+'</td><td>'+status+'</td><td class="right">'+r.rp.toLocaleString()+'</td><td>'+r.matches+'</td><td>'+r.wins+'</td><td>'+r.accuracy+'</td><td>'+r.streakDays+'</td><td>'+r.tokensSpent+'</td><td class="muted">'+ago(r.lastSeen)+'</td><td>'+fl+'</td></tr>';
}).join('');
el.innerHTML='<table><thead><tr>'+thead+'</tr></thead><tbody>'+rows+'</tbody></table>'+
'<div class="toolbar" style="margin-top:10px"><button class="btn" id="pprev" '+(d.page<=1?'disabled':'')+'>Prev</button><span class="muted">Page '+d.page+' / '+d.pages+' · '+d.total+' players</span><button class="btn" id="pnext" '+(d.page>=d.pages?'disabled':'')+'>Next</button></div>';
[].forEach.call(el.querySelectorAll('th'),function(th){th.onclick=function(){var s=th.getAttribute('data-sort');pState.sort=(pState.sort===s?'-'+s:s);loadP();};});
[].forEach.call(el.querySelectorAll('tr.clickable'),function(tr){tr.onclick=function(e){if(e.target.getAttribute('data-copy'))return;openPlayer(tr.getAttribute('data-u'));};});
var pv=document.getElementById('pprev'),nx=document.getElementById('pnext');if(pv)pv.onclick=function(){pState.page--;loadP();};if(nx)nx.onclick=function(){pState.page++;loadP();};
});}
function openPlayer(u){api('/players/'+u).then(function(p){
var eh=p.emailHistory.map(function(e){return '<div class="card"><span class="mono">'+esc(e.email)+'</span> <span class="muted">'+fmtTs(e.setAt)+' · '+e.source+'</span></div>';}).join('')||'<span class="muted">none</span>';
var mh=p.matchHistory.slice(0,40).map(function(m){return '<tr><td class="muted">'+fmtTs(m.ts)+'</td><td>'+esc(m.level)+'</td><td>'+esc(m.mode)+'</td><td>'+m.correctBase+'</td><td>'+m.rp+'</td><td class="muted">'+(m.avgMs||0)+'ms</td></tr>';}).join('');
var fl=p.allFlags.map(function(f){return '<div class="card"><span class="pill '+(f.state==='open'?'red':'muted')+'">'+esc(f.kind)+'</span> '+esc(f.evidence)+' <span class="muted">'+f.state+'</span></div>';}).join('')||'<span class="muted">none</span>';
drawer.innerHTML='<span class="close" id="dclose">✕ close</span><h2>'+esc(p.name)+'</h2>'+
'<p class="mono">TG '+p.u+copyBtn(String(p.u))+'</p>'+
'<div class="card"><b>Email:</b> '+(p.email?esc(p.email)+copyBtn(p.email):'<span class="muted">none</span>')+' <span class="pill muted">'+esc(p.emailStatus)+'</span><br>'+
'<b>Account ref:</b> <span class="mono">'+esc(p.rgAccountRef||'—')+'</span></div>'+
'<div class="tiles"><div class="tile"><div class="k">RP</div><div class="v">'+p.rp.toLocaleString()+'</div><div class="s">rank '+(p.rank||'—')+'</div></div>'+
'<div class="tile"><div class="k">Matches</div><div class="v">'+p.matches+'</div><div class="s">'+p.wins+' wins · '+p.accuracy+'% acc</div></div></div>'+
'<h3>Operator note</h3><textarea id="dnote" style="width:100%" rows="2">'+esc(p.note||'')+'</textarea><button class="btn" id="dnotesave">Save note</button> <button class="btn" id="dref">Set account ref</button> '+(p.banned?'':'<button class="btn danger" id="dban">Ban</button>')+
'<h3>Flags</h3>'+fl+
'<h3>Email history</h3>'+eh+
'<h3>Recent matches</h3><table><thead><tr><th>When</th><th>Lvl</th><th>Mode</th><th>✓</th><th>RP</th><th>Avg</th></tr></thead><tbody>'+mh+'</tbody></table>';
drawer.classList.add('open');
document.getElementById('dclose').onclick=function(){drawer.classList.remove('open');};
document.getElementById('dnotesave').onclick=function(){api('/players/'+u+'/note',{method:'POST',body:JSON.stringify({note:document.getElementById('dnote').value})}).then(function(){document.getElementById('dnotesave').textContent='Saved ✓';});};
document.getElementById('dref').onclick=function(){var ref=prompt('Back-office account reference for this player:');if(ref)api('/players/'+u+'/account-ref',{method:'POST',body:JSON.stringify({ref:ref})}).then(function(){openPlayer(u);});};
var db=document.getElementById('dban');if(db)db.onclick=function(){var r=prompt('Reason for ban:');if(r)api('/players/'+u+'/ban',{method:'POST',body:JSON.stringify({reason:r})}).then(function(){openPlayer(u);loadP();});};
});}

// ---- Season ----
VIEWS.season=function(){main.innerHTML='<h2>Season &amp; standings</h2><div id="sbody">Loading…</div>';
api('/season/'+CFG.activeSeason+'/standings').then(function(d){
var noEmailTop=d.rows.slice(0,10).filter(function(r){return !r.hasEmail;}).length;
var banner=noEmailTop>0?'<div class="banner">⚠️ '+noEmailTop+' of the current top 10 have no email on file. <button class="btn" id="remind">Send email reminder</button></div>':'';
var rows=d.rows.slice(0,100).map(function(r){var rc=r.rank<=3?'rank'+r.rank:'';return '<tr class="clickable" data-u="'+r.u+'"><td class="'+rc+'">'+r.rank+'</td><td>'+esc(r.name)+'</td><td class="right">'+r.rp.toLocaleString()+'</td><td>'+r.matches+'</td><td>'+r.accuracy+'%</td><td>'+(r.hasEmail?'<span class="pill green">✓</span>':'<span class="pill muted">—</span>')+'</td><td>'+(r.eligible?'<span class="pill green">yes</span>':'<span class="pill muted">no</span>')+'</td><td>'+r.flags.map(function(f){return '<span class="pill red">'+esc(f)+'</span>';}).join(' ')+'</td></tr>';}).join('');
document.getElementById('sbody').innerHTML='<p class="muted">Season '+esc(d.season)+' · '+d.status+'</p>'+banner+'<table><thead><tr><th>#</th><th>Name</th><th class="right">RP</th><th>M</th><th>Acc</th><th>Email</th><th>Eligible</th><th>Flags</th></tr></thead><tbody>'+rows+'</tbody></table>';
var rb=document.getElementById('remind');if(rb)rb.onclick=function(){api('/prizes/'+CFG.prevSeason+'/remind',{method:'POST',body:'{}'}).then(function(x){rb.textContent='Sent to '+((x.notified)||0);});};
[].forEach.call(document.querySelectorAll('#sbody tr.clickable'),function(tr){tr.onclick=function(){openPlayer(tr.getAttribute('data-u'));};});
});};

// ---- Prizes ----
VIEWS.prizes=function(){main.innerHTML='<h2>Prize workflow</h2><p class="muted">Previous season: '+esc(CFG.prevSeason)+'</p><div class="toolbar"><a class="btn" href="/admin/api/export/winners.csv?season='+encodeURIComponent(CFG.prevSeason)+'">Export CSV</a><button class="btn" id="premind">Email reminder to winners</button></div><div id="pwbody">Loading…</div>';
document.getElementById('premind').onclick=function(){api('/prizes/'+CFG.prevSeason+'/remind',{method:'POST',body:'{}'}).then(function(x){document.getElementById('premind').textContent='Sent '+((x.notified)||0);});};
loadPW();};
function loadPW(){api('/prizes/'+CFG.prevSeason).then(function(d){var b=document.getElementById('pwbody');if(!b)return;
if(!d.rows.length){b.innerHTML='<p class="muted">No prizes for this season (no closed season yet, or no eligible winners).</p>';return;}
var medal=['🥇','🥈','🥉'];
b.innerHTML=d.rows.map(function(p,i){
var checks='<span class="pill '+(p.matches>=20?'green':'muted')+'">20-match '+(p.matches>=20?'✓':'✗')+'</span> <span class="pill '+(p.email?'green':'red')+'">email '+(p.email?'✓':'✗')+'</span> <span class="pill '+(p.flags.length?'red':'green')+'">'+(p.flags.length?'flagged':'clean')+'</span>';
var actions=p.state==='applied'?'<span class="pill green">applied '+p.shareApplied+'%</span>':p.state==='expired'?'<span class="pill muted">rolled down</span>':
'<button class="btn gold" data-apply="'+p.rank+'" '+(p.email?'':'disabled')+'>Mark applied</button> <button class="btn danger" data-roll="'+p.rank+'">Roll down</button>';
var bo=CFG.backofficeUrl&&p.email?'<a class="btn" target="_blank" href="'+esc(CFG.backofficeUrl.replace(/\/$/,'')+'/search?email='+encodeURIComponent(p.email))+'">Open back office ↗</a> ':'';
return '<div class="card"><h3>'+(medal[i]||'')+' Rank '+p.rank+' · '+esc(p.name)+' <span class="muted">'+p.sharePct+'% share</span></h3>'+
'<p class="mono">TG '+p.u+copyBtn(String(p.u))+' · '+(p.email?esc(p.email)+copyBtn(p.email):'<span class="err">no email</span>')+'</p>'+
'<p>'+p.matches+' matches · '+p.accuracy+'% acc · claim by '+fmtTs(p.claimDeadline)+'</p>'+
'<p>'+checks+'</p><p>'+bo+actions+'</p></div>';
}).join('');
[].forEach.call(b.querySelectorAll('[data-apply]'),function(bt){bt.onclick=function(){applyPrize(bt.getAttribute('data-apply'));};});
[].forEach.call(b.querySelectorAll('[data-roll]'),function(bt){bt.onclick=function(){var r=prompt('Reason for rolling this prize down:');if(r)api('/prizes/'+CFG.prevSeason+'/'+bt.getAttribute('data-roll')+'/rolldown',{method:'POST',body:JSON.stringify({reason:r})}).then(loadPW);};});
});}
function applyPrize(rank){var share=prompt('Rebate share % actually applied:', '');if(share===null)return;
var ref=prompt('Back-office reference (optional):','')||'';
var note=prompt('Note (optional):','')||'';
var from=Date.now();var until=from+30*86400000;
api('/prizes/'+CFG.prevSeason+'/'+rank+'/apply',{method:'POST',body:JSON.stringify({share:Number(share),effectiveFrom:from,effectiveUntil:until,backofficeRef:ref,note:note})}).then(function(x){if(x.ok)loadPW();else alert('Failed: '+(x.error||'?'));});}

// ---- Tasks (catalog CRUD + funnel) ----
VIEWS.tasks=function(){main.innerHTML='<h2>Tasks</h2><p class="muted">Edit rewards/URLs/active without redeploy. Rewards are clamped server-side (≤200 RP / ≤2 tokens).</p><div id="tkbody">Loading…</div>';loadTK();};
function loadTK(){api('/tasks').then(function(d){var b=document.getElementById('tkbody');if(!b)return;
var rows=d.tasks.map(function(t){
return '<tr data-id="'+t.id+'"><td>'+esc(t.id)+'</td><td><input data-f="title" value="'+esc(t.title)+'" style="width:200px"></td><td class="muted">'+esc(t.cadence)+'/'+esc(t.kind)+'<br><span class="pill muted">'+esc(t.verifyMethod)+'</span></td>'+
'<td><input data-f="rewardAmount" type="number" value="'+t.rewardAmount+'" style="width:70px"> '+esc(t.rewardType)+'</td>'+
'<td><input data-f="'+(t.channel!==undefined&&t.verifyMethod==="tg_member"?"channel":"url")+'" value="'+esc(t.channel||t.url||"")+'" placeholder="'+(t.verifyMethod==="tg_member"?"@channel":t.verifyMethod==="click_claim"?"https://…":"")+'" style="width:160px"></td>'+
'<td><input data-f="active" type="checkbox" '+(t.active?"checked":"")+'></td>'+
'<td class="muted">'+t.completed+' done · '+t.claimed+' claimed</td>'+
'<td><button class="btn" data-save="'+t.id+'">Save</button></td></tr>';
}).join('');
b.innerHTML='<table><thead><tr><th>ID</th><th>Title</th><th>Type</th><th>Reward</th><th>URL / channel</th><th>Active</th><th>Funnel</th><th></th></tr></thead><tbody>'+rows+'</tbody></table>';
[].forEach.call(b.querySelectorAll('[data-save]'),function(bt){bt.onclick=function(){
var tr=bt.closest('tr');var patch={};
[].forEach.call(tr.querySelectorAll('[data-f]'),function(inp){var f=inp.getAttribute('data-f');patch[f]=inp.type==='checkbox'?inp.checked:inp.value;});
api('/tasks/'+bt.getAttribute('data-save'),{method:'POST',body:JSON.stringify(patch)}).then(function(){bt.textContent='Saved ✓';setTimeout(loadTK,600);});
};});
});}

// ---- Flags ----
VIEWS.flags=function(){main.innerHTML='<h2>Anomalies &amp; review</h2><div class="toolbar"><button class="btn" id="reval">Re-evaluate now</button></div><div id="fbody">Loading…</div>';
document.getElementById('reval').onclick=function(){api('/flags/evaluate',{method:'POST',body:'{}'}).then(loadF);};
loadF();};
function loadF(){api('/flags').then(function(d){var b=document.getElementById('fbody');if(!b)return;
if(!d.flags.length){b.innerHTML='<p class="muted">No open flags. 🎉</p>';return;}
b.innerHTML=d.flags.map(function(f){return '<div class="card"><span class="pill red">'+esc(f.kind)+'</span> <b>'+esc(f.name||('TG '+f.u))+'</b> <span class="muted">'+esc(f.evidence)+' · '+fmtTs(f.createdAt)+'</span><br>'+
'<button class="btn" data-clear="'+f.id+'">Clear</button> <button class="btn" data-exc="'+f.id+'">Exclude from prizes</button> <button class="btn danger" data-ban="'+f.id+'">Ban</button> <button class="btn" data-u="'+f.u+'">View player</button></div>';}).join('');
[].forEach.call(b.querySelectorAll('[data-clear]'),function(x){x.onclick=function(){resolve(x.getAttribute('data-clear'),'clear');};});
[].forEach.call(b.querySelectorAll('[data-exc]'),function(x){x.onclick=function(){resolve(x.getAttribute('data-exc'),'exclude');};});
[].forEach.call(b.querySelectorAll('[data-ban]'),function(x){x.onclick=function(){resolve(x.getAttribute('data-ban'),'ban');};});
[].forEach.call(b.querySelectorAll('[data-u]'),function(x){x.onclick=function(){openPlayer(x.getAttribute('data-u'));};});
});}
function resolve(id,action){var note=prompt(action+' — note (required):');if(!note)return;api('/flags/'+id+'/resolve',{method:'POST',body:JSON.stringify({action:action,note:note})}).then(loadF);}

// ---- Audit ----
VIEWS.audit=function(){main.innerHTML='<h2>Audit log</h2><div id="abody">Loading…</div>';
api('/audit').then(function(d){var rows=d.entries.map(function(e){return '<tr><td class="muted">'+fmtTs(e.ts)+'</td><td>'+esc(e.actor)+'</td><td>'+esc(e.action)+'</td><td class="mono">'+esc(e.targetType)+':'+esc(e.targetId)+'</td><td class="muted">'+esc(e.note||'')+'</td></tr>';}).join('');
document.getElementById('abody').innerHTML='<table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Note</th></tr></thead><tbody>'+rows+'</tbody></table>';
});};

show((location.hash||'#overview').slice(1));
})();
`;
