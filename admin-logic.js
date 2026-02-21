// admin-logic.js - ניהול עריכת תיק לקוח עם מנגנון Follow-up ואחוזים דינמיים
import { FinanceLogic } from './shared.js';
import { db } from './firebase-config.js';
import { doc, setDoc, getDoc, collection, getDocs, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const clientID = urlParams.get('id');
let currentProperties = [];
let allBankProperties = []; 
let selectedIDs = []; // המשתנה החדש לניהול הבחירה המרובה
let currentRatings = {};

window.hasUnsavedChanges = false;

// מפת דרכים: תרגום סטטוס למספר שלב עבור הלקוח
const STATUS_TO_ROADMAP_STEP = {
    'INITIAL': '1',
    'RESEARCH': '2',
    'SIGNING': '3',
    'DELIVERY': '4',
    'DONE': '5',
	'FROZEN': '6',   // הקפאה
    'CANCELLED': '7' // בוטל
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

/**
 * עדכון ויזואלי של שדה ההערות ושדה המעקב
 */
function updateUrgentUI() {
    const checkbox = document.getElementById('in-isNotesUrgent');
    const notesField = document.getElementById('in-privateNotes');
    if (checkbox && notesField) {
        if (checkbox.checked) notesField.classList.add('urgent-mode');
        else notesField.classList.remove('urgent-mode');
    }
    checkFollowUpStatus();
}

/**
 * בדיקה האם תאריך המעקב הגיע או עבר
 */
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
    console.log("Checking for Client ID:", clientID);
    if (!clientID) {
        console.error("No Client ID found in URL!");
        return;
    }

    try {
        // --- עדכון: טעינת בנק הנכסים לפני הכל כדי שרנדר הנכסים יזהה שינויי כתובת ---
        const bankSnap = await getDocs(collection(db, "property_bank"));
        allBankProperties = [];
        bankSnap.forEach(s => {
            allBankProperties.push({ id: s.id, ...s.data() });
        });
        // ------------------------------------------------------------------

        const snap = await getDoc(doc(db, "projects", clientID));
        if (snap.exists()) {
            const d = snap.data();
            console.log("Client data loaded:", d);
            
            // פרטי כותרת וקשר
            const nameDisp = document.getElementById('client-name-display');
            if (nameDisp) nameDisp.innerText = d.clientName || "לקוח ללא שם";
            
            if (document.getElementById('client-name-title')) {
                document.getElementById('client-name-title').innerText = d.clientName || "לקוח ללא שם";
            }

            document.getElementById('in-status').value = d.status || "INITIAL";
            document.getElementById('in-clientPhone').value = FinanceLogic.formatPhone(d.clientPhone || "");
            
            if (document.getElementById('in-clientEmail')) {
                document.getElementById('in-clientEmail').value = d.clientEmail || "";
            }
            
            if (document.getElementById('in-clientName')) {
                document.getElementById('in-clientName').value = d.clientName || "";
            }
            
            // אסטרטגיה והערות
            if(document.getElementById('in-clientNeeds')) document.getElementById('in-clientNeeds').value = d.clientNeeds || "";
            if(document.getElementById('in-privateNotes')) document.getElementById('in-privateNotes').value = d.privateNotes || "";
            if(document.getElementById('in-targetDate')) document.getElementById('in-targetDate').value = d.targetDate || "";
            if(document.getElementById('in-followUpDate')) document.getElementById('in-followUpDate').value = d.followUpDate || "";
            
            // ניהול דחיפות
            const urgentCheckbox = document.getElementById('in-isNotesUrgent');
            if (urgentCheckbox) {
                urgentCheckbox.checked = d.isNotesUrgent || false;
                updateUrgentUI();
                urgentCheckbox.addEventListener('change', () => {
                    updateUrgentUI();
                    markChanged();
                });
            }

            // האזנה לשינוי תאריך מעקב
            const followUpInput = document.getElementById('in-followUpDate');
            if (followUpInput) {
                followUpInput.addEventListener('change', () => {
                    checkFollowUpStatus();
                    markChanged();
                });
            }

            // טעינת אחוזי עמלה (עם ברירות מחדל)
            document.getElementById('in-brokerageRateSale').value = d.brokerageRateSale !== undefined ? d.brokerageRateSale : 2;
            document.getElementById('in-lawyerRateSale').value = d.lawyerRateSale !== undefined ? d.lawyerRateSale : 0.5;
            document.getElementById('in-brokerageRatePurch').value = d.brokerageRatePurch !== undefined ? d.brokerageRatePurch : 2;
            document.getElementById('in-lawyerRatePurch').value = d.lawyerRatePurch !== undefined ? d.lawyerRatePurch : 0.5;
            
            // טעינת העדפות התאמה אישית
            if(document.getElementById('in-prefEdu')) document.getElementById('in-prefEdu').value = d.prefEdu !== undefined ? d.prefEdu : 3;
            if(document.getElementById('in-prefTrans')) document.getElementById('in-prefTrans').value = d.prefTrans !== undefined ? d.prefTrans : 3;
            if(document.getElementById('in-prefLeisure')) document.getElementById('in-prefLeisure').value = d.prefLeisure !== undefined ? d.prefLeisure : 3;
            if(document.getElementById('in-prefSea')) document.getElementById('in-prefSea').value = d.prefSea !== undefined ? d.prefSea : 3;
            if(document.getElementById('in-limitHighFloor')) document.getElementById('in-limitHighFloor').checked = d.limitHighFloor || false;

            // נכסים ומועדפים
            currentProperties = d.properties || [];
            window.currentFavorites = d.favorites || [];
            currentRatings = d.ratings || {}; 
            
            // עכשיו renderAssigned ימצא את המידע ב-allBankProperties הטעון
            renderAssigned();

            // הוספת האזנה לשינויים לכל השדות (לצורך דגל השמירה)
            document.querySelectorAll('input, select, textarea').forEach(el => {
                el.addEventListener('input', markChanged);
            });
            
            // איפוס הדגל לאחר הטעינה הראשונית
            window.hasUnsavedChanges = false;
            if (document.getElementById('save-status')) document.getElementById('save-status').style.display = 'none';
        } else {
            console.error("No such document in Firestore!");
            alert("לא נמצאו נתונים עבור לקוח זה.");
        }
    } catch (error) {
        console.error("Error loading project data:", error);
    }
}

document.getElementById('btn-save-all').onclick = async () => {
    const saveBtn = document.getElementById('btn-save-all');
    
    // בדיקה אחרונה של תאריך לפני שמירה
    checkFollowUpStatus();

    const currentStatus = document.getElementById('in-status').value;
    
    // גזירת שלב ה-Roadmap מהסטטוס שנבחר
    // אם הסטטוס הוא הקפאה/ביטול, אנחנו לא מעדכנים את השלב כדי שהציר יישאר במקום האחרון שלו
    const newRoadmapStep = STATUS_TO_ROADMAP_STEP[currentStatus];

    const data = {
        clientName: document.getElementById('in-clientName') ? document.getElementById('in-clientName').value : (document.getElementById('client-name-display') ? document.getElementById('client-name-display').innerText : ""),
        status: currentStatus,
        clientPhone: document.getElementById('in-clientPhone').value,
        clientEmail: document.getElementById('in-clientEmail') ? document.getElementById('in-clientEmail').value : "",
        clientNeeds: document.getElementById('in-clientNeeds') ? document.getElementById('in-clientNeeds').value : "",
        privateNotes: document.getElementById('in-privateNotes').value,
        isNotesUrgent: document.getElementById('in-isNotesUrgent').checked,
        targetDate: document.getElementById('in-targetDate') ? document.getElementById('in-targetDate').value : "",
        followUpDate: document.getElementById('in-followUpDate').value,

        // המרה למספרים עבור המחשבון
        brokerageRateSale: parseFloat(document.getElementById('in-brokerageRateSale').value) || 0,
        lawyerRateSale: parseFloat(document.getElementById('in-lawyerRateSale').value) || 0,
        brokerageRatePurch: parseFloat(document.getElementById('in-brokerageRatePurch').value) || 0,
        lawyerRatePurch: parseFloat(document.getElementById('in-lawyerRatePurch').value) || 0,
        
        // שמירת העדפות התאמה אישית
        prefEdu: parseFloat(document.getElementById('in-prefEdu').value) || 3,
        prefTrans: parseFloat(document.getElementById('in-prefTrans').value) || 3,
        prefLeisure: parseFloat(document.getElementById('in-prefLeisure').value) || 3,
        prefSea: parseFloat(document.getElementById('in-prefSea').value) || 3,
        limitHighFloor: document.getElementById('in-limitHighFloor').checked,
        
        properties: currentProperties,
        favorites: window.currentFavorites, 
        ratings: currentRatings,
        lastUpdated: new Date().toISOString()
    };

    // הזרקת שלב ציר הזמן רק אם הוא אחד מ-5 השלבים הפעילים
    if (newRoadmapStep) {
        data.roadmapStep = newRoadmapStep;
    }
    
    try {
        await updateDoc(doc(db, "projects", clientID), data);
        let logMsg = `✨ עודכן תיק לקוח: ${data.clientName} (סטטוס: ${currentStatus})`;
        if (data.isNotesUrgent) logMsg += " [סומן כדחוף ⚠️]";
        await logAction(logMsg);
        
        window.hasUnsavedChanges = false;
        if (saveBtn) saveBtn.classList.remove('unsaved');
        if (document.getElementById('save-status')) document.getElementById('save-status').style.display = 'none';
        
        alert("התיק סונכרן בהצלחה! ציר הזמן של הלקוח עודכן.");
    } catch (error) {
        console.error("Save error:", error);
        alert("שגיאה בשמירה. וודאי שאת מחוברת לאינטרנט.");
    }
};

function renderAssigned() {
    const container = document.getElementById('assigned-props-container') || document.getElementById('assigned-props-list');
    if (!container) return;

    if (currentProperties.length === 0) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:#888; border:1px dashed #ddd; border-radius:8px;">אין נכסים משויכים לתיק זה</div>`;
        return;
    }

    container.innerHTML = currentProperties.map((p, i) => {
        // 1. מחפשים את הנכס בבנק לפי ID (propertyId) או כתובת
        const liveProp = allBankProperties.find(bp => 
            (p.propertyId && bp.id === p.propertyId) || (p.id && bp.id === p.id) || (bp.address === p.address)
        );

        // 2. משתמשים במידע המעודכן מהבנק אם הוא קיים
        const currentAddr = liveProp ? liveProp.address : p.address;
        const currentPrice = liveProp ? liveProp.price : p.price;
        const currentCity = liveProp ? liveProp.city : (p.city || 'כללי');

        const isFav = window.currentFavorites && window.currentFavorites.some(addr => addr.trim() === currentAddr.trim());
        const favTag = isFav ? `<div class="fav-indicator" style="color:#e74c3c; font-size:12px; font-weight:bold;">❤️ אהבו את הנכס</div>` : '';

        return `
        <div class="assigned-prop" style="display: flex; justify-content: space-between; align-items: center; background: #f8f9fa; padding: 12px 20px; border-radius: 8px; margin-bottom: 10px; border-right: 4px solid #2c3e50;">
            <div style="flex-grow:1;">
                <div style="font-weight:bold;">${currentAddr}</div>
                <div style="font-size:12px; color:#666;">
                    ${currentCity} | ₪${FinanceLogic.formatNumber(currentPrice)} | ${p.rooms || '?'} חד'
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:15px;">
                ${favTag}
                <button onclick="window.remP(${i})" style="color:#e74c3c; background:none; border:1px solid #fed7d7; padding:5px 10px; border-radius:5px; cursor:pointer; font-size:12px;">הסר</button>
            </div>
        </div>
        `;
    }).join('');
}

window.remP = (i) => { 
    if (!currentProperties[i]) return;

    // 1. שמירת הכתובת של הנכס להסרה
    const addrToRemove = currentProperties[i].address;

    if (confirm(`האם להסיר את ${addrToRemove} מהתיק? (זה ינקה גם מועדפים ודירוגים)`)) {
        
        // א. הסרה מרשימת הנכסים המשויכים
        currentProperties.splice(i, 1); 

        // ב. ניקוי מהמועדפים (Favorites)
        if (window.currentFavorites) {
            window.currentFavorites = window.currentFavorites.filter(f => 
                f && f.trim() !== addrToRemove.trim()
            );
        }

        // ג. ניקוי מהדירוגים (Ratings) - עכשיו זה יעבוד כי הוספנו את המשתנה
        if (currentRatings) {
            // אנחנו בודקים אם קיימת כתובת כזו במפתחות של האובייקט ומוחקים
            Object.keys(currentRatings).forEach(key => {
                if (key.trim() === addrToRemove.trim()) {
                    delete currentRatings[key];
                }
            });
        }

        // ד. רענון התצוגה וסימון לשינוי
        renderAssigned(); 
        markChanged();
    }
};

const openBankBtn = document.getElementById('btn-open-bank') || document.querySelector('[onclick="window.openBankModal()"]');
if (openBankBtn) {
    openBankBtn.onclick = async () => {
        const snap = await getDocs(collection(db, "property_bank"));
        allBankProperties = [];
        snap.forEach(s => {
            const data = s.data();
            allBankProperties.push({ id: s.id, ...data });
        });

        const modal = document.getElementById('bank-modal');
        const listContainer = document.getElementById('bank-list-container') || document.getElementById('bank-list');
        
        selectedIDs = []; 

        if (!document.getElementById('bank-search-input')) {
            const searchInput = document.createElement('input');
            searchInput.id = "bank-search-input";
            searchInput.type = "text";
            searchInput.placeholder = "חיפוש בבנק (רחוב או עיר)...";
            searchInput.style = "width:100%; padding:12px; margin-bottom:15px; border:1px solid #ddd; border-radius:8px;";
            searchInput.oninput = (e) => renderBankList(e.target.value);
            listContainer.parentElement.insertBefore(searchInput, listContainer);
        } else {
            document.getElementById('bank-search-input').value = ""; 
        }
        renderBankList();
        modal.style.display = 'block';
    };
    
    window.openBankModal = openBankBtn.onclick;
}

function renderBankList(filterTerm = "") {
    const list = document.getElementById('bank-list-container') || document.getElementById('bank-list');
    list.innerHTML = "";
    const term = filterTerm.toLowerCase();
    
    const assignedAddresses = currentProperties.map(p => p.address);
    const filtered = allBankProperties.filter(d => {
        const matchesSearch = d.address.toLowerCase().includes(term) || (d.city && d.city.toLowerCase().includes(term));
        return matchesSearch && !assignedAddresses.includes(d.address);
    });

    if (filtered.length === 0) {
        list.innerHTML = `<div style="padding:20px; text-align:center; color:#888;">לא נמצאו נכסים חדשים לשיוך</div>`;
        return;
    }

    filtered.forEach(d => {
        const isSelected = selectedIDs.includes(d.id);
        const div = document.createElement('div');
        div.className = "bank-item" + (isSelected ? " selected" : "");
        div.style = `padding:12px; border-bottom:1px solid #f0f0f0; cursor:pointer; transition: 0.2s; ${isSelected ? 'background:#fff9e6; border:1px solid #FFD700;' : ''}`;
        
        div.innerHTML = `
            <div style="font-weight:bold;">${d.address}</div>
            <div style="font-size:13px; color:#666;">
                ${d.city || 'כללי'} | <span style="color:#27ae60; font-weight:bold;">₪${FinanceLogic.formatNumber(d.price)}</span>
            </div>
        `;

        div.onclick = () => { 
            if (selectedIDs.includes(d.id)) {
                selectedIDs = selectedIDs.filter(id => id !== d.id);
            } else {
                selectedIDs.push(d.id);
            }
            renderBankList(document.getElementById('bank-search-input') ? document.getElementById('bank-search-input').value : "");
        };
        list.appendChild(div);
    });
}

const confirmBtn = document.getElementById('btn-confirm-selection');
if (confirmBtn) {
    confirmBtn.onclick = () => {
        if (selectedIDs.length === 0) {
            alert("לא נבחרו נכסים לשיוך.");
            return;
        }

        selectedIDs.forEach(id => {
            const propData = allBankProperties.find(p => p.id === id);
            if (propData) {
                // במקום למחוק את ה-ID, אנחנו שומרים את כל הנתונים 
                // ומוסיפים להם שדה שנקרא propertyId כדי שנוכל לזהות את הנכס תמיד
                const propWithId = { 
                    ...propData, 
                    propertyId: id 
                };
                currentProperties.push(propWithId);
            }
        });

        renderAssigned();
        markChanged();
        document.getElementById('bank-modal').style.display = 'none';
    };
}

init();

document.addEventListener('DOMContentLoaded', init);

document.getElementById('in-clientPhone').oninput = (e) => {
    e.target.value = FinanceLogic.formatPhone(e.target.value);
    markChanged();
};