import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut, signInWithCustomToken, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, onSnapshot, updateDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

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
window.switchView = (name, el) => {
    // Hide all sections
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    // Reset sidebar buttons styling
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active-nav'));
    
    // Show the targeted view
    const target = document.getElementById('view-' + name);
    if (target) target.classList.add('active');
    
    // Highlight the clicked button
    if (el) el.classList.add('active-nav');
    
    // Auto-close sidebar on mobile devices
    if (window.innerWidth < 768) window.toggleSidebar();
    
    // Refresh Lucide Icons
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
// 2. AUTHENTICATION & INITIALIZATION
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            // Display User Email in Sidebar
            const emailDisp = document.getElementById('shop-user-email');
            if(emailDisp) emailDisp.textContent = user.email || "Partner Account";

            // RULE 1: Fetch Shop ID from the user's private document
            const userDocRef = doc(db, 'artifacts', appId, 'users', user.uid);
            const userDoc = await getDoc(userDocRef);
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                currentShopId = userData.shopId;
                
                // Fetch Public Shop Details (Name, Owner Name, etc.)
                const shopDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'shops', currentShopId);
                const shopDoc = await getDoc(shopDocRef);
                
                if (shopDoc.exists()) {
                    const shopData = shopDoc.data();
                    document.getElementById('ui-shop-name').textContent = shopData.shopName;
                    document.getElementById('shop-owner-name').textContent = shopData.ownerName || "Shop Owner";
                    document.getElementById('ui-shop-id').textContent = 'ID: ' + currentShopId;
                }

                // Initialize Dashboard Components
                generateShopQR();
                startListeningToQueue();
                loadShopAnalytics();
            } else {
                // If profile not found, don't show fake data. Alert the user.
                document.getElementById('ui-shop-name').textContent = "Unauthorized Access";
                document.getElementById('ui-shop-id').textContent = "Profile not linked to a shop.";
            }
        } catch(e) { 
            console.error("Initialization failed:", e); 
        }
    } else {
        // Redirect to login if not authenticated
        window.location.href = "index.html";
    }
});

// Logout Button Logic
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
    
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');
    const shopUrl = `${baseUrl}/customer.html?shop=${currentShopId}`;
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
// 4. REAL-TIME QUEUE LISTENER
// ==========================================
function startListeningToQueue() {
    // RULE 1: Public prints collection
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'prints');
    
    onSnapshot(q, (snapshot) => {
        allJobs = [];
        let pendingCount = 0;
        const now = Date.now();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            
            // Filter by current shop in memory (Rule 2)
            if (data.shopId !== currentShopId) return;

            // Secure Auto-Delete Check
            if (data.expiresAt && now > data.expiresAt) {
                if (data.filePath) deleteObject(ref(storage, data.filePath)).catch(() => {});
                deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', data.id));
                return;
            }
            
            allJobs.push(data);
            if (data.status === 'Pending' || data.status === 'Printing') pendingCount++;
        });

        // Update Counters in Header/Sidebar
        document.getElementById('s-pending').textContent = pendingCount;
        document.getElementById('s-total').textContent = allJobs.length;
        
        const badge = document.getElementById('q-badge');
        if (badge) {
            badge.textContent = pendingCount;
            badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }

        // Notification Sound on new arrivals
        if (pendingCount > previousPendingCount && soundEnabled) playAlertSound();
        previousPendingCount = pendingCount;

        // Sort: Newest First
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
    <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden transition-all hover:shadow-md animate-slide-in ${isDone ? 'opacity-70' : ''}">
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
            <a href="${j.fileUrl}" target="_blank" class="text-[10px] font-black text-blue-600 bg-blue-100 px-3 py-2 rounded-xl uppercase hover:bg-blue-200 transition-colors">Open</a>
        </div>

        ${j.settings.notes ? `<div class="mb-4 text-[11px] bg-amber-50 p-3 rounded-xl text-amber-700 italic border border-amber-100 flex gap-2"><i data-lucide="info" class="w-3 h-3 shrink-0 mt-0.5"></i> <span>Note: ${j.settings.notes}</span></div>` : ''}

        <div class="flex gap-2">
            ${!isDone ? 
                (j.status === 'Pending' ? 
                    `<button onclick="window.updateJobStatus('${j.id}', 'Printing')" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black py-3 rounded-xl shadow-lg transition-all active:scale-95">Start Printing</button>` : 
                    `<button onclick="window.markJobAsDone('${j.id}')" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black py-3 rounded-xl shadow-lg transition-all active:scale-95">Complete Job</button>`) 
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
    qc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-20 text-center"><i data-lucide="inbox" class="w-12 h-12 text-slate-200 mx-auto mb-2"></i><p class="text-sm font-bold text-slate-400 uppercase tracking-widest text-xs">Queue is empty</p></div>`;
    if (window.lucide) window.lucide.createIcons();
}

function renderDone() {
    const dc = document.getElementById('done-cards');
    if (!dc) return;
    const filtered = allJobs.filter(j => j.status === 'Done');
    dc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-20 text-center"><p class="text-sm font-bold text-slate-400 uppercase tracking-widest text-xs">No history found</p></div>`;
    if (window.lucide) window.lucide.createIcons();
}

// ==========================================
// 5. STATUS UPDATES & REVENUE LOGIC
// ==========================================
window.updateJobStatus = async (id, status) => {
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { status });
    window.showToast(`Job updated: ${status}`);
};

window.markJobAsDone = async (id) => {
    const job = allJobs.find(j => j.id === id);
    if (!job) return;

    // 1. Mark as Done in Database
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { status: 'Done' });
    
    // 2. REVENUE TRACKER (Update analytics record)
    const today = new Date().toISOString().split('T')[0];
    const statRef = doc(db, 'artifacts', appId, 'public', 'data', 'shop_analytics', `${currentShopId}_${today}`);
    const amount = Number(job.billEstimate) || 0;

    const statSnap = await getDoc(statRef);
    if (statSnap.exists()) {
        await updateDoc(statRef, { 
            revenue: increment(amount), 
            totalTokens: increment(1) 
        });
    } else {
        await setDoc(statRef, { 
            shopId: currentShopId, 
            date: today, 
            revenue: amount, 
            totalTokens: 1, 
            timestamp: Date.now() 
        });
    }
    window.showToast("Order completed and recorded!", "success");
};

// ==========================================
// 6. PROFESSIONAL DELETE MODAL
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

const confirmDeleteBtn = document.getElementById('btn-confirm-delete');
if (confirmDeleteBtn) {
    confirmDeleteBtn.onclick = async () => {
        if (!deleteContext) return;
        const { id, path } = deleteContext;
        
        try {
            // Delete file from Storage if path exists
            if (path && path !== 'undefined') {
                await deleteObject(ref(storage, path)).catch(() => console.log('File already gone from storage'));
            }
            // Delete record from Firestore
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id));
            window.showToast("Job deleted successfully.", "info");
        } catch(e) { console.error(e); }
        
        window.closeConfirm();
    };
}

// ==========================================
// 7. ANALYTICS DATA LOADING
// ==========================================
function loadShopAnalytics() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'shop_analytics');
    
    onSnapshot(q, (snapshot) => {
        let totalRev = 0, todayRev = 0, todayTok = 0, logs = [];
        const today = new Date().toISOString().split('T')[0];

        snapshot.forEach(d => {
            const data = d.data();
            // RULE 2: Filtering by current shop in memory
            if (data.shopId !== currentShopId) return;

            totalRev += (data.revenue || 0);
            if (data.date === today) {
                todayRev = data.revenue;
                todayTok = data.totalTokens;
            }
            logs.push(data);
        });

        // Update UI counters
        if(document.getElementById('stat-earn-total')) document.getElementById('stat-earn-total').textContent = totalRev;
        if(document.getElementById('stat-earn-today')) document.getElementById('stat-earn-today').textContent = todayRev;
        if(document.getElementById('stat-tokens-today')) document.getElementById('stat-tokens-today').textContent = todayTok;

        // Populate Earning Ledger Table
        logs.sort((a, b) => b.date.localeCompare(a.date));
        const tbody = document.getElementById('daily-revenue-table');
        if (tbody) {
            tbody.innerHTML = logs.map(l => `
                <tr class="hover:bg-slate-50 transition-colors border-b border-slate-50">
                    <td class="p-5 font-bold text-slate-600">${l.date}</td>
                    <td class="p-5 text-center font-black text-blue-600">${l.totalTokens}</td>
                    <td class="p-5 text-right font-black text-emerald-600">₹${l.revenue}</td>
                </tr>
            `).join('');
        }
    });
}

// ==========================================
// 8. NOTIFICATION UTILITIES
// ==========================================
window.toggleSound = () => {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btn-sound');
    if (btn) {
        btn.innerHTML = soundEnabled ? '<i data-lucide="bell" class="w-5 h-5"></i>' : '<i data-lucide="bell-off" class="w-5 h-5 text-red-400"></i>';
        if (window.lucide) window.lucide.createIcons();
    }
    window.showToast(soundEnabled ? "Notifications sound ON" : "Notifications sound OFF");
};

function playAlertSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

// Initial Icon Refresh
if (window.lucide) window.lucide.createIcons();
