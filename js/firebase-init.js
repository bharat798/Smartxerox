import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAMo83w6y7efkb4uNp6vn0neYjaHGbDiCc",
  authDomain: "smart-xerox-351eb.firebaseapp.com",
  projectId: "smart-xerox-351eb",
  storageBucket: "smart-xerox-351eb.firebasestorage.app",
  messagingSenderId: "132259843591",
  appId: "1:132259843591:web:5a1f695f02938b0d6e64a2"
};

// Initialize
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Taaki bina module wali files bhi ise use kar sakein
window.auth = auth;
window.db = db;
window.storage = storage;

const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);
