import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ==========================================
// 🔴 YAHAN APNA ASLI FIREBASE CONFIG BHAREIN 🔴
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAMo83w6y7efkb4uNp6vn0neYjaHGbDiCc",
  authDomain: "smart-xerox-351eb.firebaseapp.com",
  projectId: "smart-xerox-351eb",
  storageBucket: "smart-xerox-351eb.firebasestorage.app",
  messagingSenderId: "132259843591",
  appId: "1:132259843591:web:5a1f695f02938b0d6e64a2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app); 

// For admin panel (creating shops without logging out)
export const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);