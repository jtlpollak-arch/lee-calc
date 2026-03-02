import { db } from './firebase-config.js';
import { collection, getDocs, limit, query, orderBy, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// מפתחות גוגל - יימשכו דינמית מה-DB
let CLIENT_ID = '';
let API_KEY = '';
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

let tokenClient, gapiInited = false, gisInited = false;

/**
 * פונקציה חכמה לבדיקת סטטוס יום הולדת
 * מחזירה 'today' אם היום, 'tomorrow' אם מחר, או false
 */
function checkBirthdayStatus(dateVal) {
    if (!dateVal) return false;
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);

    const tDay = now.getDate();
    const tMonth = now.getMonth() + 1;
    const mDay = tomorrow.getDate();
    const mMonth = tomorrow.getMonth() + 1;

    let bDay, bMonth;

    if (dateVal.toDate) {
        const d = dateVal.toDate();
        bDay = d.getDate();
        bMonth = d.getMonth() + 1;
    } else {
        const parts = dateVal.toString().split(/[-/.]/);
        if (parts.length >= 2) {
            if (parts[0].length === 4) { // YYYY-MM-DD
                bMonth = parseInt(parts[1]);
                bDay = parseInt(parts[2]);
            } else { // DD/MM/YYYY
                bDay = parseInt(parts[0]);
                bMonth = parseInt(parts[1]);
            }
        }
    }

    if (bDay === tDay && bMonth === tMonth) return 'today';
    if (bDay === mDay && bMonth === mMonth) return 'tomorrow';
    return false;
}

/**
 * פונקציית החגיגה - קונפטי זהב ב-100%
 */
function celebrate() {
    const duration = 4 * 1000;
    const end = Date.now() + duration;

    (function frame() {
        confetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#FFD700', '#FFFFFF']
        });
        confetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#FFD700', '#FFFFFF']
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
}

/**
 * אתחול המערכת
 */
async function initToday() {
    console.log("%c--- Dashboard Mission Control Initializing ---", "color: #FFD700; font-weight: bold;");

    try {
        const settingsSnap = await getDoc(doc(db, "settings", "google_config"));
        if (settingsSnap.exists()) {
            const config = settingsSnap.data();
            CLIENT_ID = config.clientId;
            API_KEY = config.apiKey;
            
            if (CLIENT_ID && API_KEY && CLIENT_ID.includes('.apps')) {
                gapi.load('client', gapiInitInternal);
                gisInitInternal(); 
            } else {
                const calendarContent = document.getElementById('calendar-content');
                if (calendarContent) calendarContent.innerHTML = `<div class="p-4 text-xs text-orange-400 italic">חסר הגדרות גוגל ב-Firebase</div>`;
            }
        }
    } catch (e) {
        console.error("Critical Init Error:", e);
    }

    await refreshAllData(); 
    setupLocalTasks();

    // רענון אוטומטי כל 5 דקות
    setInterval(async () => {
        console.log("Auto-refreshing Dashboard Data...");
        await refreshAllData();
    }, 300000);
}

/**
 * רענון כל הנתונים במסך
 */
async function refreshAllData() {
    await fetchFirebaseData();
    await fetchNewProperties();
    if (gapiInited && gapi.client.getToken()) {
        listUpcomingEvents();
    }
}

/**
 * משיכת נתונים מ-Firebase - הלוגיקה המלאה ללא צמצומים
 */
async function fetchFirebaseData() {
    const tasksList = document.getElementById('tasks-list');
    const bdayCountElem = document.getElementById('today-birthdays');
    const signingElem = document.getElementById('stats-signing');
    const revenueElem = document.getElementById('stats-revenue');
    const stuckList = document.getElementById('stuck-clients-list');
    
    if (!tasksList) return;

    try {
        const querySnapshot = await getDocs(collection(db, "projects"));
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];
        const staleThreshold = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));

        let bdayTodayCounter = 0;
        let signingCounter = 0;
        let totalRevenueSum = 0;
        
        let bdayHtml = ""; 
        let generalTasksHtml = ""; 
        let stuckHtml = ""; 

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const clientId = doc.id;
            const clientPhone = data.clientPhone || '';

            // 1. ניהול ימי הולדת (היום ומחר)
            const bdayStatus = checkBirthdayStatus(data.clientBirthday);
            if (bdayStatus === 'today') {
                bdayTodayCounter++;
                const msg = `מזל טוב ${data.clientName} היקר/ה! יום הולדת שמח, המון הצלחה ואושר! 🎂`;
                bdayHtml += createTaskHTML(`🎈 יום הולדת היום: ${data.clientName}`, 'BIRTHDAY', clientId, clientPhone, msg);
            } else if (bdayStatus === 'tomorrow') {
                const msgTomorrow = `היי ${data.clientName}, מחר יש לך יום הולדת! רציתי להקדים ולברך במזל טוב...`;
                bdayHtml += createTaskHTML(`⏳ מחר יום הולדת: ${data.clientName}`, 'TOMORROW_BDAY', clientId, clientPhone, msgTomorrow);
            }

            // 2. ניהול עסקאות בחתימה וחישוב עמלה (2%)
            if (data.status === "SIGNING" || data.roadmapStep === "3") {
                signingCounter++;
                let price = parseFloat(String(data.salePrice || data.dealPrice || 0).replace(/[^\d.]/g, '')) || 0;
                let rate = parseFloat(data.brokerageRatePurch || 2);
                if (price > 0) totalRevenueSum += (price * (rate / 100));
                generalTasksHtml += createTaskHTML(`🖊️ חוזה בחתימה: ${data.clientName}`, 'SIGNING', clientId, clientPhone, `היי ${data.clientName}, רציתי להתעדכן לגבי התקדמות החוזה.`);
            }

            // 3. משימות מעקב (Follow-up)
            if (data.followUpDate && data.followUpDate <= todayStr && data.status !== 'DONE' && data.status !== 'CANCELLED') {
                generalTasksHtml += createTaskHTML(`📞 שיחת מעקב: ${data.clientName}`, 'FOLLOWUP', clientId, clientPhone, `היי ${data.clientName}, רציתי לשמוע אם יש חדש.`);
            }

            // 4. זיהוי לקוחות "תקועים" (+3 ימים ללא עדכון)
            const lastUpdate = data.timestamp || data.lastUpdated;
            if (lastUpdate && data.status !== 'DONE' && data.status !== 'CANCELLED') {
                const lastDate = lastUpdate.toDate ? lastUpdate.toDate() : new Date(lastUpdate);
                if (lastDate < staleThreshold) {
                    const diffDays = Math.ceil(Math.abs(now - lastDate) / (1000 * 60 * 60 * 24));
                    let bColor = diffDays >= 14 ? "border-red-600" : (diffDays >= 7 ? "border-orange-600" : "border-yellow-600");
                    stuckHtml += `
                        <div class="dark-card p-4 rounded-xl border-r-4 ${bColor} flex justify-between items-center mb-3 text-right transition-all">
                            <div>
                                <div class="text-white font-bold text-sm text-right">${data.clientName}</div>
                                <div class="text-[10px] text-gray-500 italic text-right">לא עודכן ${diffDays} ימים</div>
                            </div>
                            <a href="https://wa.me/${clientPhone.replace(/\D/g, '')}" target="_blank" class="bg-green-500/10 p-2 rounded-full text-xs hover:bg-green-500 transition-all">💬</a>
                        </div>`;
                }
            }
        });

        // עדכון סטטיסטיקות בקארדים
        if (bdayCountElem) bdayCountElem.innerText = bdayTodayCounter;
        if (signingElem) signingElem.innerText = signingCounter;
        if (revenueElem) revenueElem.innerText = '₪' + Math.floor(totalRevenueSum).toLocaleString();
        
        // עדכון רשימת תקועים
        if (stuckList) {
            stuckList.innerHTML = stuckHtml || `<div class="text-green-500/50 text-[10px] italic text-right">הכל מטופל ומתוקתק! ✨</div>`;
        }
        
        // עדכון רשימת משימות ראשית
        tasksList.innerHTML = (bdayHtml + generalTasksHtml) || `<div class="text-gray-600 text-center py-12 italic text-sm">אין משימות דחופות להיום.</div>`;
        
        updateDayProgress();

    } catch (error) { console.error("Firebase Fetch Error:", error); }
}

/**
 * משיכת נכסים חדשים מבנק הנכסים
 */
async function fetchNewProperties() {
    const propList = document.getElementById('new-properties-list');
    if (!propList) return;
    try {
        const q = query(collection(db, "property_bank"), orderBy("lastUpdated", "desc"), limit(3));
        const querySnapshot = await getDocs(q);
        let propHtml = "";
        querySnapshot.forEach(doc => {
            const p = doc.data();
            propHtml += `
                <div class="dark-card p-3 rounded-xl border-r-4 border-blue-500 mb-3 text-right">
                    <div class="text-white text-[11px] font-bold truncate text-right">${p.address || "נכס חדש"}</div>
                    <div class="text-[9px] text-blue-400 text-right">₪${Number(p.price || 0).toLocaleString()}</div>
                </div>`;
        });
        propList.innerHTML = propHtml || `<div class="text-[10px] text-gray-600 text-right">אין נכסים חדשים כרגע.</div>`;
    } catch (e) { console.error("Property Bank Error:", e); }
}

/**
 * עדכון מד ההתקדמות הוויזואלי
 */
function updateDayProgress() {
    const total = document.querySelectorAll('#tasks-list input[type="checkbox"]').length;
    const done = document.querySelectorAll('#tasks-list input[type="checkbox"]:checked').length;
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('main-progress-bar');
    
    if (total === 0) {
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.innerText = '0% הושלמו';
        return;
    }
    
    const percentage = Math.round((done / total) * 100);
    if (progressBar) progressBar.style.width = percentage + '%';
    if (progressText) progressText.innerText = percentage + '% הושלמו';

    if (percentage === 100 && total > 0) {
        celebrate();
    }
}

window.updateDayProgress = updateDayProgress;

/**
 * פונקציה לטיפול בסימון משימה (שמירה על ה-V)
 */
window.toggleTask = (checkbox) => {
    const row = checkbox.closest('.task-item-container');
    if (checkbox.checked) {
        row.classList.add('task-done');
    } else {
        row.classList.remove('task-done');
    }
    updateDayProgress();
};

/**
 * יצירת HTML למשימת היום
 */
function createTaskHTML(text, type, clientId, phone, waMsg) {
    let bgColor = "border-gray-800";
    if (type === 'BIRTHDAY') bgColor = "border-pink-500/40 bg-pink-500/10 shadow-[0_0_10px_rgba(236,72,153,0.1)]";
    if (type === 'TOMORROW_BDAY') bgColor = "border-blue-400/30 bg-blue-400/5";
    if (type === 'SIGNING') bgColor = "border-blue-500/30 bg-blue-500/5";

    const cleanPhone = phone ? phone.replace(/\D/g, '').replace(/^0/, '972') : '';
    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
    
    return `
        <div class="task-item-container flex items-center gap-3 p-4 border rounded-xl ${bgColor} mb-3 transition-all hover:scale-[1.01] text-right">
            <input type="checkbox" class="w-5 h-5 accent-yellow-500 cursor-pointer" onchange="window.toggleTask(this)">
            <div class="flex-grow text-sm font-bold text-gray-100 text-right">
                ${text}
                <div class="flex gap-4 mt-2 justify-end">
                    ${clientId ? `<a href="edit-project.html?id=${clientId}" target="_parent" class="text-[10px] text-gray-500 underline">תיק לקוח</a>` : ''}
                    ${cleanPhone ? `<a href="${waLink}" target="_blank" class="text-[10px] text-green-500 font-bold">💬 WhatsApp</a>` : ''}
                </div>
            </div>
        </div>`;
}

/**
 * משימות מקומיות (הוספה מהירה)
 */
function setupLocalTasks() {
    const input = document.getElementById('new-task-input'), btn = document.getElementById('add-task-btn');
    if (input && btn) btn.onclick = () => {
        if (input.value.trim() !== "") {
            document.getElementById('tasks-list').insertAdjacentHTML('afterbegin', createTaskHTML(input.value, 'LOCAL', null, null, ""));
            input.value = "";
            updateDayProgress();
        }
    };
}

// לוגיקת GAPI (Google API)
async function gapiInitInternal() {
    try {
        await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
        gapiInited = true;
        if (gapi.client.getToken()) listUpcomingEvents();
    } catch (e) { console.warn("GAPI Init Warning", e); }
}

function gisInitInternal() {
    try {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID, scope: SCOPES,
            callback: (resp) => { if (resp.error !== undefined) throw (resp); listUpcomingEvents(); },
        });
        gisInited = true;
    } catch (e) { console.warn("GIS Init Warning", e); }
}

window.handleAuthClick = () => { 
    if (tokenClient) tokenClient.requestAccessToken({prompt: 'consent'}); 
    else alert("אנא הגדירי CLIENT_ID ב-Firebase.");
};

/**
 * הצגת הלו"ז עם כפתורי ניווט ושיתוף מיקום חכמים
 */
async function listUpcomingEvents() {
    const calendarContent = document.getElementById('calendar-content'), leadsCountElem = document.getElementById('today-leads');
    try {
        const response = await gapi.client.calendar.events.list({
            'calendarId': 'primary', 'timeMin': (new Date()).toISOString(),
            'showDeleted': false, 'singleEvents': true, 'maxResults': 8, 'orderBy': 'startTime',
        });
        const events = response.result.items;
        if (leadsCountElem) leadsCountElem.innerText = events ? events.length : 0;
        
        if (!events || events.length == 0) {
            calendarContent.innerHTML = `<div class="p-12 text-center text-gray-600 italic text-xs">אין פגישות להיום</div>`;
            return;
        }

        const now = new Date();

        calendarContent.innerHTML = events.map(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const time = start.toLocaleTimeString('he-IL', {hour: '2-digit', minute:'2-digit'});
            const location = event.location || '';
            
            // הדגשת פגישה קרובה (בטווח של 3 שעות מהיום)
            const isNext = (start > now && (start - now) < 10800000); 
            const borderClass = isNext ? 'border-yellow-500 shadow-[0_0_15px_rgba(255,215,0,0.1)]' : (location ? 'border-blue-500' : 'border-gray-800');

            // כפתורי עזר לשטח
            const navBtn = location ? 
                `<a href="https://waze.com/ul?q=${encodeURIComponent(location)}" 
                    target="_blank" class="text-[9px] bg-blue-600/20 text-blue-400 px-2 py-1 rounded-md border border-blue-400/30 hover:bg-blue-600 hover:text-white transition-all">📍 ניווט</a>` : '';

            const shareBtn = location ? 
                `<a href="https://wa.me/?text=${encodeURIComponent('היי, מחכה לך כאן בנכס: ' + location + ' \nלינק לניווט: https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(location))}" 
                    target="_blank" class="text-[9px] bg-green-600/20 text-green-400 px-2 py-1 rounded-md border border-green-400/30 hover:bg-green-600 hover:text-white transition-all">💬 שלח מיקום</a>` : '';

            return `
                <div class="dark-card p-4 rounded-xl flex justify-between items-center mb-3 text-right border-r-4 ${borderClass} transition-all">
                    <div class="flex flex-col items-start gap-2">
                        <div class="text-xs font-bold ${isNext ? 'gold-text' : 'text-blue-400'}">${time}</div>
                        <div class="flex gap-1">${navBtn}${shareBtn}</div>
                    </div>
                    <div class="overflow-hidden">
                        <div class="text-sm text-white font-bold truncate text-right">${event.summary}</div>
                        ${location ? `<div class="text-[10px] text-gray-500 truncate mt-1 italic text-right">${location}</div>` : ''}
                    </div>
                </div>`;
        }).join('');
    } catch (err) { console.error("Calendar Error:", err); }
}

/**
 * מודאל וניהול אירועים חדשים
 */
window.openEventModal = () => {
    document.getElementById('event-modal').style.display = 'block';
    document.getElementById('event-date').value = new Date().toISOString().split('T')[0];
};

window.closeEventModal = () => {
    document.getElementById('event-modal').style.display = 'none';
};

/**
 * שמירת אירוע לגוגל קלנדר (Fix פורמט 400)
 */
window.saveEventToGoogle = async () => {
    if (!gapiInited || !gapi.client.getToken()) {
        alert("נא לבצע סנכרון לגוגל.");
        return;
    }

    const type = document.getElementById('event-type').value;
    const title = document.getElementById('event-title').value;
    const location = document.getElementById('event-location').value;
    const date = document.getElementById('event-date').value;
    const time = document.getElementById('event-time').value;

    if (!title || !date || !time) {
        alert("נא למלא את כל השדות.");
        return;
    }

    const startDateTime = new Date(`${date}T${time}:00`);
    if (isNaN(startDateTime.getTime())) {
        alert("הזמן אינו תקין.");
        return;
    }
    const endDateTime = new Date(startDateTime.getTime() + (60 * 60 * 1000));

    const event = {
        'summary': `${type}: ${title}`,
        'location': location,
        'description': `נוצר דרך מרכז הפיקוד של לי אטדגי`,
        'start': { 'dateTime': startDateTime.toISOString(), 'timeZone': 'Asia/Jerusalem' },
        'end': { 'dateTime': endDateTime.toISOString(), 'timeZone': 'Asia/Jerusalem' }
    };

    try {
        await gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': event
        });
        alert("האירוע נוצר בהצלחה! ✨");
        closeEventModal();
        listUpcomingEvents(); 
    } catch (err) {
        console.error("Save Event Error:", err);
        alert("שגיאה ביצירת האירוע. בדקי הרשאות כתיבה.");
    }
};

document.addEventListener('DOMContentLoaded', initToday);