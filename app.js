const DB_NAME = "BaseVozLocal";
const DB_VERSION = 1;
const STORE = "registos";

let db = null;
let recognition = null;
let voiceMode = null;
let editingId = null;

const $ = id => document.getElementById(id);
const assuntoEl = $("assunto");
const dataEl = $("data");
const voiceBtn = $("voiceBtn");
const voiceStatus = $("voiceStatus");
const voiceHelp = $("voiceHelp");
const recordsEl = $("records");
const searchEl = $("search");
const backupStatus = $("backupStatus");

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = e => {
      const database = e.target.result;
      const store = database.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("assunto", "assunto", { unique: false });
      store.createIndex("data", "data", { unique: false });
    };
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}

function tx(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function addRecord(record) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").add(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(record) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").put(record);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getRecord(id) {
  return new Promise((resolve, reject) => {
    const request = tx().get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(id) {
  return new Promise((resolve, reject) => {
    const request = tx("readwrite").delete(id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

function getAllRecords() {
  return new Promise((resolve, reject) => {
    const request = tx().getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.,!?;:()[\]{}"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(text) {
  const s = normalize(text);
  const m = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${y}`;
  }
  const months = {
    janeiro:"01", fevereiro:"02", marco:"03", abril:"04", maio:"05", junho:"06",
    julho:"07", agosto:"08", setembro:"09", outubro:"10", novembro:"11", dezembro:"12"
  };
 const n = s.match(/\b(\d{1,2})\s+(?:de\s+)?([a-z]+)(?:\s+(?:de\s+)?(\d{4}))?\b/);

if (n) {
  const day = n[1].padStart(2, "0");
  const month = months[n[2]];
  const year = n[3] || String(new Date().getFullYear());

  if (month) {
    return `${day}/${month}/${year}`;
  }
}
  
  return text.trim();
}

async function saveCurrent() {
  const assunto = assuntoEl.value.trim();
  const data = dataEl.value.trim();
  if (!assunto && !data) {
    alert("Preencha pelo menos o assunto ou a data.");
    return;
  }
  const record = {
    assunto,
    data: parseDate(data),
    updatedAt: new Date().toISOString()
  };
  if (editingId !== null) {
    record.id = editingId;
    await putRecord(record);
    editingId = null;
  } else {
    record.createdAt = new Date().toISOString();
    await addRecord(record);
  }
  clearForm();
  await renderRecords();
}

function clearForm() {
  assuntoEl.value = "";
  dataEl.value = "";
  editingId = null;
  $("saveBtn").textContent = "Guardar";
}

async function renderRecords() {
  const all = await getAllRecords();
  all.sort((a,b) => b.id - a.id);
  const q = normalize(searchEl.value);
  const filtered = q
    ? all.filter(r => normalize(r.assunto).includes(q) || normalize(r.data).includes(q))
    : all;

  recordsEl.innerHTML = "";
  if (!filtered.length) {
    recordsEl.innerHTML = `<div class="empty">${all.length ? "Nenhum registo corresponde à pesquisa." : "Ainda não existem registos."}</div>`;
    return;
  }

  for (const r of filtered) {
    const el = document.createElement("article");
    el.className = "record";
    el.innerHTML = `
      <div class="subject"></div>
      <div class="date"></div>
      <div class="meta">ID ${r.id}</div>
      <div class="record-actions">
        <button type="button" data-edit="${r.id}">Editar</button>
        <button type="button" data-delete="${r.id}">Apagar</button>
      </div>`;
    el.querySelector(".subject").textContent = r.assunto || "(sem assunto)";
    el.querySelector(".date").textContent = r.data ? `Data: ${r.data}` : "Data: —";
    recordsEl.appendChild(el);
  }
}

async function edit(id) {
  const r = await getRecord(Number(id));
  if (!r) return;
  assuntoEl.value = r.assunto || "";
  dataEl.value = r.data || "";
  editingId = r.id;
  $("saveBtn").textContent = "Guardar alterações";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function remove(id) {
  const r = await getRecord(Number(id));
  if (!r) return;
  if (!confirm(`Apagar o registo ${r.id}?`)) return;
  await deleteRecord(r.id);
  await renderRecords();
}

recordsEl.addEventListener("click", e => {
  const editId = e.target.dataset.edit;
  const deleteId = e.target.dataset.delete;
  if (editId) edit(editId);
  if (deleteId) remove(deleteId);
});

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceBtn.disabled = true;
    voiceStatus.textContent = "Reconhecimento de voz não disponível";
    voiceHelp.textContent = "Neste dispositivo/browser, a função de voz não está disponível.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "pt-PT";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;

  recognition.onstart = () => {
    voiceBtn.classList.add("listening");
    voiceStatus.textContent = "A ouvir…";
  };
  recognition.onend = () => {
    voiceBtn.classList.remove("listening");
    voiceStatus.textContent = "Pronto";
  };
  recognition.onerror = e => {
    voiceBtn.classList.remove("listening");
    voiceStatus.textContent = "Erro no reconhecimento";
    voiceHelp.textContent = e.error === "not-allowed"
      ? "O microfone não foi autorizado. Verifique as permissões do Safari."
      : "Tente novamente.";
  };
  recognition.onresult = async e => {
    const text = e.results[0][0].transcript.trim();
    handleVoice(text);
  };
}

async function handleVoice(text) {
  const n = normalize(text);
  voiceHelp.textContent = `O iPhone entendeu: “${text}”`;

  const deleteMatch = n.match(/^apagar(?: registo)?\s+(\d+)$/);
  if (deleteMatch) {
    await remove(Number(deleteMatch[1]));
    return;
  }
if (["guardar","gravar","guardar registo","gravar registo"].includes(n)) {
  await saveCurrent();
  voiceMode = null;
  if (recognition) recognition.stop();
  voiceBtn.classList.remove("listening");
  voiceStatus.textContent = "Pronto";
  voiceHelp.textContent = "Registo guardado. Microfone desativado.";
  return;
}
  if (["limpar","novo registo"].includes(n)) {
    clearForm();
    return;
  }
  if (["consultar","mostrar","listar","mostrar registos","listar registos"].includes(n)) {
    await renderRecords();
    return;
  }

  if (["assunto", "assumpto", "assunto campo", "assumpto campo"].includes(n)) {
    voiceMode = "assunto";
    voiceHelp.textContent = "Agora toque novamente no microfone e diga o assunto.";
    return;
  }
  if (n === "data" || n === "data campo") {
    voiceMode = "data";
    voiceHelp.textContent = "Agora toque novamente no microfone e diga a data.";
    return;
  }

  if (voiceMode === "assunto") {
    assuntoEl.value = text;
    voiceMode = null;
    voiceHelp.textContent = "Assunto preenchido. Diga “data” ou toque no microfone.";
    return;
  }
  if (voiceMode === "data") {
    dataEl.value = parseDate(text);
    voiceMode = null;
    voiceHelp.textContent = "Data preenchida. Diga “guardar” ou toque no botão Guardar.";
    return;
  }

  if (n.startsWith("assunto ")) {
    assuntoEl.value = text.slice(8).trim();
    voiceMode = null;
    return;
  }
  if (n.startsWith("data ")) {
    dataEl.value = parseDate(text.slice(5).trim());
    voiceMode = null;
    return;
  }

  voiceHelp.textContent = `O iPhone entendeu: “${text}”. Comando não reconhecido.`;
}

voiceBtn.addEventListener("click", () => {
  if (!recognition) return;
  try { recognition.start(); } catch (_) {}
});

$("saveBtn").addEventListener("click", saveCurrent);
$("clearBtn").addEventListener("click", clearForm);
$("refreshBtn").addEventListener("click", renderRecords);
searchEl.addEventListener("input", renderRecords);

$("exportBtn").addEventListener("click", async () => {
  const records = await getAllRecords();
  const payload = {
    app: "Base Voz",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    records
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `base-voz-backup-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  backupStatus.textContent = `Backup exportado: ${records.length} registo(s).`;
});

$("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.records)) throw new Error("Formato inválido");
    if (!confirm(`Restaurar ${payload.records.length} registo(s)? Os dados atuais não serão apagados; os registos do backup serão adicionados.`)) return;
    let count = 0;
    for (const r of payload.records) {
      await addRecord({
        assunto: String(r.assunto || ""),
        data: String(r.data || ""),
        createdAt: r.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      count++;
    }
    backupStatus.textContent = `Restauro concluído: ${count} registo(s) adicionados.`;
    await renderRecords();
  } catch (err) {
    backupStatus.textContent = "Não foi possível restaurar o backup. Verifique o ficheiro.";
  } finally {
    e.target.value = "";
  }
});

(async function init() {
  try {
    await openDB();
    setupRecognition();
    await renderRecords();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {});
      });
    }
  } catch (err) {
    alert("Não foi possível iniciar a base de dados local.");
    console.error(err);
  }
})();
