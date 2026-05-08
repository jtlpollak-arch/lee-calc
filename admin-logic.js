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
// בדיקת זיהוי משתמש לפתרון שגיאת Permissions
    const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
    const auth = getAuth();
    
    onAuthStateChanged(auth, (user) => {
        if (user) {
            console.log("✅ משתמש מזוהה במערכת:", user.email);
        } else {
            console.error("❌ אזהרה: המערכת לא מזהה משתמש מחובר! השמירה תיכשל.");
            alert("שימי לב: את לא מחוברת למערכת בכתובת זו. אנא בצעי Login מחדש בטאב זה.");
        }
    });

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
            const catalogCheckbox = document.getElementById('in-isCatalog');
            if (catalogCheckbox) { catalogCheckbox.checked = d.isCatalog || false; }
            
            if (document.getElementById('client-name-title')) document.getElementById('client-name-title').innerText = d.clientName || "לקוח ללא שם";
            if (document.getElementById('in-clientName')) document.getElementById('in-clientName').value = d.clientName || "";

            document.getElementById('in-status').value = d.status || "INITIAL";
            document.getElementById('in-clientPhone').value = FinanceLogic.formatPhone(d.clientPhone || "");
            
            // טעינת תאריך לידה
            if (document.getElementById('in-clientBirthday')) document.getElementById('in-clientBirthday').value = d.clientBirthday || "";
            
            if (document.getElementById('in-clientEmail')) document.getElementById('in-clientEmail').value = d.clientEmail || "";
            if (document.getElementById('in-clientNeeds')) document.getElementById('in-clientNeeds').value = d.clientNeeds || "";
            if (document.getElementById('in-privateNotes')) document.getElementById('in-privateNotes').value = d.privateNotes || "";
            if (document.getElementById('in-targetDate')) document.getElementById('in-targetDate').value = d.targetDate || "";
            if (document.getElementById('in-followUpDate')) document.getElementById('in-followUpDate').value = d.followUpDate || "";
            
            // טעינת העדפות התאמה אישית (1-5)
            if (document.getElementById('in-prefEdu')) document.getElementById('in-prefEdu').value = d.prefEdu || 3;
            if (document.getElementById('in-prefTrans')) document.getElementById('in-prefTrans').value = d.prefTrans || 3;
            if (document.getElementById('in-prefLeisure')) document.getElementById('in-prefLeisure').value = d.prefLeisure || 3;
            if (document.getElementById('in-prefSea')) document.getElementById('in-prefSea').value = d.prefSea || 3;

            // טעינת מגבלת קומה גבוהה (Checkbox)
            if (document.getElementById('in-limitHighFloor')) {
                document.getElementById('in-limitHighFloor').checked = d.limitHighFloor || false;
            }

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
    
    console.log("בדיקת משתנים לפני שמירה:");
    console.log("currentProperties:", currentProperties);
    console.log("currentFavorites:", window.currentFavorites);
    console.log("currentRatings:", currentRatings);

    const data = {
        isCatalog: document.getElementById('in-isCatalog')?.checked || false,
        clientName: document.getElementById('in-clientName')?.value || "",
        status: document.getElementById('in-status')?.value || "INITIAL",
        clientPhone: document.getElementById('in-clientPhone')?.value || "",
        clientBirthday: document.getElementById('in-clientBirthday')?.value || "",
        privateNotes: document.getElementById('in-privateNotes')?.value || "",
        isNotesUrgent: document.getElementById('in-isNotesUrgent')?.checked || false,
        followUpDate: document.getElementById('in-followUpDate')?.value || "",
        
        // --- שדות ההעדפות (1-5) ---
        prefEdu: parseFloat(document.getElementById('in-prefEdu')?.value) || 3,
        prefTrans: parseFloat(document.getElementById('in-prefTrans')?.value) || 3,
        prefLeisure: parseFloat(document.getElementById('in-prefLeisure')?.value) || 3,
        prefSea: parseFloat(document.getElementById('in-prefSea')?.value) || 3,
        limitHighFloor: document.getElementById('in-limitHighFloor')?.checked || false,

        // --- שדות האחוזים (עמלות) ---
        brokerageRateSale: parseFloat(document.getElementById('in-brokerageRateSale')?.value) || 0,
        brokerageRatePurch: parseFloat(document.getElementById('in-brokerageRatePurch')?.value) || 0,
        lawyerRateSale: parseFloat(document.getElementById('in-lawyerRateSale')?.value) || 0,
        lawyerRatePurch: parseFloat(document.getElementById('in-lawyerRatePurch')?.value) || 0,

        // --- הגנה על רשימות ודירוגים ---
        properties: currentProperties || [],
        favorites: window.currentFavorites || [],
        ratings: currentRatings || {},
        
        roadmapStep: STATUS_TO_ROADMAP_STEP[document.getElementById('in-status')?.value || "INITIAL"] || "1",
        lastUpdated: new Date().toISOString()
    };
    
    try {
        if (!clientID) throw new Error("Missing Client ID");
        // עדכון המסמך ב-Firebase
        await updateDoc(doc(db, "projects", clientID), data);
        
        alert("התיק נשמר בהצלחה! ✨");
        
        // איפוס מצב ה"שינויים לא שמורים"
        window.hasUnsavedChanges = false;
        document.getElementById('btn-save-all')?.classList.remove('unsaved');
        document.getElementById('save-status').style.display = 'none';
        
    } catch (e) {
        console.error("שגיאת שמירה מפורטת:", e);
        alert("שגיאה בשמירה: " + e.message);
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

    // יצירת תאריך ברירת מחדל נכון לפי שעון ישראל
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localToday = (new Date(now - offset)).toISOString().split('T')[0];

    const taskDate = prompt("עבור איזה תאריך? (YYYY-MM-DD)", localToday);
    
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

window.renderTourNotesForAdmin = (tourNotes) => {
    const container = document.getElementById('admin-tour-notes-list');
    if (!container) return;
    const keys = Object.keys(tourNotes || {});
    if (keys.length === 0) {
        container.innerHTML = '<p style="color:#888; font-style:italic;">אין עדיין סיכומים מהשטח.</p>';
        return;
    }

    container.innerHTML = keys.map(id => {
        const n = tourNotes[id];
        
        // מיפוי השדות המדויק לפי צילום המסך מה-DB
        const noise = n.noise || "0";
        const condition = n.condition || "0";
        const moisture = n.moisture ? '⚠️ יש רטיבות' : '✅ אין רטיבות';
        const renovated = n.renovated ? '✨ מטבח חדש/משופץ' : '🏚️ מטבח ישן';
        const light = n.light ? '☀️ מוארת מספיק' : '🌑 חשוכה';
        const dateStr = n.timestamp ? new Date(n.timestamp).toLocaleDateString('he-IL') : '';

        return `
            <div class="tour-note-card" style="border-right:5px solid #FFD700; background:#fff; padding:15px; margin-bottom:15px; border:1px solid #eee; border-radius:10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid #f0f0f0; padding-bottom:5px;">
                    <strong style="color:#2c3e50;">🏠 נכס: ${id}</strong>
                    <span style="font-size:11px; color:#999;">${dateStr}</span>
                </div>
                
                <div style="display: flex; gap: 15px; margin-bottom: 10px; font-size: 13px; font-weight: bold; color: #4f46e5;">
                    <span>🔊 רעש: ${noise}/5</span>
                    <span>🛠️ מצב תחזוקה: ${condition}/5</span>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 11px;">
                    <span style="background:#f8f9fa; padding:4px; border-radius:4px; text-align:center; border:1px solid #eee;">${moisture}</span>
                    <span style="background:#f8f9fa; padding:4px; border-radius:4px; text-align:center; border:1px solid #eee;">${renovated}</span>
                    <span style="background:#f8f9fa; padding:4px; border-radius:4px; text-align:center; border:1px solid #eee;">${light}</span>
                </div>

                <div style="background: #fff9e6; padding: 12px; border-radius: 8px; font-size: 14px; font-style: italic; color: #444; border-right: 3px solid #FFD700;">
                    "${n.notes || "אין הערות נוספות"}"
                </div>
            </div>
        `;
    }).join('');
};

// עדכון פונקציית הרענון הידני
window.manualRefreshTourNotes = async () => {
    if (!clientID) return;
    const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js");
    const snap = await getDoc(doc(db, "projects", clientID));
    if (snap.exists()) {
        window.renderTourNotesForAdmin(snap.data().tourNotes || {});
    }
};

// --- שחזור לוגיקת בנק הנכסים (הקוד שנמצא בגרסאות קודמות) ---

window.openBankModal = () => {
    // עדכון רשימת ה-IDs שנבחרו כבר (כדי להציג V במודל)
    selectedIDs = currentProperties.map(p => p.propertyId || p.id);
    renderBankList();
    const modal = document.getElementById('bank-modal');
    if (modal) modal.style.display = 'block';
};

function renderBankList() {
    const list = document.getElementById('bank-list');
    if (!list) return;
    const searchTerm = document.getElementById('bank-search')?.value.toLowerCase() || "";

    list.innerHTML = allBankProperties
        .filter(p => (p.address || "").toLowerCase().includes(searchTerm))
        .map(p => {
            const isSelected = selectedIDs.includes(p.id);
            return `
            <div class="bank-item ${isSelected ? 'selected' : ''}" 
                 onclick="window.toggleBankSelection('${p.id}')" 
                 style="padding:15px; border-bottom:1px solid #eee; cursor:pointer; position:relative;">
                <div style="font-weight:bold;">${p.address || "ללא כתובת"}</div>
                <div style="font-size:12px; color:#666;">₪${Number(p.price || 0).toLocaleString()}</div>
                ${isSelected ? '<span style="position:absolute; left:20px; top:50%; transform:translateY(-50%); color:green; font-weight:bold;">✓</span>' : ''}
            </div>`;
        }).join('');
}

window.toggleBankSelection = (id) => {
    if (selectedIDs.includes(id)) {
        selectedIDs = selectedIDs.filter(sid => sid !== id);
    } else {
        selectedIDs.push(id);
    }
    renderBankList();
};

// האזנה לחיפוש בבנק הנכסים
document.getElementById('bank-search')?.addEventListener('input', renderBankList);

// כפתור אישור שיוך
const confirmBtn = document.getElementById('btn-confirm-selection');
if (confirmBtn) {
    confirmBtn.onclick = () => {
        // 1. יצירת רשימת נכסים חדשה עם הגנה מלאה
        currentProperties = selectedIDs.map(id => {
            const prop = allBankProperties.find(p => p.id === id);
            return { 
                propertyId: id || "", 
                address: prop?.address || "נכס משויך",
                clientRole: "BUYER", // חובה ערך התחלתי
                closingDate: ""      // חובה ערך התחלתי
            };
        });
        
        // 2. הגנה קריטית על משתנים גלובליים לפני רענון התצוגה
        if (!window.currentFavorites) window.currentFavorites = [];
        if (!currentRatings) currentRatings = {};

        renderAssigned(); // עדכון התצוגה בדף
        markChanged();    // סימון שיש שינויים לשמירה
        
        // סגירת המודל
        const modal = document.getElementById('bank-modal');
        if (modal) modal.style.display = 'none';
        
        console.log("✅ נכסים שויכו. מוכן לשמירה ללא undefined.");
    };
}

init();
document.addEventListener('DOMContentLoaded', init);