import { db } from './firebase-config.js';
import { collection, getDocs, limit, query, orderBy, getDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// מפתחות גוגל
let CLIENT_ID = '';
let API_KEY = '';
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
// שינוי ה-SCOPE כדי לאפשר יצירת אירועים (כתיבה)
const SCOPES = "https://www.googleapis.com/auth/calendar.events";

let tokenClient, gapiInited = false, gisInited = false;

/**
 * פונקציית החגיגה - קונפטי זהב
 */
function celebrate() {
    const duration = 3 * 1000;
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
    console.log("%c--- Starting Today Dashboard Init ---", "color: #FFD700; font-weight: bold;");

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
                if (calendarContent) calendarContent.innerHTML = `<div class="p-4 text-xs text-orange-400 italic">יש להגדיר CLIENT_ID ו-API_KEY ב-Firebase</div>`;
            }
        }
    } catch (e) {
        console.error("Config Loading Error:", e);
    }

    await refreshAllData(); 
    setupLocalTasks();

    setInterval(async () => {
        await refreshAllData();
    }, 300000);
}

/**
 * רענון כל מקורות הנתונים
 */
async function refreshAllData() {
    await fetchFirebaseData();
    await fetchNewProperties();
    if (gapiInited && gapi.client.getToken()) {
        listUpcomingEvents();
    }
}

/**
 * משיכת נתונים מ-Firebase
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
        const todayMD = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`; 
        const todayStr = now.toISOString().split('T')[0];
        const staleThreshold = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));

        let bdayCount = 0, signingCount = 0, totalRevenue = 0;
        let bdayHtml = ""; 
        let generalTasksHtml = ""; 
        let stuckHtml = ""; 

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const clientId = doc.id;

            if (data.clientBirthday && (data.clientBirthday.includes(todayMD) || data.clientBirthday.includes(todayMD.replace('/', '-')))) {
                bdayCount++;
                bdayHtml += createTaskHTML(`🎈 יום הולדת ל-${data.clientName}`, 'BIRTHDAY', clientId, data.clientPhone, `מזל טוב ${data.clientName}! 🎂`);
            }

            if (data.status === "SIGNING" || data.roadmapStep === "3") {
                signingCount++;
                let price = parseFloat(String(data.salePrice || data.dealPrice || 0).replace(/[^\d.]/g, '')) || 0;
                let rate = parseFloat(data.brokerageRatePurch || 2);
                if (price > 0) totalRevenue += (price * (rate / 100));
                generalTasksHtml += createTaskHTML(`🖊️ בדיקת עו"ד: ${data.clientName}`, 'SIGNING', clientId, data.clientPhone, `היי ${data.clientName}, מה עם החוזה?`);
            }

            if (data.followUpDate && data.followUpDate <= todayStr && data.status !== 'DONE') {
                generalTasksHtml += createTaskHTML(`📞 מעקב: ${data.clientName}`, 'FOLLOWUP', clientId, data.clientPhone, `היי ${data.clientName}, רציתי להתעדכן.`);
            }

            const lastUpdate = data.timestamp || data.lastUpdated;
            if (lastUpdate && data.status !== 'DONE' && data.status !== 'CANCELLED') {
                const lastDate = lastUpdate.toDate ? lastUpdate.toDate() : new Date(lastUpdate);
                if (lastDate < staleThreshold) {
                    const diffDays = Math.ceil(Math.abs(now - lastDate) / (1000 * 60 * 60 * 24));
                    let bColor = diffDays >= 14 ? "border-red-600" : (diffDays >= 7 ? "border-orange-600" : "border-yellow-600");
                    stuckHtml += `
                        <div class="dark-card p-4 rounded-xl border-r-4 ${bColor} flex justify-between items-center mb-3">
                            <div class="text-right">
                                <div class="text-white font-bold text-sm">${data.clientName}</div>
                                <div class="text-[10px] text-gray-400 italic">לא טופל ${diffDays} ימים</div>
                            </div>
                            <a href="https://wa.me/${data.clientPhone?.replace(/\D/g, '').replace(/^0/, '972')}" target="_blank" class="bg-white/5 p-2 rounded-full text-xs">💬</a>
                        </div>`;
                }
            }
        });

        if (bdayCountElem) bdayCountElem.innerText = bdayCount;
        if (signingElem) signingElem.innerText = signingCount;
        if (revenueElem) revenueElem.innerText = '₪' + Math.floor(totalRevenue).toLocaleString();
        if (stuckList) stuckList.innerHTML = stuckHtml || `<div class="text-green-500 text-[10px] italic">הכל בתנועה! ✨</div>`;
        
        tasksList.innerHTML = (bdayHtml + generalTasksHtml) || `<div class="text-gray-600 text-center py-12 italic text-sm">אין משימות קריטיות להיום.</div>`;
        
        updateDayProgress();

    } catch (error) { console.error("Firebase Error:", error); }
}

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
                    <div class="text-white text-[11px] font-bold truncate">${p.address || "נכס חדש"}</div>
                    <div class="text-[9px] text-blue-400">₪${Number(p.price || 0).toLocaleString()}</div>
                </div>`;
        });
        propList.innerHTML = propHtml || `<div class="text-[10px] text-gray-600 text-right">אין נכסים חדשים.</div>`;
    } catch (e) { console.error("Properties Error:", e); }
}

/**
 * עדכון מד התקדמות + חגיגת 100%
 */
function updateDayProgress() {
    const total = document.querySelectorAll('#tasks-list input[type=\"checkbox\"]').length;
    const done = document.querySelectorAll('#tasks-list input[type=\"checkbox\"]:checked').length;
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('main-progress-bar');
    
    if (total === 0) return;
    
    const percentage = Math.round((done / total) * 100);
    if (progressBar) progressBar.style.width = percentage + '%';
    if (progressText) progressText.innerText = percentage + '% הושלמו';

    if (percentage === 100 && total > 0) {
        celebrate();
    }
}

window.updateDayProgress = updateDayProgress;

function createTaskHTML(text, type, clientId, phone, waMsg) {
    let bgColor = "border-gray-800";
    if (type === 'BIRTHDAY') bgColor = "border-pink-500/40 bg-pink-500/10";
    if (type === 'SIGNING') bgColor = "border-blue-500/30 bg-blue-500/5";
    const cleanPhone = phone ? phone.replace(/\D/g, '').replace(/^0/, '972') : '';
    const waLink = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}`;
    
    return `
        <div class="flex items-center gap-3 p-4 border rounded-xl ${bgColor} mb-3 transition-all hover:scale-[1.01] text-right">
            <input type="checkbox" class="w-5 h-5 accent-yellow-500 cursor-pointer" onchange="this.parentElement.classList.toggle('task-done'); window.updateDayProgress()">
            <div class="flex-grow text-sm font-bold text-gray-100">
                ${text}
                <div class="flex gap-3 mt-1 justify-end">
                    ${clientId ? `<a href=\"edit-project.html?id=${clientId}\" target=\"_parent\" class=\"text-[10px] text-gray-500 underline\">תיק לקוח</a>` : ''}
                    ${cleanPhone ? `<a href=\"${waLink}\" target=\"_blank\" class=\"text-[10px] text-green-500 font-bold\">💬 WhatsApp</a>` : ''}
                </div>
            </div>
        </div>`;
}

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

// לוגיקת גוגל
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
            calendarContent.innerHTML = `<div class=\"p-12 text-center text-gray-600 italic text-xs\">אין פגישות להיום</div>`;
            return;
        }
        calendarContent.innerHTML = events.map(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const time = start.toLocaleTimeString('he-IL', {hour: '2-digit', minute:'2-digit'});
            return `<div class=\"dark-card p-4 rounded-xl flex justify-between items-center mb-2 text-right\">
                        <div class=\"text-xs font-bold text-blue-400\">${time}</div>
                        <div class=\"text-sm text-white font-bold\">${event.summary}</div>
                    </div>`;
        }).join('');
    } catch (err) { console.error(err); }
}

/**
 * פונקציות לניהול המודאל ליצירת אירוע
 */
window.openEventModal = () => {
    document.getElementById('event-modal').style.display = 'block';
    document.getElementById('event-date').value = new Date().toISOString().split('T')[0];
};

window.closeEventModal = () => {
    document.getElementById('event-modal').style.display = 'none';
};

/**
 * שליחת אירוע חדש לגוגל קלנדר כולל מיקום
 */
window.saveEventToGoogle = async () => {
    if (!gapiInited || !gapi.client.getToken()) {
        alert("נא לבצע סנכרון (Login) לגוגל קודם.");
        return;
    }

    const type = document.getElementById('event-type').value;
    const title = document.getElementById('event-title').value;
    const location = document.getElementById('event-location').value;
    const date = document.getElementById('event-date').value;
    const time = document.getElementById('event-time').value;

    if (!title || !date || !time) {
        alert("נא למלא את כל שדות החובה (שם, תאריך ושעה).");
        return;
    }

    const startDateTime = `${date}T${time}:00`;
    const endDateTime = new Date(new Date(startDateTime).getTime() + 60*60*1000).toISOString().split('.')[0]; 

    const event = {
        'summary': `${type}: ${title}`,
        'location': location, // שדה המיקום החדש
        'description': `נוצר דרך מרכז הפיקוד של לי אטדגי`,
        'start': { 'dateTime': startDateTime, 'timeZone': 'Asia/Jerusalem' },
        'end': { 'dateTime': endDateTime, 'timeZone': 'Asia/Jerusalem' }
    };

    try {
        await gapi.client.calendar.events.insert({
            'calendarId': 'primary',
            'resource': event
        });
        alert("האירוע נוצר בהצלחה ביומן של לי! ✨");
        closeEventModal();
        listUpcomingEvents(); 
    } catch (err) {
        console.error("Error creating event:", err);
        alert("שגיאה ביצירת האירוע. וודאי שיש לך הרשאות כתיבה.");
    }
};

document.addEventListener('DOMContentLoaded', initToday);