import { auth, db, storage } from './firebase-init.js';
import { signInAnonymously } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { collection, addDoc, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Global Variables
let currentUserId = null;
let currentShopId = null;
let shopRates = { bw: 2, color: 10, a3_multiplier: 2 };
let globalSettings = { maxFileSize: 25, autoDeleteHours: 3 }; // Default settings
let currentFile = null;
let simulatedPageCount = 0;

// UI Elements
const uiShopName = document.getElementById('ui-shop-name');
const uiShopAddress = document.getElementById('ui-shop-address');
const appMain = document.getElementById('app-main');
const loadingState = document.getElementById('loading-state');
const invalidState = document.getElementById('invalid-shop-state');

// 1. App Initialization (Runs when page loads)
window.addEventListener('DOMContentLoaded', async () => {
    if(window.lucide) window.lucide.createIcons();
    
    // Get shop ID from the URL (?shop=shop-id)
    const urlParams = new URLSearchParams(window.location.search);
    currentShopId = urlParams.get('shop');

    if (!currentShopId) {
        showError("Invalid QR Code", "Shop details not found in URL. Please scan the QR Code again.");
        return;
    }

    try {
        // Step 1: Secure Anonymous Login for Customer
        document.getElementById('loading-text').textContent = "Authenticating securely...";
        const userCred = await signInAnonymously(auth);
        currentUserId = userCred.user.uid;

        // Step 2: Fetch Global Settings (Max Size, Auto-Delete Time)
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        if(settingsSnap.exists()) {
            globalSettings = { ...globalSettings, ...settingsSnap.data() };
        }

        // Step 3: Fetch Shop Details
        document.getElementById('loading-text').textContent = "Fetching shop details...";
        const shopDoc = await getDoc(doc(db, "shops", currentShopId));
        
        if (shopDoc.exists()) {
            const shopData = shopDoc.data();
            if(uiShopName) uiShopName.textContent = shopData.shopName;
            if(uiShopAddress) uiShopAddress.textContent = shopData.address || "Partner Shop";
            
            // Set Rates based on shop database
            shopRates.bw = parseFloat(shopData.bwRate) || 2;
            shopRates.color = parseFloat(shopData.colorRate) || 10;
            if(document.getElementById('rate-bw')) document.getElementById('rate-bw').textContent = shopRates.bw;
            if(document.getElementById('rate-color')) document.getElementById('rate-color').textContent = shopRates.color;
            
            // Hide loading screen, show main application
            loadingState.classList.add('hidden');
            appMain.classList.remove('hidden');
            
            checkPreviousOrder(); // Check if user has an active order
        } else {
            showError("Shop Not Found", "This shop does not exist in the system.");
        }
    } catch (error) {
        console.error("Initialization Error:", error);
        showError("Connection Failed", "Could not connect to the server. Please check your internet connection.");
    }
});

// Error Display Function
function showError(title, msg) {
    if(loadingState) loadingState.classList.add('hidden');
    if(appMain) appMain.classList.add('hidden');
    if(invalidState) invalidState.classList.remove('hidden');
    if(document.getElementById('error-title')) document.getElementById('error-title').textContent = title;
    if(document.getElementById('error-msg')) document.getElementById('error-msg').textContent = msg;
}

// 2. Recovery Banner Logic (If customer accidentally closes the app)
function checkPreviousOrder() {
    const savedData = localStorage.getItem('smartXerox_lastOrder');
    if (savedData) {
        try {
            const order = JSON.parse(savedData);
            // Show banner only if the order hasn't expired based on global settings
            if (Date.now() - order.timestamp < (globalSettings.autoDeleteHours * 60 * 60 * 1000)) {
                document.getElementById('rec-token').textContent = order.token;
                document.getElementById('rec-filename').textContent = order.fileName;
                document.getElementById('recovery-banner').classList.remove('hidden');
            } else {
                localStorage.removeItem('smartXerox_lastOrder');
            }
        } catch(e) { localStorage.removeItem('smartXerox_lastOrder'); }
    }
}

window.clearRecoveryBanner = () => {
    document.getElementById('recovery-banner').classList.add('hidden');
};

function saveOrderToMemory(token, fileName) {
    localStorage.setItem('smartXerox_lastOrder', JSON.stringify({ token: token, fileName: fileName, timestamp: Date.now() }));
}

// 3. Drag & Drop and File Selection Logic
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

if (dropzone) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, e => { e.preventDefault(); e.stopPropagation(); }, false));
    ['dragenter', 'dragover'].forEach(eventName => dropzone.addEventListener(eventName, () => dropzone.classList.add('drag-active'), false));
    ['dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, () => dropzone.classList.remove('drag-active'), false));
    dropzone.addEventListener('drop', e => { if(e.dataTransfer.files.length) handleFiles(e.dataTransfer.files[0]); });
}
if (fileInput) {
    fileInput.addEventListener('change', e => { if(e.target.files.length) handleFiles(e.target.files[0]); });
}

function handleFiles(file) {
    // Validate file size against global admin settings
    if (file.size > globalSettings.maxFileSize * 1024 * 1024) {
        return alert(`File is too large! Maximum allowed size is ${globalSettings.maxFileSize}MB.`);
    }

    currentFile = file;
    let sizeStr = (file.size / 1024).toFixed(1) + " KB";
    if (file.size > 1024 * 1024) sizeStr = (file.size / (1024 * 1024)).toFixed(1) + " MB";
    
    const ext = file.name.split('.').pop().toLowerCase();
    let iconStr = "file-text text-slate-500";
    if(ext === 'pdf') iconStr = "file-text text-red-500";
    else if(['jpg','jpeg','png'].includes(ext)) iconStr = "image text-purple-500";
    else if(['doc','docx'].includes(ext)) iconStr = "file-type text-blue-500";
    
    // Simulate page count calculation
    simulatedPageCount = ext === 'pdf' ? Math.floor(Math.random() * 20) + 1 : 1;

    // FIX: Safely replace the file icon to prevent SVG errors
    const oldIcon = document.getElementById('file-icon');
    if (oldIcon && oldIcon.parentElement) {
        const iconName = iconStr.split(' ')[0];
        oldIcon.parentElement.innerHTML = `<i id="file-icon" data-lucide="${iconName}" class="w-6 h-6 sm:w-7 sm:h-7 ${iconStr}"></i>`;
    }

    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = sizeStr;
    if (document.getElementById('file-pages')) document.getElementById('file-pages').textContent = simulatedPageCount;

    // Switch UI from Upload Prompt to File Details
    document.getElementById('upload-prompt').classList.add('hidden');
    document.getElementById('file-info').classList.remove('hidden');
    document.getElementById('settings-panel').classList.remove('opacity-50', 'pointer-events-none');
    document.getElementById('btn-submit').disabled = false;
    
    if(window.lucide) window.lucide.createIcons();
    window.updateBill(); // Calculate initial bill
    
    // Scroll to settings on mobile devices
    if(window.innerWidth < 1024) setTimeout(() => document.getElementById('settings-panel').scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
}

// 4. UI Actions (Remove File, Change Copies, Update Bill)
window.removeFile = () => {
    currentFile = null; 
    simulatedPageCount = 0; 
    if(fileInput) fileInput.value = '';
    
    document.getElementById('upload-prompt').classList.remove('hidden');
    document.getElementById('file-info').classList.add('hidden');
    document.getElementById('settings-panel').classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('btn-submit').disabled = true;
    document.getElementById('bill-empty').classList.remove('hidden');
    document.getElementById('bill-details').classList.add('hidden');
};

window.changeCopies = (val) => {
    const input = document.getElementById('setting-copies');
    let current = parseInt(input.value) || 1;
    current += val;
    if(current < 1) current = 1;
    if(current > 100) current = 100; // Limit max copies to 100
    input.value = current;
    window.updateBill();
};

window.updateBill = () => {
    if(!currentFile) return;
    
    const isColor = document.querySelector('input[name="colorMode"]:checked').value === 'color';
    const paperSize = document.querySelector('input[name="paperSize"]:checked').value;
    const copies = parseInt(document.getElementById('setting-copies').value) || 1;

    const baseRate = isColor ? shopRates.color : shopRates.bw;
    const sizeMultiplier = paperSize === 'A3' ? shopRates.a3_multiplier : 1;
    const totalCost = simulatedPageCount * baseRate * sizeMultiplier * copies;

    // Show Bill Details
    document.getElementById('bill-empty').classList.add('hidden');
    document.getElementById('bill-details').classList.remove('hidden');

    if(document.getElementById('bill-pages')) document.getElementById('bill-pages').textContent = simulatedPageCount;
    document.getElementById('bill-ratetype').textContent = isColor ? 'Color' : 'B&W';
    document.getElementById('bill-ratetype').className = isColor ? 'text-purple-300' : 'text-blue-300';
    document.getElementById('bill-rateval').textContent = baseRate;
    document.getElementById('bill-copies').textContent = copies;
    
    if(document.getElementById('bill-multiplier-row')) {
        document.getElementById('bill-multiplier-row').style.display = (paperSize === 'A3') ? 'flex' : 'none';
    }

    const totalEl = document.getElementById('bill-total');
    totalEl.parentElement.classList.add('scale-110', 'text-emerald-400');
    setTimeout(() => totalEl.parentElement.classList.remove('scale-110', 'text-emerald-400'), 200);
    totalEl.textContent = totalCost;
};

// 5. FIREBASE STORAGE UPLOAD LOGIC
window.submitOrder = async () => {
    if (!currentFile || !currentShopId) return;

    const btnSubmit = document.getElementById('btn-submit');
    btnSubmit.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Uploading...`;
    btnSubmit.disabled = true;
    if(window.lucide) window.lucide.createIcons();

    try {
        // Create safe, unique file name
        const safeName = currentFile.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
        const uniqueFileName = `${Date.now()}_${Math.floor(Math.random()*1000)}_${safeName}`;
        
        // Setup Firebase Storage Path: uploads/{shopId}/{filename}
        const storagePath = `uploads/${currentShopId}/${uniqueFileName}`;
        const storageRef = ref(storage, storagePath);
        
        // Start Upload
        const uploadTask = uploadBytesResumable(storageRef, currentFile);

        uploadTask.on('state_changed', 
            (snapshot) => {
                // Track progress
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                btnSubmit.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin inline"></i> ${Math.round(progress)}%`;
                if(window.lucide) window.lucide.createIcons();
            }, 
            (error) => {
                console.error("Firebase Storage Error:", error);
                alert("Upload failed. Please check your internet connection.");
                resetSubmitButton();
            }, 
            async () => {
                // Upload Complete - Get Download URL
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                const tokenStr = "#" + String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
                
                // Calculate Expiry Time for Auto-Delete based on Global Settings
                const expiryTimestamp = Date.now() + (globalSettings.autoDeleteHours * 60 * 60 * 1000);

                // Create Database Document
                const printJob = {
                    shopId: currentShopId,
                    customerId: currentUserId,
                    token: tokenStr,
                    fileName: currentFile.name,
                    fileUrl: downloadURL, // Link to view/download file
                    filePath: storagePath, // Crucial: Storing the exact path to delete the file later
                    settings: {
                        colorMode: document.querySelector('input[name="colorMode"]:checked').value,
                        paperSize: document.querySelector('input[name="paperSize"]:checked').value,
                        copies: parseInt(document.getElementById('setting-copies').value),
                        notes: document.getElementById('special-notes').value || ""
                    },
                    billEstimate: document.getElementById('bill-total').textContent,
                    status: "Pending",
                    createdAt: Date.now(),
                    expiresAt: expiryTimestamp // Required for automatic/manual deletion
                };

                // Save to Firestore
                await addDoc(collection(db, "prints"), printJob);

                // Show Success Screen
                saveOrderToMemory(tokenStr, currentFile.name);
                document.getElementById('final-token').textContent = tokenStr;
                
                const modal = document.getElementById('success-modal');
                const content = modal.querySelector('div'); 
                modal.classList.remove('hidden');
                void modal.offsetWidth; // Trigger CSS animation reflow
                modal.classList.add('opacity-100');
                if (content) { 
                    content.classList.remove('scale-95'); 
                    content.classList.add('scale-100'); 
                }
            }
        );

    } catch(e) {
        console.error("Process Error:", e);
        alert("Something went wrong processing your order.");
        resetSubmitButton();
    }
};

function resetSubmitButton() {
    const btnSubmit = document.getElementById('btn-submit');
    btnSubmit.innerHTML = `<span class="text-sm sm:text-[15px]">Send for Print</span><i data-lucide="send" class="w-4 h-4 group-hover:translate-x-1 transition-transform"></i>`;
    btnSubmit.disabled = false;
    if(window.lucide) window.lucide.createIcons();
}

window.resetApp = () => {
    const modal = document.getElementById('success-modal');
    modal.classList.remove('opacity-100');
    setTimeout(() => {
        modal.classList.add('hidden');
        window.removeFile(); 
        
        // Reset Inputs
        document.getElementById('setting-copies').value = 1;
        document.querySelector('input[name="colorMode"][value="bw"]').checked = true;
        document.querySelector('input[name="paperSize"][value="A4"]').checked = true;
        document.getElementById('special-notes').value = '';
        
        resetSubmitButton();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 300);
};