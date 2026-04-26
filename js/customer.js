import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// --- Global Configuration & State ---
// Environment variables provided by Canvas or local setup
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

let currentShopId = new URLSearchParams(window.location.search).get('shop');
let shopRates = { bwRate: 2, bwRateBulk: 1.5, colorRate: 10, colorRateBulk: 8, tierThreshold: 3 };
let selectedFiles = [];

// ==========================================
// 1. Initialization & Shop Setup
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { 
        await signInAnonymously(auth); 
        return; 
    }
    
    if (!currentShopId) { 
        document.getElementById('ui-shop-name').textContent = "Invalid Link";
        return; 
    }

    // Search for shop details across possible database paths
    const shopPaths = [
        doc(db, 'artifacts', appId, 'public', 'data', 'shops', currentShopId), 
        doc(db, 'shops', currentShopId)
    ];

    for (let sRef of shopPaths) {
        try {
            const sSnap = await getDoc(sRef);
            if (sSnap.exists()) {
                const data = sSnap.data();
                document.getElementById('ui-shop-name').textContent = data.shopName;
                // Merge real rates from DB into our local shopRates
                shopRates = { ...shopRates, ...data };
                break;
            }
        } catch (e) {
            console.error("Shop lookup error:", e);
        }
    }
});

// ==========================================
// 2. File Selection & Pricing Logic
// ==========================================
const fileInput = document.getElementById('file-input');
if (fileInput) {
    fileInput.onchange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const fileId = Math.random().toString(36).substr(2, 9);
            const isPdf = file.name.toLowerCase().endsWith('.pdf');
            
            const fileObj = {
                id: fileId,
                file: file,
                fileName: file.name,
                // SIMULATED PAGE COUNT: In production, use a library like pdf.js to get real page counts
                pages: isPdf ? Math.floor(Math.random() * 15) + 1 : 1, 
                settings: { colorMode: 'bw' },
                price: 0
            };
            selectedFiles.push(fileObj);
        });
        renderFileList();
    };
}

/**
 * 🟢 TIERED PRICING CALCULATION 🟢
 * Standard Rate vs Bulk Rate based on threshold
 */
function calculatePrice(pages, mode) {
    const threshold = parseInt(shopRates.tierThreshold) || 3;
    const rateNormal = mode === 'bw' ? parseFloat(shopRates.bwRate) : parseFloat(shopRates.colorRate);
    const rateBulk = mode === 'bw' ? parseFloat(shopRates.bwRateBulk) : parseFloat(shopRates.colorRateBulk);

    if (pages <= threshold) {
        return pages * rateNormal;
    } else {
        return pages * rateBulk;
    }
}

function renderFileList() {
    const container = document.getElementById('file-list');
    if (!container) return;
    
    container.innerHTML = "";
    let totalOrderPrice = 0;

    selectedFiles.forEach((f) => {
        f.price = calculatePrice(f.pages, f.settings.colorMode);
        totalOrderPrice += f.price;

        container.innerHTML += `
        <div class="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center gap-5 animate-fade-in relative overflow-hidden group">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <div class="bg-blue-50 p-1.5 rounded-lg"><i data-lucide="file-text" class="w-4 h-4 text-blue-500"></i></div>
                    <h4 class="font-black text-slate-800 truncate">${f.fileName}</h4>
                </div>
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">${f.pages} Pages • Estimated: <span class="text-emerald-600 font-black text-sm ml-1">₹${f.price.toFixed(2)}</span></p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <div class="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                    <button onclick="window.updateFileMode('${f.id}', 'bw')" class="px-5 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${f.settings.colorMode === 'bw' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}">B&W</button>
                    <button onclick="window.updateFileMode('${f.id}', 'color')" class="px-5 py-2.5 rounded-lg text-[10px] font-black uppercase transition-all ${f.settings.colorMode === 'color' ? 'bg-white shadow-sm text-purple-600' : 'text-slate-500 hover:text-slate-700'}">Color</button>
                </div>
                <button onclick="window.removeFile('${f.id}')" class="p-3 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-xl transition-colors"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
            </div>
        </div>`;
    });

    const summaryBar = document.getElementById('summary-bar');
    if (summaryBar) summaryBar.classList.toggle('hidden', selectedFiles.length === 0);
    
    const totalDisp = document.getElementById('order-total');
    if (totalDisp) totalDisp.textContent = totalOrderPrice.toFixed(2);
    
    if (window.lucide) window.lucide.createIcons();
}

// Binders for HTML onclick events
window.updateFileMode = (id, mode) => {
    const f = selectedFiles.find(x => x.id === id);
    if (f) { 
        f.settings.colorMode = mode; 
        renderFileList(); 
    }
};

window.removeFile = (id) => {
    selectedFiles = selectedFiles.filter(x => x.id !== id);
    renderFileList();
};

// ==========================================
// 3. Token & Submission Logic
// ==========================================

/**
 * 🟢 ATOMIC DAILY TOKEN GENERATOR 🟢
 * Ensures tokens reset at midnight and handle concurrency
 */
async function getNextToken() {
    const today = new Date().toISOString().split('T')[0];
    const counterRef = doc(db, 'artifacts', appId, 'public', 'data', 'counters', `${currentShopId}_${today}`);
    
    try {
        let token = 1;
        await runTransaction(db, async (t) => {
            const snap = await t.get(counterRef);
            if (snap.exists()) { 
                token = snap.data().lastToken + 1; 
                t.update(counterRef, { lastToken: token }); 
            } else { 
                t.set(counterRef, { lastToken: 1, shopId: currentShopId, date: today }); 
            }
        });
        return token;
    } catch (e) { 
        // Fallback random token on critical failure
        return Math.floor(Math.random() * 900) + 100; 
    }
}

const btnSubmit = document.getElementById('btn-submit');
if (btnSubmit) {
    btnSubmit.onclick = async () => {
        btnSubmit.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Processing Order...`; 
        btnSubmit.disabled = true;
        if (window.lucide) window.lucide.createIcons();

        try {
            const tokenNum = await getNextToken();
            const uploadedFilesData = [];

            // Parallel file uploads
            for (let fObj of selectedFiles) {
                const cleanName = fObj.fileName.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
                const storagePath = `uploads/${currentShopId}/${Date.now()}_${cleanName}`;
                const storageRef = ref(storage, storagePath);
                
                const uploadTask = await uploadBytesResumable(storageRef, fObj.file);
                const url = await getDownloadURL(uploadTask.ref);
                
                uploadedFilesData.push({
                    fileName: fObj.fileName,
                    fileUrl: url,
                    filePath: storagePath,
                    pages: fObj.pages,
                    price: fObj.price,
                    settings: fObj.settings
                });
            }

            // Create Master Print Entry in Firestore
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'prints'), {
                shopId: currentShopId,
                token: tokenNum,
                files: uploadedFilesData,
                billEstimate: document.getElementById('order-total').textContent,
                status: "Pending",
                createdAt: Date.now()
            });

            document.getElementById('final-token').textContent = `#${tokenNum}`;
            document.getElementById('success-modal').classList.remove('hidden');
            
            // Local record for recovery
            localStorage.setItem('smartXerox_lastToken', tokenNum);
            
        } catch (e) { 
            console.error("Submission error:", e); 
            alert("Order failed. Please check your connection."); 
            btnSubmit.innerHTML = "Submit Order <i data-lucide='send' class='w-5 h-5'></i>"; 
            btnSubmit.disabled = false; 
            if (window.lucide) window.lucide.createIcons();
        }
    };
}

// Initial icon setup
if (window.lucide) window.lucide.createIcons();
