// firebase.js — Login com Google + banco de dados (Firestore) da Lousa Digital
// Usa os módulos oficiais via CDN, então funciona direto no GitHub Pages (sem npm/bundler).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  where,
  addDoc,
  updateDoc,
  getDocs,
  arrayUnion,
  arrayRemove,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDqfdAJm5WElb3RZrChFbUEnQKGek-EPlo",
  authDomain: "lousadigital.firebaseapp.com",
  projectId: "lousadigital",
  storageBucket: "lousadigital.firebasestorage.app",
  messagingSenderId: "61389111120",
  appId: "1:61389111120:web:fb129fc70a0537e47ef655"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" }); // deixa escolher a conta a cada login

/* ---------- base64 (seguro para acentos/emojis) ---------- */
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ---------- caminhos: cada usuário só enxerga o que está dentro de users/{uid} ---------- */
function uid() {
  const u = auth.currentUser;
  if (!u) throw new Error("Usuário não autenticado");
  return u.uid;
}
const mainRef = () => doc(db, "users", uid());
const imageRef = (id) => doc(db, "users", uid(), "images", id);

/* ---------- API usada pelo index.html ---------- */
window.FB = {
  login: () => signInWithPopup(auth, provider),
  logout: () => { FB._profile = null; return signOut(auth); },

  // Lousas, notas, calendário e tema (JSON convertido em base64).
  // Se passar de ~900 KB, é gravado em pedaços (users/{uid}/chunks/{n}) — assim nunca deixa de salvar por tamanho.
  async loadAppData() {
    const snap = await getDoc(mainRef());
    if (!snap.exists()) return null;
    const d = snap.data();
    if (d.payload) return JSON.parse(fromBase64(d.payload));
    if (d.chunks > 0) {
      const parts = await Promise.all(
        Array.from({ length: d.chunks }, (_, i) => getDoc(doc(db, "users", uid(), "chunks", String(i))))
      );
      if (parts.some((p) => !p.exists())) throw new Error("Dados incompletos na nuvem (partes faltando).");
      return JSON.parse(fromBase64(parts.map((p) => p.data().data).join("")));
    }
    return null;
  },

  async saveAppData(obj) {
    const payload = toBase64(JSON.stringify(obj));
    const base = {
      encoding: "base64-json",
      updatedAt: obj.updatedAt || Date.now(),
      email: auth.currentUser.email || null
    };
    const SIZE = 700000;
    if (payload.length <= 900000) {
      await setDoc(mainRef(), Object.assign(base, { payload, chunks: 0 }));
    } else {
      const n = Math.ceil(payload.length / SIZE);
      for (let i = 0; i < n; i++) {
        await setDoc(doc(db, "users", uid(), "chunks", String(i)), { data: payload.slice(i * SIZE, (i + 1) * SIZE), n });
      }
      // o documento principal só aponta para os pedaços depois que todos foram gravados
      await setDoc(mainRef(), Object.assign(base, { chunks: n }));
      // limpa pedaços antigos que sobraram
      try {
        const old = await getDocs(collection(db, "users", uid(), "chunks"));
        await Promise.all(old.docs.filter((x) => Number(x.id) >= n).map((x) => deleteDoc(x.ref)));
      } catch (e) { console.warn("Limpeza de pedaços:", e); }
    }
  },

  // Imagens: cada uma num documento próprio, em base64 (data URL)
  async saveImage(id, dataUrl) {
    await setDoc(imageRef(id), { data: dataUrl, createdAt: Date.now() });
  },

  async loadImage(id) {
    const snap = await getDoc(imageRef(id));
    return snap.exists() ? snap.data().data : null;
  },

  async deleteImage(id) {
    await deleteDoc(imageRef(id));
  }
};

/* =====================================================================
   LOUSAS COMPARTILHADAS (tempo real) + CONVITES
   shared/{sid}            -> a lousa compartilhada (payload base64 + membros + rev)
   shared/{sid}/images/{id}-> imagens da lousa compartilhada
   invites/{id}            -> pedidos de compartilhamento (por e-mail)
   ===================================================================== */
const lc = (s) => String(s || "").trim().toLowerCase();
const sharedRef = (sid) => doc(db, "shared", sid);
const sharedImgRef = (sid, id) => doc(db, "shared", sid, "images", id);

function packShared(obj) {
  const payload = toBase64(JSON.stringify(obj));
  if (payload.length > 950000) {
    throw new Error("Lousa compartilhada grande demais para salvar (limite de ~950 KB de texto).");
  }
  return payload;
}
function unpackShared(d) {
  return {
    rev: d.rev || 0,
    ownerUid: d.ownerUid,
    ownerEmail: d.ownerEmail,
    members: d.members || [],
    memberEmails: d.memberEmails || [],
    invitedEmails: d.invitedEmails || [],
    memberProfiles: d.memberProfiles || {},
    content: d.payload ? JSON.parse(fromBase64(d.payload)) : {}
  };
}

Object.assign(window.FB, {
  me() {
    const u = auth.currentUser;
    return { uid: u.uid, email: lc(u.email), name: u.displayName || u.email };
  },

  async createShared(sid, content, invitedEmail) {
    const u = auth.currentUser;
    await setDoc(sharedRef(sid), {
      ownerUid: u.uid,
      ownerEmail: lc(u.email),
      members: [u.uid],
      memberEmails: [lc(u.email)],
      invitedEmails: invitedEmail ? [lc(invitedEmail)] : [],
      payload: packShared(content),
      rev: 1,
      updatedAt: Date.now(),
      updatedBy: u.uid
    });
    return 1;
  },

  // Gravação com controle de versão: se alguém gravou antes, devolve { conflict, remote } para mesclar
  async pushShared(sid, content, expectRev) {
    const payload = packShared(content);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(sharedRef(sid));
      if (!snap.exists()) return { gone: true };
      const d = snap.data();
      if ((d.rev || 0) !== expectRev) return { conflict: true, remote: unpackShared(d) };
      const rev = expectRev + 1;
      tx.update(sharedRef(sid), { payload, rev, updatedAt: Date.now(), updatedBy: auth.currentUser.uid });
      return { rev };
    });
  },

  // Tempo real: cb(dados) a cada mudança; cb(null, erro) se a lousa sumiu ou o acesso foi retirado
  watchShared(sid, cb) {
    return onSnapshot(
      sharedRef(sid),
      (snap) => cb(snap.exists() ? unpackShared(snap.data()) : null),
      (err) => cb(null, err)
    );
  },

  // Nome + foto do participante, visíveis para os outros da lousa (a foto vai em shared/{sid}/images/profile_{uid}, já coberto pelas regras)
  async publishMemberProfile(sid, p) {
    const m = FB.me();
    if (p.photo) await setDoc(sharedImgRef(sid, "profile_" + m.uid), { data: p.photo, createdAt: Date.now(), profile: true });
    else { try { await deleteDoc(sharedImgRef(sid, "profile_" + m.uid)); } catch (e) {} }
    await updateDoc(sharedRef(sid), { ["memberProfiles." + m.uid]: { name: String(p.name || "").slice(0, 24), ph: p.photo ? (p.ph || "1") : "", v: Date.now() } });
  },

  async addInvited(sid, email) { await updateDoc(sharedRef(sid), { invitedEmails: arrayUnion(lc(email)) }); },
  async uninvite(sid, email) { await updateDoc(sharedRef(sid), { invitedEmails: arrayRemove(lc(email)) }); },

  async joinShared(sid) {
    const m = FB.me();
    await updateDoc(sharedRef(sid), {
      members: arrayUnion(m.uid),
      memberEmails: arrayUnion(m.email),
      invitedEmails: arrayRemove(m.email)
    });
  },
  async declineShared(sid) {
    await updateDoc(sharedRef(sid), { invitedEmails: arrayRemove(FB.me().email) });
  },
  async removeMember(sid, memberUid, memberEmail) {
    await updateDoc(sharedRef(sid), {
      members: arrayRemove(memberUid),
      memberEmails: arrayRemove(lc(memberEmail)),
      invitedEmails: arrayRemove(lc(memberEmail))
    });
  },
  async deleteShared(sid) {
    try {
      const imgs = await getDocs(collection(db, "shared", sid, "images"));
      await Promise.all(imgs.docs.map((d) => deleteDoc(d.ref)));
    } catch (e) { console.warn("Imagens compartilhadas:", e); }
    await deleteDoc(sharedRef(sid));
  },

  // Convites
  async sendInvite(inv) {
    const m = FB.me();
    let p = { username: "", photo: "" };
    try { p = FB._profile || await FB.loadProfile(); } catch (e) {}
    const base = {
      fromUid: m.uid, fromEmail: m.email, fromName: p.username || m.name,
      toEmail: lc(inv.toEmail), sid: inv.sid, boardName: inv.boardName || "Lousa", kind: inv.kind || "board",
      status: "pending", createdAt: Date.now(), updatedAt: Date.now()
    };
    try {
      await addDoc(collection(db, "invites"), Object.assign({ fromPhoto: p.photo || "" }, base));
    } catch (e) {
      // se as regras do Firestore não aceitarem o campo extra, envia o convite sem a foto
      await addDoc(collection(db, "invites"), base);
    }
  },
  async setInviteStatus(id, status) {
    const upd = { status, updatedAt: Date.now() };
    if (status === "accepted" || status === "rejected") {
      try {
        const p = FB._profile || await FB.loadProfile();
        upd.toUsername = p.username || "";
        upd.toPhoto = p.photo || "";
      } catch (e) {}
    }
    try {
      await updateDoc(doc(db, "invites", id), upd);
    } catch (e) {
      if (upd.toUsername === undefined) throw e;
      await updateDoc(doc(db, "invites", id), { status, updatedAt: upd.updatedAt }); // sem perfil, mas nunca bloqueia o aceite
    }
  },
  watchInvites(onIncoming, onOutgoing) {
    const m = FB.me();
    const pack = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const u1 = onSnapshot(query(collection(db, "invites"), where("toEmail", "==", m.email)), (s) => onIncoming(pack(s)), (e) => console.warn("invites in:", e));
    const u2 = onSnapshot(query(collection(db, "invites"), where("fromUid", "==", m.uid)), (s) => onOutgoing(pack(s)), (e) => console.warn("invites out:", e));
    return () => { u1(); u2(); };
  },

  // Sinalização do jogo em tempo real (Pong online): só troca os dados de conexão uma vez; o jogo em si vai direto entre os navegadores (WebRTC)
  rtc: {
    get: async (sid, id) => { const s = await getDoc(doc(db, "shared", sid, "rtc", id)); return s.exists() ? s.data() : null; },
    set: (sid, id, d) => setDoc(doc(db, "shared", sid, "rtc", id), d),
    update: (sid, id, d) => updateDoc(doc(db, "shared", sid, "rtc", id), d),
    del: (sid, id) => deleteDoc(doc(db, "shared", sid, "rtc", id)),
    watch: (sid, id, cb) => onSnapshot(doc(db, "shared", sid, "rtc", id), (s) => cb(s.exists() ? s.data() : null), () => cb(null))
  },

  // Imagens da lousa compartilhada
  async saveSharedImage(sid, id, dataUrl) { await setDoc(sharedImgRef(sid, id), { data: dataUrl, createdAt: Date.now() }); },
  async loadSharedImage(sid, id) {
    const snap = await getDoc(sharedImgRef(sid, id));
    return snap.exists() ? snap.data().data : null;
  },
  async deleteSharedImage(sid, id) { await deleteDoc(sharedImgRef(sid, id)); },
  // garante que a imagem (que está no espaço privado do usuário) também exista na lousa compartilhada
  async ensureSharedImage(sid, id) {
    const ex = await getDoc(sharedImgRef(sid, id));
    if (ex.exists()) return true;
    const mine = await getDoc(imageRef(id));
    if (!mine.exists()) return false;
    await setDoc(sharedImgRef(sid, id), { data: mine.data().data, createdAt: Date.now() });
    return true;
  }
});


/* =====================================================================
   CALENDÁRIO / PLANNER — privados de cada usuário
   users/{uid}/calendar/{idDaLousa} -> { events: "JSON {data:[textos]}", updatedAt }
   (já coberto pela regra users/{uid}/{document=**}; não precisa mudar as regras)
   ===================================================================== */
const calCol = () => collection(db, "users", uid(), "calendar");
Object.assign(window.FB, {
  async loadCalendars() {
    const snap = await getDocs(calCol());
    const out = {};
    snap.forEach((d) => {
      try { out[d.id] = JSON.parse(d.data().events || "{}"); } catch (e) { out[d.id] = {}; }
    });
    return out;
  },
  saveCalendar(boardId, events) {
    return setDoc(doc(db, "users", uid(), "calendar", boardId), {
      events: JSON.stringify(events || {}),
      updatedAt: Date.now()
    });
  },
  deleteCalendar(boardId) {
    return deleteDoc(doc(db, "users", uid(), "calendar", boardId));
  },
  // cb(idDaLousa, eventos) quando OUTRO aparelho muda algo (as próprias gravações são ignoradas)
  watchCalendars(cb) {
    return onSnapshot(calCol(), (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.doc.metadata.hasPendingWrites) return;
        if (ch.type === "removed") return cb(ch.doc.id, {});
        let ev = {};
        try { ev = JSON.parse(ch.doc.data().events || "{}"); } catch (e) {}
        cb(ch.doc.id, ev);
      });
    }, (e) => console.warn("calendar watch:", e));
  }
});

/* =====================================================================
   PERFIL — nome de usuário + foto (JPEG pequeno em base64)
   users/{uid}/profile/me -> { username, photo, updatedAt }
   (coberto pela regra users/{uid}/{document=**}; os outros usuários veem o perfil
   por dentro dos convites, então nenhuma regra nova é necessária)
   ===================================================================== */
Object.assign(window.FB, {
  _profile: null,
  async loadProfile() {
    const snap = await getDoc(doc(db, "users", uid(), "profile", "me"));
    const d = snap.exists() ? snap.data() : {};
    FB._profile = { username: d.username || "", photo: d.photo || "" };
    return FB._profile;
  },
  async saveProfile(p) {
    const clean = { username: String(p.username || "").trim().slice(0, 24), photo: p.photo || "" };
    await setDoc(doc(db, "users", uid(), "profile", "me"), Object.assign({ updatedAt: Date.now() }, clean));
    FB._profile = clean;
    return clean;
  }
});

/* ---------- avisa o index.html quando o login muda ---------- */
onAuthStateChanged(auth, (user) => {
  window.dispatchEvent(
    new CustomEvent("fb-auth", {
      detail: {
        user: user
          ? {
              uid: user.uid,
              name: user.displayName || user.email,
              email: user.email,
              photo: user.photoURL
            }
          : null
      }
    })
  );
});


/* =====================================================================
   PLANO / ACESSO — liga o site de vendas à lousa
   users/{uid}/plan/me -> { status: "active", plan: "free"|"pro", source, updatedAt }
   (coberto pela regra users/{uid}/{document=**}; não precisa mudar as regras)
   Quem já tinha lousa salva antes do site (documento principal existe) entra direto
   e recebe plano "legacy", sem precisar comprar.
   ===================================================================== */
Object.assign(window.FB, {
  async getPlan() {
    const snap = await getDoc(doc(db, "users", uid(), "plan", "me"));
    return snap.exists() ? snap.data() : null;
  },
  async setPlan(p) {
    await setDoc(doc(db, "users", uid(), "plan", "me"), Object.assign({ updatedAt: Date.now() }, p));
  },
  async hasAccess() {
    const plan = await FB.getPlan();
    if (plan && plan.status === "active") return true;
    const main = await getDoc(mainRef());
    if (main.exists()) { await FB.setPlan({ status: "active", plan: "legacy", source: "existing-account" }); return true; }
    return false;
  }
});
