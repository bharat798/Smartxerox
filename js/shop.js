import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- Configuration & State ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
let currentShopId = null;
let currentShopRef = null; // Stores the detected path for rate updates
let soundEnabled = true;
let previousPendingCount = 0;
let qFilter = 'all';
let historyDateFilter = null; 
let allJobs = []; 
let deleteContext = null; 
let expiryContextId = null; 

// --- Helper: Format Date to DD/MM/YYYY ---
function formatToDDMMYYYY(dateStr) {
    if(!dateStr) return "";
    // Handle ISO string or YYYY-MM-DD
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj)) {
        const parts = dateStr.split('-'); 
        if(parts.length !== 3) return dateStr;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
}

// ==========================================
// 1. UI NAVIGATION & SIDEBAR (Window Scope)
// ==========================================
window.switchView = (name, el) => {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active-nav'));
    
    const target = document.getElementById('view-' + name);
    if (target) target.classList.add('active');
    
    if (name !== 'done') historyDateFilter = null; 

    if (el) el.classList.add('active-nav');
    else {
        const navId = 'nav-' + name;
        if(document.getElementById(navId)) document.getElementById(navId).classList.add('active-nav');
    }
    
    if (window.innerWidth < 768) window.toggleSidebar();
    if (window.lucide) window.lucide.createIcons();
    
    if(name === 'done') renderDone(); 
    if(name === 'analytics') updateAnalyticsUI();
    if(name === 'settings') loadShopPricingUI();
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

window.filterHistoryByDate = (dateStr) => {
    historyDateFilter = dateStr;
    window.switchView('done'); 
    window.showToast(`Showing history for ${formatToDDMMYYYY(dateStr)}`, "info");
};

// ==========================================
// 2. AUTHENTICATION & DATA LOADING
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const emailDisp = document.getElementById('shop-user-email');
            if(emailDisp) emailDisp.textContent = user.email || "Partner Account";

            // Multi-path search for user profile
            const pathsToTry = [
                doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'),
                doc(db, 'artifacts', appId, 'users', user.uid),
                doc(db, 'users', user.uid)
            ];

            let userData = null;
            for (let docRef of pathsToTry) {
                const snap = await getDoc(docRef);
                if (snap.exists()) {
                    userData = snap.data();
                    break;
                }
            }
            
            if (userData && userData.shopId) {
                currentShopId = userData.shopId;
                
                // Search for the correct shop path and store it
                const shopPaths = [
                    doc(db, 'artifacts', appId, 'public', 'data', 'shops', currentShopId),
                    doc(db, 'shops', currentShopId)
                ];

                let shopData = null;
                for(let sRef of shopPaths) {
                    const sSnap = await getDoc(sRef);
                    if(sSnap.exists()) {
                        shopData = sSnap.data();
                        currentShopRef = sRef; // Set reference for saveShopRates
                        break;
                    }
                }
                
                if (shopData) {
                    document.getElementById('ui-shop-name').textContent = shopData.shopName;
                    const ownerEl = document.getElementById('shop-owner-name');
                    if(ownerEl) ownerEl.textContent = shopData.ownerName || "Shop Owner";
                    document.getElementById('ui-shop-id').textContent = 'ID: ' + currentShopId;
                }

                generateShopQR();
                startListeningToQueue();
                initAnalyticsListener(); 
                loadShopPricingUI(); 
            } else {
                document.getElementById('ui-shop-name').textContent = "Unauthorized Access";
            }
        } catch(e) { console.error("Dashboard init error:", e); }
    } else {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    }
});

const logoutBtn = document.getElementById('btn-logout');
if (logoutBtn) {
    logoutBtn.onclick = () => {
        signOut(auth).then(() => { window.location.href = "index.html"; });
    };
}

// ==========================================
// 3. QR CODE LOGIC
// ==========================================
function generateShopQR() {
    const con = document.getElementById('main-qr-canvas');
    if (!con || !currentShopId) return;
    con.innerHTML = "";
    const baseUrl = window.location.origin + window.location.pathname.replace('shop.html', 'customer.html');
    const shopUrl = `${baseUrl}?shop=${currentShopId}`;
    if(document.getElementById('qr-link-text')) document.getElementById('qr-link-text').textContent = shopUrl;
    if (typeof window.QRCode !== 'undefined') {
        new window.QRCode(con, { text: shopUrl, width: 180, height: 180, colorDark : "#0f172a", colorLight : "#ffffff", correctLevel : window.QRCode.CorrectLevel.H });
    }
}

window.copyShopLink = () => {
    const url = document.getElementById('qr-link-text').textContent;
    const el = document.createElement('textarea');
    el.value = url;
    document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
    window.showToast('Shop Link Copied!', 'success');
};

// ==========================================
// 4. REAL-TIME QUEUE LISTENER
// ==========================================
function startListeningToQueue() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'prints');
    onSnapshot(q, (snapshot) => {
        allJobs = [];
        let pendingCount = 0;
        const now = Date.now();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            if (data.shopId !== currentShopId) return;

            if (data.expiresAt && now > data.expiresAt && !data.fileDeleted) {
                if (data.filePath) deleteObject(ref(storage, data.filePath)).catch(() => {});
                updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', data.id), { 
                    fileDeleted: true,
                    fileUrl: null,
                    filePath: null 
                });
                return;
            }
            
            allJobs.push(data);
            if (data.status === 'Pending' || data.status === 'Printing') pendingCount++;
        });

        if(document.getElementById('s-pending')) document.getElementById('s-pending').textContent = pendingCount;
        if(document.getElementById('s-total')) document.getElementById('s-total').textContent = allJobs.length;
        
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
    
    let timeLabel = '';
    if (j.expiresAt && !j.fileDeleted) {
        const remainingMinutes = Math.round((j.expiresAt - Date.now()) / (1000 * 60));
        if (remainingMinutes > 60) timeLabel = Math.floor(remainingMinutes / 60) + "h left";
        else timeLabel = Math.max(0, remainingMinutes) + "m left";
    }

    const fileActionHtml = j.fileDeleted ? 
        `<div class="text-[10px] font-bold text-red-500 bg-red-50 px-3 py-2 rounded-xl uppercase border border-red-100 flex items-center gap-1"><i data-lucide="file-x-2" class="w-3 h-3"></i> Document Deleted</div>` :
        `<a href="${j.fileUrl}" target="_blank" class="text-[10px] font-black text-blue-600 bg-blue-100 px-3 py-2 rounded-xl uppercase hover:bg-blue-200 transition-colors flex items-center gap-1"><i data-lucide="external-link" class="w-3 h-3"></i> Open</a>`;

    const priceBadge = `<div class="bg-emerald-500 text-white px-2 py-1 rounded-lg text-xs font-black shadow-sm">₹${j.billEstimate || 0}</div>`;

    return `
    <div class="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden transition-all hover:shadow-md ${isDone ? 'opacity-75' : ''}">
        <div class="absolute left-0 top-0 bottom-0 w-1.5 ${statusCol}"></div>
        <div class="flex justify-between items-start mb-4">
            <div class="flex items-center gap-2">
                <div class="bg-slate-900 text-white px-3 py-1.5 rounded-xl text-xl font-black">#${j.token}</div>
                ${priceBadge}
            </div>
            <div class="flex flex-col items-end">
                <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-1 rounded-md uppercase">${time}</div>
                ${isDone && timeLabel && !j.fileDeleted ? `<div class="text-[9px] font-bold text-blue-500 mt-1 flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i> ${timeLabel}</div>` : ''}
                ${j.fileDeleted ? `<div class="text-[9px] font-bold text-slate-400 mt-1 italic">Record Kept</div>` : ''}
            </div>
        </div>
        
        <div class="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-4">
            <div class="p-2 bg-white rounded-xl shadow-xs"><i data-lucide="file-text" class="w-5 h-5 text-blue-500"></i></div>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-bold text-slate-700 truncate">${j.fileName}</p>
                <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">${j.settings.colorMode} • ${j.settings.paperSize} • ${j.settings.copies} sets</p>
            </div>
            ${fileActionHtml}
        </div>

        ${j.settings.notes ? `<div class="mb-4 text-[11px] bg-amber-50 p-3 rounded-xl text-amber-700 italic border border-amber-100 flex gap-2"><span>Note: ${j.settings.notes}</span></div>` : ''}

        <div class="flex gap-2">
            ${!isDone ? 
                (j.status === 'Pending' ? 
                    `<button onclick="window.updateJobStatus('${j.id}', 'Printing')" class="flex-1 bg-blue-600 text-white text-xs font-black py-3 rounded-xl shadow-lg active:scale-95 transition-all">Start Print</button>` : 
                    `<button onclick="window.markJobAsDone('${j.id}')" class="flex-1 bg-emerald-600 text-white text-xs font-black py-3 rounded-xl shadow-lg active:scale-95 transition-all">Complete</button>`) 
                : `<div class="flex-1 text-center py-2 text-emerald-600 font-black text-xs uppercase bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-center gap-2">Printed <i data-lucide="check-circle" class="w-3.5 h-3.5"></i></div>`
            }
            
            ${!j.fileDeleted ? `
                <button onclick="window.openExpiryModal('${j.id}')" class="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors" title="Set Auto-Delete Timer">
                    <i data-lucide="timer" class="w-5 h-5"></i>
                </button>
            ` : ''}

            <button onclick="window.askDelete('${j.id}', '${j.filePath}', ${isDone})" class="p-3 text-slate-400 hover:text-red-600 transition-colors" title="${isDone ? 'Delete Document Only' : 'Delete Order'}">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
        </div>
    </div>`;
}

function renderQueue() {
    const qc = document.getElementById('queue-cards');
    if (!qc) return;
    const filtered = allJobs.filter(j => j.status !== 'Done' && (qFilter === 'all' || j.status === qFilter));
    qc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-20 text-center"><p class="text-sm font-bold text-slate-400 uppercase tracking-widest text-xs">Queue is Empty</p></div>`;
    if (window.lucide) window.lucide.createIcons();
}

function renderDone() {
    const dc = document.getElementById('done-cards');
    if (!dc) return;
    
    let filtered = allJobs.filter(j => j.status === 'Done');
    
    if (historyDateFilter) {
        filtered = filtered.filter(j => new Date(j.createdAt).toISOString().split('T')[0] === historyDateFilter);
    }

    if (!filtered.length) {
        dc.innerHTML = `<div class="col-span-full py-20 text-center"><p class="text-sm font-bold text-slate-400 uppercase tracking-widest text-xs">${historyDateFilter ? 'No jobs for ' + formatToDDMMYYYY(historyDateFilter) : 'No history found'}</p></div>`;
        return;
    }

    const groups = {};
    filtered.forEach(j => {
        const rawDate = new Date(j.createdAt).toISOString().split('T')[0];
        const displayDate = formatToDDMMYYYY(rawDate);
        if(!groups[displayDate]) groups[displayDate] = [];
        groups[displayDate].push(j);
    });

    let html = '';
    for (const date in groups) {
        html += `<div class="col-span-full mt-6 mb-2 flex items-center gap-4">
                    <div class="h-px bg-slate-200 flex-1"></div>
                    <span class="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] whitespace-nowrap">${date}</span>
                    <div class="h-px bg-slate-200 flex-1"></div>
                 </div>`;
        html += groups[date].map(j => buildCard(j)).join('');
    }
    
    dc.innerHTML = html;
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
    const today = new Date().toISOString().split('T')[0];
    const statRef = doc(db, 'artifacts', appId, 'public', 'data', 'shop_analytics', `${currentShopId}_${today}`);
    const amount = Number(job.billEstimate) || 0;
    const statSnap = await getDoc(statRef);
    if (statSnap.exists()) await updateDoc(statRef, { revenue: increment(amount), totalTokens: increment(1) });
    else await setDoc(statRef, { shopId: currentShopId, date: today, revenue: amount, totalTokens: 1, timestamp: Date.now() });
    window.showToast("Job Done & Revenue Added!", "success");
};

// ==========================================
// 6. ANALYTICS LOGIC (Simplified)
// ==========================================
function initAnalyticsListener() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'shop_analytics');
    onSnapshot(q, (snapshot) => {
        globalAnalyticsData = [];
        snapshot.forEach(d => {
            if (d.data().shopId === currentShopId) {
                globalAnalyticsData.push(d.data());
            }
        });
        updateAnalyticsUI();
    });
}

function updateAnalyticsUI() {
    let totalRevAllTime = 0;
    let todayRev = 0;
    let todayTok = 0;
    let logs = [...globalAnalyticsData];
    const todayStr = new Date().toISOString().split('T')[0];

    globalAnalyticsData.forEach(data => {
        totalRevAllTime += (data.revenue || 0);
        if (data.date === todayStr) {
            todayRev = data.revenue;
            todayTok = data.totalTokens;
        }
    });

    if(document.getElementById('stat-earn-today')) document.getElementById('stat-earn-today').textContent = todayRev;
    if(document.getElementById('stat-tokens-today')) document.getElementById('stat-tokens-today').textContent = todayTok;
    if(document.getElementById('stat-earn-total')) document.getElementById('stat-earn-total').textContent = totalRevAllTime;

    logs.sort((a, b) => b.date.localeCompare(a.date));
    const tbody = document.getElementById('daily-revenue-table');
    if (tbody) {
        tbody.innerHTML = logs.map(l => `
            <tr onclick="window.filterHistoryByDate('${l.date}')" class="hover:bg-blue-50 cursor-pointer transition-colors border-b border-slate-50 font-medium group">
                <td class="p-5 text-slate-600 flex items-center gap-2 group-hover:text-blue-600">
                    <i data-lucide="calendar" class="w-4 h-4 text-slate-300 group-hover:text-blue-400"></i> ${formatToDDMMYYYY(l.date)}
                </td>
                <td class="p-5 text-center text-blue-600 font-bold">${l.totalTokens}</td>
                <td class="p-5 text-right text-emerald-600 font-black">₹${l.revenue}</td>
            </tr>
        `).join('');
        if(window.lucide) window.lucide.createIcons();
    }
}

// ==========================================
// 7. SHOP PRICING LOGIC (Decimals Fixed)
// ==========================================
async function loadShopPricingUI() {
    if(!currentShopRef) return; 
    try {
        const snap = await getDoc(currentShopRef);
        if(snap.exists()){
            const d = snap.data();
            const bwInput = document.getElementById('bw-rate-input');
            const colorInput = document.getElementById('color-rate-input');
            if(bwInput) bwInput.value = d.bwRate || 2;
            if(colorInput) colorInput.value = d.colorRate || 10;
        }
    } catch(e) { console.error(e); }
}

window.saveShopRates = async () => {
    const bwRaw = document.getElementById('bw-rate-input').value;
    const colorRaw = document.getElementById('color-rate-input').value;
    
    const bw = parseFloat(bwRaw);
    const color = parseFloat(colorRaw);
    
    if(isNaN(bw) || isNaN(color) || bw < 0 || color < 0){
        window.showToast("Kripya sahi rate bhariye.", "error");
        return;
    }

    if(!currentShopRef) {
        window.showToast("Shop data loading... Please wait.", "info");
        return;
    }

    try {
        await updateDoc(currentShopRef, {
            bwRate: bw,
            colorRate: color
        });
        window.showToast("Rates update ho gaye!", "success");
    } catch(e) {
        console.error("Save Rates Error:", e);
        window.showToast("Error: " + e.message, "error");
    }
};

// ==========================================
// 8. PROFESSIONAL MODALS
// ==========================================
window.askDelete = (id, path, isDoneRecord) => {
    deleteContext = { id, path, isDoneRecord };
    const modal = document.getElementById('confirm-modal');
    if (modal) {
        const title = modal.querySelector('h3');
        const desc = modal.querySelector('p');
        if (isDoneRecord) {
            title.textContent = "Delete Document Only?";
            desc.textContent = "Isse Storage se file delete ho jayegi lekin aapka transaction record safe rahega.";
        } else {
            title.textContent = "Cancel Order?";
            desc.textContent = "Is order ko poori tarah queue se hata diya jayega.";
        }
        modal.classList.remove('hidden');
    }
};

window.closeConfirm = () => {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    deleteContext = null;
};

document.getElementById('btn-confirm-delete').onclick = async () => {
    if (!deleteContext) return;
    const { id, path, isDoneRecord } = deleteContext;
    try {
        if (path && path !== 'undefined') {
            await deleteObject(ref(storage, path)).catch(() => {});
        }
        if (isDoneRecord) {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), {
                fileDeleted: true,
                fileUrl: null,
                filePath: null
            });
            window.showToast("File deleted, record kept.", "info");
        } else {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id));
            window.showToast("Order removed.", "info");
        }
    } catch(e) { console.error(e); }
    window.closeConfirm();
};

window.openExpiryModal = (id) => {
    expiryContextId = id;
    const modal = document.getElementById('expiry-modal');
    if (modal) {
        modal.classList.remove('hidden');
        // PROPORTIONAL ALIGNMENT FIX
        const unitSelect = document.getElementById('expiry-unit');
        const valInput = document.getElementById('expiry-val');
        if(unitSelect && valInput) {
            valInput.style.width = "65%";
            unitSelect.style.width = "35%";
        }
    }
};

window.closeExpiryModal = () => {
    const modal = document.getElementById('expiry-modal');
    if (modal) modal.classList.add('hidden');
    expiryContextId = null;
};

document.getElementById('btn-save-expiry').onclick = async () => {
    if (!expiryContextId) return;
    const val = parseInt(document.getElementById('expiry-val').value);
    const unit = document.getElementById('expiry-unit').value;
    if (isNaN(val) || val <= 0) { window.showToast("Invalid number.", "error"); return; }
    let multiplier = unit === 'hours' ? (60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    const newExpiry = Date.now() + (val * multiplier);
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', expiryContextId), { expiresAt: newExpiry });
        window.showToast(`Timer set for ${val} ${unit}.`, "success");
        window.closeExpiryModal();
    } catch(e) { console.error(e); }
};

window.toggleSound = () => { soundEnabled = !soundEnabled; window.showToast(soundEnabled ? "Sound ON" : "Sound Muted"); };

function playAlertSound() { try { const audioCtx = new AudioContext(); const oscillator = audioCtx.createOscillator(); oscillator.connect(audioCtx.destination); oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); oscillator.start(); oscillator.stop(audioCtx.currentTime + 0.15); } catch(e) {} }

window.showToast = (msg, type = 'info') => {
    const t = document.getElementById('toast');
    const msgEl = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    if (msgEl) msgEl.textContent = msg;
    if (icon) {
        icon.setAttribute('class', `w-5 h-5 ${type === 'success' ? 'text-emerald-400' : 'text-blue-400'}`);
        icon.setAttribute('data-lucide', type === 'success' ? 'check-circle' : 'info');
    }
    if (window.lucide) window.lucide.createIcons();
    if (t) { t.classList.remove('opacity-0', '-translate-y-4'); t.classList.add('opacity-100', 'translate-y-0'); setTimeout(() => { if(t) { t.classList.remove('opacity-100', 'translate-y-0'); t.classList.add('opacity-0', '-translate-y-4'); } }, 3000); }
};

if (window.lucide) window.lucide.createIcons();
