const path=require('path');
const W=path.join(__dirname,'..','..','tools','scoresnap-worker');
const { initializeApp } = require(path.join(W,'node_modules','firebase','app'));
const { getAuth, signInWithEmailAndPassword } = require(path.join(W,'node_modules','firebase','auth'));
const { getFirestore, collection, query, where, getDocs, doc, getDoc } = require(path.join(W,'node_modules','firebase','firestore'));
const CFG=require(path.join(W,'config.json'));
const app=initializeApp({apiKey:'AIzaSyAb5d8w9mI5_hpcoBFcWnG5tE1TF_8guw8',authDomain:'readaloud-51113.firebaseapp.com',projectId:'readaloud-51113'});
(async()=>{const db=getFirestore(app),auth=getAuth(app);
const lk=await getDoc(doc(db,'usernameLookup',String(CFG.username).toLowerCase()));
const c=await signInWithEmailAndPassword(auth,lk.data().email,CFG.password);const tok=await c.user.getIdTokenResult();
console.log('academyId claim:',tok.claims.academyId,'role',tok.claims.role);
try{const s=await getDocs(query(collection(db,'scoresnapSessions'),where('academyId','==',tok.claims.academyId||'default'),where('kind','==','worker')));
console.log('클라이언트 쿼리 결과',s.size,'건');s.docs.forEach(d=>{const x=d.data();console.log(d.id,x.workerName,x.lastSeen&&x.lastSeen.toMillis?Math.round((Date.now()-x.lastSeen.toMillis())/1000)+'초 전':'-')})}catch(e){console.log('쿼리 오류:',e.code,e.message)}
process.exit(0)})()
