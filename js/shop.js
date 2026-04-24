import { auth, db, storage } from './firebase-init.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, query, where, onSnapshot, updateDoc, deleteDoc, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Global Variables
let currentShopId = null;
let soundEnabled = true;
let previousPendingCount = 0;
let qFilter = 'all';

let allJobs = []; 

// 1. UI Navigation Logic
window.switchView = (name, el) => {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => {
        n.className = "nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/5 border-l-2 border-transparent hover:text-white text-slate-300";
    });
    
    document.getElementById('view-' + name).classList.add('active');
    
    if(el) {
        el.className = "nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors bg-blue-500/10 text-white border-l-2 border-blue-500 hover:bg-white/5 active-nav";
    }
    if(window.innerWidth < 768) toggleSidebar();
}

window.toggleSidebar = () => {
    document.getElementById('sidebar').classList.toggle('-translate-x-full');
    document.getElementById('mobile-overlay').classList.toggle('hidden');
}

window.filterQ = (f, btn) => {
    qFilter = f;
    const btns = btn.parentElement.querySelectorAll('button');
    btns.forEach(b => b.className = "f-btn px-4 py-1.5 text-sm font-medium rounded-md text-slate-500 hover:text-slate-800 transition-all");
    btn.className = "f-btn px-4 py-1.5 text-sm font-medium rounded-md bg-white text-slate-800 shadow-sm transition-all";
    renderQueue();
}

// 2. Authentication & Initialization
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            // SET REAL EMAIL IN SIDEBAR
            const emailEl = document.getElementById('shop-user-email');
            if(emailEl) emailEl.textContent = user.email;

            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists() && userDoc.data().role === 'shop') {
                currentShopId = userDoc.data().shopId;
                
                const shopDoc = await getDoc(doc(db, "shops", currentShopId));
                if(shopDoc.exists()) {
                    document.getElementById('ui-shop-name').textContent = shopDoc.data().shopName;
                    document.getElementById('ui-shop-id').textContent = 'ID: ' + currentShopId;
                    
                    // SET REAL OWNER NAME IN SIDEBAR
                    const ownerEl = document.getElementById('shop-owner-name');
                    if(ownerEl) ownerEl.textContent = shopDoc.data().ownerName || "Shop Owner";
                }

                generateShopQR();
                startListeningToQueue();
                loadShopAnalytics(); // Start fetching daily revenue
            } else {
                alert("Unauthorized Access. Please login as a Shop Partner.");
                window.location.href = "index.html"; 
            }
        } catch(e) {
            console.error(e);
            window.location.href = "index.html"; 
        }
    } else {
        window.location.href = "index.html"; 
    }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    signOut(auth).then(() => window.location.href = "index.html"); 
});

// 3. QR Code Generator (Universal URL for GitHub/Localhost)
const getBaseUrl = () => window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '');

function generateShopQR() {
    const qrContainer = document.getElementById('main-qr-canvas');
    if(qrContainer) {
        qrContainer.innerHTML = ""; 
        
        const shopUrl = `${getBaseUrl()}/customer.html?shop=${currentShopId}`;
        document.getElementById('qr-link-text').textContent = shopUrl;
        
        // FIXED QR BUG: Checking window.QRCode
        if (typeof window.QRCode === 'undefined') {
            qrContainer.innerHTML = "<span class='text-xs text-red-500'>QR Load Error. Refresh page.</span>";
            return;
        }

        new window.QRCode(qrContainer, {
            text: shopUrl,
            width: 176,
            height: 176,
            colorDark : "#0f172a",
            colorLight : "#ffffff",
            correctLevel : window.QRCode.CorrectLevel.H
        });
    }
}

window.copyShopLink = () => {
    const link = document.getElementById('qr-link-text').textContent;
    navigator.clipboard.writeText(link).then(() => {
        showToast('Link copied to clipboard!', 'success');
    });
}

window.downloadShopQR = () => {
    alert("Please take a screenshot of this QR Code from your phone to share it with customers.");
}

// 4. Real-time Queue & Auto-Delete Logic
function startListeningToQueue() {
    const q = query(collection(db, "prints"), where("shopId", "==", currentShopId));
    
    onSnapshot(q, (snapshot) => {
        allJobs = [];
        let pendingCount = 0;
        let printingCount = 0;
        let doneCount = 0;
        const now = Date.now();

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            
            // AUTO-DELETE LOGIC (Storage + Database)
            if (data.expiresAt && now > data.expiresAt) {
                // Delete from Firebase Storage securely
                if (data.filePath) {
                    deleteObject(ref(storage, data.filePath)).catch(e => console.log('File already deleted from storage'));
                }
                // Delete from Database
                deleteDoc(doc(db, "prints", data.id));
                return; // Skip adding to UI
            }
            
            allJobs.push(data);
            if(data.status === 'Pending') pendingCount++;
            if(data.status === 'Printing') printingCount++;
            if(data.status === 'Done') doneCount++;
        });

        // Update Dashboard Stats
        if(document.getElementById('s-pending')) document.getElementById('s-pending').textContent = pendingCount + printingCount;
        if(document.getElementById('s-done')) document.getElementById('s-done').textContent = doneCount;
        if(document.getElementById('s-total')) document.getElementById('s-total').textContent = allJobs.length;
        
        // Update Sidebar Badge
        const activeCount = pendingCount + printingCount;
        const badge = document.getElementById('q-badge');
        if(badge) {
            badge.textContent = activeCount;
            badge.style.display = activeCount > 0 ? 'inline-block' : 'none';
        }

        // Play Alert Sound on new order
        if (pendingCount > previousPendingCount && soundEnabled) {
            playAlertSound();
        }
        previousPendingCount = pendingCount;

        // Sort newest first
        allJobs.sort((a, b) => b.createdAt - a.createdAt);

        renderQueue();
        renderDone();
    });
}

function getStatusColor(status) {
    if(status === 'Pending') return 'bg-yellow-400';
    if(status === 'Printing') return 'bg-blue-500';
    return 'bg-emerald-500';
}

function getStatusBadge(status) {
    if(status === 'Pending') return `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-yellow-100 text-yellow-700 border-yellow-200">Pending</span>`;
    if(status === 'Printing') return `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-blue-100 text-blue-700 border-blue-200">Printing...</span>`;
    return `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold border bg-emerald-100 text-emerald-700 border-emerald-200">Done</span>`;
}

function buildCard(j) {
    const isDone = j.status === 'Done';
    const ext = j.fileName.split('.').pop().toLowerCase();
    
    let iconStr = "file text-slate-500";
    if(ext === 'pdf') iconStr = "file-text text-red-500";
    else if(['jpg','jpeg','png'].includes(ext)) iconStr = "image text-purple-500";
    else if(['doc','docx'].includes(ext)) iconStr = "file-type text-blue-500";

    const typeLabel = j.settings.colorMode === 'color' 
        ? '<span class="flex items-center gap-1"><i data-lucide="palette" class="w-3.5 h-3.5 text-purple-500"></i> Color</span>' 
        : '<span class="flex items-center gap-1"><i data-lucide="droplet" class="w-3.5 h-3.5 text-slate-800 fill-slate-800"></i> B&W</span>';
    
    const notesHtml = j.settings.notes ? `
        <div class="mt-3 bg-amber-50/50 border border-amber-100 rounded-lg p-2.5 flex items-start gap-2">
            <i data-lucide="message-square" class="w-4 h-4 text-amber-500 mt-0.5 shrink-0"></i>
            <p class="text-xs font-medium text-amber-800 italic">${j.settings.notes}</p>
        </div>
    ` : '';

    const timeStr = new Date(j.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

    let actions = '';
    
    // Status Buttons
    if (!isDone) {
        if (j.status === 'Pending') {
            actions += `<button onclick="markPrinting('${j.id}')" class="flex-1 sm:flex-none flex justify-center items-center gap-1.5 px-4 py-2 border border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg text-sm font-semibold transition-colors"><i data-lucide="printer" class="w-4 h-4"></i> Start Print</button>`;
        } else if (j.status === 'Printing') {
            actions += `<button onclick="markDone('${j.id}')" class="flex-1 sm:flex-none flex justify-center items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-semibold transition-colors"><i data-lucide="check" class="w-4 h-4"></i> Mark Done</button>`;
        }
    } else {
         actions += `<span class="text-emerald-600 text-sm font-semibold flex items-center gap-1"><i data-lucide="check-circle-2" class="w-4 h-4"></i> Completed</span>`;
    }

    // CUSTOM TIMER BUTTON
    actions += `
        <button onclick="setCustomExpiry('${j.id}')" class="ml-auto p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Set Custom Auto-Delete Timer">
            <i data-lucide="clock" class="w-5 h-5"></i>
        </button>
    `;

    // MANUAL DELETE BUTTON
    actions += `
        <button onclick="deleteJob('${j.id}', '${j.filePath || ''}')" class="ml-2 p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete Job Permanently">
            <i data-lucide="trash-2" class="w-5 h-5"></i>
        </button>
    `;

    return `
    <div class="bg-white rounded-xl shadow-sm hover:shadow-md border border-slate-200 p-4 sm:p-5 transition-shadow relative overflow-hidden animate-slide-in ${isDone ? 'opacity-80' : ''}">
        <div class="absolute left-0 top-0 bottom-0 w-1 ${getStatusColor(j.status)}"></div>
        <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
            <div class="flex items-center gap-3">
                <div class="bg-blue-50 border border-blue-100 text-blue-700 rounded-lg px-3 py-2 text-center min-w-[70px]">
                    <div class="text-[10px] font-bold uppercase tracking-wider">Token</div>
                    <div class="text-xl font-black">${j.token}</div>
                </div>
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        ${getStatusBadge(j.status)}
                    </div>
                    <div class="flex items-center gap-3 text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                        <span class="uppercase">${j.settings.paperSize}</span> • ${typeLabel} • <span>${j.settings.copies} Cop${j.settings.copies > 1 ? 'ies' : 'y'}</span>
                    </div>
                </div>
            </div>
            <div class="text-xs font-medium text-slate-400 flex items-center gap-1">
                <i data-lucide="clock" class="w-3.5 h-3.5"></i> ${timeStr}
            </div>
        </div>

        <div class="mb-2">
            <div class="flex items-center gap-3 p-2 bg-slate-50 rounded-lg border border-slate-100 mb-1.5 hover:bg-slate-100 transition-colors">
                <div class="bg-white p-1.5 rounded shadow-sm border border-slate-200"><i data-lucide="${iconStr.split(' ')[0]}" class="w-4 h-4 ${iconStr.split(' ')[1] || 'text-slate-500'}"></i></div>
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-slate-700 truncate">${j.fileName}</p>
                </div>
                <a href="${j.fileUrl}" target="_blank" class="text-blue-600 hover:text-blue-800 text-xs font-semibold px-3 py-1 bg-blue-100 rounded">View File</a>
            </div>
        </div>
        
        ${notesHtml}

        <div class="mt-4 pt-4 border-t border-slate-100 flex items-center flex-wrap gap-2">
            ${actions}
        </div>
    </div>`;
}

function renderQueue() {
    const qc = document.getElementById('queue-cards');
    if(!qc) return;
    const filtered = allJobs.filter(j => j.status !== 'Done' && (qFilter === 'all' || j.status === qFilter));
    
    if (filtered.length > 0) {
        qc.innerHTML = filtered.map(j => buildCard(j)).join('');
    } else {
        qc.innerHTML = `<div class="text-center py-12 bg-white rounded-xl border border-slate-200 border-dashed"><div class="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3"><i data-lucide="inbox" class="w-8 h-8 text-slate-300"></i></div><p class="text-slate-500 font-medium">No documents in queue</p></div>`;
    }
    window.lucide.createIcons();
}

function renderDone() {
    const dc = document.getElementById('done-cards');
    if(!dc) return;
    const doneList = allJobs.filter(j => j.status === 'Done');
    
    if (doneList.length > 0) {
        dc.innerHTML = doneList.map(j => buildCard(j)).join('');
    } else {
        dc.innerHTML = `<div class="text-center py-10 text-slate-400">No completed jobs yet</div>`;
    }
    window.lucide.createIcons();
}

// 5. Actions & 🟢 REVENUE TRACKING 🟢
window.markPrinting = async (id) => {
    try {
        await updateDoc(doc(db, "prints", id), { status: "Printing" });
        showToast("Job moved to Printing state");
    } catch(e) { console.error(e); }
}

window.markDone = async (id) => {
    try {
        const job = allJobs.find(j => j.id === id);
        
        await updateDoc(doc(db, "prints", id), { status: "Done" });
        showToast("Document marked as done!", 'success');
        
        // SAVE REVENUE TO ANALYTICS DATABASE (Permanent Record)
        if (job) {
            const todayStr = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
            const statRef = doc(db, "shop_analytics", `${currentShopId}_${todayStr}`);
            const statSnap = await getDoc(statRef);
            
            // Clean up bill amount (just in case it has ₹ sign or text)
            const billAmtStr = String(job.billEstimate || "0").replace(/[^0-9.]/g, '');
            const billAmt = Number(billAmtStr) || 0;
            
            if (statSnap.exists()) {
                await updateDoc(statRef, {
                    revenue: increment(billAmt),
                    totalJobs: increment(1)
                });
            } else {
                await setDoc(statRef, {
                    shopId: currentShopId,
                    date: todayStr,
                    revenue: billAmt,
                    totalJobs: 1,
                    timestamp: Date.now()
                });
            }
        }
    } catch(e) { console.error(e); }
}

// LOAD SHOP ANALYTICS (Day-to-day Earnings)
function loadShopAnalytics() {
    const q = query(collection(db, "shop_analytics"), where("shopId", "==", currentShopId));
    
    onSnapshot(q, (snapshot) => {
        let totalRev = 0;
        let todayRev = 0;
        let totalJobsAllTime = 0;
        const todayStr = new Date().toISOString().split('T')[0];
        let dailyLogs = [];

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            totalRev += (data.revenue || 0);
            totalJobsAllTime += (data.totalJobs || 0);
            
            if (data.date === todayStr) {
                todayRev = data.revenue || 0;
            }
            dailyLogs.push(data);
        });

        // Update High-Level Cards in UI
        if(document.getElementById('stat-earn-total')) document.getElementById('stat-earn-total').textContent = totalRev;
        if(document.getElementById('stat-earn-today')) document.getElementById('stat-earn-today').textContent = todayRev;
        if(document.getElementById('stat-an-total-jobs')) document.getElementById('stat-an-total-jobs').textContent = totalJobsAllTime;

        // Sort logs descending by date (Newest first)
        dailyLogs.sort((a, b) => b.date.localeCompare(a.date));

        const tbody = document.getElementById('daily-revenue-table');
        if (tbody) {
            if (dailyLogs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="p-8 text-center text-slate-400">No revenue data available yet. Complete a job to see earnings.</td></tr>';
            } else {
                tbody.innerHTML = dailyLogs.map(log => {
                    // Format date nicely (e.g., "Oct 24, 2023")
                    const dateObj = new Date(log.date);
                    const niceDate = dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                    
                    return `
                        <tr class="hover:bg-slate-50 border-b border-slate-100 transition-colors">
                            <td class="p-4 font-medium text-slate-800">${niceDate}</td>
                            <td class="p-4 text-center font-bold text-blue-600">${log.totalJobs || 0}</td>
                            <td class="p-4 text-right font-black text-emerald-600">₹${log.revenue || 0}</td>
                        </tr>
                    `;
                }).join('');
            }
        }
    });
}

// MANUAL DELETE (Deletes from Storage AND Firestore securely)
window.deleteJob = async (id, filePath) => {
    if(confirm("Are you sure you want to permanently delete this document?")) {
        try {
            // Delete from Firebase Storage (If it exists)
            if(filePath && filePath !== 'undefined') {
                await deleteObject(ref(storage, filePath)).catch(e => console.log('File might already be deleted from storage'));
            }
            // Delete from Database
            await deleteDoc(doc(db, "prints", id));
            showToast("Document deleted securely.", 'success');
        } catch(e) { 
            console.error(e); 
            showToast("Error deleting document.", 'error');
        }
    }
}

// CUSTOM AUTO-DELETE TIMER
window.setCustomExpiry = async (id) => {
    const hours = prompt("Enter the number of hours to keep this file before Auto-Delete (e.g., 10):", "10");
    
    if(hours !== null && !isNaN(hours) && Number(hours) > 0) {
        // Calculate new expiry timestamp
        const newExpiry = Date.now() + (Number(hours) * 60 * 60 * 1000);
        
        try {
            await updateDoc(doc(db, "prints", id), { expiresAt: newExpiry });
            showToast(`Auto-delete set to ${hours} hours from now.`, 'success');
        } catch(e) { 
            console.error(e); 
            showToast("Error setting timer", 'error'); 
        }
    } else if (hours !== null) {
        alert("Please enter a valid number greater than 0.");
    }
}

// Sound & Toast Utils
document.getElementById('btn-sound')?.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    const btn = document.getElementById('btn-sound');
    if(btn) {
        btn.innerHTML = soundEnabled ? '<i data-lucide="bell" class="w-5 h-5 text-slate-400"></i>' : '<i data-lucide="bell-off" class="w-5 h-5 text-red-400"></i>';
        window.lucide.createIcons();
    }
});

function playAlertSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.frequency.value = 880;
        osc.connect(ctx.destination);
        osc.start();
        setTimeout(() => osc.stop(), 200);
    } catch(e) {}
}

let toastTimeout;
window.showToast = (msg, type = 'info') => {
    const t = document.getElementById('toast');
    if(!t) return;
    
    let iconHtml = '';
    const icon = document.getElementById('toast-icon');
    if (icon) {
        if(type === 'error') {
            icon.setAttribute('data-lucide', 'alert-circle');
            icon.className = 'w-4 h-4 text-red-400';
        } else if(type === 'success') {
            icon.setAttribute('data-lucide', 'check-circle');
            icon.className = 'w-4 h-4 text-emerald-400';
        } else {
            icon.setAttribute('data-lucide', 'info');
            icon.className = 'w-4 h-4 text-blue-400';
        }
    }
    
    const msgEl = document.getElementById('toast-msg');
    if(msgEl) msgEl.textContent = msg;
    
    window.lucide.createIcons();

    t.classList.remove('opacity-0', '-translate-y-4');
    t.classList.add('opacity-100', 'translate-y-0');
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        t.classList.remove('opacity-100', 'translate-y-0');
        t.classList.add('opacity-0', '-translate-y-4');
    }, 3000);
}
