// Firebase services ko aapki init file se import kar rahe hain
import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, onSnapshot, updateDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- Configuration ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
let currentShopId = null;
let soundEnabled = true;
let previousPendingCount = 0;
let qFilter = 'all';
let allJobs = []; 
let deleteContext = null; 

// ==========================================
// 1. UI NAVIGATION & SIDEBAR (Window Scope)
// ==========================================
// Inhe window se attach kiya hai taaki HTML onclick inhe dhoond sake
window.switchView = (name, el) => {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active-nav'));
    
    const target = document.getElementById('view-' + name);
    if (target) target.classList.add('active');
    if (el) el.classList.add('active-nav');
    
    if (window.innerWidth < 768) window.toggleSidebar();
    if (window.lucide) window.lucide.createIcons();
};

window.toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (sidebar) sidebar.classList.toggle('-translate-x-full');
    if (overlay) overlay.classList.toggle('hidden');
};

window.filterQ = (f, btn) => {
    qFilter = f;
    const btns = btn.parentElement.querySelectorAll('button');
    btns.forEach(b => {
        b.classList.remove('bg-white', 'shadow-sm', 'text-blue-600');
        b.classList.add('text-slate-500');
    });
    btn.classList.add('bg-white', 'shadow-sm', 'text-blue-600');
    btn.classList.remove('text-slate-500');
    renderQueue();
};

// ==========================================
// 2. AUTHENTICATION & SHOP DATA
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            // Sidebar mein email set karein
            const emailDisp = document.getElementById('shop-user-email');
            if(emailDisp) emailDisp.textContent = user.email || "Partner Account";

            // RULE 1: Pehle user profile se shopId fetch karein
            const userDocRef = doc(db, 'artifacts', appId, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                currentShopId = userData.shopId;
                
                // Shop details fetch karein (Name, Owner, etc.)
                const shopDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'shops', currentShopId);
                const shopDoc = await getDoc(shopDocRef);
                
                if (shopDoc.exists()) {
                    const shopData = shopDoc.data();
                    document.getElementById('ui-shop-name').textContent = shopData.shopName;
                    document.getElementById('shop-owner-name').textContent = shopData.ownerName || "Shop Owner";
                    document.getElementById('ui-shop-id').textContent = 'ID: ' + currentShopId;
                    
                    // Sab kuch sahi hai, ab dashboard activate karein
                    generateShopQR();
                    startListeningToQueue();
                    loadShopAnalytics();
                }
            } else {
                console.error("User profile not found in database.");
                document.getElementById('ui-shop-name').textContent = "Unauthorized Account";
            }
        } catch(e) { 
            console.error("Dashboard init error:", e); 
        }
    } else {
        // Agar user logged in nahi hai toh login page par bhejein
        window.location.href = "index.html";
    }
});

// Logout Button logic
const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) {
    logoutBtn.onclick = () => {
        signOut(auth).then(() => {
            window.location.href = "index.html"; 
        });
    };
}

// ==========================================
// 3. QR CODE GENERATION
// ==========================================
function generateShopQR() {
    const con = document.getElementById('main-qr-canvas');
    if (!con || !currentShopId) return;
    con.innerHTML = "";
    
    // Automatic URL detection (VS Code ya GitHub ke liye)
    const currentPath = window.location.pathname;
    const baseUrl = window.location.origin + currentPath.substring(0, currentPath.lastIndexOf('/') + 1);
    const shopUrl = `${baseUrl}customer.html?shop=${currentShopId}`;
    
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
    const url = document.getElementById('qr-link-text').textContent;
    const el = document.createElement('textarea');
    el.value = url;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    window.showToast('Shop Link Copied!', 'success');
};

// ==========================================
// 4. QUEUE & RENDERING
// ==========================================
function startListeningToQueue() {
    // RULE 1: Fetch documents for this shop
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'prints');
    
    onSnapshot(q, (snapshot) => {
        allJobs = [];
        let pendingCount = 0;
        const now = Date.now();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            
            // Memory filtering
            if (data.shopId !== currentShopId) return;

            // Auto-delete implementation
            if (data.expiresAt && now > data.expiresAt) {
                if (data.filePath) deleteObject(ref(storage, data.filePath)).catch(() => {});
                deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', data.id));
                return;
            }
            
            allJobs.push(data);
            if (data.status === 'Pending' || data.status === 'Printing') pendingCount++;
        });

        document.getElementById('s-pending').textContent = pendingCount;
        document.getElementById('s-total').textContent = allJobs.length;
        
        const badge = document.getElementById('q-badge');
        if (badge) {
            badge.textContent = pendingCount;
            badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }

        if (pendingCount > previousPendingCount && soundEnabled) playAlertSound();
        previousPendingCount = pendingCount;

        allJobs.sort((a, b) => b.createdAt - a.createdAt);
        renderQueue();
        renderDone();
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
            <div class="bg-slate-900 text-white px-4 py-1.5 rounded-xl text-xl font-black">#${j.token}</div>
            <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-md">${time}</div>
        </div>
        
        <div class="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-4">
            <div class="p-2 bg-white rounded-xl shadow-xs"><i data-lucide="file-text" class="w-5 h-5 text-blue-500"></i></div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-slate-700 truncate">${j.fileName}</p>
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">${j.settings.colorMode} • ${j.settings.paperSize} • ${j.settings.copies} sets</p>
            </div>
            <a href="${j.fileUrl}" target="_blank" class="text-[10px] font-black text-blue-600 bg-blue-100 px-3 py-2 rounded-xl uppercase">Open</a>
        </div>

        ${j.settings.notes ? `<div class="mb-4 text-[11px] bg-amber-50 p-3 rounded-xl text-amber-700 italic border border-amber-100">Note: ${j.settings.notes}</div>` : ''}

        <div class="flex gap-2">
            ${!isDone ? 
                (j.status === 'Pending' ? 
                    `<button onclick="window.updateJobStatus('${j.id}', 'Printing')" class="flex-1 bg-blue-600 text-white text-xs font-black py-3 rounded-xl shadow-lg active:scale-95">Start Printing</button>` : 
                    `<button onclick="window.markJobAsDone('${j.id}')" class="flex-1 bg-emerald-600 text-white text-xs font-black py-3 rounded-xl shadow-lg active:scale-95">Mark Done</button>`) 
                : `<div class="flex-1 text-center py-2 text-emerald-600 font-black text-xs uppercase bg-emerald-50 rounded-xl border border-emerald-100">Printed ✓</div>`
            }
            <button onclick="window.askDelete('${j.id}', '${j.filePath}')" class="p-3 text-slate-400 hover:text-red-600 transition-colors"><i data-lucide="trash-2" class="w-5 h-5"></i></button>
        </div>
    </div>`;
}

function renderQueue() {
    const qc = document.getElementById('queue-cards');
    if (!qc) return;
    const filtered = allJobs.filter(j => j.status !== 'Done' && (qFilter === 'all' || j.status === qFilter));
    qc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-10 text-center"><p class="text-sm font-bold text-slate-400 uppercase tracking-widest text-xs">Queue is Empty</p></div>`;
    if (window.lucide) window.lucide.createIcons();
}

function renderDone() {
    const dc = document.getElementById('done-cards');
    if (!dc) return;
    const filtered = allJobs.filter(j => j.status === 'Done');
    dc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-10 text-center"><p class="text-sm font-bold text-slate-400 uppercase tracking-widest text-xs">No History Found</p></div>`;
    if (window.lucide) window.lucide.createIcons();
}

// ==========================================
// 5. DATABASE ACTIONS & REVENUE
// ==========================================
window.updateJobStatus = async (id, status) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { status });
    window.showToast(`Order is now ${status}`);
};

window.markJobAsDone = async (id) => {
    const job = allJobs.find(j => j.id === id);
    if (!job) return;

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { status: 'Done' });
    
    // Revenue Ledger Logic (Daily Records)
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
    window.showToast("Job Done & Revenue Added!", "success");
};

// ==========================================
// 6. DELETE MODAL LOGIC
// ==========================================
window.askDelete = (id, path) => {
    deleteContext = { id, path };
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.remove('hidden');
};

window.closeConfirm = () => {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    deleteContext = null;
};

document.getElementById('btn-confirm-delete').onclick = async () => {
    if (!deleteContext) return;
    const { id, path } = deleteContext;
    try {
        if (path && path !== 'undefined') {
            await deleteObject(ref(storage, path)).catch(() => console.warn('Storage file missing'));
        }
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id));
        window.showToast("Deleted Forever", "info");
    } catch(e) { console.error(e); }
    window.closeConfirm();
};

// ==========================================
// 7. ANALYTICS LOADER
// ==========================================
function loadShopAnalytics() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'shop_analytics');
    onSnapshot(q, (snapshot) => {
        let totalRev = 0, todayRev = 0, todayTok = 0, logs = [];
        const today = new Date().toISOString().split('T')[0];

        snapshot.forEach(d => {
            const data = d.data();
            if (data.shopId !== currentShopId) return;

            totalRev += (data.revenue || 0);
            if (data.date === today) {
                todayRev = data.revenue;
                todayTok = data.totalTokens;
            }
            logs.push(data);
        });

        const earnTotal = document.getElementById('stat-earn-total');
        const earnToday = document.getElementById('stat-earn-today');
        const tokensToday = document.getElementById('stat-tokens-today');

        if(earnTotal) earnTotal.textContent = totalRev;
        if(earnToday) earnToday.textContent = todayRev;
        if(tokensToday) tokensToday.textContent = todayTok;

        logs.sort((a, b) => b.date.localeCompare(a.date));
        const tbody = document.getElementById('daily-revenue-table');
        if (tbody) {
            tbody.innerHTML = logs.map(l => `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-50">
                    <td class="p-5 text-slate-600 font-bold">${l.date}</td>
                    <td class="p-5 text-center text-blue-600 font-black">${l.totalTokens}</td>
                    <td class="p-5 text-right text-emerald-600 font-black">₹${l.revenue}</td>
                </tr>
            `).join('');
        }
    });
}

// ==========================================
// 8. UTILITIES (Sound & Toast)
// ==========================================
window.toggleSound = () => {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btn-sound');
    if (btn) {
        btn.innerHTML = soundEnabled ? '<i data-lucide="bell" class="w-5 h-5"></i>' : '<i data-lucide="bell-off" class="w-5 h-5 text-red-400"></i>';
        if (window.lucide) window.lucide.createIcons();
    }
    window.showToast(soundEnabled ? "Notifications Sound On" : "Sound Muted");
};

function playAlertSound() {
    try {
        const audioCtx = new AudioContext();
        const oscillator = audioCtx.createOscillator();
        oscillator.connect(audioCtx.destination);
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15);
    } catch(e) {}
}

window.showToast = (msg, type = 'info') => {
    const t = document.getElementById('toast');
    const msgEl = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    
    if (msgEl) msgEl.textContent = msg;
    if (icon) {
        if (type === 'success') { 
            icon.setAttribute('data-lucide', 'check-circle'); 
            icon.className = 'w-5 h-5 text-emerald-400'; 
        } else { 
            icon.setAttribute('data-lucide', 'info'); 
            icon.className = 'w-5 h-5 text-blue-400'; 
        }
    }
    
    if (window.lucide) window.lucide.createIcons();
    if (t) {
        t.classList.remove('opacity-0', '-translate-y-4', 'pointer-events-none');
        t.classList.add('opacity-100', 'translate-y-0');
        setTimeout(() => {
            t.classList.remove('opacity-100', 'translate-y-0');
            t.classList.add('opacity-0', '-translate-y-4', 'pointer-events-none');
        }, 3000);
    }
};

// First time Lucide Init
if (window.lucide) window.lucide.createIcons();
