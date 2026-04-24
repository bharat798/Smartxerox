import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage, ref, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// Firebase Configuration (Managed by Environment)
const firebaseConfig = JSON.parse(__firebase_config);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Global Variables
let currentShopId = null;
let soundEnabled = true;
let previousPendingCount = 0;
let qFilter = 'all';
let allJobs = []; 
let deleteContext = null; // Stores job to be deleted for modal

// ==========================================
// 1. UI Navigation & Helpers
// ==========================================
window.switchView = (name, el) => {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => {
        n.className = "nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/5";
    });
    
    document.getElementById('view-' + name).classList.add('active');
    if(el) el.classList.add('active-nav');
    
    if(window.innerWidth < 768) toggleSidebar();
    if(window.lucide) window.lucide.createIcons();
};

window.toggleSidebar = () => {
    document.getElementById('sidebar').classList.toggle('-translate-x-full');
    document.getElementById('mobile-overlay').classList.toggle('hidden');
};

window.filterQ = (f, btn) => {
    qFilter = f;
    const btns = btn.parentElement.querySelectorAll('button');
    btns.forEach(b => b.className = "px-4 py-1.5 text-xs font-bold rounded-lg text-slate-500");
    btn.className = "px-4 py-1.5 text-xs font-bold rounded-lg bg-white shadow-sm text-blue-600";
    renderQueue();
};

// ==========================================
// 2. Authentication & Initialization
// ==========================================
const initAuth = async () => {
    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
    } else {
        await signInAnonymously(auth);
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            // Display email in Sidebar
            document.getElementById('shop-user-email').textContent = user.email || "Guest Partner";

            // Fetch user profile to get ShopID (Rule 1 path)
            const userDoc = await getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'));
            
            // Check if user is a shop owner
            if (userDoc.exists() && userDoc.data().role === 'shop') {
                currentShopId = userDoc.data().shopId;
                
                // Fetch public shop details (Rule 1 path)
                const shopDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shops', currentShopId));
                if(shopDoc.exists()) {
                    document.getElementById('ui-shop-name').textContent = shopDoc.data().shopName;
                    document.getElementById('shop-owner-name').textContent = shopDoc.data().ownerName || "Shop Owner";
                    document.getElementById('ui-shop-id').textContent = 'ID: ' + currentShopId;
                }

                generateShopQR();
                startListeningToQueue();
                loadShopAnalytics();
            } else {
                // If profile not in private, check public shops for demo/fallback
                const publicShopDoc = await getDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shops', 'demo-shop'));
                if(publicShopDoc.exists()){
                    currentShopId = 'demo-shop';
                    startListeningToQueue();
                    loadShopAnalytics();
                }
            }
        } catch(e) { console.error("Init Error:", e); }
    } else {
        initAuth();
    }
});

document.getElementById('btn-logout').onclick = () => {
    signOut(auth).then(() => location.reload());
};

// ==========================================
// 3. QR Code Logic
// ==========================================
const getBaseUrl = () => {
    let url = window.location.origin + window.location.pathname;
    return url.substring(0, url.lastIndexOf('/'));
};

function generateShopQR() {
    const con = document.getElementById('main-qr-canvas');
    if(!con || !currentShopId) return;
    con.innerHTML = "";
    
    const shopUrl = `${getBaseUrl()}/customer.html?shop=${currentShopId}`;
    document.getElementById('qr-link-text').textContent = shopUrl;
    
    if (typeof window.QRCode !== 'undefined') {
        new window.QRCode(con, {
            text: shopUrl,
            width: 180,
            height: 180,
            colorDark : "#0f172a",
            colorLight : "#ffffff",
            correctLevel : window.QRCode.CorrectLevel.H
        });
    }
}

window.copyShopLink = () => {
    const text = document.getElementById('qr-link-text').textContent;
    const dummy = document.createElement("textarea");
    document.body.appendChild(dummy);
    dummy.value = text;
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
    showToast('Shop link copied to clipboard!', 'success');
};

// ==========================================
// 4. Real-time Queue Logic
// ==========================================
function startListeningToQueue() {
    // Simple query (Rule 2)
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'prints');
    
    onSnapshot(q, (snapshot) => {
        allJobs = [];
        let pendingCount = 0;
        const now = Date.now();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            
            // Filter by current shop in memory (Rule 2)
            if(data.shopId !== currentShopId) return;

            // Secure Auto-Delete Check
            if (data.expiresAt && now > data.expiresAt) {
                if (data.filePath) deleteObject(ref(storage, data.filePath)).catch(() => {});
                deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', data.id));
                return;
            }
            
            allJobs.push(data);
            if(data.status === 'Pending' || data.status === 'Printing') pendingCount++;
        });

        // Update UI counters
        document.getElementById('s-pending').textContent = pendingCount;
        document.getElementById('s-total').textContent = allJobs.length;
        
        const badge = document.getElementById('q-badge');
        badge.textContent = pendingCount;
        badge.classList.toggle('hidden', pendingCount === 0);

        if (pendingCount > previousPendingCount && soundEnabled) playAlertSound();
        previousPendingCount = pendingCount;

        allJobs.sort((a, b) => b.createdAt - a.createdAt);
        renderQueue();
        renderDone();
    }, (error) => {
        console.error("Firestore Listen Error:", error);
    });
}

function buildCard(j) {
    const isDone = j.status === 'Done';
    const time = new Date(j.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    const statusCol = j.status === 'Pending' ? 'bg-yellow-400' : j.status === 'Printing' ? 'bg-blue-600' : 'bg-emerald-500';
    
    return `
    <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden transition-all hover:shadow-md ${isDone ? 'opacity-70' : ''}">
        <div class="absolute left-0 top-0 bottom-0 w-1.5 ${statusCol}"></div>
        <div class="flex justify-between items-start mb-4">
            <div class="bg-slate-900 text-white px-4 py-1.5 rounded-xl text-xl font-black tracking-tight shadow-sm">#${j.token}</div>
            <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-md">${time}</div>
        </div>
        
        <div class="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-4">
            <div class="p-2 bg-white rounded-xl shadow-xs"><i data-lucide="file-text" class="w-5 h-5 text-blue-500"></i></div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-slate-700 truncate">${j.fileName}</p>
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">${j.settings.colorMode} • ${j.settings.paperSize} • ${j.settings.copies} sets</p>
            </div>
            <a href="${j.fileUrl}" target="_blank" class="text-[10px] font-black text-blue-600 bg-blue-100 px-3 py-2 rounded-xl uppercase hover:bg-blue-200 transition-colors">Open</a>
        </div>

        ${j.settings.notes ? `<div class="mb-4 text-[11px] bg-amber-50 p-3 rounded-xl text-amber-700 italic border border-amber-100 flex gap-2"><i data-lucide="info" class="w-3 h-3 shrink-0 mt-0.5"></i> <span>Note: ${j.settings.notes}</span></div>` : ''}

        <div class="flex gap-2">
            ${!isDone ? 
                (j.status === 'Pending' ? 
                    `<button onclick="updateJobStatus('${j.id}', 'Printing')" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black py-3 rounded-xl shadow-lg shadow-blue-100 transition-all active:scale-95">Start Printing</button>` : 
                    `<button onclick="markJobAsDone('${j.id}')" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black py-3 rounded-xl shadow-lg shadow-emerald-100 transition-all active:scale-95">Complete Job</button>`) 
                : `<div class="flex-1 text-center py-2 text-emerald-600 font-black text-xs uppercase tracking-widest bg-emerald-50 rounded-xl border border-emerald-100">Printed ✓</div>`
            }
            <button onclick="askDelete('${j.id}', '${j.filePath}')" class="p-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
        </div>
    </div>`;
}

function renderQueue() {
    const qc = document.getElementById('queue-cards');
    const filtered = allJobs.filter(j => j.status !== 'Done' && (qFilter === 'all' || j.status === qFilter));
    qc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-20 text-center"><i data-lucide="inbox" class="w-12 h-12 text-slate-200 mx-auto mb-2"></i><p class="text-sm font-bold text-slate-400">Queue is currently empty</p></div>`;
    if(window.lucide) window.lucide.createIcons();
}

function renderDone() {
    const dc = document.getElementById('done-cards');
    const filtered = allJobs.filter(j => j.status === 'Done');
    dc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-20 text-center"><p class="text-sm font-bold text-slate-400">No completed jobs today</p></div>`;
    if(window.lucide) window.lucide.createIcons();
}

// ==========================================
// 5. Actions & Revenue Tracker
// ==========================================
window.updateJobStatus = async (id, status) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { status });
    showToast(`Job status updated to ${status}`);
};

window.markJobAsDone = async (id) => {
    const job = allJobs.find(j => j.id === id);
    if (!job) return;

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { status: 'Done' });
    
    // 🟢 REVENUE TRACKER LOGIC 🟢
    const today = new Date().toISOString().split('T')[0];
    const statRef = doc(db, 'artifacts', appId, 'public', 'data', 'shop_analytics', `${currentShopId}_${today}`);
    const amount = Number(job.billEstimate) || 0;

    const statSnap = await getDoc(statRef);
    if (statSnap.exists()) {
        await updateDoc(statRef, { revenue: increment(amount), totalTokens: increment(1) });
    } else {
        await setDoc(statRef, { 
            shopId: currentShopId, 
            date: today, 
            revenue: amount, 
            totalTokens: 1, 
            timestamp: Date.now() 
        });
    }
    showToast("Document completed & recorded!", "success");
};

// ==========================================
// 6. Professional Confirm Modal Logic
// ==========================================
window.askDelete = (id, path) => {
    deleteContext = { id, path };
    document.getElementById('confirm-modal').classList.remove('hidden');
};

window.closeConfirm = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    deleteContext = null;
};

document.getElementById('btn-confirm-delete').onclick = async () => {
    if (!deleteContext) return;
    const { id, path } = deleteContext;
    
    try {
        if (path && path !== 'undefined') {
            await deleteObject(ref(storage, path)).catch(e => console.log('File already gone from storage'));
        }
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id));
        showToast("Document deleted securely.", "info");
    } catch(e) { console.error(e); }
    
    closeConfirm();
};

// ==========================================
// 7. Analytics Logic
// ==========================================
function loadShopAnalytics() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'shop_analytics');
    
    onSnapshot(q, (snapshot) => {
        let totalRev = 0, todayRev = 0, todayTok = 0, logs = [];
        const today = new Date().toISOString().split('T')[0];

        snapshot.forEach(d => {
            const data = d.data();
            if(data.shopId !== currentShopId) return;

            totalRev += (data.revenue || 0);
            if(data.date === today) {
                todayRev = data.revenue;
                todayTok = data.totalTokens;
            }
            logs.push(data);
        });

        document.getElementById('stat-earn-total').textContent = totalRev;
        document.getElementById('stat-earn-today').textContent = todayRev;
        document.getElementById('stat-tokens-today').textContent = todayTok;

        logs.sort((a, b) => b.date.localeCompare(a.date));
        const tbody = document.getElementById('daily-revenue-table');
        tbody.innerHTML = logs.map(l => `
            <tr class="hover:bg-slate-50 transition-colors border-b border-slate-50">
                <td class="p-5 font-bold text-slate-600">${l.date}</td>
                <td class="p-5 text-center font-black text-blue-600">${l.totalTokens}</td>
                <td class="p-5 text-right font-black text-emerald-600">₹${l.revenue}</td>
            </tr>
        `).join('');
    });
}

// ==========================================
// 8. Sound & UI Utilities
// ==========================================
document.getElementById('btn-sound').onclick = () => {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btn-sound');
    btn.innerHTML = soundEnabled ? '<i data-lucide="bell" class="w-5 h-5"></i>' : '<i data-lucide="bell-off" class="w-5 h-5 text-red-400"></i>';
    if(window.lucide) window.lucide.createIcons();
    showToast(soundEnabled ? "Sound enabled" : "Sound muted");
};

function playAlertSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.2);
    } catch(e) {}
}

let toastTimeout;
window.showToast = (msg, type = 'info') => {
    const t = document.getElementById('toast');
    const icon = document.getElementById('toast-icon');
    document.getElementById('toast-msg').textContent = msg;
    
    if(type === 'success') { icon.setAttribute('data-lucide', 'check-circle'); icon.className = 'w-5 h-5 text-emerald-400'; }
    else if(type === 'error') { icon.setAttribute('data-lucide', 'alert-circle'); icon.className = 'w-5 h-5 text-red-400'; }
    else { icon.setAttribute('data-lucide', 'info'); icon.className = 'w-5 h-5 text-blue-400'; }
    
    if(window.lucide) window.lucide.createIcons();
    t.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
    t.classList.add('opacity-100', 'translate-y-0');
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        t.classList.remove('opacity-100', 'translate-y-0');
        t.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
    }, 3000);
};

// Start
if(window.lucide) window.lucide.createIcons();
