import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  initializeFirestore,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  writeBatch,
  collection,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/**
 * ✅ Firebase config
 */
const firebaseConfig = {
  apiKey: "AIzaSyDU0Vud3w0WtvXLznosVhxZFoqofoxzJAk",
  authDomain: "dockmanager-bd5f1.firebaseapp.com",
  projectId: "dockmanager-bd5f1",
  storageBucket: "dockmanager-bd5f1.firebasestorage.app",
  messagingSenderId: "143031724714",
  appId: "1:143031724714:web:44d27f4ff02092a566fed3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  useFetchStreams: false
});

/* -----------------------------
   UI REFS (index.html)
------------------------------*/
const authSection = document.getElementById("authSection");
const panelSection = document.getElementById("panelSection");
const userBox = document.getElementById("userBox");

const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const btnLogin = document.getElementById("btnLogin");
const authMsg = document.getElementById("authMsg");

function show(el){ el?.classList?.remove("hidden"); }
function hide(el){ el?.classList?.add("hidden"); }

function setMsg(text, isError=false){
  if (!authMsg) return;
  authMsg.style.color = isError ? "#b00020" : "#0b6b2e";
  authMsg.textContent = text || "";
}

function setUserBox(userEmail, rolText){
  if (!userBox) return;
  userBox.innerHTML = `
    Usuario: ${userEmail}<br/>
    Rol: <b>${rolText}</b>
    <button id="btnLogout" style="margin-left:10px;background:#b00020;">Salir</button>
  `;
  const btn = document.getElementById("btnLogout");
  if (btn) btn.onclick = () => signOut(auth);
}

/**
 * ✅ Crea/actualiza doc base del usuario (sin tocar rol)
 */
async function ensureUserDoc(user){
  const ref = doc(db, "usuarios", user.uid);
  await setDoc(ref, {
    email: user.email || "",
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });
}

/* -----------------------------
   UTILIDADES TEXTO / DIAS
------------------------------*/
function norm(s){
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const DAY_MAP = {
  "DOMINGO": 0,
  "LUNES": 1,
  "MARTES": 2,
  "MIERCOLES": 3,
  "JUEVES": 4,
  "VIERNES": 5,
  "SABADO": 6
};

function pad2(n){ return String(n).padStart(2,"0"); }

function formatDDMMYYYY(date){
  if (!date) return "";
  const dd = pad2(date.getDate());
  const mm = pad2(date.getMonth()+1);
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toISODate(date){
  if (!date) return "";
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth()+1);
  const dd = pad2(date.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ✅ Convierte:
 * "LUNES / JUEVES", "LUNES,JUEVES", "LUNES Y JUEVES" -> ["LUNES","JUEVES"]
 */
function parseDiasEntrega(raw){
  const s = norm(raw);
  if (!s) return [];

  const parts = s
    .replace(/\s+Y\s+/g, ",")
    .replace(/\s+E\s+/g, ",")
    .replace(/[\/;|]+/g, ",")
    .split(",");

  const out = [];
  for (const p of parts){
    const day = norm(p);
    if (DAY_MAP[day] == null) continue;
    if (!out.includes(day)) out.push(day);
  }
  return out;
}

/* -----------------------------
   ✅ Generar varias entregas por proveedor
   - Por defecto: próximas 45 días
------------------------------*/
function getOccurrencesForDayWithinRange(diaSemana, startDate, endDate){
  const d = norm(diaSemana);
  const target = DAY_MAP[d];
  if (target == null) return [];

  const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  // buscar primera ocurrencia >= start
  const first = new Date(start);
  const delta = (target - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + delta);

  const out = [];
  for (let cur = new Date(first); cur <= end; cur.setDate(cur.getDate() + 7)){
    out.push(new Date(cur));
  }
  return out;
}

function buildEntregaListForProveedor(p, today = new Date()){
  const dias = Array.isArray(p.diasEntrega) && p.diasEntrega.length
    ? p.diasEntrega
    : (p.diaEntrega ? [p.diaEntrega] : []);

  // ✅ rango de fechas: hoy -> hoy + 45 días
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 45);

  // generar ocurrencias por cada día
  const map = new Map(); // fechaISO -> {dia,date,fechaISO,fechaTXT}
  for (const dia of dias){
    const dates = getOccurrencesForDayWithinRange(dia, start, end);
    for (const date of dates){
      const fechaISO = toISODate(date);
      map.set(fechaISO, {
        dia: norm(dia),
        date,
        fechaISO,
        fechaTXT: formatDDMMYYYY(date)
      });
    }
  }

  // ordenar por fecha
  return Array.from(map.values()).sort((a,b) => a.fechaISO.localeCompare(b.fechaISO));
}

/* -----------------------------
   UTILIDADES EXCEL
------------------------------*/
function isHeaderRow(row){
  const headers = row.map(norm);

  const hasSap = headers.some(h => h.includes("SAP") && (h.includes("COD") || h.includes("CODIGO")));
  const hasNit = headers.some(h => h.includes("NIT"));
  const hasNombre = headers.some(h => (h.includes("RAZON") || h.includes("NOMBRE")) && h.includes("PROVEED"));
  const hasDiaEntrega = headers.some(h => h.includes("DIA") && h.includes("ENTREGA"));

  return hasSap && hasNit && hasNombre && hasDiaEntrega;
}

function findColumnIndexes(headerRow){
  const headers = headerRow.map(norm);
  return {
    codSap: headers.findIndex(h => h.includes("SAP") && (h.includes("COD") || h.includes("CODIGO"))),
    nit: headers.findIndex(h => h.includes("NIT")),
    nombre: headers.findIndex(h => (h.includes("RAZON") || h.includes("NOMBRE")) && h.includes("PROVEED")),
    frecSemanal: headers.findIndex(h => h.includes("FREC") && h.includes("SEMAN")),
    diaPedido: headers.findIndex(h => h.includes("DIA") && h.includes("PEDIDO")),
    diaEntrega: headers.findIndex(h => h.includes("DIA") && h.includes("ENTREGA")),
    lead: headers.findIndex(h => h.includes("LEAD") && h.includes("TIME")),
    horaCita: headers.findIndex(h => h.includes("HORA") && h.includes("CITA")),
    fecha: headers.findIndex(h => h === "FECHA" || h.includes("FECHA"))
  };
}

function toText(v){
  if (v == null) return "";
  return v.toString().trim();
}

function toNumberOrNull(v){
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toHoraString(v){
  if (v == null || v === "") return "";

  const s = v.toString().trim();
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
    return s.length === 5 ? (s + ":00") : s;
  }

  if (v instanceof Date) {
    const hh = String(v.getHours()).padStart(2,"0");
    const mm = String(v.getMinutes()).padStart(2,"0");
    const ss = String(v.getSeconds()).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  }

  if (typeof v === "number") {
    const totalSeconds = Math.round(v * 24 * 60 * 60);
    const hh = String(Math.floor(totalSeconds / 3600) % 24).padStart(2,"0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2,"0");
    const ss = String(totalSeconds % 60).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  }

  return s;
}

/* -----------------------------
   ✅ Importar Excel -> Firestore
   ✅ AGRUPA por Cod SAP (varias filas = varios días)
------------------------------*/
async function importExcelToFirestore(file){
  if (!file) return;

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!matrix.length) {
    alert("El Excel está vacío.");
    return;
  }

  let headerIndex = -1;
  for (let i = 0; i < Math.min(matrix.length, 80); i++){
    if (isHeaderRow(matrix[i])) { headerIndex = i; break; }
  }

  if (headerIndex === -1) {
    console.log("🔎 No encontré encabezados. Primeras filas:", matrix.slice(0, 12));
    alert("No encontré encabezados. Debe existir: Cod Sap, NIT PROV, Razon/Nombre Proveedor, Dia Entrega.");
    return;
  }

  const headerRow = matrix[headerIndex];
  const idx = findColumnIndexes(headerRow);

  if (idx.codSap === -1 || idx.nombre === -1 || idx.diaEntrega === -1) {
    console.log("Encabezados detectados:", headerRow);
    console.log("Índices:", idx);
    alert("Faltan columnas obligatorias (Cod Sap / Razon-Nombre / Dia Entrega). Revisa consola (F12).");
    return;
  }

  const dataRows = matrix.slice(headerIndex + 1);

  const acc = new Map(); // codSap -> { ...data, diasEntrega:Set }
  let skipped = 0;

  for (const row of dataRows){
    const allEmpty = row.every(cell => (cell ?? "").toString().trim() === "");
    if (allEmpty) continue;

    const codSap = toText(row[idx.codSap]);
    const nombre = toText(row[idx.nombre]);
    const nitProv = (idx.nit !== -1) ? toText(row[idx.nit]) : "";

    const diaEntregaRaw = (idx.diaEntrega !== -1) ? row[idx.diaEntrega] : "";
    const diasEntregaParsed = parseDiasEntrega(diaEntregaRaw);

    const frecRaw = (idx.frecSemanal !== -1) ? row[idx.frecSemanal] : "";
    const frecOfSemanal = (frecRaw === "" ? null : (toNumberOrNull(frecRaw) ?? toText(frecRaw)));

    const diaPedido = (idx.diaPedido !== -1) ? norm(row[idx.diaPedido]) : "";

    const leadRaw = (idx.lead !== -1) ? row[idx.lead] : "";
    const leadTime = leadRaw === "" ? null : (toNumberOrNull(leadRaw) ?? null);

    const horaCita = (idx.horaCita !== -1) ? toHoraString(row[idx.horaCita]) : "";

    const fechaRaw = (idx.fecha !== -1) ? row[idx.fecha] : "";
    const fechaExcel = toText(fechaRaw);

    if (!codSap || !nombre || diasEntregaParsed.length === 0) {
      skipped++;
      continue;
    }

    if (!acc.has(codSap)){
      acc.set(codSap, {
        codSap,
        nitProv: nitProv || null,
        nombre,
        diasEntregaSet: new Set(diasEntregaParsed),
        frecOfSemanal: frecOfSemanal ?? null,
        diaPedido: diaPedido || null,
        leadTime,
        horaCita: horaCita || null,
        fechaExcel: fechaExcel || null
      });
    } else {
      const cur = acc.get(codSap);

      for (const d of diasEntregaParsed) cur.diasEntregaSet.add(d);

      if (!cur.nitProv && nitProv) cur.nitProv = nitProv;
      if (!cur.nombre && nombre) cur.nombre = nombre;

      if (cur.frecOfSemanal == null && frecOfSemanal != null) cur.frecOfSemanal = frecOfSemanal;
      if (!cur.diaPedido && diaPedido) cur.diaPedido = diaPedido;
      if (cur.leadTime == null && leadTime != null) cur.leadTime = leadTime;
      if (!cur.horaCita && horaCita) cur.horaCita = horaCita;
      if (!cur.fechaExcel && fechaExcel) cur.fechaExcel = fechaExcel;

      acc.set(codSap, cur);
    }
  }

  let batch = writeBatch(db);
  let ops = 0;

  async function commitIfNeeded(){
    if (ops >= 450) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }

  let count = 0;

  for (const [codSap, obj] of acc.entries()){
    const diasEntrega = Array.from(obj.diasEntregaSet || []);
    diasEntrega.sort((a,b) => (DAY_MAP[a] ?? 99) - (DAY_MAP[b] ?? 99));

    const ref = doc(db, "proveedores", codSap);

    batch.set(ref, {
      codSap,
      nitProv: obj.nitProv || null,
      nombre: obj.nombre || null,

      // ✅ todos los días
      diasEntrega,
      // compatibilidad
      diaEntrega: diasEntrega[0] || null,

      frecOfSemanal: obj.frecOfSemanal ?? null,
      diaPedido: obj.diaPedido || null,
      leadTime: obj.leadTime ?? null,
      horaCita: obj.horaCita || null,
      fechaExcel: obj.fechaExcel || null,

      updatedAt: serverTimestamp()
    }, { merge: true });

    ops++;
    count++;
    await commitIfNeeded();
  }

  if (ops > 0) await batch.commit();

  alert(`✅ Importación terminada.\nProveedores únicos: ${count}\nFilas saltadas: ${skipped}`);
  await loadProveedorCards();
}

/* -----------------------------
   PANEL PROVEEDORES (mismo para admin/recibo)
------------------------------*/
let proveedorCache = [];
let currentRole = null;

function renderPanel(role){
  currentRole = role;

  const isAdmin = role === "admin" || role === "administrador";
  const isRecibo = role === "recibo";

  if (!isAdmin && !isRecibo){
    panelSection.innerHTML = `
      <div class="card">
        <h2 style="margin:0 0 6px 0;">Acceso restringido</h2>
        <p style="opacity:.75;margin:0;">Tu usuario no tiene rol válido. Usa <b>admin</b> o <b>recibo</b>.</p>
      </div>
    `;
    return;
  }

  panelSection.innerHTML = `
    <div class="card" style="padding:18px;">
      <h2 style="margin:0 0 6px 0;">Panel ${isAdmin ? "ADMIN" : "RECIBO"}</h2>

      <p style="margin:0 0 14px 0; opacity:.75;">
        Consulta de proveedores (colección <b>proveedores</b>).
        ${isAdmin ? `Excel → Firestore con: Cod Sap, NIT PROV, Razon/Nombre Proveedor, Frec. Of. Semanal, Dia Pedido, Dia Entrega, Lead Time, Hora de cita, Fecha.` : ``}
      </p>

      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:10px 0 12px;">
        ${isAdmin ? `<input id="excelFile" type="file" accept=".xlsx,.xls" />` : ``}
        ${isAdmin ? `<button id="btnImportExcel">Importar Excel</button>` : ``}
        <button id="btnReload" style="background:#111827">Recargar</button>
        ${isAdmin ? `<button id="btnUsers" style="background:#2563eb">Usuarios</button>` : ``}
        <span id="infoPill" style="padding:6px 10px;border-radius:999px;background:#ecfeff;color:#155e75;font-weight:800;font-size:12px;">Listo</span>
      </div>

      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin:8px 0 14px;">
        <input id="searchBox" style="flex:1; min-width:260px;" placeholder="Buscar por Cod SAP / NIT / Nombre..." />
        <select id="dayFilter" style="padding:10px;border-radius:12px;border:1px solid #e6e6e6;">
          <option value="">Todos</option>
          <option value="LUNES">LUNES</option>
          <option value="MARTES">MARTES</option>
          <option value="MIERCOLES">MIERCOLES</option>
          <option value="JUEVES">JUEVES</option>
          <option value="VIERNES">VIERNES</option>
          <option value="SABADO">SABADO</option>
          <option value="DOMINGO">DOMINGO</option>
        </select>
        <small id="tableInfo" style="opacity:.75">Registros: 0</small>
      </div>

      <div id="cards" style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px;">
        <div style="padding:12px;border:1px solid #eef0f6;border-radius:14px;background:#fff;">Cargando...</div>
      </div>

      <style>
        @media (max-width:980px){
          #cards{grid-template-columns:1fr !important;}
        }
        .pCard{
          border:1px solid #eef0f6;border-radius:16px;background:#fff;padding:14px;
        }
        .pHead{
          display:flex; justify-content:space-between; gap:10px; align-items:flex-start;
        }
        .pTitle{font-weight:900}
        .pMeta{opacity:.8; font-size:12px; margin-top:4px;}
        .pGrid{
          display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:12px;
        }
        @media (max-width:980px){ .pGrid{grid-template-columns:repeat(2,minmax(0,1fr));} }
        @media (max-width:520px){ .pGrid{grid-template-columns:1fr;} }

        .kv b{display:block;font-size:12px;opacity:.65;margin-bottom:2px}
        .kv div{font-weight:900}

        .btnSmall{
          padding:10px 12px;
          border-radius:12px;
          border:0;
          cursor:pointer;
          background:#2563eb;
          color:#fff;
          font-weight:900;
        }
        .btnSmall:disabled{
          opacity:.45;
          cursor:not-allowed;
        }
        .pill{
          padding:6px 10px; border-radius:999px; background:#eaf2ff; color:#1e3a8a;
          font-weight:900; font-size:12px; white-space:nowrap;
        }
      </style>
    </div>
  `;

  // hooks
  panelSection.querySelector("#btnReload").addEventListener("click", loadProveedorCards);
  panelSection.querySelector("#searchBox").addEventListener("input", applyFiltersAndRender);
  panelSection.querySelector("#dayFilter").addEventListener("change", applyFiltersAndRender);

  if (isAdmin) {
    const btnUsers = panelSection.querySelector("#btnUsers");
    btnUsers.addEventListener("click", () => window.location.href = "./usuarios.html");

    const excelFile = panelSection.querySelector("#excelFile");
    const btnImportExcel = panelSection.querySelector("#btnImportExcel");
    const infoPill = panelSection.querySelector("#infoPill");

    btnImportExcel.addEventListener("click", async () => {
      const f = excelFile.files?.[0];
      if (!f) return alert("Selecciona el Excel primero.");

      infoPill.textContent = "Importando...";
      infoPill.style.background = "#fff7ed";
      infoPill.style.color = "#9a3412";

      try{
        await importExcelToFirestore(f);
        infoPill.textContent = "✅ Importado";
        infoPill.style.background = "#ecfeff";
        infoPill.style.color = "#155e75";
      }catch(e){
        console.error(e);
        infoPill.textContent = "Error";
        infoPill.style.background = "#ffe4e6";
        infoPill.style.color = "#9f1239";
        alert("Error importando: " + (e?.message || e));
      }
    });
  }

  loadProveedorCards();
}

async function loadProveedorCards(){
  const info = panelSection.querySelector("#tableInfo");
  const cards = panelSection.querySelector("#cards");
  if (!cards) return;

  cards.innerHTML = `<div style="padding:12px;border:1px solid #eef0f6;border-radius:14px;background:#fff;">Cargando...</div>`;
  proveedorCache = [];

  try{
    const qy = query(collection(db, "proveedores"), orderBy("nombre"));
    const snap = await getDocs(qy);

    const today = new Date();

    snap.forEach(d => {
      const data = d.data() || {};

      // ✅ genera varias entregas (próximos 45 días)
      const entregas = buildEntregaListForProveedor(data, today);

      const nextISO = entregas.length ? entregas[0].fechaISO : "9999-99-99";

      const diasEntrega = Array.isArray(data.diasEntrega)
        ? data.diasEntrega
        : (data.diaEntrega ? [data.diaEntrega] : []);

      proveedorCache.push({
        codSap: data.codSap || d.id,
        nitProv: data.nitProv || "",
        nombre: data.nombre || "",
        frecOfSemanal: (data.frecOfSemanal ?? ""),
        diaPedido: data.diaPedido || "",
        diasEntrega,
        entregas,
        horaCita: data.horaCita || "",
        leadTime: (data.leadTime ?? ""),
        nextISO
      });
    });

    if (info) info.textContent = `Registros: ${proveedorCache.length}`;
    applyFiltersAndRender();

  }catch(e){
    console.error(e);
    cards.innerHTML = `<div style="padding:12px;color:#b00020;border:1px solid #eef0f6;border-radius:14px;background:#fff;">
      Error cargando proveedores: ${(e?.message || e)}
    </div>`;
  }
}

function applyFiltersAndRender(){
  const cards = panelSection.querySelector("#cards");
  const search = (panelSection.querySelector("#searchBox")?.value || "").trim().toLowerCase();
  const day = (panelSection.querySelector("#dayFilter")?.value || "").trim().toUpperCase();
  if (!cards) return;

  const filtered = proveedorCache
    .filter(p => {
      const blob = `${p.codSap} ${p.nitProv} ${p.nombre}`.toLowerCase();
      const okSearch = !search || blob.includes(search);
      const okDay = !day || (p.diasEntrega || []).some(d => (d || "").toUpperCase() === day);
      return okSearch && okDay;
    })
    .sort((a,b) => (a.nextISO || "").localeCompare(b.nextISO || ""));

  if (!filtered.length){
    cards.innerHTML = `<div style="padding:12px;border:1px solid #eef0f6;border-radius:14px;background:#fff;">Sin resultados.</div>`;
    return;
  }

  cards.innerHTML = filtered.map(p => {
    // ✅ 1 SOLO BOTÓN por card (abre la próxima entrega)
    const next = (p.entregas && p.entregas.length) ? p.entregas[0] : null;
    const openUrl = next
      ? `./entrega.html?codSap=${encodeURIComponent(p.codSap)}&fecha=${encodeURIComponent(next.fechaISO)}`
      : `#`;

    const btnLabel = next ? "Abrir planilla" : "Sin entregas";
    const btnDisabled = next ? "" : "disabled";
    const btnTitle = next ? `${next.dia} ${next.fechaTXT}` : "No hay entregas calculadas";

    return `
      <div class="pCard">
        <div class="pHead">
          <div>
            <div class="pTitle">${p.nombre || "-"}</div>
            <div class="pMeta">Cod SAP: <b>${p.codSap}</b> · NIT: <b>${p.nitProv || "-"}</b></div>
          </div>
          <div class="pill">${next?.fechaTXT ? next.fechaTXT : "Sin fecha"}</div>
        </div>

        <div class="pGrid">
          <div class="kv"><b>Hora de cita</b><div>${p.horaCita || "-"}</div></div>
          <div class="kv"><b>Lead Time</b><div>${p.leadTime ?? "-"}</div></div>
          <div class="kv"><b>Frec. Of. Semanal</b><div>${p.frecOfSemanal ?? "-"}</div></div>
          <div class="kv"><b>Día Pedido</b><div>${p.diaPedido || "-"}</div></div>
          <div class="kv"><b>Días Entrega</b><div>${(p.diasEntrega || []).join(", ") || "-"}</div></div>
          <div class="kv"><b>Entregas (próx. 45 días)</b><div>${(p.entregas || []).length || 0}</div></div>
        </div>

        <div style="margin-top:12px; display:flex; justify-content:flex-end;">
          <button class="btnSmall"
            ${btnDisabled}
            title="${btnTitle}"
            onclick="window.location.href='${openUrl}'">
            ${btnLabel}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

/* -----------------------------
   LOGIN
------------------------------*/
btnLogin?.addEventListener("click", async () => {
  setMsg("");

  const email = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password) {
    setMsg("Debes ingresar email y contraseña.", true);
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    setMsg("Error de login: " + (e?.message || e), true);
  }
});

/* -----------------------------
   LISTENER DE ROL
------------------------------*/
let unsubscribeRole = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubscribeRole) {
    unsubscribeRole();
    unsubscribeRole = null;
  }

  hide(panelSection);

  if (!user) {
    userBox.innerHTML = "";
    show(authSection);
    setMsg("");
    return;
  }

  hide(authSection);
  show(panelSection);
  setMsg("");
  setUserBox(user.email, "CARGANDO...");

  try{
    await ensureUserDoc(user);
  }catch(e){
    console.warn("ensureUserDoc warning:", e);
  }

  const ref = doc(db, "usuarios", user.uid);

  unsubscribeRole = onSnapshot(ref, (snap) => {
    const data = snap.data() || {};
    const rol = (data.rol ?? "").toString().trim().toLowerCase();

    setUserBox(user.email, rol || "SIN ROL");
    renderPanel(rol || "");

  }, (error) => {
    console.error("onSnapshot error:", error);
    setUserBox(user.email, "SIN ROL");
    renderPanel("");
  });
});
