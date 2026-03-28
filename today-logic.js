import { db } from './firebase-config.js';
import { collection, getDocs, limit, query, orderBy, getDoc, doc, addDoc, where, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from './firebase-config.js';

/**
 * אבטחה: מניעת "מירוץ" טעינה
 */
const auth = getAuth(initializeApp(firebaseConfig));

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = 'login.html';
    } else {
        console.log("משתמש מחובר ומאומת: " + user.email);
        initToday();
    }
});

// משתני גוגל
let CLIENT_ID = '';
let API_KEY = '';
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest";
const SCOPES = "https://www.googleapis.com/auth/calendar.events";
let tokenClient, gapiInited = false, gisInited = false;

/**
 * פונקציות עזר (יום הולדת, קונפטי)
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

    try {
        if (dateVal.toDate) {
            const d = dateVal.toDate();
            bDay = d.getDate();
            bMonth = d.getMonth() + 1;
        } else {
            const parts = dateVal.toString().split(/[-/.]/);
            if (parts.length >= 2) {
                if (parts[0].length === 4) { 
                    bMonth = parseInt(parts[1]); 
                    bDay = parseInt(parts[2]); 
                } else { 
                    bDay = parseInt(parts[0]); 
                    bMonth = parseInt(parts[1]); 
                }
            }
        }
        if (bDay === tDay && bMonth === tMonth) return 'today';
        if (bDay === mDay && bMonth === mMonth) return 'tomorrow';
    } catch (e) {
        console.error("Birthday Format Error:", e);
    }
    return false;
}

function celebrate() {
    const duration = 4000;
    const end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0 }, colors: ['#FFD700', '#FFFFFF'] });
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1 }, colors: ['#FFD700', '#FFFFFF'] });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}

async function initToday() {
    try {
        const settingsSnap = await getDoc(doc(db, "settings", "google_config"));
        if (settingsSnap.exists()) {
            const config = settingsSnap.data();
            CLIENT_ID = config.clientId; API_KEY = config.apiKey;
            if (CLIENT_ID && API_KEY) {
                gapi.load('client', gapiInitInternal);
                gisInitInternal(); 
            }
        }
    } catch (e) { console.error("Setting Load Error:", e); }
    
    await refreshAllData(); 
    setupLocalTasks();
    setInterval(refreshAllData, 300000);
}

/**
 * רענון נתונים חכם: מרענן תמיד את Firebase, 
 * ומרענן את גוגל רק אם כבר קיים טוקן פעיל (מונע קפיצת חלונות).
 */
async function refreshAllData() {
    if (!auth.currentUser) return;

    // רענון Firebase תמיד
    await fetchFirebaseData();
    await fetchNewProperties();

    // רענון גוגל רק אם מחובר
    if (gapiInited && gapi.client.getToken()) {
        try {
            await listUpcomingEvents();
        } catch (e) {
            console.log("Google refresh failed quietly:", e);
        }
    } else {
        renderLoginPrompt();
    }
}

async function fetchFirebaseData() {
    const tasksList = document.getElementById('tasks-list');
    const bdayCountElem = document.getElementById('today-birthdays');
    const signingElem = document.getElementById('stats-signing');
    const revenueElem = document.getElementById('stats-revenue');
    const stuckList = document.getElementById('stuck-clients-list');
    
    if (!tasksList) return;

    try {
        const querySnapshot = await getDocs(collection(db, "projects"));
        const now = new Date(), todayStr = now.toISOString().split('T')[0];
        const staleThreshold = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
        let bCount = 0, sCount = 0, rev = 0;
        let bHtml = "", tHtml = "", sHtml = "";

        const adminTasksSnap = await getDocs(query(collection(db, "admin_tasks"), where("dueDate", "<=", todayStr)));
        adminTasksSnap.forEach(tDoc => {
            const tData = tDoc.data();
            if (!tData.isDone) {
                const name = tData.clientName || "";
                const content = tData.taskContent || tData.text;
                const displayText = name ? `<strong class="gold-text ml-1">${name}:</strong> ${content}` : content;
                tHtml += createTaskHTML(displayText, 'ADMIN_TASK', tDoc.id, '', '');
            }
        });

        querySnapshot.forEach((doc) => {
            const data = doc.data(), id = doc.id, phone = data.clientPhone || '';
            const bStatus = checkBirthdayStatus(data.clientBirthday);
            if (bStatus === 'today') { 
                bCount++; 
                bHtml += createTaskHTML(`🎈 יום הולדת היום: ${data.clientName}`, 'BIRTHDAY', id, phone, `מזל טוב! 🎂`); 
            }
            else if (bStatus === 'tomorrow') { 
                bHtml += createTaskHTML(`⏳ מחר יום הולדת: ${data.clientName}`, 'TOMORROW_BDAY', id, phone, `מחר יום הולדת!`); 
            }
            
            if (data.status === "SIGNING" || data.roadmapStep === "3") {
                sCount++;
                let price = parseFloat(String(data.salePrice || 0).replace(/[^\d.]/g, '')) || 0;
                rev += (price * (parseFloat(data.brokerageRatePurch || 2) / 100));
            }

            const last = data.timestamp || data.lastUpdated;
            if (last && data.status !== 'DONE' && data.status !== 'CANCELLED') {
                const lDate = last.toDate ? last.toDate() : new Date(last);
                if (lDate < staleThreshold) {
                    const diff = Math.ceil(Math.abs(now - lDate) / (1000 * 60 * 60 * 24));
                    let c = diff >= 14 ? "border-red-600" : (diff >= 7 ? "border-orange-600" : "border-yellow-600");
                    sHtml += `<div class="dark-card p-4 rounded-xl border-r-4 ${c} mb-3 text-right"><div><div class="text-white font-bold text-sm text-right">${data.clientName}</div><div class="text-[10px] text-gray-500 italic text-right">ללא עדכון ${diff} ימים</div></div><a href="https://wa.me/${phone.replace(/\D/g, '')}" target="_blank" class="bg-green-500/10 p-2 rounded-full text-xs hover:bg-green-500 transition-all text-center">💬</a></div>`;
                }
            }
        });

        if (bdayCountElem) bdayCountElem.innerText = bCount;
        if (signingElem) signingElem.innerText = sCount;
        if (revenueElem) revenueElem.innerText = '₪' + Math.floor(rev).toLocaleString();
        if (stuckList) stuckList.innerHTML = sHtml || `<div class="text-green-500/50 text-[10px] italic text-right">הכל מטופל! ✨</div>`;
        
        tasksList.innerHTML = (bHtml + tHtml) || `<div class="text-gray-600 text-center py-12 italic text-sm text-right">אין משימות.</div>`;
        updateDayProgress();
    } catch (e) { console.error("Firebase Error:", e); }
}

async function fetchNewProperties() {
    const list = document.getElementById('new-properties-list');
    if (!list) return;
    try {
        const q = query(collection(db, "property_bank"), orderBy("lastUpdated", "desc"), limit(3));
        const snap = await getDocs(q);
        let h = "";
        snap.forEach(doc => {
            const p = doc.data();
            h += `<div class="dark-card p-3 rounded-xl border-r-4 border-blue-500 mb-3 text-right"><div class="text-white text-[11px] font-bold text-right">${p.address || "נכס"}</div><div class="text-[9px] text-blue-400 text-right">₪${Number(p.price || 0).toLocaleString()}</div></div>`;
        });
        list.innerHTML = h;
    } catch (e) {}
}

function updateDayProgress() {
    const total = document.querySelectorAll('#tasks-list input[type="checkbox"]').length;
    const done = document.querySelectorAll('#tasks-list input[type="checkbox"]:checked').length;
    const p = total === 0 ? 0 : Math.round((done / total) * 100);
    const bar = document.getElementById('main-progress-bar'), txt = document.getElementById('progress-text');
    if (bar) bar.style.width = p + '%';
    if (txt) txt.innerText = p + '% הושלמו';
    if (p === 100 && total > 0) celebrate();
}

window.toggleTask = async (checkbox, taskId, type) => {
    checkbox.closest('.task-item-container').classList.toggle('task-done', checkbox.checked);
    if (type === 'ADMIN_TASK' && taskId) {
        try {
            await updateDoc(doc(db, "admin_tasks", taskId), { isDone: checkbox.checked });
        } catch (e) { console.error("Error updating task:", e); }
    }
    updateDayProgress();
};

function createTaskHTML(text, type, id, phone, waMsg) {
    let c = "border-gray-800";
    if (type === 'BIRTHDAY') c = "border-pink-500/40 bg-pink-500/10 shadow-[0_0_10px_rgba(236,72,153,0.1)]";
    if (type === 'TOMORROW_BDAY') c = "border-blue-400/30 bg-blue-400/5";
    const wa = phone ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(waMsg)}` : "#";
    const waStyle = phone ? "" : "display:none;";
    const folderStyle = id && type !== 'ADMIN_TASK' ? "" : "display:none;";
    
    return `<div class="task-item-container flex items-center gap-3 p-4 border rounded-xl ${c} mb-3 text-right"><input type="checkbox" onchange="window.toggleTask(this, '${id}', '${type}')" class="w-5 h-5 accent-yellow-500 cursor-pointer"><div class="flex-grow text-sm text-right">${text}<div class="flex gap-4 mt-2 justify-end"><a href="edit-project.html?id=${id}" target="_blank" class="text-[10px] text-gray-500 underline" style="${folderStyle}">תיק</a><a href="${wa}" target="_blank" class="text-[10px] text-green-500 font-bold" style="${waStyle}">WhatsApp</a></div></div></div>`;
}

function setupLocalTasks() {
    const input = document.getElementById('new-task-input'), btn = document.getElementById('add-task-btn');
    if (btn) btn.onclick = async () => { 
        if (input.value.trim()) { 
            const taskText = input.value.trim();
            try {
                await addDoc(collection(db, "admin_tasks"), {
                    taskContent: taskText,
                    clientName: "כללי",
                    text: `כללי: ${taskText}`,
                    dueDate: new Date().toISOString().split('T')[0],
                    isDone: false,
                    timestamp: new Date().toISOString()
                });
                input.value = ""; 
                await refreshAllData(); 
            } catch (e) { console.error(e); }
        } 
    };
}

async function gapiInitInternal() { try { await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] }); gapiInited = true; if (gapi.client.getToken()) listUpcomingEvents(); } catch (e) {} }

function gisInitInternal() { 
    tokenClient = google.accounts.oauth2.initTokenClient({ 
        client_id: CLIENT_ID, 
        scope: SCOPES, 
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                listUpcomingEvents();
            }
        } 
    }); 
}

window.handleAuthClick = () => tokenClient.requestAccessToken({prompt: 'consent'});

function renderLoginPrompt() {
    const content = document.getElementById('calendar-content');
    if (!content) return;
    content.innerHTML = `<div class="flex flex-col items-center justify-center p-8 text-center bg-yellow-500/5 rounded-3xl border border-yellow-500/20 mt-4"><div class="text-4xl mb-4">✨</div><h3 class="text-white font-bold mb-2 text-right">לי היקרה, שלום!</h3><p class="text-[10px] text-gray-400 mb-6 leading-relaxed px-4 text-right">כדי לצפות ביומן הפגישות שלך, אנא בצעי חיבור לגוגל.</p><button onclick="handleAuthClick()" class="bg-yellow-500 text-black font-bold py-2 px-8 rounded-full text-xs hover:bg-yellow-400 transition-all shadow-lg">סנכרון יומן גוגל</button></div>`;
}

async function listUpcomingEvents() {
    const content = document.getElementById('calendar-content'), count = document.getElementById('today-leads');
    try {
        const resp = await gapi.client.calendar.events.list({ 'calendarId': 'primary', 'timeMin': (new Date()).toISOString(), 'singleEvents': true, 'maxResults': 30, 'orderBy': 'startTime' });
        const events = resp.result.items, now = new Date();
        const dayNames = ["יום א'", "יום ב'", "יום ג'", "יום ד'", "יום ה'", "יום ו'", "שבת"];
        const groups = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(now); d.setDate(now.getDate() + i);
            groups.push({ date: d.toDateString(), label: i === 0 ? "היום" : (i === 1 ? "מחר" : dayNames[d.getDay()]), events: [] });
        }
        events.forEach(e => { const d = new Date(e.start.dateTime || e.start.date).toDateString(); const g = groups.find(x => x.date === d); if (g) g.events.push(e); });
        if (count) count.innerText = groups[0].events.length;
        
        content.innerHTML = groups.filter((g, i) => g.events.length > 0 || i < 2).map((g, i) => {
            let h = `<div class="day-header text-right font-bold gold-text mt-4 mb-2">${g.label}</div>`;
            if (g.events.length === 0) return h + `<div class="text-[10px] text-gray-700 py-2 text-right italic">אין פגישות מתוכננות</div>`;
            return h + g.events.map(e => {
                const start = new Date(e.start.dateTime || e.start.date), time = start.toLocaleTimeString('he-IL', {hour: '2-digit', minute:'2-digit'});
                const isToday = (i === 0), diffMins = Math.floor((start - now) / 60000);
                let st = isToday ? (diffMins > 0 && diffMins < 60 ? `<span class="text-[9px] text-yellow-500 animate-pulse block font-bold">בעוד ${diffMins} דק'</span>` : (diffMins <= 0 && diffMins > -60 ? `<span class="text-[9px] text-red-500 font-bold block">עכשיו!</span>` : "")) : "";
                
                let displaySummary = e.summary || "ללא כותרת";
                if (displaySummary.includes(':')) {
                    const parts = displaySummary.split(':');
                    displaySummary = `<strong class="text-white">${parts[1].trim()}:</strong> <span class="opacity-80">${parts[0].trim()}</span>`;
                }

                const sAttendee = e.attendees?.find(a => a.self);
                const sColor = sAttendee?.responseStatus === 'accepted' ? 'bg-green-500' : 'bg-gray-500';
                let icon = e.summary?.includes("סיור") ? "🏠" : (e.summary?.includes("חתימה") ? "🖊️" : (e.summary?.includes("שיחה") ? "📞" : "📅"));

                return `
                <div class="dark-card p-3 rounded-xl mb-2 border-r-4 ${isToday ? 'border-yellow-500' : 'border-gray-800'} transition-all flex items-center dir-rtl text-right">
                    <div class="w-20 flex-shrink-0 flex flex-col items-center justify-center border-l border-white/10 pl-2 ml-2">
                        <div class="text-[12px] font-bold text-blue-400">${time}</div>
                        ${st}
                        ${e.location ? `
                            <a href="https://waze.com/ul?q=${encodeURIComponent(e.location)}" target="_blank" 
                               class="text-[8px] bg-blue-600/20 text-blue-400 px-2 py-0.5 rounded border border-blue-400/30 mt-1 whitespace-nowrap">
                                📍 ניווט
                            </a>` : ""}
                    </div>
                    <div class="flex-grow pr-2 overflow-hidden text-right">
                        <div class="flex items-center justify-start gap-2 mb-0.5">
                            <span class="text-xs opacity-70">${icon}</span>
                            <div class="text-sm truncate">${displaySummary}</div>
                        </div>
                        ${e.location ? `<div class="text-[10px] text-gray-400 truncate italic">${e.location}</div>` : ""}
                    </div>
                    <div class="w-1.5 h-1.5 rounded-full ${sColor} flex-shrink-0 mr-auto ml-1"></div>
                </div>`;
            }).join('');
        }).join('');
    } catch (e) { console.error("Calendar Error:", e); }
}

window.openEventModal = () => {
    document.getElementById('event-title').value = ""; document.getElementById('event-location').value = ""; document.getElementById('event-time').value = "";
    document.getElementById('event-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('event-modal').style.display = 'block';
};
window.closeEventModal = () => { document.getElementById('event-modal').style.display = 'none'; };

window.saveEventToGoogle = async () => {
    if (!gapiInited || !gapi.client.getToken()) return alert("נא לבצע סנכרון.");
    const t = document.getElementById('event-title').value, d = document.getElementById('event-date').value, tm = document.getElementById('event-time').value;
    const type = document.getElementById('event-type').value;
    if (!t || !d || !tm) return alert("מלאי את כל השדות.");
    const start = new Date(`${d}T${tm}:00`);
    
    const ev = { 
        'summary': `${type}: ${t}`, 
        'location': document.getElementById('event-location').value, 
        'start': { 'dateTime': start.toISOString(), 'timeZone': 'Asia/Jerusalem' }, 
        'end': { 'dateTime': new Date(start.getTime() + 3600000).toISOString(), 'timeZone': 'Asia/Jerusalem' } 
    };
    try { await gapi.client.calendar.events.insert({ 'calendarId': 'primary', 'resource': ev }); alert("האירוע נוצר! ✨"); window.closeEventModal(); listUpcomingEvents(); } catch (e) { console.error(e); }
};

/**
 * מנגנון רענון אוטומטי בעת חזרה לטאב
 */
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        refreshAllData();
    }
});

window.addEventListener('focus', () => {
    refreshAllData();
});