import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { 
    getFirestore, collection, getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc, 
    query, orderBy, limit, onSnapshot, setDoc, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

// אתחול Firebase בתוך הקובץ
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// בדיקת אבטחה לפני טעינת נתונים
onAuthStateChanged(auth, (user) => {
    if (!user) {
        // אם המשתמש לא מחובר, החזר אותו ל-Login
        window.location.href = 'login.html';
    } else {
        console.log("Admin מחובר ומאומת: " + user.email);
        
        // הפעלת הסנכרון הראשוני של הנתונים רק אחרי שיש אימות
        initProvidersSync();
        initAllSnapshots(); 
    }
});

// פונקציה מרכזת לכל ה-Snapshots שהיו "זרוקים" בקוד
function initAllSnapshots() {
    // יומן פעילות
    onSnapshot(query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(100)), (snap) => {
        allLogs = [];
        snap.forEach(s => allLogs.push(s.data()));
        if (!document.getElementById('log-search').value) {
            renderLogs(allLogs);
        } else {
            document.getElementById('log-search').dispatchEvent(new Event('input'));
        }
    });

    // בקשות ייעוץ
    onSnapshot(query(collection(db, "consultation_requests"), orderBy("timestamp", "desc")), (snap) => {
        const tbody = document.getElementById('consults-tbody');
        if (!tbody) return;
        tbody.innerHTML = "";
        snap.forEach(s => {
            const d = s.data();
            tbody.innerHTML += `<tr>
                <td><strong>${d.clientName}</strong></td>
                <td style="max-width:300px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                    <a href="${d.url}" target="_blank" style="color:#3498db;">${d.url}</a>
                </td>
                <td style="font-size:12px; color:#888;">${new Date(d.timestamp).toLocaleString('he-IL')}</td>
                <td>
                    <button class="btn-action btn-inject" onclick="window.injectToBank('${d.url}', '${s.id}')">הזרקה לבנק 💉</button>
                    <button class="btn-action btn-del" onclick="window.delConsult('${s.id}')">מחיקה</button>
                </td>
            </tr>`;
        });
    });

    // ערים
    onSnapshot(collection(db, "cities"), (snap) => {
        const cityList = document.getElementById('cities-list-admin');
        const citySelect = document.getElementById('p-city-select');
        const bankFilter = document.getElementById('bank-city-filter');
        if (cityList) cityList.innerHTML = "";
        if (citySelect) citySelect.innerHTML = '<option value="">בחרי עיר...</option>';
        if (bankFilter) bankFilter.innerHTML = '<option value="">כל הערים</option>';

        snap.forEach(s => {
            const city = s.data();
            if (cityList) {
                const div = document.createElement('div');
                div.className = "city-item-admin"; 
                div.innerHTML = `<span>${city.name}</span> <button onclick="window.delCity('${s.id}', '${city.name}')" title="מחיקה">✖</button>`;
                cityList.appendChild(div);
            }
            const opt = document.createElement('option');
            opt.value = city.name;
            opt.innerText = city.name;
            if (citySelect) citySelect.appendChild(opt.cloneNode(true));
            if (bankFilter) bankFilter.appendChild(opt);
        });
    });

    // פרויקטים/לקוחות
    onSnapshot(collection(db, "projects"), (snap) => {
        ensureFilterAndExportButtons();
        const tbody = document.getElementById('clients-tbody');
        const clientBtn = document.getElementById('btn-show-clients');
        if (!tbody) return;
        tbody.innerHTML = "";
        
        let urgentCount = 0;
        allCurrentClients = [];

        // --- תיקון שעון ישראל: קבלת התאריך המקומי (YYYY-MM-DD) ללא תלות בשעון UTC ---
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000; // הפרש דקות במילישניות
        const todayStr = (new Date(now - offset)).toISOString().split('T')[0];
        
        snap.forEach(s => {
            const d = s.data();
            let isActuallyUrgent = d.isNotesUrgent || false;
            
            // בדיקת דחיפות לפי תאריך מעקב (השוואה טקסטואלית של YYYY-MM-DD היא הכי בטוחה)
            if (d.followUpDate) {
                if (d.followUpDate <= todayStr) {
                    isActuallyUrgent = true;
                }
            }

            allCurrentClients.push({ id: s.id, ...d, computedUrgent: isActuallyUrgent });
            if (isActuallyUrgent) urgentCount++;
        });

        if (clientBtn) {
            const existingBadge = clientBtn.querySelector('.urgent-badge-tab');
            if (existingBadge) existingBadge.remove();
            if (urgentCount > 0) {
                clientBtn.innerHTML += ` <span class="urgent-badge-tab" style="background:#e74c3c; color:white; border-radius:50%; padding:2px 7px; font-size:11px; margin-right:5px; vertical-align:middle;">${urgentCount}</span>`;
            }
        }

        const render = () => {
            tbody.innerHTML = "";
            allCurrentClients.forEach(d => {
                const matchesUrgent = !showUrgentOnly || d.computedUrgent;
                const matchesSearch = !clientSearchTerm || d.clientName.toLowerCase().includes(clientSearchTerm);

                if (matchesUrgent && matchesSearch) {
                    // עיצוב תאריך התזכורת לתצוגה יפה (DD/MM/YYYY)
                    const displayFollowUp = d.followUpDate ? d.followUpDate.split('-').reverse().join('/') : "";

                    const urgentUI = d.computedUrgent ? `
                        <div style="display:flex; align-items:center; gap:5px;">
                            <span style="cursor:help;" title="${d.followUpDate ? 'תזכורת מעקב ליום: ' + displayFollowUp : 'הערה דחופה בתיק'}">⚠️</span>
                            <button onclick="window.resolveUrgent('${d.id}', '${d.clientName}')" 
                                    title="סמן כטופל והסר דחיפות"
                                    style="background:#27ae60; color:white; border:none; border-radius:50%; width:18px; height:18px; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center;">✓</button>
                        </div>
                    ` : '';

                    const roadmapText = ROADMAP_STEPS[d.roadmapStep] || "טרם נקבע";

                    const propsList = (d.properties || []).map(p => {
                        const liveProp = allBankProps.find(bp => 
                            (p.propertyId && bp.id === p.propertyId) || 
                            (p.id && bp.id === p.id) || 
                            (bp.data.address === p.address)
                        );
                        const currentAddr = liveProp ? liveProp.data.address : p.address;
                        return `
                            <span class="prop-badge" title="לחצי לעריכת הנכס" style="cursor:pointer;" onclick="window.quickEditProp('${currentAddr}')">
                                ${currentAddr}
                            </span>
                        `;
                    }).join('');

                    const favsList = (d.favorites || []).map(f => {
                        const associatedProp = (d.properties || []).find(p => p.address === f);
                        const pId = associatedProp ? (associatedProp.propertyId || associatedProp.id) : null;
                        const liveProp = allBankProps.find(bp => 
                            (pId && bp.id === pId) || (bp.data.address === f)
                        );
                        const currentAddr = liveProp ? liveProp.data.address : f;
                        return `
                            <span class="fav-badge" title="לחצי לעריכת הנכס" style="cursor:pointer;" onclick="window.quickEditProp('${currentAddr}')">
                                ${currentAddr}
                            </span>
                        `;
                    }).join('');
                    
                    const ratingsObj = d.ratings || {};
                    const ratingsList = Object.entries(ratingsObj).map(([addr, stars]) => {
                        const associatedProp = (d.properties || []).find(p => p.address === addr);
                        const pId = associatedProp ? (associatedProp.propertyId || associatedProp.id) : null;
                        const liveProp = allBankProps.find(bp => 
                            (pId && bp.id === pId) || (bp.data.address === addr)
                        );
                        const currentAddr = liveProp ? liveProp.data.address : addr;
                        return `
                            <span class="rating-badge" title="לחצי לעריכת הנכס" style="cursor:pointer;" onclick="window.quickEditProp('${currentAddr}')">
                                ${currentAddr} (${stars}⭐)
                            </span>
                        `;
                    }).join('');
                    
                    const clientPortalUrl = `${window.location.origin}/client.html?id=${d.id}`;

                    tbody.innerHTML += `<tr>
                        <td style="vertical-align: top; font-weight: bold;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                ${urgentUI}${d.clientName}
                            </div>
                        </td>
                        <td style="vertical-align: top;">
                            <div style="background: #222; color: #FFD700; padding: 4px 10px; border-radius: 12px; font-size: 11px; border: 1px solid #333; font-weight: bold; width: fit-content;">${roadmapText}</div>
                        </td>
                        <td style="width: 200px;">
                            <div style="max-height: 80px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 5px; padding: 5px; border: 1px solid #222; border-radius: 8px; background: #0a0a0a;">
                                ${propsList || '<span style="color:#444; font-size:12px;">אין משויכים</span>'}
                            </div>
                        </td>
                        <td style="width: 200px;">
                            <div style="max-height: 80px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 5px; padding: 5px; border: 1px solid #222; border-radius: 8px; background: #0a0a0a;">
                                ${favsList || '<span style="color:#444; font-size:12px;">אין מועדפים</span>'}
                            </div>
                        </td>
                        <td style="width: 200px;">
                            <div style="max-height: 80px; overflow-y: auto; display: flex; flex-wrap: wrap; gap: 5px; padding: 5px; border: 1px solid #222; border-radius: 8px; background: #0a0a0a;">
                                ${ratingsList || '<span style="color:#444; font-size:12px;">טרם דורג</span>'}
                            </div>
                        </td>
                        <td style="vertical-align: top;">
                            <button class="btn-action btn-whatsapp" onclick="window.sendWA('${d.id}', '${d.clientName}', '${d.clientPhone || ''}')">💬 WhatsApp</button>
                            <a href="edit-project.html?id=${d.id}" target="_blank" class="btn-action" style="background: black; color: #FFD700; font-weight: bold; border: 1px solid #FFD700;">🏠 ניהול לקוח</a>
                            <a href="${clientPortalUrl}" target="_blank" class="btn-action btn-view-client">👁️ צפיית לקוח</a>
                            <button class="btn-action btn-del" onclick="window.delCl('${d.id}', '${d.clientName}')">מחיקה</button>
                        </td>
                    </tr>`;
                }
            });
            document.dispatchEvent(new Event('refreshBank'));
        };
        document.addEventListener('refreshClients', render);
        render();
    });

    // בנק נכסים
    onSnapshot(collection(db, "property_bank"), (snap) => {
        allBankProps = [];
        snap.forEach(s => allBankProps.push({ id: s.id, data: s.data() }));
        renderBank();
        document.dispatchEvent(new Event('refreshClients'));
    });
}

let showUrgentOnly = false; 
let clientSearchTerm = ""; 
let allCurrentClients = []; 
let allBankProps = []; 
let matchingPropData = null; 
let selectedMatchClientIDs = [];

const ROADMAP_STEPS = {
    "1": "🔍 חיפוש ואיתור",
    "2": "⚖️ בדיקות ומשא ומתן",
    "3": "🖊️ חתימה ומימון",
    "4": "🔑 קבלת מפתח ושיפוץ",
    "5": "🎊 מזל טוב!",
    "6": "❄️ הקפאה",
    "7": "🚫 בוטל"
};

const switchTab = (target) => {
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const targetSection = document.getElementById(`section-${target}`);
    const targetBtn = document.getElementById(`btn-show-${target}`);
    if (targetSection) targetSection.classList.add('active');
    if (targetBtn) targetBtn.classList.add('active');
};

document.getElementById('btn-show-today').onclick = () => switchTab('today');
document.getElementById('btn-show-clients').onclick = () => switchTab('clients');
document.getElementById('btn-show-props').onclick = () => switchTab('props');
document.getElementById('btn-show-logs').onclick = () => switchTab('logs');
document.getElementById('btn-show-settings').onclick = () => switchTab('settings');
document.getElementById('btn-show-consults').onclick = () => switchTab('consults');

const btnShowProviders = document.getElementById('btn-show-providers');
if (btnShowProviders) {
    btnShowProviders.onclick = () => switchTab('providers');
}

async function logAction(msg) {
    await addDoc(collection(db, "activity_logs"), { timestamp: new Date().toISOString(), message: msg });
}

// --- פונקציות ניהול אנשי מקצוע ---
function initProvidersSync() {
    onSnapshot(collection(db, "service_providers"), (snap) => {
        const providers = [];
        snap.forEach(d => providers.push({ id: d.id, ...d.data() }));
        renderProviders(providers);
    });
}

function renderProviders(providersArray) {
    const tbody = document.getElementById('providers-tbody');
    if (!tbody) return;
    tbody.innerHTML = "";
    
    providersArray.forEach(p => {
        // התיקון: הוספת || "" מבטיחה שאם p.phone הוא undefined, הפונקציה תקבל טקסט ריק
        const displayPhone = window.formatPhone(p.phone || "");

        tbody.innerHTML += `<tr>
            <td style="font-weight:bold; color:#FFD700;">${p.name}</td>
            <td><span style="background:#222; padding:4px 10px; border-radius:4px; font-size:13px;">${p.category}</span></td>
            <td style="white-space:nowrap; direction: ltr; text-align: right;">${displayPhone}</td>
            <td style="max-width:300px; font-size:13px; color:#ccc;">${p.description || '-'}</td>
            <td>
                <button class="btn-action btn-del" onclick="window.delProvider('${p.id}', '${p.name}')">מחיקה</button>
            </td>
        </tr>`;
    });
}

const saveProviderBtn = document.getElementById('save-provider-btn');
if (saveProviderBtn) {
    saveProviderBtn.onclick = async () => {
        const name = document.getElementById('prov-name').value;
        const category = document.getElementById('prov-category').value;
        const phone = document.getElementById('prov-phone').value;
        const description = document.getElementById('prov-desc').value;
        
        if (!name || !phone) return alert("חובה למלא שם וטלפון");
        
        try {
            await addDoc(collection(db, "service_providers"), {
                name, 
                category, 
                phone: window.cleanPhone(phone), 
                description,
                timestamp: new Date().toISOString()
            });
            
            await logAction(`🛠️ נוסף איש מקצוע לנבחרת: ${name} (${category})`);
            document.getElementById('provider-modal').style.display = 'none';
            ['prov-name', 'prov-phone', 'prov-desc'].forEach(id => document.getElementById(id).value = "");
        } catch (e) {
            console.error("Error saving provider:", e);
            alert("שגיאה בשמירת איש המקצוע");
        }
    };
}

window.delProvider = async (id, name) => {
    if (confirm(`למחוק את ${name} מנבחרת המומחים?`)) {
        await deleteDoc(doc(db, "service_providers", id));
        await logAction(`🗑️ איש מקצוע הוסר: ${name}`);
    }
};

window.quickEditProp = async (address) => {
    try {
        const snap = await getDocs(collection(db, "property_bank"));
        let found = null;
        let foundId = null;
        snap.forEach(s => {
            if (s.data().address === address) {
                found = s.data();
                foundId = s.id;
            }
        });
        if (found) {
            window.editPr(foundId, found);
        } else {
            alert("נכס זה לא נמצא בבנק הנכסים המרכזי.");
        }
    } catch (error) {
        console.error("Error finding property:", error);
    }
};

window.exportUrgentReport = () => {
    const urgentClients = allCurrentClients.filter(c => c.computedUrgent);
    if (urgentClients.length === 0) return alert("אין לקוחות דחופים לייצוא כרגע.");
    const printWindow = window.open('', '_blank');
    const todayStr = new Date().toLocaleDateString('he-IL');
    let html = `
        <html dir="rtl" lang="he">
        <head>
            <title>דו"ח עבודה יומי - לי אטדגי - ${todayStr}</title>
            <style>
                body { font-family: 'Segoe UI', Arial, sans-serif; padding: 40px; color: #333; }
                h1 { color: #2c3e50; border-bottom: 3px solid #FFD700; padding-bottom: 10px; }
                .client-card { border: 1px solid #eee; padding: 15px; margin-bottom: 20px; border-radius: 8px; page-break-inside: avoid; }
                .client-header { display: flex; justify-content: space-between; align-items: center; background: #f9f9f9; padding: 10px; border-radius: 5px; margin-bottom: 10px; }
                .client-name { font-size: 20px; font-weight: bold; color: #e74c3c; }
                .client-info { font-size: 14px; color: #555; }
                .urgent-note { background: #fff5f5; border-right: 4px solid #e74c3c; padding: 10px; margin-top: 10px; font-style: italic; }
                @media print { .no-print { display: none; } }
                .btn-print { background: #27ae60; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <button class="btn-print no-print" onclick="window.print()">🖨️ הדפסי דו"ח או שמרי כ-PDF</button>
            <h1>📋 דו"ח לקוחות לטיפול דחוף - ${todayStr}</h1>
    `;
    urgentClients.forEach(c => {
        const props = (c.properties || []).map(p => `<li>${p.address}, ${p.city}</li>`).join('');
        html += `
            <div class="client-card">
                <div class="client-header">
                    <span class="client-name">${c.clientName}</span>
                    <span class="client-info">📞 ${c.clientPhone || 'אין טלפון'}</span>
                </div>
                ${c.privateNotes ? `<div class="urgent-note"><strong>הערה דחופה:</strong> ${c.privateNotes}</div>` : ''}
                <ul class="prop-list">${props || 'אין נכסים משויכים'}</ul>
            </div>
        `;
    });
    html += `</body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
};

window.resolveUrgent = async (id, name) => {
    try {
        await updateDoc(doc(db, "projects", id), { isNotesUrgent: false, followUpDate: "" });
        await logAction(`✅ סומן כבוצע: הדחיפות בתיק של ${name} הוסרה`);
    } catch (error) { console.error(error); }
};

let allLogs = []; 
document.getElementById('clear-logs-btn').onclick = async () => {
    if (confirm("האם את בטוחה שברצונך למחוק את כל יומן הפעילות?")) {
        try {
            const querySnapshot = await getDocs(collection(db, "activity_logs"));
            const batch = writeBatch(db);
            querySnapshot.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            alert("היומן נוקה!");
            await logAction("🧹 יומן הפעילות נוקה");
        } catch (error) { console.error(error); }
    }
};

function renderLogs(logsArray) {
    const tbody = document.getElementById('logs-tbody');
    if (!tbody) return;
    tbody.innerHTML = "";
    logsArray.forEach(d => {
        let rowStyle = (d.message.includes("🎊") || d.message.includes("✅")) ? "background: rgba(255, 215, 0, 0.1); font-weight: bold;" : "";
        tbody.innerHTML += `<tr style="${rowStyle}">
            <td style="color:#888; font-size:12px;">${new Date(d.timestamp).toLocaleString('he-IL')}</td>
            <td>${d.message}</td>
        </tr>`;
    });
}

document.getElementById('log-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allLogs.filter(log => log.message.toLowerCase().includes(term));
    renderLogs(filtered);
};

window.injectToBank = async (url, requestId) => {
    document.getElementById('edit-prop-id').value = "";
    document.querySelectorAll('#prop-modal input:not([type="checkbox"]), #prop-modal textarea, #prop-modal select').forEach(i => i.value = "");
    document.getElementById('p-link').value = url;
    if (!url.startsWith('http')) document.getElementById('p-address').value = url;
    document.getElementById('p-status').value = "ACTIVE";
    document.getElementById('prop-modal').style.display = 'block';
};

window.delConsult = async (id) => {
    if (confirm("למחוק את בקשת ייעוץ?")) await deleteDoc(doc(db, "consultation_requests", id));
};

document.getElementById('add-city-btn').onclick = async () => {
    const input = document.getElementById('new-city-name');
    if (!input.value) return;
    await addDoc(collection(db, "cities"), { name: input.value });
    await logAction(`התווספה עיר חדשה: ${input.value}`);
    input.value = "";
};

window.delCity = async (id, name) => {
    if (confirm(`למחוק את העיר ${name}?`)) {
        await deleteDoc(doc(db, "cities", id));
        await logAction(`העיר ${name} הוסרה`);
    }
};

document.getElementById('save-ai-settings').onclick = async () => {
    const key = document.getElementById('ai-api-key').value;
    await setDoc(doc(db, "settings", "ai_config"), { apiKey: key });
    alert("המפתח נשמר!");
};

let isAiRequestPending = false;
document.getElementById('run-ai-analysis').onclick = async (e) => {
    const btn = e.currentTarget;
    const addr = document.getElementById('p-address').value;
    const ta = document.getElementById('p-ai-analysis');
    if (isAiRequestPending || !addr) return; 
    const settingsSnap = await getDoc(doc(db, "settings", "ai_config"));
    const apiKey = settingsSnap.exists() ? settingsSnap.data().apiKey : null;
    if (!apiKey) return alert("הגדירי API Key");
    isAiRequestPending = true;
    ta.value = "מנתחת נתונים...";
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: `נתחי נכס בכתובת: ${addr}` }] }] })
        });
        const result = await resp.json();
        if (result.candidates) ta.value = result.candidates[0].content.parts[0].text;
    } catch (e) { console.error(e); }
    finally { isAiRequestPending = false; }
};

window.sendWA = (id, name, phone) => {
    const url = `${window.location.origin}/client.html?id=${id}`;
    const msg = encodeURIComponent(`היי ${name}, הנה הקישור שלך: ${url}`);
    const cleanPhone = phone ? phone.replace(/\D/g, '') : "";
    window.open(`https://wa.me/${cleanPhone.startsWith('0') ? '972' + cleanPhone.substring(1) : cleanPhone}?text=${msg}`, '_blank');
};

function ensureFilterAndExportButtons() {
    if (document.getElementById('urgent-filter-container')) return;
    const clientSection = document.getElementById('section-clients');
    if (!clientSection) return;
    const filterDiv = document.createElement('div');
    filterDiv.id = "urgent-filter-container";
    filterDiv.style = "margin-bottom: 15px; background: #fff; padding: 15px; border-radius: 8px; border-right: 4px solid #FFD700; display: flex; align-items: center; justify-content: space-between; color: black;";
    filterDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" id="chk-urgent-only" style="width: auto;">
            <label for="chk-urgent-only" style="font-weight: bold; color: #e74c3c;">דחופים בלבד ⚠️</label>
        </div>
        <button onclick="window.exportUrgentReport()" style="background: #3498db; color: white; padding: 8px 15px; border-radius: 5px; cursor: pointer;">📄 ייצוא דו"ח</button>
    `;
    const table = clientSection.querySelector('table');
    if (table) clientSection.insertBefore(filterDiv, table);
    document.getElementById('chk-urgent-only').onclick = (e) => {
        showUrgentOnly = e.target.checked;
        document.dispatchEvent(new Event('refreshClients'));
    };
}

document.getElementById('client-search-input').oninput = (e) => {
    clientSearchTerm = e.target.value.toLowerCase();
    document.dispatchEvent(new Event('refreshClients'));
};

window.delCl = async (id, name) => {
    if (confirm(`למחוק את ${name}?`)) {
        await deleteDoc(doc(db, "projects", id));
        await logAction(`נמחק לקוח: ${name}`);
    }
};

const renderBank = () => {
    const tbody = document.getElementById('props-tbody');
    if (!tbody) return;
    tbody.innerHTML = "";
    const cityFilter = document.getElementById('bank-city-filter').value;
    const searchFilter = document.getElementById('bank-search-input').value.toLowerCase();
    allBankProps.forEach(d => {
        if ((!cityFilter || d.data.city === cityFilter) && (!searchFilter || d.data.address.toLowerCase().includes(searchFilter))) {
            tbody.innerHTML += `<tr>
                <td>${d.data.featured ? '🌟 ' : ''}${d.data.address}<br><small style="color:#888;">${d.data.city}</small></td>
                <td>₪${Number(d.data.price || 0).toLocaleString()}</td>
                <td>${d.data.rooms} חד', קומה ${d.data.floor}</td>
                <td>
                    <button class="btn-action btn-match-users" onclick="window.openMatchModal('${d.id}', '${d.data.address}')">שיוך 👥</button>
                    <button class="btn-action" onclick='window.editPr("${d.id}", ${JSON.stringify(d.data).replace(/'/g, "&apos;").replace(/"/g, "&quot;")})'>עריכה</button>
                    <button class="btn-action btn-del" onclick="window.delPr('${d.id}', '${d.data.address}')">מחיקה</button>
                </td>
            </tr>`;
        }
    });
};

document.getElementById('bank-city-filter').onchange = renderBank;
document.getElementById('bank-search-input').oninput = renderBank;

window.delPr = async (id, addr) => {
    if (confirm(`למחוק את ${addr}?`)) {
        await deleteDoc(doc(db, "property_bank", id));
        await logAction(`נכס נמחק: ${addr}`);
    }
};

window.editPr = (id, d) => {
    // מזהה הנכס (נסתר)
    document.getElementById('edit-prop-id').value = id;
    
    // נתונים בסיסיים
    document.getElementById('p-address').value = d.address || "";
    document.getElementById('p-city-select').value = d.city || "";
    document.getElementById('p-type').value = d.type || "";
    
    // נתונים פיזיים (כולל פורמט מחיר עם פסיקים לתצוגה)
    const formattedPrice = d.price ? Number(d.price).toLocaleString() : "";
    document.getElementById('p-price').value = formattedPrice;
    
    document.getElementById('p-rooms').value = d.rooms || "";
    document.getElementById('p-floor').value = d.floor || "";
    document.getElementById('p-sqm').value = d.sqm || "";
    document.getElementById('p-distTrain').value = d.distTrain || "";
    document.getElementById('p-status').value = d.status || "ACTIVE";

    // מדדי איכות חיים (ציונים)
    document.getElementById('p-scoreEdu').value = d.scoreEdu || "";
    document.getElementById('p-scoreTrans').value = d.scoreTrans || "";
    document.getElementById('p-scoreLeisure').value = d.scoreLeisure || "";
    document.getElementById('p-scoreSea').value = d.scoreSea || "";
    document.getElementById('p-distSea').value = d.distSea || "";

    // לינקים ותוכן
    document.getElementById('p-link').value = d.link || "";
    document.getElementById('p-featured').checked = d.featured || false; // Checkbox משתמש ב-checked
    document.getElementById('p-leeTip').value = d.leeTip || "";
    document.getElementById('p-ai-analysis').value = d.aiAnalysis || "";

    // פתיחת המודל
    document.getElementById('prop-modal').style.display = 'block';
};

document.getElementById('save-prop-to-db').onclick = async () => {
    const id = document.getElementById('edit-prop-id').value;
    
    // איסוף הלינקים מה-textarea ופיצול למערך לפי ירידת שורה
    const rawLinksText = document.getElementById('p-link').value;
    const linksArray = rawLinksText.split('\n').map(l => l.trim()).filter(l => l !== "");

    // איסוף כל הנתונים מהמודל לפי ה-IDs ב-HTML
    const data = {
        address: document.getElementById('p-address').value,
        city: document.getElementById('p-city-select').value,
        type: document.getElementById('p-type').value,
        price: window.cleanPhone(document.getElementById('p-price').value), 
        rooms: document.getElementById('p-rooms').value,
        floor: document.getElementById('p-floor').value,
        sqm: document.getElementById('p-sqm').value,
        distTrain: document.getElementById('p-distTrain').value,
        status: document.getElementById('p-status').value,
        scoreEdu: document.getElementById('p-scoreEdu').value,
        scoreTrans: document.getElementById('p-scoreTrans').value,
        scoreLeisure: document.getElementById('p-scoreLeisure').value,
        scoreSea: document.getElementById('p-scoreSea').value,
        distSea: document.getElementById('p-distSea').value,
        
        // --- עדכון הלינקים לשמירה כמערך וגם כטקסט לגיבוי ---
        link: rawLinksText,        // שומר את הטקסט הגולמי כפי שהוקלד (בשביל ה-Admin)
        links: linksArray,        // שומר מערך נקי (בשביל הבורר ב-Client)
        
        featured: document.getElementById('p-featured').checked,
        leeTip: document.getElementById('p-leeTip').value,
        aiAnalysis: document.getElementById('p-ai-analysis').value,
        lastUpdated: new Date().toISOString()
    };

    try {
        if (id) {
            await updateDoc(doc(db, "property_bank", id), data);
        } else {
            await addDoc(collection(db, "property_bank"), data);
        }
        
        document.getElementById('prop-modal').style.display = 'none';
        alert("הנכס נשמר בהצלחה בבנק הנכסים!");
        
    } catch (error) {
        console.error("שגיאה בשמירת הנכס:", error);
        alert("אירעה שגיאה בשמירה. בדקי את הקונסול.");
    }
};

window.openMatchModal = async (propId, address) => {
    const propSnap = await getDoc(doc(db, "property_bank", propId));
    matchingPropData = { id: propId, ...propSnap.data() };
    document.getElementById('match-prop-name').innerText = `שיוך: ${address}`;
    selectedMatchClientIDs = [];
    renderMatchClientList();
    document.getElementById('match-clients-modal').style.display = 'block';
};

const renderMatchClientList = (searchTerm = "") => {
    const list = document.getElementById('match-clients-list');
    list.innerHTML = "";
    allCurrentClients.forEach(c => {
        if (!searchTerm || c.clientName.toLowerCase().includes(searchTerm.toLowerCase())) {
            const div = document.createElement('div');
            div.className = `client-match-item ${selectedMatchClientIDs.includes(c.id) ? 'selected' : ''}`;
            div.innerText = c.clientName;
            div.onclick = () => {
                if (selectedMatchClientIDs.includes(c.id)) selectedMatchClientIDs = selectedMatchClientIDs.filter(id => id !== c.id);
                else selectedMatchClientIDs.push(c.id);
                renderMatchClientList(searchTerm);
            };
            list.appendChild(div);
        }
    });
};

document.getElementById('confirm-match-action').onclick = async () => {
    const batch = writeBatch(db);
    for (const clientId of selectedMatchClientIDs) {
        const clientRef = doc(db, "projects", clientId);
        const clientSnap = await getDoc(clientRef);
        const props = clientSnap.data().properties || [];
        if (!props.some(p => p.address === matchingPropData.address)) {
            props.push(matchingPropData);
            batch.update(clientRef, { properties: props });
        }
    }
    await batch.commit();
    document.getElementById('match-clients-modal').style.display = 'none';
};

document.getElementById('open-new-client-modal').onclick = () => {
    document.getElementById('edit-client-id').value = "";
    document.getElementById('new-client-name-input').value = "";
    document.getElementById('client-modal').style.display = 'block';
};

document.getElementById('confirm-create-client').onclick = async () => {
    const name = document.getElementById('new-client-name-input').value.trim();
    const rawPhone = document.getElementById('new-client-phone-input').value;

    if (!name) return alert("הזיני שם");

    try {
        // 1. שמירת הרשומה וקבלת המזהה (docRef)
        const docRef = await addDoc(collection(db, "projects"), { 
            clientName: name, 
            clientPhone: window.cleanPhone(rawPhone), // שמירת הטלפון נקי ממקפים
            roadmapStep: "1", 
            timestamp: new Date().toISOString() 
        });

        // 2. סגירת המודאל
        document.getElementById('client-modal').style.display = 'none';

        // 3. פתיחת דף העריכה בטאב חדש עם ה-ID שנוצר
        const newClientId = docRef.id;
        window.open(`edit-project.html?id=${newClientId}`, '_blank');

    } catch (error) {
        console.error("שגיאה ביצירת לקוח:", error);
        alert("אירעה שגיאה ביצירת הלקוח. בדקי את החיבור למערכת.");
    }
};

document.getElementById('open-new-prop-modal').onclick = () => {
    window.clearPropertyModal(); // הפעלת הניקוי
    document.getElementById('prop-modal').style.display = 'block'; // פתיחת המודאל
};

document.getElementById('master-reset-db').onclick = async () => {
    if (confirm("⚠️ אזהרה: מחיקת כל הנתונים?") && prompt("הקלידי 'מחק הכל'") === "מחק הכל") {
        const collections = ["projects", "property_bank", "cities", "activity_logs"];
        for (const col of collections) {
            const snap = await getDocs(collection(db, col));
            const batch = writeBatch(db);
            snap.forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        window.location.reload();
    }
};

window.clearPropertyModal = () => {
    console.log("Cleaning modal fields..."); // לבדיקה בקונסול
    
    // רשימת ה-IDs של כל השדות
    const fields = [
        'edit-prop-id', 'p-address', 'p-city-select', 'p-type', 'p-price', 
        'p-rooms', 'p-floor', 'p-sqm', 'p-distTrain', 'p-status', 
        'p-scoreEdu', 'p-scoreTrans', 'p-scoreLeisure', 'p-scoreSea', 'p-distSea', 
        'p-link', 'p-leeTip', 'p-ai-analysis'
    ];
    
    // איפוס שדות טקסט, מספר וסלקט
    fields.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    // איפוס צ'קבוקס
    const featured = document.getElementById('p-featured');
    if (featured) featured.checked = false;

    // איפוס כותרת המודאל למצב "נכס חדש"
    const modalTitle = document.getElementById('prop-modal-title');
    if (modalTitle) modalTitle.innerText = "הוספת נכס חדש לבנק";
};