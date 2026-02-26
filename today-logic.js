import { db } from './firebase-config.js';
import { collection, getDocs, limit, query, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// מפתחות גוגל
const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
const API_KEY = 'YOUR_API_KEY';
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const SCOPES = "https://www.googleapis.com/auth/calendar.events.readonly";

let tokenClient, gapiInited = false, gisInited = false;

/**
 * אתחול המערכת
 */
async function initToday() {
    console.log("%c--- Starting Today Dashboard Init ---", "color: #FFD700; font-weight: bold;");
    await refreshAllData(); // טעינה ראשונית
    setupLocalTasks();

    // 3. הגדרת רענון אוטומטי כל 5 דקות (300,000 מילישניות)
    setInterval(async () => {
        console.log("מבצע רענון נתונים אוטומטי...");
        await refreshAllData();
    }, 300000);
}

/**
 * פונקציית עזר לרענון כל מקורות הנתונים
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
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const todayMD = `${m}/${d}`; 
        const todayStr = now.toISOString().split('T')[0];

        // זמן לבדיקת "תקועים" - 3 ימים
        const staleThreshold = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));

        let bdayCount = 0, signingCount = 0, totalRevenue = 0;
        let bdayHtml = "";      // 1. מיכל ייעודי לימי הולדת (לתעדוף בראש הרשימה)
        let generalTasksHtml = ""; // מיכל לשאר המשימות
        let stuckHtml = ""; 

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const clientId = doc.id;

            // 1. בדיקת ימי הולדת - נכנס למיכל נפרד כדי להופיע ראשון
            if (data.clientBirthday && (data.clientBirthday.includes(todayMD) || data.clientBirthday.includes(todayMD.replace('/', '-')))) {
                bdayCount++;
                bdayHtml += createTaskHTML(`🎈 יום הולדת ל-${data.clientName}`, 'BIRTHDAY', clientId, data.clientPhone, `מזל טוב ${data.clientName}! מאחלת לך המון אושר והצלחה. לי אטדגי`);
            }

            // 2. בדיקת עסקאות בחתימה וצפי עמלות
            if (data.status === "SIGNING" || data.status === "3" || String(data.status) === "3" || data.roadmapStep === "3") {
                signingCount++;
                let price = parseFloat(String(data.salePrice || data.dealPrice || 0).replace(/[^\d.]/g, '')) || 0;
                let rate = parseFloat(data.brokerageRatePurch || 2);
                if (price > 0) totalRevenue += (price * (rate / 100));
                generalTasksHtml += createTaskHTML(`🖊️ בדיקת סטטוס עו"ד: ${data.clientName}`, 'SIGNING', clientId, data.clientPhone, `היי ${data.clientName}, מה שלומך? רציתי לבדוק אם יש עדכון לגבי טיוטת החוזה.`);
            }

            // 3. מעקבים
            if (data.followUpDate && data.followUpDate <= todayStr && data.status !== 'DONE' && String(data.status) !== "3" && data.roadmapStep !== "3") {
                generalTasksHtml += createTaskHTML(`📞 שיחת מעקב: ${data.clientName}`, 'FOLLOWUP', clientId, data.clientPhone, `היי ${data.clientName}, מה נשמע? רציתי לשמוע איך אתם מתקדמים.`);
            }

            // 4. לקוחות תקועים - עם לוגיקת צבעים (שיפור 2)
            const lastUpdate = data.timestamp || data.lastUpdated || data.createdAt;
            if (lastUpdate) {
                const lastDate = lastUpdate.toDate ? lastUpdate.toDate() : new Date(lastUpdate);
                if (lastDate < staleThreshold && data.status !== 'DONE' && data.status !== 'CANCELLED') {
                    const diffTime = Math.abs(now - lastDate);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    
                    // קביעת צבע לפי חומרת העיכוב
                    let borderColor = "border-yellow-600"; // ברירת מחדל ל-3 ימים
                    let textColor = "text-yellow-500";
                    if (diffDays >= 7) { borderColor = "border-orange-600"; textColor = "text-orange-500"; }
                    if (diffDays >= 14) { borderColor = "border-red-600"; textColor = "text-red-500"; }

                    stuckHtml += `
                        <div class="dark-card p-4 rounded-xl border-r-4 ${borderColor} flex justify-between items-center mb-3 transition-all hover:bg-white/5">
                            <div>
                                <div class="text-white font-bold text-sm">${data.clientName}</div>
                                <div class="text-[10px] ${textColor} italic font-bold">לא טופל ${diffDays} ימים</div>
                            </div>
                            <a href="https://wa.me/${data.clientPhone?.replace(/\D/g, '').replace(/^0/, '972')}" target="_blank" class="bg-white/5 p-2 rounded-full text-xs hover:bg-white/10 transition-all">💬</a>
                        </div>`;
                }
            }
        });

        if (bdayCountElem) bdayCountElem.innerText = bdayCount;
        if (signingElem) signingElem.innerText = signingCount;
        if (revenueElem) revenueElem.innerText = '₪' + Math.floor(totalRevenue).toLocaleString();
        
        if (stuckList) {
            stuckList.innerHTML = stuckHtml || `<div class="dark-card p-6 rounded-2xl text-center text-green-500 text-xs italic border-dashed border-green-900/30">כל הלקוחות בתנועה! ✨</div>`;
        }

        // 1. הזרקת המשימות: קודם ימי הולדת (תעדוף), אחר כך שאר המשימות
        tasksList.innerHTML = (bdayHtml + generalTasksHtml) || `<div class="text-gray-600 text-center py-12 italic text-sm underline decoration-gray-800">אין משימות דחופות להיום.</div>`;

    } catch (error) { console.error("Firebase Error:", error); }
}

async function fetchNewProperties() {
    const propList = document.getElementById('new-properties-list');
    if (!propList) return;
    try {
        const querySnapshot = await getDocs(query(collection(db, "property_bank"), limit(3)));
        let propHtml = "";
        querySnapshot.forEach(doc => {
            const p = doc.data();
            propHtml += `
                <div class="dark-card p-3 rounded-xl border-r-4 border-blue-500 mb-3">
                    <div class="text-white text-[11px] font-bold truncate">${p.address || "נכס ללא כתובת"}</div>
                    <div class="text-[9px] text-blue-400">₪${Number(p.price || 0).toLocaleString()}</div>
                </div>`;
        });
        propList.innerHTML = propHtml || `<div class="text-[10px] text-gray-600 italic">אין נכסים חדשים בבנק.</div>`;
    } catch (e) { console.error("Properties Error:", e); }
}

function createTaskHTML(text, type, clientId, phone, waMsg) {
    let bgColor = "border-gray-800";
    if (type === 'BIRTHDAY') bgColor = "border-pink-500/40 bg-pink-500/10 shadow-[0_0_10px_rgba(236,72,153,0.1)]";
    if (type === 'SIGNING') bgColor = "border-blue-500/30 bg-blue-500/5";
    const cleanPhone = phone ? phone.replace(/\D/g, '').replace(/^0/, '972') : '';
    const waLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waMsg)}` : '#';
    return `<div class="flex items-center gap-3 p-4 border rounded-xl ${bgColor} group mb-3 transition-all hover:scale-[1.01]">
                <input type="checkbox" class="w-5 h-5 accent-yellow-500 cursor-pointer" onchange="this.parentElement.classList.toggle('task-done')">
                <div class="flex-grow text-sm font-bold text-gray-100">
                    ${text}
                    <div class="flex gap-3 mt-1">
                        <a href="edit-project.html?id=${clientId}" target="_parent" class="text-[10px] text-gray-500 underline hover:text-yellow-500">תיק לקוח</a>
                        ${cleanPhone ? `<a href="${waLink}" target="_blank" class="text-[10px] text-green-500 font-bold hover:underline">💬 WhatsApp</a>` : ''}
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
        }
    };
}

window.gapiInitInternal = async () => {
    try {
        await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
        gapiInited = true;
        if (gapi.client.getToken()) listUpcomingEvents();
    } catch (e) { console.error("GAPI Error", e); }
};
window.gisInitInternal = () => {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPES,
        callback: (resp) => { if (resp.error !== undefined) throw (resp); listUpcomingEvents(); },
    });
};
window.handleAuthClick = () => { if (tokenClient) tokenClient.requestAccessToken({prompt: 'consent'}); };

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
        calendarContent.innerHTML = events.map(event => {
            const start = new Date(event.start.dateTime || event.start.date);
            const time = start.toLocaleTimeString('he-IL', {hour: '2-digit', minute:'2-digit'});
            return `<div class="dark-card p-4 rounded-xl flex justify-between items-center mb-2">
                        <div class="text-xs font-bold text-blue-400">${time}</div>
                        <div class="text-sm text-white font-bold">${event.summary}</div>
                    </div>`;
        }).join('');
    } catch (err) { console.error(err); }
}

document.addEventListener('DOMContentLoaded', initToday);