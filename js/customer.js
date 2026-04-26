import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

let user = null;
let currentShopId = null;
let shopRates = { bw: 2, color: 10, a3_multiplier: 2 };
let globalSettings = { maxFileSize: 25, autoDeleteHours: 3 };
let currentFile = null;
let simulatedPageCount = 0;

// UI Element References
const loadingState = document.getElementById('loading-state');
const invalidState = document.getElementById('invalid-shop-state');
const appMain = document.getElementById('app-main');
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const btnSubmit = document.getElementById('btn-submit');

// ==========================================
// 🟢 PROFESSIONAL POPUP LOGIC 🟢
// ==========================================
const showPopup = (title, msg, type = 'info') => {
    const popup = document.getElementById('custom-popup');
    const iconCon = document.getElementById('popup-icon-container');
    document.getElementById('popup-title').textContent = title;
    document.getElementById('popup-msg').textContent = msg;
    
    if(type === 'error') {
        iconCon.className = "w-14 h-14 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center mb-4";
        iconCon.innerHTML = '<i data-lucide="x-circle" class="w-8 h-8"></i>';
    } else {
        iconCon.className = "w-14 h-14 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4";
        iconCon.innerHTML = '<i data-lucide="info" class="w-8 h-8"></i>';
    }
    
    popup.classList.remove('hidden');
    // Simple fade in effect
    setTimeout(() => popup.classList.add('opacity-100'), 10);
    if(window.lucide) window.lucide.createIcons();
};

window.closePopup = () => {
    const popup = document.getElementById('custom-popup');
    popup.classList.remove('opacity-100');
    setTimeout(() => popup.classList.add('hidden'), 200);
};

// ==========================================
// 🟢 DAILY TOKEN LOGIC (TRANSACTIONS) 🟢
// ==========================================
async function getNextToken() {
    const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
    const counterRef = doc(db, 'artifacts', appId, 'public', 'data', 'counters', `${currentShopId}_${today}`);
    
    try {
        let newToken = 1;
        await runTransaction(db, async (transaction) => {
            const counterSnap = await transaction.get(counterRef);
            if (counterSnap.exists()) {
                newToken = counterSnap.data().lastToken + 1;
                transaction.update(counterRef, { lastToken: newToken });
            } else {
                // Pehla order aaj ke din ka
                transaction.set(counterRef, { lastToken: 1, date: today, shopId: currentShopId });
            }
        });
        return newToken;
    } catch (e) {
        console.error("Token generation error:", e);
        // Fallback random token in case of total failure
        return Math.floor(Math.random() * 900) + 100; 
    }
}

// ==========================================
// 1. App Initialization
// ==========================================
const init = async () => {
    if(window.lucide) window.lucide.createIcons();
    
    const urlParams = new URLSearchParams(window.location.search);
    currentShopId = urlParams.get('shop');

    if (!currentShopId) {
        loadingState.classList.add('hidden');
        invalidState.classList.remove('hidden');
        return;
    }

    try {
        // Step 1: Login
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }

        // Step 2: Global Settings
        const settingsSnap = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global'));
        if(settingsSnap.exists()) globalSettings = { ...globalSettings, ...settingsSnap.data() };

        // Step 3: Shop Data
        const shopDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shops', currentShopId));
        if (shopDoc.exists()) {
            const data = shopDoc.data();
            document.getElementById('ui-shop-name').textContent = data.shopName;
            document.getElementById('ui-shop-address').textContent = data.address || "Partner Shop";
            shopRates.bw = parseFloat(data.bwRate) || 2;
            shopRates.color = parseFloat(data.colorRate) || 10;
            document.getElementById('rate-bw').textContent = shopRates.bw;
            document.getElementById('rate-color').textContent = shopRates.color;
            
            loadingState.classList.add('hidden');
            appMain.classList.remove('hidden');
            checkPreviousOrder();
        } else {
            loadingState.classList.add('hidden');
            invalidState.classList.remove('hidden');
        }
    } catch (e) {
        console.error(e);
        showPopup("Connection Error", "Server se connect nahi ho pa rahe hain. Kripya page refresh karein.", "error");
    }
};

onAuthStateChanged(auth, (u) => { 
    user = u; 
    if(u) init(); 
});

// ==========================================
// 2. File Selection Logic
// ==========================================
fileInput.onchange = e => { if(e.target.files[0]) handleFiles(e.target.files[0]); };

['dragenter', 'dragover'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.add('drag-active')));
['dragleave', 'drop'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.remove('drag-active')));
dropzone.addEventListener('drop', e => { 
    e.preventDefault();
    if(e.dataTransfer.files[0]) handleFiles(e.dataTransfer.files[0]);
});
dropzone.addEventListener('dragover', e => e.preventDefault());

function handleFiles(file) {
    if (file.size > globalSettings.maxFileSize * 1024 * 1024) {
        showPopup("File Badi Hai", `Aap maximum ${globalSettings.maxFileSize}MB tak ki file upload kar sakte hain.`, "error");
        return;
    }
    currentFile = file;
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";
    const ext = file.name.split('.').pop().toLowerCase();
    simulatedPageCount = ext === 'pdf' ? Math.floor(Math.random() * 15) + 1 : 1;
    document.getElementById('file-pages').textContent = simulatedPageCount;
    
    document.getElementById('upload-prompt').classList.add('hidden');
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('settings-panel').classList.remove('opacity-50', 'pointer-events-none');
    btnSubmit.disabled = false;
    updateBill();
}

document.getElementById('btn-remove-file').onclick = () => {
    currentFile = null; 
    fileInput.value = '';
    document.getElementById('upload-prompt').classList.remove('hidden');
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('settings-panel').classList.add('opacity-50', 'pointer-events-none');
    btnSubmit.disabled = true;
    document.getElementById('bill-details').classList.add('hidden');
    document.getElementById('bill-empty').classList.remove('hidden');
};

// ==========================================
// 3. Bill Calculation
// ==========================================
const updateBill = () => {
    if(!currentFile) return;
    const isColor = document.querySelector('input[name="colorMode"]:checked').value === 'color';
    const paperSize = document.querySelector('input[name="paperSize"]:checked').value;
    const copies = parseInt(document.getElementById('setting-copies').value);
    const baseRate = isColor ? shopRates.color : shopRates.bw;
    const multiplier = paperSize === 'A3' ? 2 : 1;
    const total = simulatedPageCount * baseRate * multiplier * copies;
    
    document.getElementById('bill-empty').classList.add('hidden');
    document.getElementById('bill-details').classList.remove('hidden');
    document.getElementById('bill-pages').textContent = simulatedPageCount;
    document.getElementById('bill-copies').textContent = copies;
    document.getElementById('bill-ratetype').textContent = isColor ? 'Color' : 'B&W';
    document.getElementById('bill-total').textContent = total;
};

document.querySelectorAll('input[name="colorMode"], input[name="paperSize"]').forEach(el => el.onchange = updateBill);
document.getElementById('btn-minus').onclick = () => { 
    let v = parseInt(document.getElementById('setting-copies').value); 
    if(v > 1) { document.getElementById('setting-copies').value = v - 1; updateBill(); }
};
document.getElementById('btn-plus').onclick = () => { 
    let v = parseInt(document.getElementById('setting-copies').value); 
    if(v < 100) { document.getElementById('setting-copies').value = v + 1; updateBill(); }
};

// ==========================================
// 4. Submit Order Logic
// ==========================================
btnSubmit.onclick = async () => {
    if(!user || !currentFile) return;
    
    const originalHTML = btnSubmit.innerHTML;
    btnSubmit.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Processing...`;
    btnSubmit.disabled = true;
    if(window.lucide) window.lucide.createIcons();

    try {
        // Step 1: Upload to Storage
        const safeName = currentFile.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const uniqueFileName = `${Date.now()}_${safeName}`;
        const storagePath = `uploads/${currentShopId}/${uniqueFileName}`;
        const storageRef = ref(storage, storagePath);
        
        const uploadTask = uploadBytesResumable(storageRef, currentFile);

        uploadTask.on('state_changed', 
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                btnSubmit.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> ${Math.round(progress)}%`;
            }, 
            (err) => {
                showPopup("Upload Error", "File upload nahi ho payi. Dobara koshish karein.", "error");
                btnSubmit.innerHTML = originalHTML; btnSubmit.disabled = false;
            }, 
            async () => {
                // Step 2: Generate Download URL & Token
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                const tokenNum = await getNextToken(); // 🟢 DAILY RESET LOGIC 🟢
                const expiry = Date.now() + (globalSettings.autoDeleteHours * 60 * 60 * 1000);
                
                // Step 3: Save Order to Firestore
                await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'prints'), {
                    shopId: currentShopId, 
                    customerId: user.uid,
                    token: tokenNum, 
                    fileName: currentFile.name,
                    fileUrl: downloadURL, 
                    filePath: storagePath,
                    settings: {
                        colorMode: document.querySelector('input[name="colorMode"]:checked').value,
                        paperSize: document.querySelector('input[name="paperSize"]:checked').value,
                        copies: parseInt(document.getElementById('setting-copies').value),
                        notes: document.getElementById('special-notes').value || ""
                    },
                    billEstimate: document.getElementById('bill-total').textContent,
                    status: "Pending", 
                    createdAt: Date.now(), 
                    expiresAt: expiry
                });

                // Step 4: Show Success UI
                localStorage.setItem('smartXerox_lastOrder', JSON.stringify({ token: tokenNum, fileName: currentFile.name, timestamp: Date.now() }));
                document.getElementById('final-token').textContent = `#${tokenNum}`;
                document.getElementById('success-modal').classList.remove('hidden');
                void document.getElementById('success-modal').offsetWidth;
                document.getElementById('success-modal').classList.add('opacity-100');
            }
        );
    } catch(e) {
        console.error(e);
        showPopup("Error", "Order process karne mein dikkat aayi. Kripya internet check karein.", "error");
        btnSubmit.innerHTML = originalHTML; btnSubmit.disabled = false;
    }
};

function checkPreviousOrder() {
    const saved = localStorage.getItem('smartXerox_lastOrder');
    if (saved) {
        try {
            const o = JSON.parse(saved);
            // Check if order is still fresh (within global delete hours)
            if (Date.now() - o.timestamp < (globalSettings.autoDeleteHours * 3600000)) {
                document.getElementById('rec-token').textContent = `#${o.token}`;
                document.getElementById('rec-filename').textContent = o.fileName;
                document.getElementById('recovery-banner').classList.remove('hidden');
            }
        } catch(e) { localStorage.removeItem('smartXerox_lastOrder'); }
    }
}

document.getElementById('btn-close-recovery').onclick = () => document.getElementById('recovery-banner').classList.add('hidden');
document.getElementById('btn-reset-app').onclick = () => location.reload();

window.closePopup = window.closePopup;
