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
  updateDoc,
  serverTimestamp,
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

// UI
const authSection = document.getElementById("authSection");
const usersSection = document.getElementById("usersSection");
const userBox = document.getElementById("userBox");

const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const btnLogin = document.getElementById("btnLogin");
const authMsg = document.getElementById("authMsg");

function show(el){ el.classList.remove("hidden"); }
function hide(el){ el.classList.add("hidden"); }

function setMsg(text, isError=false){
  if (!authMsg) return;
  authMsg.style.color = isError ? "#b00020" : "#0b6b2e";
  authMsg.textContent = text || "";
}

function setUserBox(userEmail, rolText){
  userBox.innerHTML = `
    Usuario: ${userEmail}<br/>
    Rol: <b>${rolText}</b>
    <button id="btnLogout" style="margin-left:10px;background:#b00020;">Salir</button>
  `;
  document.getElementById("btnLogout").onclick = () => signOut(auth);
}

async function ensureUserDoc(user){
  const ref = doc(db, "usuarios", user.uid);
  await setDoc(ref, {
    email: user.email || "",
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });
}

function goHome(){
  window.location.href = "./index.html";
}

let currentUid = null;

async function renderUsersPage(){
  usersSection.innerHTML = `
    <h2 style="margin:0 0 6px 0;">Gestión de usuarios</h2>
    <p class="muted" style="margin:0 0 12px 0;">
      Si un usuario no aparece aquí es porque no ha iniciado sesión aún (no existe su doc en <b>usuarios</b>).
    </p>

    <div class="row" style="margin:10px 0 14px;">
      <button id="btnBack" class="dark">⬅ Volver</button>
      <button id="btnReloadUsers">Recargar</button>
      <small id="info" class="muted"></small>
    </div>

    <div id="usersList" class="grid">
      <div class="item">Cargando...</div>
    </div>
  `;

  document.getElementById("btnBack").addEventListener("click", goHome);
  document.getElementById("btnReloadUsers").addEventListener("click", loadUsers);

  await loadUsers();
}

async function loadUsers(){
  const usersList = document.getElementById("usersList");
  const info = document.getElementById("info");

  try{
    usersList.innerHTML = `<div class="item">Cargando...</div>`;

    const qy = query(collection(db, "usuarios"), orderBy("email"));
    const snap = await getDocs(qy);

    info.textContent = `Usuarios (con doc): ${snap.size}`;

    if (snap.empty){
      usersList.innerHTML = `<div class="item">No hay usuarios aún (con doc en Firestore).</div>`;
      return;
    }

    const cards = [];
    snap.forEach(docSnap => {
      const uid = docSnap.id;
      const data = docSnap.data() || {};
      const email = data.email || "";
      const rol = (data.rol || "").toString().toLowerCase();
      const isSelf = (uid === currentUid);

      cards.push(`
        <div class="item">
          <h4 style="margin:0">${email || "(sin email)"}</h4>
          <div class="muted" style="font-size:12px;margin-top:4px;">UID: ${uid}</div>

          <div class="kv">
            <div>
              <b>Rol</b>
              <select data-uid="${uid}" ${isSelf ? "disabled":""}>
                <option value="" ${rol==="" ? "selected":""}>SIN ROL</option>
                <option value="admin" ${rol==="admin" ? "selected":""}>admin</option>
                <option value="recibo" ${rol==="recibo" ? "selected":""}>recibo</option>
              </select>
              ${isSelf ? `<div class="muted" style="margin-top:6px;font-size:12px;">(No puedes cambiar tu propio rol)</div>` : ``}
            </div>

            <div>
              <b>Acción</b>
              <button class="btnSaveRole" data-uid="${uid}" style="width:100%;" ${isSelf ? "disabled":""}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      `);
    });

    usersList.innerHTML = cards.join("");

    usersList.querySelectorAll(".btnSaveRole").forEach(btn => {
      btn.addEventListener("click", async () => {
        const uid = btn.getAttribute("data-uid");
        if (uid === currentUid) return alert("No puedes cambiar tu propio rol.");

        const sel = usersList.querySelector(`select[data-uid="${uid}"]`);
        const newRol = (sel.value || "").trim().toLowerCase();

        btn.disabled = true;
        btn.textContent = "Guardando...";

        try{
          await updateDoc(doc(db, "usuarios", uid), {
            rol: newRol,
            updatedAt: serverTimestamp()
          });
          btn.textContent = "✅ Guardado";
          setTimeout(()=> btn.textContent = "Guardar", 900);
        }catch(err){
          console.error(err);
          alert("Error guardando rol: " + (err?.message || err));
          btn.textContent = "Guardar";
        }finally{
          btn.disabled = false;
        }
      });
    });

  }catch(err){
    console.error(err);
    usersList.innerHTML = `<div class="item" style="color:#b00020;">Error cargando usuarios: ${(err?.message || err)}</div>`;
  }
}

/* LOGIN */
btnLogin?.addEventListener("click", async () => {
  setMsg("");
  const email = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password) return setMsg("Debes ingresar email y contraseña.", true);

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    setMsg("Error de login: " + (e?.message || e), true);
  }
});

/* GUARD ADMIN + AUTH */
let unsubRole = null;

onAuthStateChanged(auth, async (user) => {
  if (unsubRole) { unsubRole(); unsubRole = null; }

  hide(usersSection);

  if (!user) {
    currentUid = null;
    userBox.innerHTML = "";
    show(authSection);
    setMsg("");
    return;
  }

  currentUid = user.uid;
  hide(authSection);
  setMsg("");
  setUserBox(user.email, "CARGANDO...");

  try { await ensureUserDoc(user); } catch(e){ console.warn("ensureUserDoc:", e); }

  const ref = doc(db, "usuarios", user.uid);

  unsubRole = onSnapshot(ref, async (snap) => {
    const data = snap.data() || {};
    const rol = (data.rol ?? "").toString().trim().toLowerCase();

    setUserBox(user.email, rol || "SIN ROL");

    // Solo admin entra
    if (rol !== "admin" && rol !== "administrador") {
      usersSection.innerHTML = `
        <div class="card">
          <h2 style="margin:0 0 6px 0;">Acceso restringido</h2>
          <p style="margin:0 0 12px 0;opacity:.75;">Solo el administrador puede ver esta página.</p>
          <button id="btnBackHome" class="dark">Volver al Panel</button>
        </div>
      `;
      show(usersSection);
      document.getElementById("btnBackHome").onclick = goHome;
      return;
    }

    show(usersSection);
    await renderUsersPage();

  }, (err) => {
    console.error("role snapshot error:", err);
    goHome();
  });
});
