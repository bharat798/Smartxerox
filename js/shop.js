import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// --- Configuration & State ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
let currentShopId = null;
let currentShopRef = null; 
let soundEnabled = true;
let previousPendingCount = 0;
let qFilter = 'all';
let historyDateFilter = null; 
let allJobs = []; 
let deleteContext = null; 
let expiryContextId = null; 

let globalAnalyticsData = []; 

// --- Helper: Format Date to DD/MM/YYYY ---
function formatToDDMMYYYY(dateStr) {
    if(!dateStr) return "";
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

// --- Helper: Format Full Time (HH:MM AM/PM) ---
function formatTime(timestamp) {
    if(!timestamp) return "";
    const date = timestamp.seconds ? new Date(timestamp.seconds * 1000) : new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- Helper: Format Expiry Full (DD/MM/YYYY HH:MM) ---
function formatExpiryFull(expiryTimestamp) {
    if(!expiryTimestamp) return "";
    const date = new Date(expiryTimestamp);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${day}/${month}/${year} ${time}`;
}

// 🟢 NEW: Clean View Function to prevent URL/Header/Footer in prints 🟢
window.viewFile = (url, fileName) => {
    const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
    if (isImage) {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>${fileName}</title>
                <style>
                    @page { size: auto; margin: 0mm; }
                    body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #fff; }
                    img { max-width: 100%; max-height: 100%; object-fit: contain; page-break-inside: avoid; }
                </style>
            </head>
            <body>
                <img src="${url}">
            </body>
            </html>
        `);
        printWindow.document.close();
    } else {
        // PDFs already handle clean printing well in browsers
        window.open(url, '_blank');
    }
};

// ==========================================
// 1. UI NAVIGATION & SIDEBAR
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
    
    if (window.innerWidth < 1024 && document.getElementById('sidebar')) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
        const overlay = document.getElementById('mobile-overlay');
        if(overlay) overlay.classList.add('hidden');
    }
    
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
        b.classList.remove('bg-white', 'shadow-sm', 'text-slate-800');
        b.classList.add('text-slate-500');
    });
    btn.classList.add('bg-white', 'shadow-sm', 'text-slate-800');
    btn.classList.remove('text-slate-500');
    renderQueue();
};

window.filterHistoryByDate = (dateStr) => {
    historyDateFilter = dateStr;
    window.switchView('done'); 
    window.showToast(`Showing history for ${formatToDDMMYYYY(dateStr)}`, "info");
};

// ==========================================
// 2. AUTH & SHOP INITIALIZATION
// ==========================================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const emailDisp = document.getElementById('shop-user-email');
            if(emailDisp) emailDisp.textContent = user.email;

            const pathsToTry = [
                doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'data'),
                doc(db, 'artifacts', appId, 'users', user.uid),
                doc(db, 'users', user.uid)
            ];

            let userData = null;
            for (let docRef of pathsToTry) {
                const snap = await getDoc(docRef);
                if (snap.exists()) { userData = snap.data(); break; }
            }
            
            if (userData && userData.shopId) {
                currentShopId = userData.shopId;
                
                const shopPaths = [
                    doc(db, 'artifacts', appId, 'public', 'data', 'shops', currentShopId),
                    doc(db, 'shops', currentShopId)
                ];

                let shopData = null;
                for(let sRef of shopPaths) {
                    const sSnap = await getDoc(sRef);
                    if(sSnap.exists()) {
                        shopData = sSnap.data();
                        currentShopRef = sRef; 
                        break;
                    }
                }
                
                if (shopData) {
                    document.getElementById('ui-shop-name').textContent = shopData.shopName;
                    const ownerEl = document.getElementById('shop-owner-name');
                    if(ownerEl) ownerEl.textContent = shopData.ownerName || "Authorized Manager";
                    document.getElementById('ui-shop-id').textContent = 'ID: ' + currentShopId;
                }

                generateShopQR();
                startListeningToQueue();
                initAnalyticsListener(); 
                loadShopPricingUI(); 
            }
        } catch(e) { console.error("Dashboard error:", e); }
    } else {
        window.location.href = "index.html";
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
    
    const currentUrl = window.location.origin + window.location.pathname;
    const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/')) + "/customer.html";
    const shopUrl = `${baseUrl}?shop=${currentShopId}`;
    
    if(document.getElementById('qr-link-text')) document.getElementById('qr-link-text').textContent = shopUrl;
    
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
    document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
    window.showToast('Link copied to clipboard!', 'success');
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

            // Auto-Delete logic
            if (data.expiresAt && now > data.expiresAt && !data.fileDeleted) {
                if (data.files && Array.isArray(data.files)) {
                    data.files.forEach(f => {
                        if (f.filePath) deleteObject(ref(storage, f.filePath)).catch(() => {});
                    });
                } else if (data.filePath) {
                    deleteObject(ref(storage, data.filePath)).catch(() => {});
                }
                
                updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', data.id), { 
                    fileDeleted: true
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

        // Sorting: Newest first
        allJobs.sort((a, b) => {
            const timeA = a.createdAt?.seconds || a.createdAt || 0;
            const timeB = b.createdAt?.seconds || b.createdAt || 0;
            return timeB - timeA;
        });

        renderQueue();
        renderDone();
    });
}

/**
 * 🟢 BUILD CARD UI: Display Time & Scheduled Delete 🟢
 */
function buildCard(j) {
    const isDone = j.status === 'Done';
    const timeStr = formatTime(j.createdAt);
    const statusCol = j.status === 'Pending' ? 'bg-yellow-400' : j.status === 'Printing' ? 'bg-blue-600' : 'bg-emerald-500';
    
    let filesHtml = "";
    if (j.files && Array.isArray(j.files)) {
        filesHtml = j.files.map(f => {
            // Clean filename for safety in JS call
            const safeFileName = f.fileName.replace(/'/g, "\\'");
            return `
                <div class="flex items-center gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100 mb-2 group/file">
                    <div class="p-2 bg-white rounded-xl shadow-xs shrink-0"><i data-lucide="file-text" class="w-5 h-5 ${f.settings?.colorMode === 'color' ? 'text-purple-500' : 'text-blue-500'}"></i></div>
                    <div class="flex-1 min-w-0">
                        <p class="text-[13px] font-bold text-slate-700 truncate">${f.fileName}</p>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">${f.settings?.colorMode?.toUpperCase() || 'B&W'} • ${f.pages || 1} Pgs • ₹${f.price || 0}</p>
                    </div>
                    ${!j.fileDeleted ? `
                        <button onclick="window.viewFile('${f.fileUrl}', '${safeFileName}')" class="text-[10px] font-black text-blue-600 bg-blue-50 px-3 py-2 rounded-lg uppercase hover:bg-blue-600 hover:text-white transition-all">Open</button>
                    ` : ''}
                </div>
            `;
        }).join('');
    }

    const priceBadge = `<div class="bg-emerald-500 text-white px-2.5 py-1.5 rounded-xl text-xs font-black shadow-sm">₹${j.billEstimate || 0}</div>`;

    // SCHEDULED DELETION INFO
    let deletionHtml = "";
    if(j.expiresAt && !j.fileDeleted) {
        deletionHtml = `
            <div class="mt-3 flex items-center gap-1.5 text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-3 py-1.5 rounded-xl w-fit">
                <i data-lucide="clock-alert" class="w-3.5 h-3.5"></i>
                Scheduled Deletion: ${formatExpiryFull(j.expiresAt)}
            </div>
        `;
    }

    return `
    <div class="bg-white rounded-[2rem] p-6 border border-slate-200 shadow-sm relative overflow-hidden transition-all hover:shadow-xl ${isDone ? 'opacity-90' : ''}">
        <div class="absolute left-0 top-0 bottom-0 w-2 ${statusCol}"></div>
        
        <div class="flex justify-between items-start mb-5">
            <div class="flex items-center gap-3">
                <div class="bg-slate-900 text-white px-4 py-2 rounded-2xl text-xl font-black shadow-lg">#${j.token}</div>
                ${priceBadge}
            </div>
            <div class="flex flex-col items-end">
                <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">Received At: ${timeStr}</div>
                ${j.fileDeleted ? `<div class="text-[9px] font-black text-red-500 mt-2 flex items-center gap-1"><i data-lucide="shield-off" class="w-3 h-3"></i> FILES PURGED</div>` : ''}
            </div>
        </div>
        
        <div class="mb-5">
            ${filesHtml}
        </div>

        ${j.notes ? `<div class="mb-4 text-[11px] bg-amber-50 p-4 rounded-2xl text-amber-700 border border-amber-100 italic flex gap-2 leading-relaxed"><i data-lucide="info" class="w-4 h-4 mt-0.5 shrink-0"></i> <span>Customer Note: ${j.notes}</span></div>` : ''}

        ${deletionHtml}

        <div class="flex gap-3 mt-6">
            ${!isDone ? 
                (j.status === 'Pending' ? 
                    `<button onclick="window.updateJobStatus('${j.id}', 'Printing')" class="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-black py-4 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"><i data-lucide="printer" class="w-4 h-4"></i> Start Printing</button>` : 
                    `<button onclick="window.markJobAsDone('${j.id}')" class="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-black py-4 rounded-2xl shadow-lg active:scale-95 flex items-center justify-center gap-2"><i data-lucide="check-circle" class="w-4 h-4"></i> Mark as Done</button>`) 
                : `<div class="flex-1 text-center py-3.5 text-emerald-600 font-black text-xs uppercase bg-emerald-50 rounded-2xl border border-emerald-100 flex items-center justify-center gap-2">Print Completed <i data-lucide="check-check" class="w-4 h-4"></i></div>`
            }
            
            ${!j.fileDeleted ? `
                <button onclick="window.openExpiryModal('${j.id}')" class="p-4 text-slate-400 bg-slate-50 border border-slate-100 hover:text-blue-600 hover:bg-white rounded-2xl transition-all shadow-sm" title="Set Deletion Timer">
                    <i data-lucide="timer" class="w-5 h-5"></i>
                </button>
            ` : ''}

            <button onclick="window.askDelete('${j.id}', '${j.filePath}', ${isDone})" class="p-4 text-slate-400 bg-slate-50 border border-slate-100 hover:text-red-600 hover:bg-white rounded-2xl transition-all shadow-sm">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
        </div>
    </div>`;
}

function renderQueue() {
    const qc = document.getElementById('queue-cards');
    if (!qc) return;
    const filtered = allJobs.filter(j => j.status !== 'Done' && (qFilter === 'all' || j.status === qFilter));
    qc.innerHTML = filtered.length ? filtered.map(j => buildCard(j)).join('') : `<div class="col-span-full py-24 text-center"><div class="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 border-2 border-slate-200 border-dashed"><i data-lucide="inbox" class="w-10 h-10 text-slate-300"></i></div><p class="text-sm font-bold text-slate-400 uppercase tracking-[0.2em]">Queue is currently empty</p></div>`;
    if (window.lucide) window.lucide.createIcons();
}

function renderDone() {
    const dc = document.getElementById('done-cards');
    if (!dc) return;
    
    let filtered = allJobs.filter(j => j.status === 'Done');
    if (historyDateFilter) {
        filtered = filtered.filter(j => {
            const d = j.createdAt?.seconds ? new Date(j.createdAt.seconds * 1000) : new Date(j.createdAt);
            return d.toISOString().split('T')[0] === historyDateFilter;
        });
    }

    if (!filtered.length) {
        dc.innerHTML = `<div class="col-span-full py-20 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">No matching history found</div>`;
        return;
    }

    // Grouping by Date
    const groups = {};
    filtered.forEach(j => {
        const rawDate = j.createdAt?.seconds ? new Date(j.createdAt.seconds * 1000).toISOString().split('T')[0] : new Date(j.createdAt).toISOString().split('T')[0];
        const displayDate = formatToDDMMYYYY(rawDate);
        if(!groups[displayDate]) groups[displayDate] = [];
        groups[displayDate].push(j);
    });

    let html = '';
    for (const date in groups) {
        html += `<div class="col-span-full mt-10 mb-4 flex items-center gap-6">
                    <div class="h-[1px] bg-slate-200 flex-1"></div>
                    <span class="text-[11px] font-black uppercase text-slate-400 tracking-[0.3em] whitespace-nowrap bg-slate-100 px-4 py-1.5 rounded-full border border-slate-200 shadow-sm">${date}</span>
                    <div class="h-[1px] bg-slate-200 flex-1"></div>
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
    window.showToast(`Order status set to: ${status}`, "info");
};

window.markJobAsDone = async (id) => {
    const job = allJobs.find(j => j.id === id);
    if (!job) return;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { status: 'Done' });
    
    const createdAt = job.createdAt?.seconds ? new Date(job.createdAt.seconds * 1000) : new Date(job.createdAt);
    const dateKey = createdAt.toISOString().split('T')[0];
    const statRef = doc(db, 'artifacts', appId, 'public', 'data', 'shop_analytics', `${currentShopId}_${dateKey}`);
    const amount = parseFloat(job.billEstimate) || 0;

    const statSnap = await getDoc(statRef);
    if (statSnap.exists()) await updateDoc(statRef, { revenue: increment(amount), totalTokens: increment(1) });
    else await setDoc(statRef, { shopId: currentShopId, date: dateKey, revenue: amount, totalTokens: 1, timestamp: Date.now() });
    
    window.showToast("Job Completed! Revenue updated.", "success");
};

// ==========================================
// 6. ANALYTICS
// ==========================================
function initAnalyticsListener() {
    const q = collection(db, 'artifacts', appId, 'public', 'data', 'shop_analytics');
    onSnapshot(q, (snapshot) => {
        globalAnalyticsData = [];
        snapshot.forEach(d => {
            if (d.data().shopId === currentShopId) globalAnalyticsData.push(d.data());
        });
        updateAnalyticsUI();
    });
}

function updateAnalyticsUI() {
    let totalRev = 0, todayRev = 0, todayTok = 0;
    const todayStr = new Date().toISOString().split('T')[0];

    globalAnalyticsData.forEach(data => {
        totalRev += (data.revenue || 0);
        if (data.date === todayStr) { todayRev = data.revenue; todayTok = data.totalTokens; }
    });

    if(document.getElementById('stat-earn-today')) document.getElementById('stat-earn-today').textContent = todayRev.toFixed(1);
    if(document.getElementById('stat-tokens-today')) document.getElementById('stat-tokens-today').textContent = todayTok;
    if(document.getElementById('stat-earn-total')) document.getElementById('stat-earn-total').textContent = totalRev.toFixed(1);

    const tbody = document.getElementById('daily-revenue-table');
    if (tbody) {
        globalAnalyticsData.sort((a, b) => b.date.localeCompare(a.date));
        tbody.innerHTML = globalAnalyticsData.map(l => `
            <tr onclick="window.filterHistoryByDate('${l.date}')" class="hover:bg-blue-50 cursor-pointer transition-colors border-b border-slate-50 font-medium group">
                <td class="p-5 text-slate-600 flex items-center gap-2 group-hover:text-blue-600">
                    <i data-lucide="calendar" class="w-4 h-4 text-slate-300 group-hover:text-blue-400"></i> ${formatToDDMMYYYY(l.date)}
                </td>
                <td class="p-5 text-center text-blue-600 font-bold">${l.totalTokens}</td>
                <td class="p-5 text-right text-emerald-600 font-black">₹${l.revenue.toFixed(1)}</td>
            </tr>
        `).join('');
        if(window.lucide) window.lucide.createIcons();
    }
}

// ==========================================
// 7. SHOP PRICING SETTINGS
// ==========================================
async function loadShopPricingUI() {
    if(!currentShopRef) return; 
    try {
        const snap = await getDoc(currentShopRef);
        if(snap.exists()){
            const d = snap.data();
            if(document.getElementById('bw-rate-input')) document.getElementById('bw-rate-input').value = d.bwRate || 2;
            if(document.getElementById('bw-bulk-input')) document.getElementById('bw-bulk-input').value = d.bwRateBulk || d.bwRate || 2;
            if(document.getElementById('color-rate-input')) document.getElementById('color-rate-input').value = d.colorRate || 10;
            if(document.getElementById('color-bulk-input')) document.getElementById('color-bulk-input').value = d.colorRateBulk || d.colorRate || 10;
            if(document.getElementById('tier-threshold')) document.getElementById('tier-threshold').value = d.tierThreshold || 3;
        }
    } catch(e) { console.error(e); }
}

window.saveShopRates = async () => {
    const bw = parseFloat(document.getElementById('bw-rate-input').value);
    const bwBulk = parseFloat(document.getElementById('bw-bulk-input').value);
    const color = parseFloat(document.getElementById('color-rate-input').value);
    const colorBulk = parseFloat(document.getElementById('color-bulk-input').value);
    const threshold = parseInt(document.getElementById('tier-threshold').value);
    
    if(isNaN(bw) || isNaN(color) || isNaN(threshold)){
        window.showToast("Please enter valid rate values.", "error");
        return;
    }

    try {
        await updateDoc(currentShopRef, {
            bwRate: bw, bwRateBulk: bwBulk,
            colorRate: color, colorRateBulk: colorBulk,
            tierThreshold: threshold
        });
        window.showToast("Pricing tiers saved successfully!", "success");
    } catch(e) { window.showToast("Failed to save pricing.", "error"); }
};

// ==========================================
// 8. MODALS & UTILS
// ==========================================
window.askDelete = (id, path, isDoneRecord) => {
    deleteContext = { id, path, isDoneRecord };
    const modal = document.getElementById('confirm-modal');
    if (modal) {
        modal.querySelector('p').textContent = isDoneRecord ? "Document will be removed from storage, but the history record will stay." : "This will cancel the order and delete it permanently.";
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
    const { id, isDoneRecord } = deleteContext;
    try {
        const job = allJobs.find(x => x.id === id);
        if (job) {
            if (job.files && Array.isArray(job.files)) {
                for (let f of job.files) {
                    if (f.filePath) await deleteObject(ref(storage, f.filePath)).catch(() => {});
                }
            } else if (job.filePath) {
                await deleteObject(ref(storage, job.filePath)).catch(() => {});
            }
        }
        
        if (isDoneRecord) {
            await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id), { fileDeleted: true });
            window.showToast("Files deleted. Transaction record saved.");
        } else {
            await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', id));
            window.showToast("Order removed successfully.");
        }
    } catch(e) { console.error(e); }
    window.closeConfirm();
};

window.openExpiryModal = (id) => {
    expiryContextId = id;
    document.getElementById('expiry-modal').classList.remove('hidden');
    const v = document.getElementById('expiry-val');
    const u = document.getElementById('expiry-unit');
    if(v && u) { v.style.width = "65%"; u.style.width = "35%"; }
};

window.closeExpiryModal = () => {
    document.getElementById('expiry-modal').classList.add('hidden');
    expiryContextId = null;
};

document.getElementById('btn-save-expiry').onclick = async () => {
    if (!expiryContextId) return;
    const val = parseInt(document.getElementById('expiry-val').value);
    const unit = document.getElementById('expiry-unit').value;
    if (isNaN(val) || val <= 0) {
        window.showToast("Please enter a valid number.", "error");
        return;
    }
    let mult = unit === 'hours' ? (60 * 60 * 1000) : (24 * 60 * 60 * 1000);
    try {
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'prints', expiryContextId), { expiresAt: Date.now() + (val * mult) });
        window.showToast(`Auto-delete scheduled: ${val} ${unit}.`, "success");
        window.closeExpiryModal();
    } catch(e) { console.error(e); }
};

window.toggleSound = () => { 
    soundEnabled = !soundEnabled; 
    const btn = document.getElementById('sound-btn');
    if(btn) btn.innerHTML = soundEnabled ? '<i data-lucide="bell" class="w-5 h-5 text-blue-500"></i>' : '<i data-lucide="bell-off" class="w-5 h-5 text-slate-400"></i>';
    window.showToast(soundEnabled ? "Notifications Sound: ON" : "Notifications Sound: OFF"); 
    lucide.createIcons();
};

function playAlertSound() { try { const audioCtx = new AudioContext(); const osc = audioCtx.createOscillator(); osc.connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + 0.15); } catch(e) {} }

window.showToast = (msg, type = 'info') => {
    const t = document.getElementById('toast');
    const msgEl = document.getElementById('toast-msg');
    const icon = t.querySelector('i');
    if (msgEl) msgEl.textContent = msg;
    if(icon) {
        icon.className = `w-5 h-5 ${type === 'success' ? 'text-emerald-400' : 'text-blue-400'}`;
        icon.setAttribute('data-lucide', type === 'success' ? 'check-circle' : 'info');
    }
    if (t) { t.classList.remove('opacity-0', '-translate-y-4'); t.classList.add('opacity-100', 'translate-y-0'); setTimeout(() => { if(t) { t.classList.remove('opacity-100', 'translate-y-0'); t.classList.add('opacity-0', '-translate-y-4'); } }, 3000); }
    lucide.createIcons();
};

if (window.lucide) window.lucide.createIcons();
