import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// ============================================================
// 🔴 IMPORTANT: Replace the placeholders below with your 
// actual Firebase Project keys from Firebase Console 🔴
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyAMo83w6y7efkb4uNp6vn0neYjaHGbDiCc",
  authDomain: "smart-xerox-351eb.firebaseapp.com",
  projectId: "smart-xerox-351eb",
  storageBucket: "smart-xerox-351eb.firebasestorage.app",
  messagingSenderId: "132259843591",
  appId: "1:132259843591:web:5a1f695f02938b0d6e64a2"
};

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize and Export Services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app); 

// Secondary App & Auth: This is used ONLY in Admin Panel 
// to create Shop accounts without logging out the Admin.
const secondaryApp = initializeApp(firebaseConfig, "Secondary");
export const secondaryAuth = getAuth(secondaryApp);

// This ensures global access if some scripts expect a global variable
window.firebaseConfig = firebaseConfig;
