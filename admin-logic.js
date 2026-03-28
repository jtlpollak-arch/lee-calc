// admin-logic.js - ניהול עריכת תיק לקוח עם מנגנון Follow-up ואחוזים דינמיים
import { FinanceLogic } from './shared.js';
import { db } from './firebase-config.js';
import { doc, setDoc, getDoc, collection, getDocs, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const clientID = urlParams.get('id');
let currentProperties = [];
let allBankProperties = []; 
let selectedIDs = []; 
let currentRatings = {};

window.hasUnsavedChanges = false;

const STATUS_TO_ROADMAP_STEP = {
    'INITIAL': '1',
    'RESEARCH': '2',
    'SIGNING': '3',
    'DELIVERY': '4',
    'DONE': '5',
    'FROZEN': '6',
    'CANCELLED': '7'
};

async function logAction(msg) {
    await addDoc(collection(db, "activity_logs"), { timestamp: new Date().toISOString(), message: msg });
}

const markChanged = () => {
    window.hasUnsavedChanges = true;
    const saveBtn = document.getElementById('btn-save-all');
    const saveStatus = document.getElementById('save-status');
    if (saveBtn) saveBtn.classList.add('unsaved');
    if (saveStatus) saveStatus.style.display = 'block';
};

function updateUrgentUI() {
    const checkbox = document.getElementById('in-isNotesUrgent');
    const notesField = document.getElementById('in-privateNotes');
    if (checkbox && notesField) {
        if (checkbox.checked) notesField.classList.add('urgent-mode');
        else notesField.classList.remove('urgent-mode');
    }
    checkFollowUpStatus();
}

function checkFollowUpStatus() {
    const dateInput = document.getElementById('in-followUpDate');
    if (!dateInput || !dateInput.value) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const followUpDate = new Date(dateInput.value);
    followUpDate.setHours(0, 0, 0, 0);

    if (followUpDate <= today) {
        if (dateInput.classList) dateInput.classList.add('follow-up-passed');
        const urgentCheckbox = document.getElementById('in-isNotesUrgent');
        if (urgentCheckbox && !urgentCheckbox.checked) {
            urgentCheckbox.checked = true;
            updateUrgentUI();
        }
    } else {
        if (dateInput.classList) dateInput.classList.remove('follow-up-passed');
    }
}

async function init() {
    if (!clientID) return;
    try {
        const bankSnap = await getDocs(collection(db, "property_bank"));
        allBankProperties = bankSnap.docs.map(s => ({ id: s.id, ...s.data() }));

        const snap = await getDoc(doc(db, "projects", clientID));
        if (snap.exists()) {
            const d = snap.data();
            
            if (window.renderTourNotesForAdmin) window.renderTourNotesForAdmin(d.tourNotes);

            const nameDisp = document.getElementById('client-name-display');
            if (nameDisp) nameDisp.innerText = d.clientName || "לקוח ללא שם";
            if (document.getElementById('client-name-title')) document.getElementById('client-name-title').innerText = d.clientName || "לקוח ללא שם";
            if (document.getElementById('in-clientName')) document.getElementById('in-clientName').value = d.clientName || "";

            document.getElementById('in-status').value = d.status || "INITIAL";
            document.getElementById('in-clientPhone').value = FinanceLogic.formatPhone(d.clientPhone || "");
            if (document.getElementById('in-clientBirthday')) document.getElementById('in-clientBirthday').value = d.clientBirthday || "";
            if (document.getElementById('in-clientEmail')) document.getElementById('in-clientEmail').value = d.clientEmail || "";
            if(document.getElementById('in-clientNeeds')) document.getElementById('in-clientNeeds').value = d.clientNeeds || "";
            if(document.getElementById('in-privateNotes')) document.getElementById('in-privateNotes').value = d.privateNotes || "";
            if(document.getElementById('in-targetDate')) document.getElementById('in-targetDate').value = d.targetDate || "";
            if(document.getElementById('in-followUpDate')) document.getElementById('in-followUpDate').value = d.followUpDate || "";
            
            const urgentCheckbox = document.getElementById('in-isNotesUrgent');
            if (urgentCheckbox) {
                urgentCheckbox.checked = d.isNotesUrgent || false;
                updateUrgentUI();
                urgentCheckbox.onchange = () => { updateUrgentUI(); markChanged(); };
            }

            document.getElementById('in-brokerageRateSale').value = d.brokerageRateSale ?? 2;
            document.getElementById('in-lawyerRateSale').value = d.lawyerRateSale ?? 0.5;
            document.getElementById('in-brokerageRatePurch').value = d.brokerageRatePurch ?? 2;
            document.getElementById('in-lawyerRatePurch').value = d.lawyerRatePurch ?? 0.5;
            
            currentProperties = d.properties || d.assignedProperties || [];
            window.currentFavorites = d.favorites || [];
            currentRatings = d.ratings || {}; 
            
            renderAssigned();

            document.querySelectorAll('input, select, textarea').forEach(el => el.addEventListener('input', markChanged));
            window.hasUnsavedChanges = false;
        }
    } catch (error) { console.error("Error loading data:", error); }
}

document.getElementById('btn-save-all').onclick = async () => {
    checkFollowUpStatus();
    const currentStatus = document.getElementById('in-status').value;
    
    // בניית האובייקט עם הגנות מפני ערכים ריקים (undefined)
    const data = {
        clientName: document.getElementById('in-clientName')?.value || (document.getElementById('client-name-display')?.innerText) || "",
        status: currentStatus,
        clientPhone: document.getElementById('in-clientPhone')?.value || "",
        clientBirthday: document.getElementById('in-clientBirthday')?.value || "",
        clientEmail: document.getElementById('in-clientEmail')?.value || "",
        clientNeeds: document.getElementById('in-clientNeeds')?.value || "",
        privateNotes: document.getElementById('in-privateNotes')?.value || "",
        isNotesUrgent: document.getElementById('in-isNotesUrgent')?.checked || false,
        targetDate: document.getElementById('in-targetDate')?.value || "",
        followUpDate: document.getElementById('in-followUpDate')?.value || "",
        brokerageRateSale: parseFloat(document.getElementById('in-brokerageRateSale')?.value) || 0,
        lawyerRateSale: parseFloat(document.getElementById('in-lawyerRateSale')?.value) || 0,
        brokerageRatePurch: parseFloat(document.getElementById('in-brokerageRatePurch')?.value) || 0,
        lawyerRatePurch: parseFloat(document.getElementById('in-lawyerRatePurch')?.value) || 0,
        
        // הגנה קריטית: אם המשתנה לא קיים, שלח מערך/אובייקט ריק במקום undefined
        properties: currentProperties || [],
        favorites: window.currentFavorites || [], 
        ratings: currentRatings || {},
        
        roadmapStep: STATUS_TO_ROADMAP_STEP[currentStatus] || "1",
        lastUpdated: new Date().toISOString()
    };
    
    console.log("ניסיון שמירה עם הנתונים הבאים:", data);

    try {
        if (!clientID) throw new Error("Missing Client ID");
        
        await updateDoc(doc(db, "projects", clientID), data);
        await logAction(`✨ עודכן תיק לקוח: ${data.clientName}`);
        
        window.hasUnsavedChanges = false;
        const saveBtn = document.getElementById('btn-save-all');
        if (saveBtn) saveBtn.classList.remove('unsaved');
        
        const saveStatus = document.getElementById('save-status');
        if (saveStatus) saveStatus.style.display = 'none';
        
        alert("התיק סונכרן בהצלחה! ✨");
    } catch (error) { 
        console.error("שגיאת שמירה מפורטת:", error);
        alert("שגיאה בשמירה: " + error.message); 
    }
};

window.updatePropDate = (index, value) => {
    if (currentProperties[index]) {
        currentProperties[index].closingDate = value;
        markChanged();
    }
};

window.updatePropRole = (index, value) => {
    if (currentProperties[index]) {
        currentProperties[index].clientRole = value;
        markChanged();
    }
};

function renderAssigned() {
    const container = document.getElementById('assigned-props-container');
    if (!container) return;
    container.innerHTML = currentProperties.map((p, i) => {
        const liveProp = allBankProperties.find(bp => bp.id === (p.propertyId || p.id));
        const addr = liveProp ? liveProp.address : p.address;
        return `
        <div class="assigned-prop" style="background:#f8f9fa; padding:15px; border-radius:8px; margin-bottom:10px; border-right:4px solid #2c3e50;">
            <div style="font-weight:bold;">${addr}</div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
                <select onchange="window.updatePropRole(${i}, this.value)" class="text-xs p-1">
                    <option value="BUYER" ${p.clientRole === 'BUYER' ? 'selected' : ''}>🔑 קונה</option>
                    <option value="SELLER" ${p.clientRole === 'SELLER' ? 'selected' : ''}>🏠 מוכר</option>
                </select>
                <input type="date" value="${p.closingDate || ''}" onchange="window.updatePropDate(${i}, this.value)" class="text-xs p-1">
            </div>
            <button onclick="window.remP(${i})" style="color:red; font-size:10px; margin-top:10px;">הסר נכס</button>
        </div>`;
    }).join('');
}

window.remP = (i) => {
    if (confirm("להסיר נכס?")) {
        currentProperties.splice(i, 1);
        renderAssigned();
        markChanged();
    }
};

/**
 * פונקציה אחת ומעודכנת לניהול משימות ללוח "היום שלי"
 * שומרת שם ומשימה בשדות נפרדים לתצוגה נכונה
 */
window.addAdminTaskFromClient = async () => {
    const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    const auth = getAuth();

    // פונקציית עזר להמתנה לזיהוי המשתמש
    const getCurrentUser = () => {
        return new Promise((resolve) => {
            const unsubscribe = onAuthStateChanged(auth, (user) => {
                unsubscribe();
                resolve(user);
            });
        });
    };

    let user = auth.currentUser || await getCurrentUser();

    if (!user) {
        alert("נראה שפג תוקף החיבור שלך. אנא חזור לדף הראשי (Dashboard) והיכנס שוב.");
        return;
    }

    const taskText = prompt("מה המשימה לביצוע עבור לקוח זה?");
    if (!taskText) return;

    const taskDate = prompt("עבור איזה תאריך? (YYYY-MM-DD)", new Date().toISOString().split('T')[0]);
    if (!taskDate) return;

    try {
        const clientName = document.getElementById('in-clientName')?.value || "לקוח כללי";
        const { collection, addDoc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");

        await addDoc(collection(db, "admin_tasks"), {
            clientName: clientName,
            taskContent: taskText,
            text: `${clientName}: ${taskText}`,
            dueDate: taskDate,
            isDone: false,
            timestamp: new Date().toISOString(),
            createdBy: user.email
        });

        alert("🎯 המשימה נוספה ללוח 'היום שלי' בהצלחה!");
    } catch (e) {
        console.error("FIREBASE ERROR:", e);
        alert("שגיאה בשמירה: " + e.message);
    }
};

window.manualRefreshTourNotes = async () => {
    if (!clientID) return;
    const snap = await getDoc(doc(db, "projects", clientID));
    if (snap.exists()) window.renderTourNotesForAdmin?.(snap.data().tourNotes || {});
};

window.handleGoBack = () => {
    if (window.hasUnsavedChanges) {
        if (confirm("שינויים לא נשמרו. לסגור את החלון בכל זאת?")) {
            window.close(); // סוגר את הטאב
        }
    } else {
        window.close(); // סוגר את הטאב
    }
};

init();
document.addEventListener('DOMContentLoaded', init);