import { db } from './firebase-config.js';
import { collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, query, orderBy, limit, getDoc, setDoc, getDocs, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { FinanceLogic } from './shared.js';

let showUrgentOnly = false; // מצב סינון דחופים
let clientSearchTerm = ""; // מצב חיפוש לקוחות
let allCurrentClients = []; // משתנה עזר לייצוא וסנכרון נכסים חמים
let allBankProps = []; // משתנה עזר לסינון בנק הנכסים
let matchingPropData = null; // עבור מודאל שידוך הפוך
let selectedMatchClientIDs = [];

// מפת שלבי הדרך ל-Roadmap
const ROADMAP_STEPS = {
    "1": "🔍 חיפוש ואיתור",
    "2": "⚖️ בדיקות ומשא ומתן",
    "3": "🖊️ חתימה ומימון",
    "4": "🔑 קבלת מפתח ושיפוץ",
    "5": "🎊 מזל טוב!"
};

const switchTab = (target) => {
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`section-${target}`).classList.add('active');
    document.getElementById(`btn-show-${target}`).classList.add('active');
};
document.getElementById('btn-show-clients').onclick = () => switchTab('clients');
document.getElementById('btn-show-props').onclick = () => switchTab('props');
document.getElementById('btn-show-logs').onclick = () => switchTab('logs');
document.getElementById('btn-show-settings').onclick = () => switchTab('settings');
document.getElementById('btn-show-consults').onclick = () => switchTab('consults');

// חיבור לשונית אנשי מקצוע חדשה
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
        tbody.innerHTML += `<tr>
            <td style="font-weight:bold; color:#FFD700;">${p.name}</td>
            <td><span style="background:#222; padding:4px 10px; border-radius:4px; font-size:13px;">${p.category}</span></td>
            <td>${p.phone}</td>
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
                name, category, phone, description,
                timestamp: new Date().toISOString()
            });
            await logAction(`🛠️ נוסף איש מקצוע לנבחרת: ${name} (${category})`);
            document.getElementById('provider-modal').style.display = 'none';
            // איפוס שדות
            ['prov-name', 'prov-phone', 'prov-desc'].forEach(id => document.getElementById(id).value = "");
        } catch (e) {
            alert("שגיאה בשמירת איש המקצוע");
        }
    };
	
	const provPhoneField = document.getElementById('prov-phone');
	if (provPhoneField) {
		provPhoneField.oninput = (e) => {
			e.target.value = FinanceLogic.formatPhone(e.target.value);
		};
	}
}

window.delProvider = async (id, name) => {
    if (confirm(`למחוק את ${name} מנבחרת המומחים?`)) {
        await deleteDoc(doc(db, "service_providers", id));
        await logAction(`🗑️ איש מקצוע הוסר: ${name}`);
    }
};

// --- פונקציות קיימות ---

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
                .prop-list { margin-right: 20px; font-size: 14px; }
                .urgent-note { background: #fff5f5; border-right: 4px solid #e74c3c; padding: 10px; margin-top: 10px; font-style: italic; }
                @media print { .no-print { display: none; } }
                .btn-print { background: #27ae60; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; margin-bottom: 20px; }
            </style>
        </head>
        <body>
            <button class="btn-print no-print" onclick="window.print()">🖨️ הדפסי דו"ח או שמרי כ-PDF</button>
            <h1>📋 דו"ח לקוחות לטיפול דחוף - ${todayStr}</h1>
            <p>להלן הלקוחות שסימנת כדחופים או שהגיע מועד המעקב שלהם:</p>
    `;

    urgentClients.forEach(c => {
        const props = (c.properties || []).map(p => `<li>${p.address}, ${p.city}</li>`).join('');
        html += `
            <div class="client-card">
                <div class="client-header">
                    <span class="client-name">${c.clientName}</span>
                    <span class="client-info">📞 ${c.clientPhone || 'אין טלפון'} | 📍 ${FinanceLogic.STATUSES[c.status] || c.status}</span>
                </div>
                ${c.privateNotes ? `<div class="urgent-note"><strong>הערה דחופה:</strong> ${c.privateNotes}</div>` : ''}
                ${c.followUpDate ? `<div style="color:#e67e22; font-weight:bold; margin-top:5px;">📅 תאריך מעקב: ${c.followUpDate}</div>` : ''}
                <div style="margin-top:10px;"><strong>נכסים משויכים:</strong></div>
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
        await updateDoc(doc(db, "projects", id), { 
            isNotesUrgent: false,
            followUpDate: "" 
        });
        await logAction(`✅ סומן כבוצע: הדחיפות והתזכורת בתיק של ${name} הוסרה מהתצוגה הראשית`);
    } catch (error) {
        console.error("Error resolving urgent status:", error);
    }
};

let allLogs = []; 

document.getElementById('clear-logs-btn').onclick = async () => {
    if (confirm("האם את בטוחה שברצונך למחוק את כל יומן הפעילות? פעולה זו אינה ניתנת לביטול.")) {
        try {
            const querySnapshot = await getDocs(collection(db, "activity_logs"));
            const batch = writeBatch(db);
            querySnapshot.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            alert("היומן נוקה בהצלחה!");
            await logAction("🧹 יומן הפעילות נוקה על ידי המנהלת");
        } catch (error) {
            console.error("Error clearing logs:", error);
            alert("שגיאה בניקוי היומן.");
        }
    }
};

function renderLogs(logsArray) {
    const tbody = document.getElementById('logs-tbody');
    if (!tbody) return;
    tbody.innerHTML = "";
    logsArray.forEach(d => {
        let rowStyle = "";
        if (d.message.includes("🎊") || d.message.includes("✨") || d.message.includes("🔍") || d.message.includes("✅")) {
            rowStyle = "background: rgba(255, 215, 0, 0.1); font-weight: bold;";
        }
        tbody.innerHTML += `<tr style="${rowStyle}">
            <td style="color:#888; font-size:12px;">${new Date(d.timestamp).toLocaleString('he-IL')}</td>
            <td>${d.message}</td>
        </tr>`;
    });
}

onSnapshot(query(collection(db, "activity_logs"), orderBy("timestamp", "desc"), limit(100)), (snap) => {
    allLogs = [];
    snap.forEach(s => allLogs.push(s.data()));
    if (!document.getElementById('log-search').value) {
        renderLogs(allLogs);
    } else {
        document.getElementById('log-search').dispatchEvent(new Event('input'));
    }
});

document.getElementById('log-search').oninput = (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = allLogs.filter(log => log.message.toLowerCase().includes(term));
    renderLogs(filtered);
};

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

window.injectToBank = async (url, requestId) => {
    document.getElementById('edit-prop-id').value = "";
    document.querySelectorAll('#prop-modal input:not([type="checkbox"]), #prop-modal textarea, #prop-modal select').forEach(i => i.value = "");
    document.getElementById('p-link').value = url;
    if (!url.startsWith('http')) {
        document.getElementById('p-address').value = url;
    }
    document.getElementById('p-status').value = "ACTIVE";
    document.getElementById('prop-modal').style.display = 'block';
    const addr = document.getElementById('p-address').value;
    const aiBtn = document.getElementById('run-ai-analysis');
    if (addr && addr.length > 3 && !aiBtn.disabled) {
        setTimeout(() => {
            aiBtn.click();
        }, 500);
    }
};

window.delConsult = async (id) => {
    if (confirm("למחוק את בקשת ייעוץ מהרשימה?")) {
        await deleteDoc(doc(db, "consultation_requests", id));
    }
};

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

document.getElementById('add-city-btn').onclick = async () => {
    const input = document.getElementById('new-city-name');
    if (!input.value) return;
    await addDoc(collection(db, "cities"), { name: input.value });
    await logAction(`התווספה עיר חדשה למערכת: ${input.value}`);
    input.value = "";
};

window.delCity = async (id, name) => {
    if (confirm(`למחוק את העיר ${name}? נכסים משויכים לא יימחקו אך יאבדו שיוך.`)) {
        await deleteDoc(doc(db, "cities", id));
        await logAction(`העיר ${name} הוסרה מהמערכת`);
    }
};

document.getElementById('save-ai-settings').onclick = async () => {
    const key = document.getElementById('ai-api-key').value;
    await setDoc(doc(db, "settings", "ai_config"), { apiKey: key });
    await logAction("עודכנו הגדרות API Key");
    alert("המפתח נשמר!");
};

let isAiRequestPending = false;

document.getElementById('run-ai-analysis').onclick = async (e) => {
    const btn = e.currentTarget;
    const addr = document.getElementById('p-address').value;
    const price = document.getElementById('p-price').value;
    const ta = document.getElementById('p-ai-analysis');
    const spinner = document.getElementById('ai-spinner');
    const btnText = document.getElementById('ai-btn-text');

    if (isAiRequestPending) return; 
    if (!addr) return alert("אנא הזיני כתובת לנכס");

    const settingsSnap = await getDoc(doc(db, "settings", "ai_config"));
    const apiKey = settingsSnap.exists() ? settingsSnap.data().apiKey : null;
    if (!apiKey) return alert("אנא הגדירי API Key בטאב הגדרות");

    isAiRequestPending = true;
    btn.disabled = true;
    spinner.style.display = 'inline-block';
    btnText.innerText = "מנתחת... נא להמתין";
    ta.classList.add('ai-analyzing');
    ta.value = "מתחברת ל-Gemini 2.0 Flash... מנתחת את הנתונים עבור לי אטדגי...";

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: `בתור סוכנת נדל"ן מומחית בשם לי אטדגי, נתחי את הנכס בכתובת: ${addr} במחיר: ${price}. 
                        כתבי 5 סעיפים קצרים ומקצועיים (שכנים, חינוך, תחבורה, שוק, שירותים). 
                        בסוף הוסיפי סיכום כדאיות אישי ממך כלי אטדגי.`
                    }]
                }]
            })
        });

        const result = await response.json();

        if (response.status === 429) {
            ta.value = "⚠️ שגיאה 429: חרגת ממכסת הבקשות של גוגל.\n\nהסבר: המודל החינמי מוגבל למספר קטן של ניתוחים בדקה.\n\nמה לעשות? המתיני 60 שניות בדיוק מבלי ללחוץ שוב, ואז נסי שוב.";
            await logAction(`⚠️ חריגת מכסה ב-API עבור כתובת: ${addr}`);
            return;
        }

        if (!response.ok) {
            throw new Error(result.error?.message || "שגיאה בחיבור לשרת ה-AI");
        }

        if (result.candidates && result.candidates[0].content) {
            ta.value = result.candidates[0].content.parts[0].text;
            await logAction(`✨ ניתוח AI הצליח עבור: ${addr}`);
        }

    } catch (e) {
        console.error("AI Error:", e);
        ta.value = "חלה שגיאה: " + e.message;
    } finally {
        setTimeout(() => {
            isAiRequestPending = false;
            btn.disabled = false;
            spinner.style.display = 'none';
            btnText.innerText = "✨ בצעי ניתוח מומחית (API)";
            ta.classList.remove('ai-analyzing');
        }, 2000);
    }
};

window.sendWA = (id, name, phone) => {
    const clientUrl = `${window.location.origin}/client.html?id=${id}`;
    const message = `היי ${name}, מצורף הקישור לדף הנכסים האישי שלך: ${clientUrl}`;
    const encodedMsg = encodeURIComponent(message);
    const cleanPhone = phone ? phone.replace(/[^0-9]/g, '') : "";
    const waNumber = cleanPhone.startsWith('0') ? '972' + cleanPhone.substring(1) : cleanPhone;
    window.open(`https://wa.me/${waNumber}?text=${encodedMsg}`, '_blank');
};

function ensureFilterAndExportButtons() {
    if (document.getElementById('urgent-filter-container')) return;
    const clientSection = document.getElementById('section-clients');
    if (!clientSection) return;
    
    const filterDiv = document.createElement('div');
    filterDiv.id = "urgent-filter-container";
    filterDiv.style = "margin-bottom: 15px; background: #fff; padding: 15px; border-radius: 8px; border-right: 4px solid #FFD700; display: flex; align-items: center; justify-content: space-between; gap: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); color: black;";
    filterDiv.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" id="chk-urgent-only" style="width: auto; cursor: pointer;">
            <label for="chk-urgent-only" style="cursor: pointer; font-weight: bold; color: #e74c3c; margin: 0;">הצג דחופים ותזכורות להיום בלבד ⚠️</label>
        </div>
        <button onclick="window.exportUrgentReport()" 
                style="background: #3498db; color: white; border: none; padding: 8px 15px; border-radius: 5px; cursor: pointer; font-weight: bold;">
                📄 ייצוא דו"ח עבודה יומי
        </button>
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

onSnapshot(collection(db, "projects"), (snap) => {
    ensureFilterAndExportButtons();
    const tbody = document.getElementById('clients-tbody');
    const clientBtn = document.getElementById('btn-show-clients');
    if (!tbody) return;
    tbody.innerHTML = "";
    
    let urgentCount = 0;
    allCurrentClients = [];
    const today = new Date();
    today.setHours(0,0,0,0);
    
    snap.forEach(s => {
        const d = s.data();
        let isActuallyUrgent = d.isNotesUrgent || false;
        
        if (d.followUpDate) {
            const fDate = new Date(d.followUpDate);
            fDate.setHours(0,0,0,0);
            if (fDate <= today) isActuallyUrgent = true;
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
                const urgentUI = d.computedUrgent ? `
                    <div style="display:flex; align-items:center; gap:5px;">
                        <span style="cursor:help;" title="${d.followUpDate ? 'תזכורת מעקב להיום: ' + d.followUpDate : 'הערה דחופה בתיק'}">⚠️</span>
                        <button onclick="window.resolveUrgent('${d.id}', '${d.clientName}')" 
                                title="סמן כטופל והסר דחיפות"
                                style="background:#27ae60; color:white; border:none; border-radius:50%; width:18px; height:18px; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center;">✓</button>
                    </div>
                ` : '';

                const roadmapText = ROADMAP_STEPS[d.roadmapStep] || "טרם נקבע";

                const propsList = (d.properties || []).map(p => `
                    <span class="prop-badge" title="לחצי לעריכת הנכס" style="cursor:pointer;" onclick="window.quickEditProp('${p.address}')">${p.address}</span>
                `).join('');

                const favsList = (d.favorites || []).map(f => `
                    <span class="fav-badge" title="לחצי לעריכת הנכס" style="cursor:pointer;" onclick="window.quickEditProp('${f}')">${f}</span>
                `).join('');
                
                const ratingsObj = d.ratings || {};
                const ratingsList = Object.entries(ratingsObj).map(([addr, stars]) => {
                    return `<span class="rating-badge" title="לחצי לעריכת הנכס" style="cursor:pointer;" onclick="window.quickEditProp('${addr}')">${addr} (${stars}⭐)</span>`;
                }).join('');
                
                const clientPortalUrl = `${window.location.origin}/client.html?id=${d.id}`;

                // תיקון התצוגה בעברית: שימוש ב-FinanceLogic.STATUSES
				tbody.innerHTML += `<tr>
                    <td style="vertical-align: top; font-weight: bold;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            ${urgentUI}${d.clientName}
                        </div>
                    </td>
                    <td style="vertical-align: top;">
                        <div style="margin-bottom:5px;">${FinanceLogic.STATUSES[d.status] || d.status}</div>
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
                        <button class="btn-action btn-whatsapp" onclick="window.sendWA('${d.id}', '${d.clientName}', '${d.clientPhone || ''}')">WhatsApp 💬</button>
                        <a href="${clientPortalUrl}" target="_blank" class="btn-action btn-view-client">צפיית לקוח 👁️</a>
                        <a href="edit-project.html?id=${d.id}" class="btn-action" style="background: black; color: #FFD700; font-weight: bold; border: 1px solid #FFD700;">ניהול תיק נכסים 🏠</a>
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

window.delCl = async (id, name) => {
    if (confirm(`למחוק את ${name}?`)) {
        await deleteDoc(doc(db, "projects", id));
        await logAction(`נמחק תיק לקוח: ${name}`);
    }
};

// --- לוגיקת בנק נכסים ---
const renderBank = () => {
    const tbody = document.getElementById('props-tbody');
    if (!tbody) return;
    tbody.innerHTML = "";
    
    const cityFilter = document.getElementById('bank-city-filter').value;
    const searchFilter = document.getElementById('bank-search-input').value.toLowerCase();

    const popularityMap = {};
    allCurrentClients.forEach(client => {
        (client.favorites || []).forEach(addr => {
            popularityMap[addr] = (popularityMap[addr] || 0) + 1;
        });
    });

    allBankProps.forEach(d => {
        const matchesCity = !cityFilter || d.data.city === cityFilter;
        const matchesSearch = !searchFilter || d.data.address.toLowerCase().includes(searchFilter);

        if (matchesCity && matchesSearch) {
            const popCount = popularityMap[d.data.address] || 0;
            const isHot = popCount > 0;
            const featuredIcon = d.data.featured ? '🌟 ' : '';
            const hotBadge = isHot ? ` <span style="color:#FFD700; font-weight:bold; font-size:12px;">❤️ ${popCount}</span>` : '';
            
            let statusTag = '';
            if (d.data.status === 'SOLD') statusTag = ' <small style="color:#ff7675;">(נמכר)</small>';
            if (d.data.status === 'BOUGHT') statusTag = ' <small style="color:#3498db;">(נקנה)</small>';
            
            const rowStyle = isHot ? 'background: rgba(255, 215, 0, 0.05);' : '';
            
            tbody.innerHTML += `<tr style="${rowStyle}">
                <td>
                    ${featuredIcon}${d.data.address}${hotBadge}${statusTag} 
                    <br>
                    <small style="color:#888;">${d.data.city || 'ללא עיר'} | חינוך: ${d.data.scoreEdu || '?'}/5 | ים: ${d.data.scoreSea || '?'}/5</small>
                </td>
                <td>₪${FinanceLogic.formatNumber(d.data.price)}</td>
                <td>${d.data.rooms} חד', קומה ${d.data.floor}, ${d.data.sqm} מ"ר</td>
                <td>
                    <button class="btn-action btn-match-users" onclick="window.openMatchModal('${d.id}', '${d.data.address}')">שייך ללקוחות 👥</button>
                    <button class="btn-action" onclick='window.editPr("${d.id}", ${JSON.stringify(d.data).replace(/'/g, "&apos;").replace(/"/g, "&quot;")})'>עריכה</button>
                    <button class="btn-action btn-del" onclick="window.delPr('${d.id}', '${d.data.address}')">מחיקה</button>
                </td>
            </tr>`;
        }
    });
};

onSnapshot(collection(db, "property_bank"), (snap) => {
    allBankProps = [];
    snap.forEach(s => allBankProps.push({ id: s.id, data: s.data() }));
    renderBank();
});

document.getElementById('bank-city-filter').onchange = renderBank;
document.getElementById('bank-search-input').oninput = renderBank;

window.delPr = async (id, addr) => {
    try {
        const projectsSnap = await getDocs(collection(db, "projects"));
        let relatedClients = [];
        projectsSnap.forEach(pDoc => {
            const project = pDoc.data();
            const props = project.properties || [];
            if (props.some(p => p.address === addr)) relatedClients.push(project.clientName);
        });
        if (relatedClients.length > 0) {
            alert(`לא ניתן למחוק! הנכס משויך ללקוחות: ${relatedClients.join(", ")}`);
            return;
        }
        if (confirm(`למחוק את ${addr}?`)) {
            await deleteDoc(doc(db, "property_bank", id));
            await logAction(`נכס הוסר מהבנק: ${addr}`);
        }
    } catch (error) { alert("שגיאה במחיקה."); }
};

window.editPr = (id, d) => {
    document.getElementById('edit-prop-id').value = id;
    document.getElementById('p-address').value = d.address;
    document.getElementById('p-price').value = FinanceLogic.formatNumber(d.price);
    document.getElementById('p-city-select').value = d.city || "";
    if (Array.isArray(d.links)) {
        document.getElementById('p-link').value = d.links.join('\n');
    } else {
        document.getElementById('p-link').value = d.link || "";
    }
    document.getElementById('p-rooms').value = d.rooms;
    document.getElementById('p-floor').value = d.floor;
    document.getElementById('p-sqm').value = d.sqm;
    document.getElementById('p-distTrain').value = d.distTrain || "";
    document.getElementById('p-leeTip').value = d.leeTip || ""; 
    document.getElementById('p-ai-analysis').value = d.aiAnalysis || "";
    document.getElementById('p-featured').checked = d.featured || false;
    document.getElementById('p-status').value = d.status || "ACTIVE";
    document.getElementById('p-scoreEdu').value = d.scoreEdu || "";
    document.getElementById('p-scoreTrans').value = d.scoreTrans || "";
    document.getElementById('p-scoreLeisure').value = d.scoreLeisure || "";
    document.getElementById('p-scoreSea').value = d.scoreSea || "";
    document.getElementById('p-distSea').value = d.distSea || "";
    document.getElementById('prop-modal').style.display = 'block';
};

document.getElementById('save-prop-to-db').onclick = async () => {
    const id = document.getElementById('edit-prop-id').value;
    const linkRaw = document.getElementById('p-link').value;
    const linkArray = linkRaw.split('\n').map(l => l.trim()).filter(l => l !== "");

    const data = { 
        address: document.getElementById('p-address').value, 
        price: FinanceLogic.cleanNumber(document.getElementById('p-price').value), 
        city: document.getElementById('p-city-select').value,
        links: linkArray,
        rooms: document.getElementById('p-rooms').value, 
        floor: document.getElementById('p-floor').value, 
        sqm: document.getElementById('p-sqm').value, 
        distTrain: parseFloat(document.getElementById('p-distTrain').value) || 0,
        leeTip: document.getElementById('p-leeTip').value,
        aiAnalysis: document.getElementById('p-ai-analysis').value,
        featured: document.getElementById('p-featured').checked,
        status: document.getElementById('p-status').value,
        scoreEdu: parseFloat(document.getElementById('p-scoreEdu').value) || 0,
        scoreTrans: parseFloat(document.getElementById('p-scoreTrans').value) || 0,
        scoreLeisure: parseFloat(document.getElementById('p-scoreLeisure').value) || 0,
        scoreSea: parseFloat(document.getElementById('p-scoreSea').value) || 0,
        distSea: parseFloat(document.getElementById('p-distSea').value) || 0
    };
    if (id) await updateDoc(doc(db, "property_bank", id), data);
    else await addDoc(collection(db, "property_bank"), data);
    await logAction(`עודכנו פרטי נכס: ${data.address}`);
    document.getElementById('prop-modal').style.display = 'none';
};

// --- לוגיקת שידוך הפוך ---
window.openMatchModal = async (propId, address) => {
    const propSnap = await getDoc(doc(db, "property_bank", propId));
    matchingPropData = { id: propId, ...propSnap.data() };
    document.getElementById('match-prop-name').innerText = `משדכת את: ${address}`;
    selectedMatchClientIDs = [];
    renderMatchClientList();
    document.getElementById('match-clients-modal').style.display = 'block';
};

const renderMatchClientList = (searchTerm = "") => {
    const list = document.getElementById('match-clients-list');
    list.innerHTML = "";
    const term = searchTerm.toLowerCase();
    allCurrentClients.forEach(c => {
        if (!term || c.clientName.toLowerCase().includes(term)) {
            const isAssigned = (c.properties || []).some(p => p.address === matchingPropData.address);
            const div = document.createElement('div');
            div.className = `client-match-item ${selectedMatchClientIDs.includes(c.id) ? 'selected' : ''}`;
            div.innerHTML = `
                <span>${c.clientName}</span>
                ${isAssigned ? '<small style="color:#888;">(כבר משויך)</small>' : (selectedMatchClientIDs.includes(c.id) ? '<span>✅</span>' : '')}
            `;
            if (!isAssigned) {
                div.onclick = () => {
                    if (selectedMatchClientIDs.includes(c.id)) {
                        selectedMatchClientIDs = selectedMatchClientIDs.filter(id => id !== c.id);
                    } else {
                        selectedMatchClientIDs.push(c.id);
                    }
                    renderMatchClientList(document.getElementById('match-client-search').value);
                };
            } else {
                div.style.opacity = "0.5";
                div.style.cursor = "not-allowed";
            }
            list.appendChild(div);
        }
    });
};

document.getElementById('match-client-search').oninput = (e) => renderMatchClientList(e.target.value);

document.getElementById('confirm-match-action').onclick = async () => {
    if (selectedMatchClientIDs.length === 0) return alert("אנא בחרי לפחות לקוח אחד.");
    const batch = writeBatch(db);
    for (const clientId of selectedMatchClientIDs) {
        const clientRef = doc(db, "projects", clientId);
        const clientSnap = await getDoc(clientRef);
        const currentProps = clientSnap.data().properties || [];
        if (!currentProps.some(p => p.address === matchingPropData.address)) {
            const { id, ...cleanProp } = matchingPropData;
            currentProps.push(cleanProp);
            batch.update(clientRef, { properties: currentProps });
        }
    }
    await batch.commit();
    await logAction(`👥 נכס (${matchingPropData.address}) שודך לקבוצה של ${selectedMatchClientIDs.length} לקוחות`);
    alert("השיוך בוצע בהצלחה!");
    document.getElementById('match-clients-modal').style.display = 'none';
};

document.querySelectorAll('.format-num-admin').forEach(i => {
    i.oninput = (e) => e.target.value = FinanceLogic.formatNumber(e.target.value.replace(/[^0-9]/g, ''));
});

// --- יצירת לקוח חדש ---
document.getElementById('open-new-client-modal').onclick = () => {
    document.getElementById('edit-client-id').value = "";
    document.getElementById('new-client-name-input').value = "";
    document.getElementById('new-client-phone-input').value = "";
    document.getElementById('client-modal-title').innerText = "יצירת תיק לקוח חדש";
    document.getElementById('client-modal').style.display = 'block';
    setTimeout(() => document.getElementById('new-client-name-input').focus(), 100);
};

document.getElementById('confirm-create-client').onclick = async () => {
    const name = document.getElementById('new-client-name-input').value.trim();
    const phone = document.getElementById('new-client-phone-input').value.trim();
    
    if (!name || !phone) {
        return alert("חובה למלא גם שם לקוח וגם מספר טלפון ליצירת תיק חדש.");
    }

    const data = {
        clientName: name,
        clientPhone: phone,
        roadmapStep: "1",
        status: "INITIAL",
        favorites: [],
        ratings: {},
        properties: [],
        prefEdu: 3, 
        prefTrans: 3, 
        prefLeisure: 3, 
        prefSea: 3,
        limitHighFloor: false,
        lawyerRateSale: 0.5,
        lawyerRatePurch: 0.5,
        brokerageRateSale: 2,
        brokerageRatePurch: 2,
        timestamp: new Date().toISOString()
    };

    try {
        await addDoc(collection(db, "projects"), data);
        await logAction(`✨ נוצר לקוח חדש: ${name} (הוגדר אוטומטית לשלב 1)`);
        document.getElementById('client-modal').style.display = 'none';
    } catch (error) {
        console.error("Error creating client:", error);
        alert("שגיאה ביצירת הלקוח.");
    }
};

const phoneField = document.getElementById('new-client-phone-input');
if (phoneField) {
    phoneField.oninput = (e) => {
        e.target.value = FinanceLogic.formatPhone(e.target.value);
    };
}

document.getElementById('open-new-prop-modal').onclick = () => {
    document.getElementById('edit-prop-id').value = "";
    document.querySelectorAll('#prop-modal input:not([type="checkbox"]), #prop-modal textarea, #prop-modal select').forEach(i => i.value = "");
    document.getElementById('p-featured').checked = false;
    document.getElementById('p-status').value = "ACTIVE"; 
    document.getElementById('prop-modal').style.display = 'block';
};

document.addEventListener('focus', function(e) {
    if (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'number')) {
        setTimeout(() => {
            if (typeof e.target.select === 'function') {
                e.target.select();
            }
        }, 50);
    }
}, true);

// --- Master Reset ---
document.getElementById('master-reset-db').onclick = async () => {
    const confirm1 = confirm("⚠️ אזהרה חמורה: את עומדת למחוק את כל מסד הנתונים.\nהאם את בטוחה?");
    if (!confirm1) return;

    const confirm2 = prompt("כדי לאשר את המחיקה הסופית, הקלידי 'מחק הכל':");
    if (confirm2 !== "מחק הכל") {
        alert("הפעולה בוטלה.");
        return;
    }

    try {
        const collections = ["projects", "property_bank", "cities", "activity_logs", "consultation_requests", "service_providers"];
        const batch = writeBatch(db);

        for (const colName of collections) {
            const snap = await getDocs(collection(db, colName));
            snap.forEach(d => batch.delete(d.ref));
        }

        await batch.commit();
        await addDoc(collection(db, "activity_logs"), { 
            timestamp: new Date().toISOString(), 
            message: "💥 המערכת עברה איפוס מלא (Master Reset)" 
        });

        alert("המערכת אופסה בהצלחה.");
        window.location.reload();
    } catch (error) {
        console.error("Reset Error:", error);
        alert("שגיאה במהלך האיפוס.");
    }
};

initProvidersSync();