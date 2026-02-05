import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

import {
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  limit
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

const userBox = document.getElementById("userBox");
const content = document.getElementById("content");

/* -----------------------------
   ✅ PERMISOS
   - SOLO "recibo" puede editar/guardar
   - "admin/administrador" solo lectura
------------------------------*/
let CURRENT_ROLE = "";

function isAdmin(role) {
  const r = (role || "").toLowerCase();
  return r === "admin" || r === "administrador";
}
function isRecibo(role) {
  return (role || "").toLowerCase() === "recibo";
}
function canEdit(role) {
  return isRecibo(role);
}

function setUserBox(userEmail, rolText) {
  userBox.innerHTML = `
    Usuario: ${userEmail}<br/>
    Rol: <b>${rolText}</b>
    <button id="btnLogout" style="margin-left:10px;background:#b00020;">Salir</button>
  `;
  document.getElementById("btnLogout").onclick = () => signOut(auth);
}

function goHome() {
  window.location.href = "./index.html";
}

/* -----------------------------
   Fechas
------------------------------*/
function pad2(n) { return String(n).padStart(2, "0"); }

function formatDDMMYYYY(date) {
  if (!date) return "";
  const dd = pad2(date.getDate());
  const mm = pad2(date.getMonth() + 1);
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function toISO(date){
  if (!date) return "";
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yyyy}-${mm}-${dd}`;
}

function yyyymmdd(date) {
  if (!date) return "";
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return `${yyyy}${mm}${dd}`;
}

function parseISODate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function dayNameFromISO(iso) {
  const d = parseISODate(iso);
  if (!d) return "";
  const days = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"];
  return days[d.getDay()] || "";
}

function getParams() {
  const u = new URL(window.location.href);
  return {
    codSap: u.searchParams.get("codSap") || "",
    fechaISO: u.searchParams.get("fecha") || "" // opcional
  };
}

/* -----------------------------
   UI bloqueo admin
------------------------------*/
function applyReadOnlyUI(isReadOnly) {
  const fields = content.querySelectorAll("input, select, textarea");
  fields.forEach(el => {
    if (el.tagName === "SELECT") el.disabled = isReadOnly;
    else {
      el.readOnly = isReadOnly;
      el.disabled = isReadOnly;
    }
  });

  const btnSave = document.getElementById("btnSave");
  if (btnSave) btnSave.style.display = isReadOnly ? "none" : "inline-flex";

  let note = document.getElementById("permNote");
  if (!note) {
    note = document.createElement("div");
    note.id = "permNote";
    note.style.margin = "10px 0 0 0";
    note.style.padding = "10px 12px";
    note.style.borderRadius = "12px";
    note.style.fontWeight = "900";
    note.style.background = "#fff7ed";
    note.style.color = "#9a3412";
    note.style.display = "none";
    const hr = content.querySelector("hr");
    if (hr && hr.parentElement) hr.parentElement.insertBefore(note, hr.nextSibling);
    else content.prepend(note);
  }

  if (isReadOnly) {
    note.textContent = "Modo solo lectura: el ADMIN no puede editar ni guardar esta planilla.";
    note.style.display = "block";
  } else {
    note.style.display = "none";
  }
}

/* -----------------------------
   Subscriptions
------------------------------*/
let unsubReciboDoc = null;
let unsubHistory = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubReciboDoc) { unsubReciboDoc(); unsubReciboDoc = null; }
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }

  if (!user) { goHome(); return; }

  // rol
  const userRef = doc(db, "usuarios", user.uid);
  const userSnap = await getDoc(userRef);
  const rol = ((userSnap.data()?.rol ?? "") + "").trim().toLowerCase();
  CURRENT_ROLE = rol;
  setUserBox(user.email, rol || "SIN ROL");

  if (!isRecibo(rol) && !isAdmin(rol)) {
    content.innerHTML = `
      <h2 style="margin:0 0 6px 0;">Acceso restringido</h2>
      <p class="muted" style="margin:0 0 12px 0;">Solo roles <b>recibo</b> o <b>admin</b> pueden entrar.</p>
      <button id="btnBack" class="dark">Volver</button>
    `;
    document.getElementById("btnBack").onclick = goHome;
    return;
  }

  const { codSap, fechaISO } = getParams();
  if (!codSap) {
    content.innerHTML = `
      <h2 style="margin:0 0 6px 0;">Falta proveedor</h2>
      <p class="muted" style="margin:0 0 12px 0;">No llegó el parámetro <b>codSap</b>.</p>
      <button id="btnBack" class="dark">Volver</button>
    `;
    document.getElementById("btnBack").onclick = goHome;
    return;
  }

  // proveedor
  const provRef = doc(db, "proveedores", codSap);
  const provSnap = await getDoc(provRef);
  if (!provSnap.exists()) {
    content.innerHTML = `
      <h2 style="margin:0 0 6px 0;">Proveedor no encontrado</h2>
      <p class="muted" style="margin:0 0 12px 0;">No existe en Firestore: <b>${codSap}</b></p>
      <button id="btnBack" class="dark">Volver</button>
    `;
    document.getElementById("btnBack").onclick = goHome;
    return;
  }
  const prov = provSnap.data() || {};

  // si llega fecha en URL, abrimos esa entrega; si NO, mostramos selector/historial
  const fechaEntregaDate = fechaISO ? parseISODate(fechaISO) : null;
  const fechaEntregaTxt = fechaEntregaDate ? formatDDMMYYYY(fechaEntregaDate) : "";
  const diaEntregaName = fechaISO ? (dayNameFromISO(fechaISO) || prov.diaEntrega || null) : (prov.diaEntrega || null);

  // UI base
  const todayISO = toISO(new Date());

  content.innerHTML = `
    <div class="row" style="justify-content:space-between;">
      <div>
        <h2 style="margin:0;">${prov.nombre || "Proveedor"}</h2>
        <div class="muted" style="margin-top:4px;font-size:13px;">
          Cod SAP: <b>${codSap}</b> · NIT: <b>${prov.nitProv || "-"}</b>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="pill">${fechaISO ? `Fecha entrega: ${fechaEntregaTxt}` : `Seleccione una fecha`}</div>
        <div class="muted" style="margin-top:6px;font-size:12px;">Día Entrega: <b>${diaEntregaName || "-"}</b></div>
      </div>
    </div>

    <hr style="margin:14px 0;border:0;border-top:1px solid #eef0f6"/>

    <div class="row" style="margin-bottom:10px; align-items:center;">
      <button id="btnBack" class="dark">⬅ Volver</button>

      <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
        <label style="font-weight:900;">Fecha:</label>
        <input id="pickDate" type="date" value="${fechaISO || todayISO}" style="padding:10px;border-radius:12px;border:1px solid #e6e6e6;"/>
        <button id="btnOpenDate" style="background:#2563eb;color:#fff;font-weight:900;border:0;border-radius:12px;padding:10px 14px;cursor:pointer;">
          Crear / Abrir
        </button>
      </div>

      <button id="btnSave" style="margin-left:auto;">Guardar planilla</button>
      <span id="status" class="pill">Listo</span>
    </div>

    <div id="formBox"></div>

    <hr style="margin:16px 0;border:0;border-top:1px solid #eef0f6"/>

    <div class="card" style="border-radius:14px;border:1px solid #eef0f6;padding:14px;background:#fff;">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
        <h3 style="margin:0;">Historial de entregas del proveedor</h3>
        <small class="muted" id="histCount" style="opacity:.75;">Cargando...</small>
      </div>
      <div id="histList" style="margin-top:10px; display:flex; flex-direction:column; gap:8px;">
        <div style="opacity:.75;">Cargando...</div>
      </div>
    </div>

    <style>
      .btnSmall{
        padding:8px 10px; border-radius:12px; border:0; cursor:pointer;
        background:#2563eb; color:#fff; font-weight:900;
      }
    </style>
  `;

  document.getElementById("btnBack").onclick = goHome;

  // abrir por fecha (navega con fecha en URL)
  document.getElementById("btnOpenDate").onclick = () => {
    const iso = (document.getElementById("pickDate").value || "").trim();
    if (!iso) return alert("Selecciona una fecha.");
    window.location.href = `./entrega.html?codSap=${encodeURIComponent(codSap)}&fecha=${encodeURIComponent(iso)}`;
  };

  // Historial (entregas) - SIEMPRE visible
  const histList = document.getElementById("histList");
  const histCount = document.getElementById("histCount");

  const histQuery = query(
    collection(db, "entregas"),
    where("codSap", "==", codSap),
    orderBy("fechaEntregaISO", "desc"),
    limit(100)
  );

  unsubHistory = onSnapshot(histQuery, (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (histCount) histCount.textContent = `Entregas registradas: ${docs.length}`;

    if (!docs.length) {
      histList.innerHTML = `<div style="opacity:.75;">Sin historial aún para este proveedor.</div>`;
      return;
    }

    histList.innerHTML = docs.map(r => {
      const iso = r.fechaEntregaISO || "";
      const ddmmyy = iso ? formatDDMMYYYY(parseISODate(iso)) : "-";
      const day = r.diaEntrega || dayNameFromISO(iso) || "-";
      const estado = (r.estado || "pendiente").toUpperCase();

      return `
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;
                    padding:10px;border:1px dashed #e5e7eb;border-radius:14px;">
          <div>
            <div class="pill">${ddmmyy} · ${day} · ${estado}</div>
            <div style="margin-top:6px;font-weight:900;">${r.proveedor || "-"}</div>
            <div style="opacity:.7;font-size:12px;margin-top:2px;">ID: ${r.id}</div>
          </div>
          <button class="btnSmall"
            onclick="window.location.href='./entrega.html?codSap=${encodeURIComponent(codSap)}&fecha=${encodeURIComponent(iso)}'">
            Abrir
          </button>
        </div>
      `;
    }).join("");
  });

  // Si NO hay fecha, no abrimos formulario (solo selector + historial)
  const formBox = document.getElementById("formBox");
  if (!fechaISO) {
    formBox.innerHTML = `
      <div style="padding:14px;border:1px solid #eef0f6;border-radius:14px;background:#fff;opacity:.85;">
        Selecciona una fecha y pulsa <b>Crear / Abrir</b> para registrar una entrega.
      </div>
    `;
    // ocultar guardar porque aún no hay doc seleccionado
    document.getElementById("btnSave").style.display = "none";
    return;
  }

  // IDs por fecha (1 entrega = 1 doc)
  const entregaId = `${codSap}_${yyyymmdd(fechaEntregaDate)}`;
  const entregaRef = doc(db, "entregas", entregaId); // historial
  const reciboRef = doc(db, "recibos", entregaId);   // planilla

  // ✅ RECIBO: asegura el historial de esa fecha (ADMIN no registra)
  if (isRecibo(CURRENT_ROLE)) {
    await setDoc(entregaRef, {
      codSap,
      proveedor: prov.nombre || null,
      nitProv: prov.nitProv || null,
      fechaEntregaISO: fechaISO,
      fechaEntregaTXT: fechaEntregaTxt || null,
      diaEntrega: dayNameFromISO(fechaISO) || prov.diaEntrega || null,
      estado: "pendiente",
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      createdBy: user.uid
    }, { merge: true });
  }

  // Render formulario (planilla)
  formBox.innerHTML = `
    <div class="grid">
      <div>
        <label>Tipo de vehículo</label>
        <select id="tipoVehiculo">
          <option value="">Seleccione...</option>
          <option value="MULA">MULA</option>
          <option value="TURBO">TURBO</option>
          <option value="SENCILLO">SENCILLO</option>
          <option value="VANS">VANS</option>
          <option value="CARRO PARTICULAR">CARRO PARTICULAR</option>
        </select>
      </div>

      <div>
        <label>Placa</label>
        <input id="placa" placeholder="Ej: ABC123" />
      </div>

      <div>
        <label>Conductor</label>
        <input id="conductor" placeholder="Nombre del conductor" />
      </div>

      <div>
        <label>Teléfono</label>
        <input id="telefono" placeholder="Ej: 3001234567" />
      </div>

      <div>
        <label>Muelle (1..8)</label>
        <select id="muelle">
          <option value="">Seleccione...</option>
          ${Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}
        </select>
      </div>

      <div>
        <label>Observación (opcional)</label>
        <input id="observacion" placeholder="Notas..." />
      </div>
    </div>

    <div class="muted" style="margin-top:12px;font-size:13px;">
      Historial: <b>entregas/${entregaId}</b> · Planilla: <b>recibos/${entregaId}</b>
    </div>
  `;

  // ✅ Bloqueo admin (solo lectura)
  applyReadOnlyUI(!canEdit(CURRENT_ROLE));

  // Cargar planilla si existe
  unsubReciboDoc = onSnapshot(reciboRef, (snap) => {
    if (!snap.exists()) return;

    const r = snap.data() || {};
    document.getElementById("tipoVehiculo").value = r.tipoVehiculo || "";
    document.getElementById("placa").value = r.placa || "";
    document.getElementById("conductor").value = r.conductor || "";
    document.getElementById("telefono").value = r.telefono || "";
    document.getElementById("muelle").value = (r.muelle ?? "") + "";
    document.getElementById("observacion").value = r.observacion || "";

    const status = document.getElementById("status");
    status.textContent = "Cargado";
  });

  // Guardar (solo recibo)
  document.getElementById("btnSave").addEventListener("click", async () => {
    if (!canEdit(CURRENT_ROLE)) {
      alert("No tienes permisos para guardar. Solo el rol RECIBO puede editar esta planilla.");
      return;
    }

    const status = document.getElementById("status");

    const tipoVehiculo = (document.getElementById("tipoVehiculo").value || "").trim();
    const placa = (document.getElementById("placa").value || "").trim().toUpperCase();
    const conductor = (document.getElementById("conductor").value || "").trim();
    const telefono = (document.getElementById("telefono").value || "").trim();
    const muelle = (document.getElementById("muelle").value || "").trim();
    const observacion = (document.getElementById("observacion").value || "").trim();

    if (!tipoVehiculo) return alert("Selecciona el tipo de vehículo.");
    if (!placa) return alert("Escribe la placa.");
    if (!conductor) return alert("Escribe el nombre del conductor.");
    if (!telefono) return alert("Escribe el teléfono.");
    if (!muelle) return alert("Selecciona el muelle (1..8).");

    status.textContent = "Guardando...";
    try {
      await setDoc(reciboRef, {
        codSap,
        proveedor: prov.nombre || null,
        nitProv: prov.nitProv || null,

        fechaEntregaISO: fechaISO,
        fechaEntregaTXT: fechaEntregaTxt || null,
        diaEntrega: dayNameFromISO(fechaISO) || prov.diaEntrega || null,

        tipoVehiculo,
        placa,
        conductor,
        telefono,
        muelle: Number(muelle),
        observacion: observacion || null,

        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      }, { merge: true });

      await setDoc(entregaRef, {
        estado: "recibido",
        updatedAt: serverTimestamp(),
        updatedBy: user.uid
      }, { merge: true });

      status.textContent = "✅ Guardado";
      setTimeout(() => status.textContent = "Listo", 1200);
    } catch (e) {
      console.error(e);
      status.textContent = "Error";
      alert("Error guardando: " + (e?.message || e));
    }
  });
});
