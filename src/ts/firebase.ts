import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyDdpM-JvavP6Zf_hsVZT_imkkydpYUvS7Y',
  authDomain: 'zatsudan-pocket.firebaseapp.com',
  projectId: 'zatsudan-pocket',
  storageBucket: 'zatsudan-pocket.firebasestorage.app',
  messagingSenderId: '366146006332',
  appId: '1:366146006332:web:018e0e066ecfdc9c47c239',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
