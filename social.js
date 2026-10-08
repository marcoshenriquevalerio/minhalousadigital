/* Amigos / seguir / bloquear — camada de dados (Firestore). Precisa vir DEPOIS do firebase.js.
   Se o seu firebase.js usa outra versão do SDK, troque V abaixo para a mesma versão. */
const V = '10.12.2', B = 'https://www.gstatic.com/firebasejs/' + V + '/';
const { getApp } = await import(B + 'firebase-app.js');
const { getFirestore, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc, collection, query, where, limit, onSnapshot } = await import(B + 'firebase-firestore.js');
const db = () => getFirestore(getApp()), col = (n) => collection(db(), n), ref = (n, id) => doc(db(), n, id);
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
window.SOCIAL = {
  async publish(me) {   // só nome (e foto à parte); nunca e-mail
    await setDoc(ref('directory', me.uid), { uid: me.uid, username: me.name, lower: norm(me.name) }, { merge: true });
    await setDoc(ref('dirPhotos', me.uid), { photo: me.photo || '' });
  },
  ping(uid, t) { return setDoc(ref('directory', uid), { lastSeen: t }, { merge: true }); },   // presença: online se visto há < 2,5 min
  async list() { return (await getDocs(query(col('directory'), limit(500)))).docs.map(d => d.data()); },
  async photo(uid) { const s = await getDoc(ref('dirPhotos', uid)); return s.exists() ? (s.data().photo || '') : ''; },
  watch(me, cb) {
    const st = { a: [], b: [], blocks: [], noReq: false }, push = () => cb({ follows: st.a.concat(st.b), blocks: st.blocks, noReq: st.noReq });
    const un = [
      onSnapshot(query(col('follows'), where('fromUid', '==', me.uid)), s => { st.a = s.docs.map(d => ({ id: d.id, ...d.data() })); push(); }, console.warn),
      onSnapshot(query(col('follows'), where('toUid', '==', me.uid)), s => { st.b = s.docs.map(d => ({ id: d.id, ...d.data() })); push(); }, console.warn),
      onSnapshot(query(col('blocks'), where('blocker', '==', me.uid)), s => { st.blocks = s.docs.map(d => ({ id: d.id, ...d.data() })); push(); }, console.warn),
      onSnapshot(ref('directory', me.uid), s => { st.noReq = !!(s.exists() && s.data().noRequests); push(); }, console.warn)
    ];
    return () => un.forEach(f => f());
  },
  request(me, t) {
    return setDoc(ref('follows', me.uid + '_' + t.uid), { fromUid: me.uid, fromEmail: me.email, fromName: me.name, fromPhoto: me.photo || '', toUid: t.uid, toName: t.name, toPhoto: t.photo || '', toEmail: '', status: 'pending', createdAt: Date.now() });
  },
  respond(id, status, me) { return updateDoc(ref('follows', id), { status, toEmail: me.email, toName: me.name, toPhoto: me.photo || '', updatedAt: Date.now() }); },
  remove(id) { return deleteDoc(ref('follows', id)); },
  setNoReq(uid, v) { return setDoc(ref('directory', uid), { noRequests: !!v }, { merge: true }); },
  async block(me, uid) {
    await setDoc(ref('blocks', me.uid + '_' + uid), { blocker: me.uid, blocked: uid, at: Date.now() });
    await Promise.allSettled([deleteDoc(ref('follows', uid + '_' + me.uid)), deleteDoc(ref('follows', me.uid + '_' + uid))]);
  },
  unblock(id) { return deleteDoc(ref('blocks', id)); }
};
