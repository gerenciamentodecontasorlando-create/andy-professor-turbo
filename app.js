/* ANDY — app.js
   Offline-first PWA com IndexedDB + PDFs (jsPDF opcional; fallback impressão).
*/
const $ = (id) => document.getElementById(id);

const CRITERIOS = [
  { key: "assiduidade", label: "Assiduidade" },
  { key: "conhecimento", label: "Conhecimento prévio" },
  { key: "postura", label: "Postura" },
  { key: "proatividade", label: "Proatividade" },
  { key: "socializacao", label: "Socialização" },
  { key: "expressividade", label: "Expressividade" },
];

const DB_NAME = "andy_db";
const DB_VERSION = 1;
const STORE_SETTINGS = "settings";
const STORE_STUDENTS = "students";
const STORE_RECORDS = "records"; // per student per date
const STORE_CASES = "cases";     // per date/group

let db;
let state = {
  selectedStudentId: null,
  students: [],
  settings: {},
  currentRecord: null,
  caseOfDay: null,
};

function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset()*60000;
  return new Date(d - tz).toISOString().slice(0,10);
}
function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE_SETTINGS)) d.createObjectStore(STORE_SETTINGS, { keyPath: "id" });
      if (!d.objectStoreNames.contains(STORE_STUDENTS)) d.createObjectStore(STORE_STUDENTS, { keyPath: "id" });
      if (!d.objectStoreNames.contains(STORE_RECORDS)) {
        const s = d.createObjectStore(STORE_RECORDS, { keyPath: "id" });
        s.createIndex("by_student_date", ["studentId","date"], { unique: true });
      }
      if (!d.objectStoreNames.contains(STORE_CASES)) {
        const s = d.createObjectStore(STORE_CASES, { keyPath: "id" });
        s.createIndex("by_group_date", ["group","date"], { unique: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode="readonly"){
  return db.transaction(storeName, mode).objectStore(storeName);
}
function put(storeName, value){
  return new Promise((resolve, reject) => {
    const req = tx(storeName,"readwrite").put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}
function get(storeName, key){
  return new Promise((resolve, reject) => {
    const req = tx(storeName,"readonly").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function getAll(storeName){
  return new Promise((resolve, reject) => {
    const req = tx(storeName,"readonly").getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function getByIndex(storeName, indexName, key){
  return new Promise((resolve, reject) => {
    const req = tx(storeName,"readonly").index(indexName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function defaultSettings(){
  return {
    id: "settings",
    profNome: "",
    profFone: "",
    profDisc: "Clínica Integrada",
    turno: "Manhã",
    local: "",
    turma: "",
    grupo: "",
    date: todayISO(),
  };
}

function renderCriteria(){
  const wrap = $("criteria");
  wrap.innerHTML = "";
  for (const c of CRITERIOS){
    const row = document.createElement("div");
    row.className = "crit-row";
    row.innerHTML = `
      <div class="crit-name">${c.label}</div>
      <div class="crit-btns" data-key="${c.key}">
        <button class="pbtn" data-val="0">0</button>
        <button class="pbtn" data-val="3">3</button>
        <button class="pbtn" data-val="5">5</button>
      </div>
    `;
    wrap.appendChild(row);
  }

  wrap.querySelectorAll(".pbtn").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.parentElement.dataset.key;
      const val = Number(btn.dataset.val);
      if (!state.currentRecord) state.currentRecord = defaultRecord();
      state.currentRecord.scores[key] = val;
      [...btn.parentElement.querySelectorAll(".pbtn")].forEach(b => b.classList.toggle("active", b === btn));
      computeScoreUI();
    });
  });
}

function defaultRecord(){
  return {
    id: uid(),
    studentId: state.selectedStudentId,
    date: $("data").value || todayISO(),
    turma: $("turma").value || "",
    grupo: $("grupo").value || "",
    turno: $("turno").value || "Manhã",
    local: $("local").value || "",
    presenca: $("presenca").value || "Presente",
    justificada: $("justificada").value || "Não",
    reposicao: $("reposicao").value || "Não",
    obsDia: $("obsDia").value || "",
    scores: Object.fromEntries(CRITERIOS.map(c => [c.key, null])),
    pontosFortes: $("pontosFortes").value || "",
    pontosDesenvolver: $("pontosDesenvolver").value || "",
    sugestaoEstudo: $("sugestaoEstudo").value || "",
    mensagem: $("mensagem").value || "",
    updatedAt: Date.now(),
  };
}

function defaultCase(){
  return {
    id: uid(),
    date: $("data").value || todayISO(),
    group: $("grupo").value || "",
    turma: $("turma").value || "",
    preceptor: $("profNome").value || "",
    turno: $("turno").value || "",
    local: $("local").value || "",
    codigo: $("casoCodigo").value || "",
    sexo: $("casoSexo").value || "",
    idade: $("casoIdade").value || "",
    qp: $("casoQP").value || "",
    hda: $("casoHDA").value || "",
    achados: $("casoAchados").value || "",
    hipoteses: $("casoHipoteses").value || "",
    conduta: $("casoConduta").value || "",
    pontos: $("casoPontos").value || "",
    updatedAt: Date.now(),
  };
}

function computeScore(record){
  if (!record) return {sum:null, nota:null};
  const vals = Object.values(record.scores || {}).filter(v => typeof v === "number");
  if (!vals.length) return {sum:null, nota:null};
  const sum = vals.reduce((a,b)=>a+b,0);
  const max = CRITERIOS.length * 5;
  const nota = Math.round(((sum/max)*10)*10)/10;
  return {sum, nota};
}

function computeScoreUI(){
  const r = state.currentRecord;
  const {sum, nota} = computeScore(r);
  $("scoreDia").textContent = (sum===null ? "—" : `${sum} / ${CRITERIOS.length*5}`);
  $("notaSug").textContent = (nota===null ? "—" : `${nota}`);
}

function escapeHTML(str){
  return (str||"").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function renderStudents(){
  const el = $("listaAlunos");
  el.innerHTML = "";
  if (!state.students.length){
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "Nenhum aluno cadastrado ainda. Clique em “+ Novo aluno”.";
    el.appendChild(empty);
    return;
  }
  state.students
    .sort((a,b)=> (a.nome||"").localeCompare(b.nome||""))
    .forEach(s => {
      const item = document.createElement("div");
      item.className = "item" + (state.selectedStudentId===s.id ? " active" : "");
      const badge = s.telefone ? "📱" : "—";
      item.innerHTML = `
        <div>
          <div class="name">${escapeHTML(s.nome || "(Sem nome)")}</div>
          <div class="sub">Matrícula: ${escapeHTML(s.matricula||"—")} • Tel: ${escapeHTML(s.telefone||"—")}</div>
        </div>
        <div class="badge">${badge}</div>
      `;
      item.addEventListener("click", async () => {
        state.selectedStudentId = s.id;
        await loadRecordForSelected();
        await loadHistoryForSelected();
        renderStudents();
      });
      el.appendChild(item);
    });
}

function renderDocMeta(){
  const date = $("data").value || todayISO();
  const meta = [
    $("turma").value ? `Turma: ${$("turma").value}` : null,
    $("grupo").value ? `Grupo: ${$("grupo").value}` : null,
    `Data: ${date}`,
    $("turno").value ? `Turno: ${$("turno").value}` : null,
    $("local").value ? `Local: ${$("local").value}` : null,
  ].filter(Boolean).join(" • ");
  $("docMeta").textContent = meta;
}

async function loadSettings(){
  const s = await get(STORE_SETTINGS, "settings") || defaultSettings();
  state.settings = s;
  $("profNome").value = s.profNome || "";
  $("profFone").value = s.profFone || "";
  $("profDisc").value = s.profDisc || "Clínica Integrada";
  $("turno").value = s.turno || "Manhã";
  $("local").value = s.local || "";
  $("turma").value = s.turma || "";
  $("grupo").value = s.grupo || "";
  $("data").value = s.date || todayISO();
  renderDocMeta();
}

async function saveSettings(){
  const s = {
    id:"settings",
    profNome: $("profNome").value,
    profFone: $("profFone").value,
    profDisc: $("profDisc").value,
    turno: $("turno").value,
    local: $("local").value,
    turma: $("turma").value,
    grupo: $("grupo").value,
    date: $("data").value,
  };
  state.settings = s;
  await put(STORE_SETTINGS, s);
}

async function loadStudents(){
  state.students = await getAll(STORE_STUDENTS);
  if (!state.selectedStudentId && state.students.length){
    state.selectedStudentId = state.students[0].id;
  }
  renderStudents();
}

async function loadRecordForSelected(){
  clearRecordUI(false);
  if (!state.selectedStudentId){
    state.currentRecord = null;
    computeScoreUI();
    $("historico").innerHTML = "";
    return;
  }
  const st = state.students.find(s => s.id === state.selectedStudentId);
  $("alunoNome").value = st?.nome || "";
  $("alunoMat").value = st?.matricula || "";
  $("alunoFone").value = st?.telefone || "";

  const date = $("data").value || todayISO();
  const existing = await getByIndex(STORE_RECORDS,"by_student_date",[state.selectedStudentId, date]);
  if (existing){
    state.currentRecord = existing;
    fillRecordUI(existing);
  } else {
    state.currentRecord = defaultRecord();
    fillRecordUI(state.currentRecord);
  }
  computeScoreUI();
}

function fillRecordUI(r){
  $("presenca").value = r.presenca || "Presente";
  $("justificada").value = r.justificada || "Não";
  $("reposicao").value = r.reposicao || "Não";
  $("obsDia").value = r.obsDia || "";
  $("pontosFortes").value = r.pontosFortes || "";
  $("pontosDesenvolver").value = r.pontosDesenvolver || "";
  $("sugestaoEstudo").value = r.sugestaoEstudo || "";
  $("mensagem").value = r.mensagem || "";

  CRITERIOS.forEach(c => {
    const val = r.scores?.[c.key];
    const btns = document.querySelector(`.crit-btns[data-key="${c.key}"]`);
    if (!btns) return;
    btns.querySelectorAll(".pbtn").forEach(b => {
      b.classList.toggle("active", val !== null && Number(b.dataset.val) === Number(val));
    });
  });
}

function clearRecordUI(clearText=true){
  if (clearText){
    $("presenca").value = "Presente";
    $("justificada").value = "Não";
    $("reposicao").value = "Não";
    $("obsDia").value = "";
    $("pontosFortes").value = "";
    $("pontosDesenvolver").value = "";
    $("sugestaoEstudo").value = "";
    $("mensagem").value = "";
  }
  document.querySelectorAll(".pbtn").forEach(b => b.classList.remove("active"));
  if (state.currentRecord){
    state.currentRecord.scores = Object.fromEntries(CRITERIOS.map(c => [c.key, null]));
  }
  computeScoreUI();
}

async function saveRecord(){
  if (!state.selectedStudentId) return alert("Cadastre e selecione um aluno primeiro.");
  const date = $("data").value || todayISO();
  const existing = await getByIndex(STORE_RECORDS,"by_student_date",[state.selectedStudentId, date]);
  const r = defaultRecord();
  if (existing) r.id = existing.id;

  CRITERIOS.forEach(c => {
    const btns = document.querySelector(`.crit-btns[data-key="${c.key}"]`);
    const active = btns?.querySelector(".pbtn.active");
    r.scores[c.key] = active ? Number(active.dataset.val) : null;
  });

  r.updatedAt = Date.now();
  await put(STORE_RECORDS, r);
  state.currentRecord = r;
  await loadHistoryForSelected();
  computeScoreUI();
  toast("Salvo ✅");
}

async function loadHistoryForSelected(){
  const el = $("historico");
  el.innerHTML = "";
  if (!state.selectedStudentId) return;
  const all = await getAll(STORE_RECORDS);
  const list = all
    .filter(r => r.studentId === state.selectedStudentId)
    .sort((a,b)=> (b.date||"").localeCompare(a.date||""));
  if (!list.length){
    el.innerHTML = `<div class="hint">Sem histórico ainda.</div>`;
    return;
  }
  for (const r of list){
    const {sum, nota} = computeScore(r);
    const wrap = document.createElement("div");
    wrap.className = "hrow";
    wrap.innerHTML = `
      <div class="hhead">
        <div>
          <div class="hdate">${escapeHTML(r.date||"")}</div>
          <div class="hmeta">${escapeHTML(r.presenca||"")} • Score: ${sum===null?"—":sum}/${CRITERIOS.length*5} • Nota: ${nota===null?"—":nota}</div>
        </div>
        <button class="btn ghost small" data-load="${r.id}">Abrir</button>
      </div>
      <details>
        <summary>Ver detalhes</summary>
        <div class="small" style="margin-top:8px; color:#455A64;">
          <b>Obs:</b> ${escapeHTML(r.obsDia||"—")}<br/>
          <b>Fortes:</b> ${escapeHTML(r.pontosFortes||"—")}<br/>
          <b>Desenvolver:</b> ${escapeHTML(r.pontosDesenvolver||"—")}<br/>
          <b>Estudo:</b> ${escapeHTML(r.sugestaoEstudo||"—")}<br/>
          <b>Mensagem:</b> ${escapeHTML(r.mensagem||"—")}
        </div>
      </details>
    `;
    wrap.querySelector("[data-load]").addEventListener("click", async () => {
      const rec = await get(STORE_RECORDS, r.id);
      if (!rec) return;
      $("data").value = rec.date || todayISO();
      renderDocMeta();
      state.currentRecord = rec;
      fillRecordUI(rec);
      computeScoreUI();
      toast("Registro carregado ✅");
    });
    el.appendChild(wrap);
  }
}

async function loadCaseOfDay(){
  const date = $("data").value || todayISO();
  const group = $("grupo").value || "";
  if (!group){
    state.caseOfDay = null;
    fillCaseUI(null);
    return;
  }
  const existing = await getByIndex(STORE_CASES,"by_group_date",[group, date]);
  if (existing){
    state.caseOfDay = existing;
    fillCaseUI(existing);
  } else {
    state.caseOfDay = defaultCase();
    fillCaseUI(state.caseOfDay);
  }
}

function fillCaseUI(c){
  $("casoCodigo").value = c?.codigo || "";
  $("casoSexo").value = c?.sexo || "";
  $("casoIdade").value = c?.idade || "";
  $("casoQP").value = c?.qp || "";
  $("casoHDA").value = c?.hda || "";
  $("casoAchados").value = c?.achados || "";
  $("casoHipoteses").value = c?.hipoteses || "";
  $("casoConduta").value = c?.conduta || "";
  $("casoPontos").value = c?.pontos || "";
}

async function saveCase(){
  const group = $("grupo").value || "";
  if (!group) return alert("Informe o Grupo para salvar o caso do dia.");
  const date = $("data").value || todayISO();
  const existing = await getByIndex(STORE_CASES,"by_group_date",[group, date]);
  const c = defaultCase();
  if (existing) c.id = existing.id;
  c.updatedAt = Date.now();
  await put(STORE_CASES, c);
  state.caseOfDay = c;
  toast("Caso do dia salvo ✅");
}

function toast(msg){
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.position="fixed";
  t.style.bottom="16px";
  t.style.left="50%";
  t.style.transform="translateX(-50%)";
  t.style.background="rgba(30,136,229,.95)";
  t.style.color="white";
  t.style.padding="10px 14px";
  t.style.borderRadius="999px";
  t.style.fontWeight="900";
  t.style.zIndex=9999;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(), 1700);
}

/* ---------- PDF / Print fallback ---------- */

function getContextHeader(){
  return {
    preceptor: $("profNome").value || "",
    tel: $("profFone").value || "",
    disc: $("profDisc").value || "",
    turma: $("turma").value || "",
    grupo: $("grupo").value || "",
    data: $("data").value || todayISO(),
    turno: $("turno").value || "",
    local: $("local").value || "",
  };
}

function ensurePrintHTML(title, bodyHtml){
  const w = window.open("", "_blank");
  if (!w) return alert("Pop-up bloqueado. Permita pop-ups para gerar PDF.");
  w.document.open();
  w.document.write(`<!doctype html>
  <html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHTML(title)}</title>
    <style>
      :root{ --azul:#1E88E5; --borda:#CFD8DC; --texto:#263238; --muted:#607D8B; }
      body{ font-family: Arial, Helvetica, sans-serif; color:var(--texto); margin:24px; }
      .head{ display:flex; align-items:center; gap:12px; border-bottom:3px solid var(--azul); padding-bottom:10px; margin-bottom:14px; }
      .logo{ width:56px; height:56px; object-fit:contain; }
      h1{ margin:0; font-size:18px; color:var(--azul); }
      .sub{ color:var(--muted); font-size:12px; margin-top:2px; }
      .box{ border:1px solid var(--borda); border-left:6px solid var(--azul); border-radius:10px; padding:12px; margin-bottom:12px; }
      table{ width:100%; border-collapse:collapse; }
      th,td{ border:1px solid var(--borda); padding:8px; font-size:12px; vertical-align:top; }
      th{ background:#E3F2FD; text-align:left; }
      .pill{ display:inline-block; padding:4px 8px; border-radius:999px; background:#E3F2FD; color:var(--azul); font-weight:bold; font-size:11px; }
      .muted{ color:var(--muted); font-size:12px; }
      .sign{ margin-top:18px; display:flex; justify-content:space-between; gap:20px; }
      .line{ flex:1; border-top:1px solid var(--borda); padding-top:6px; font-size:12px; color:var(--muted); }
      @media print{ button{display:none;} body{ margin:12mm; } }
    </style>
  </head>
  <body>
    <div class="head">
      <img class="logo" src="assets/logo.png" />
      <div>
        <h1>ANDY — ${escapeHTML(title)}</h1>
        <div class="sub">Relatório gerado pelo sistema ANDY • Uso institucional</div>
      </div>
      <div style="margin-left:auto" class="pill">${escapeHTML(getContextHeader().data)}</div>
    </div>
    ${bodyHtml}
    <div class="muted">⚠️ Caso clínico: registro acadêmico anonimizado. Não contém identificação do paciente.</div>
    <div class="sign">
      <div class="line">Assinatura do preceptor</div>
      <div class="line">Carimbo / Identificação</div>
    </div>
    <button onclick="window.print()" style="margin-top:16px;padding:10px 14px;font-weight:bold;border:none;background:#1E88E5;color:white;border-radius:10px;cursor:pointer;">Imprimir / Salvar como PDF</button>
  </body>
  </html>`);
  w.document.close();
  w.focus();
  return w;
}

async function getRecordsForDay(){
  const date = $("data").value || todayISO();
  const group = $("grupo").value || "";
  const all = await getAll(STORE_RECORDS);
  return all.filter(r => r.date === date && (!group || r.grupo === group));
}

async function pdfDia(){
  const ctx = getContextHeader();
  const records = await getRecordsForDay();
  const studentsById = Object.fromEntries(state.students.map(s => [s.id, s]));

  const rows = records
    .sort((a,b)=> (studentsById[a.studentId]?.nome||"").localeCompare(studentsById[b.studentId]?.nome||""))
    .map(r => {
      const s = studentsById[r.studentId] || {};
      const {sum, nota} = computeScore(r);
      return {
        aluno: s.nome || "—",
        matricula: s.matricula || "—",
        telefone: s.telefone || "—",
        presenca: r.presenca || "—",
        score: sum===null? "—" : `${sum}/${CRITERIOS.length*5}`,
        nota: nota===null? "—" : `${nota}`,
        obs: r.obsDia || ""
      };
    });

  const group = ctx.grupo || "";
  const date = ctx.data;
  const caso = group ? await getByIndex(STORE_CASES,"by_group_date",[group, date]) : null;

  const headerBox = `
    <div class="box">
      <div><b>Preceptor:</b> ${escapeHTML(ctx.preceptor||"—")} &nbsp; <b>Tel:</b> ${escapeHTML(ctx.tel||"—")}</div>
      <div class="muted"><b>Disciplina:</b> ${escapeHTML(ctx.disc||"—")} • <b>Turma:</b> ${escapeHTML(ctx.turma||"—")} • <b>Grupo:</b> ${escapeHTML(ctx.grupo||"—")} • <b>Turno:</b> ${escapeHTML(ctx.turno||"—")} • <b>Local:</b> ${escapeHTML(ctx.local||"—")}</div>
    </div>
  `;

  const table = `
    <div class="box">
      <div class="pill">Avaliação do dia</div>
      <table style="margin-top:10px">
        <thead>
          <tr>
            <th>Aluno</th><th>Matrícula</th><th>Telefone</th><th>Presença</th><th>Score</th><th>Nota</th><th>Observações</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${escapeHTML(r.aluno)}</td>
            <td>${escapeHTML(r.matricula)}</td>
            <td>${escapeHTML(r.telefone)}</td>
            <td>${escapeHTML(r.presenca)}</td>
            <td>${escapeHTML(r.score)}</td>
            <td>${escapeHTML(r.nota)}</td>
            <td>${escapeHTML(r.obs)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  const casoBox = `
    <div class="box">
      <div class="pill">Caso Clínico do Dia (Anonimizado)</div>
      <div class="muted" style="margin-top:8px"><b>Código / Demografia:</b> ${escapeHTML(caso?.codigo||"—")} • ${escapeHTML(caso?.sexo||"—")} • ${escapeHTML(caso?.idade||"—")} anos</div>
      <p><b>QP:</b> ${escapeHTML(caso?.qp||"—")}</p>
      <p><b>HDA:</b> ${escapeHTML(caso?.hda||"—")}</p>
      <p><b>Achados:</b> ${escapeHTML(caso?.achados||"—")}</p>
      <p><b>Hipóteses:</b> ${escapeHTML(caso?.hipoteses||"—")}</p>
      <p><b>Conduta:</b> ${escapeHTML(caso?.conduta||"—")}</p>
      <p><b>Pontos para estudo:</b> ${escapeHTML(caso?.pontos||"—")}</p>
    </div>
  `;

  ensurePrintHTML("Boletim do Dia", headerBox + table + casoBox);
}

async function pdfCaso(){
  const ctx = getContextHeader();
  const group = ctx.grupo || "";
  const date = ctx.data;
  const caso = group ? await getByIndex(STORE_CASES,"by_group_date",[group, date]) : null;

  const box = `
    <div class="box">
      <div><b>Preceptor:</b> ${escapeHTML(ctx.preceptor||"—")} &nbsp; <b>Tel:</b> ${escapeHTML(ctx.tel||"—")}</div>
      <div class="muted"><b>Turma:</b> ${escapeHTML(ctx.turma||"—")} • <b>Grupo:</b> ${escapeHTML(ctx.grupo||"—")} • <b>Turno:</b> ${escapeHTML(ctx.turno||"—")} • <b>Local:</b> ${escapeHTML(ctx.local||"—")}</div>
    </div>
    <div class="box">
      <div class="pill">Caso Clínico (Anonimizado)</div>
      <div class="muted" style="margin-top:8px"><b>Código / Demografia:</b> ${escapeHTML(caso?.codigo||"—")} • ${escapeHTML(caso?.sexo||"—")} • ${escapeHTML(caso?.idade||"—")} anos</div>
      <p><b>QP:</b> ${escapeHTML(caso?.qp||"—")}</p>
      <p><b>HDA:</b> ${escapeHTML(caso?.hda||"—")}</p>
      <p><b>Achados:</b> ${escapeHTML(caso?.achados||"—")}</p>
      <p><b>Hipóteses:</b> ${escapeHTML(caso?.hipoteses||"—")}</p>
      <p><b>Conduta:</b> ${escapeHTML(caso?.conduta||"—")}</p>
      <p><b>Pontos para estudo:</b> ${escapeHTML(caso?.pontos||"—")}</p>
    </div>
  `;
  ensurePrintHTML(`Caso Clínico — ${ctx.data}`, box);
}

async function relatorioAluno(){
  if (!state.selectedStudentId) return alert("Selecione um aluno.");
  const student = state.students.find(s => s.id===state.selectedStudentId) || {};
  const all = await getAll(STORE_RECORDS);
  const list = all.filter(r => r.studentId === state.selectedStudentId).sort((a,b)=> (a.date||"").localeCompare(b.date||""));
  const ctx = getContextHeader();

  const tableRows = list.map(r => {
    const {sum, nota} = computeScore(r);
    return `<tr>
      <td>${escapeHTML(r.date||"")}</td>
      <td>${escapeHTML(r.presenca||"")}</td>
      <td>${sum===null?"—":escapeHTML(`${sum}/${CRITERIOS.length*5}`)}</td>
      <td>${nota===null?"—":escapeHTML(`${nota}`)}</td>
      <td>${escapeHTML((r.sugestaoEstudo||"").slice(0,140) || "—")}</td>
      <td>${escapeHTML((r.obsDia||"").slice(0,140) || "—")}</td>
    </tr>`;
  }).join("");

  const body = `
    <div class="box">
      <div><b>Aluno:</b> ${escapeHTML(student.nome||"—")} &nbsp; <b>Matrícula:</b> ${escapeHTML(student.matricula||"—")} &nbsp; <b>Telefone:</b> ${escapeHTML(student.telefone||"—")}</div>
      <div class="muted"><b>Preceptor:</b> ${escapeHTML(ctx.preceptor||"—")} • <b>Disciplina:</b> ${escapeHTML(ctx.disc||"—")}</div>
    </div>
    <div class="box">
      <div class="pill">Histórico</div>
      <table style="margin-top:10px">
        <thead><tr><th>Data</th><th>Presença</th><th>Score</th><th>Nota</th><th>Estudo</th><th>Observações</th></tr></thead>
        <tbody>${tableRows || `<tr><td colspan="6">Sem registros.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  ensurePrintHTML("Relatório do Aluno", body);
}

/* ---------- Backup / Restore ---------- */
async function backup(){
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: await get(STORE_SETTINGS, "settings") || defaultSettings(),
    students: await getAll(STORE_STUDENTS),
    records: await getAll(STORE_RECORDS),
    cases: await getAll(STORE_CASES),
    version: 1,
  };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `ANDY_backup_${todayISO()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1200);
}
async function restore(file){
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || !data.version) throw new Error("Backup inválido.");
  await put(STORE_SETTINGS, { ...data.settings, id:"settings" });
  for (const s of (data.students||[])) await put(STORE_STUDENTS, s);
  for (const r of (data.records||[])) await put(STORE_RECORDS, r);
  for (const c of (data.cases||[])) await put(STORE_CASES, c);
  toast("Importado ✅");
  await init();
}

/* ---------- Install prompt ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $("btnInstall").style.display = "inline-flex";
});
$("btnInstall")?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  $("btnInstall").style.display = "none";
});

/* ---------- UI ---------- */
function wireUI(){
  $("btnHoje").addEventListener("click", async () => {
    $("data").value = todayISO();
    renderDocMeta();
    await saveSettings();
    await loadRecordForSelected();
    await loadCaseOfDay();
    await loadHistoryForSelected();
  });

  $("btnNovoAluno").addEventListener("click", async () => {
    const s = { id: uid(), nome: "Novo Aluno", matricula: "", telefone: "", createdAt: Date.now(), updatedAt: Date.now() };
    await put(STORE_STUDENTS, s);
    state.students = await getAll(STORE_STUDENTS);
    state.selectedStudentId = s.id;
    renderStudents();
    await loadRecordForSelected();
    await loadHistoryForSelected();
    toast("Aluno criado ✅");
  });

  $("btnSalvar").addEventListener("click", async () => { await saveSettings(); await saveRecord(); });
  $("btnLimpar").addEventListener("click", () => {
    if (!confirm("Limpar campos do registro atual (sem apagar o histórico salvo)?")) return;
    clearRecordUI(true);
  });

  $("btnSalvarCaso").addEventListener("click", async () => { await saveSettings(); await saveCase(); });
  $("btnPDFCaso").addEventListener("click", pdfCaso);
  $("btnGerarPDFDia").addEventListener("click", pdfDia);
  $("btnRelatorioAluno").addEventListener("click", relatorioAluno);

  $("btnBackup").addEventListener("click", backup);
  $("fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try{ await restore(file); }catch(err){ alert("Falha ao importar: " + err.message); }
    e.target.value = "";
  });

  $("btnHelp").addEventListener("click", () => $("dlgHelp").showModal());
  $("btnFecharHelp").addEventListener("click", () => $("dlgHelp").close());

  const autosaveIds = ["profNome","profFone","profDisc","turno","local","data","grupo","turma"];
  autosaveIds.forEach(id => $(id).addEventListener("input", () => { renderDocMeta(); saveSettings(); }));
  ["data","grupo","turma"].forEach(id => $(id).addEventListener("change", async () => {
    renderDocMeta();
    await saveSettings();
    await loadRecordForSelected();
    await loadCaseOfDay();
    await loadHistoryForSelected();
  }));
}

async function init(){
  db = await openDB();
  await loadSettings();
  await loadStudents();
  renderCriteria();
  wireUI();
  renderDocMeta();
  await loadRecordForSelected();
  await loadCaseOfDay();
  await loadHistoryForSelected();

  if ("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("./service-worker.js"); }
    catch(e){ console.warn("SW falhou:", e); }
  }
}

init();
