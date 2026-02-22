import { db } from './firebase-config.js';
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// מיפוי שלבי המפה לשמות בעברית עבור התצוגה
const ROADMAP_LABELS = {
    "1": "שלב 1: חיפוש ואיתור נכס",
    "2": "שלב 2: בדיקות ומשא ומתן",
    "3": "שלב 3: חתימה ומימון",
    "4": "שלב 4: קבלת מפתח ושיפוץ",
    "5": "שלב 5: מזל טוב - הושלם"
};

const ROADMAP_COLORS = {
    "1": "#3498db", "2": "#9b59b6", "3": "#f1c40f", "4": "#e67e22", "5": "#2ecc71"
};

async function initDashboard() {
    try {
        const [projectsSnap, bankSnap] = await Promise.all([
            getDocs(collection(db, "projects")),
            getDocs(collection(db, "property_bank"))
        ]);

        const projects = [];
        projectsSnap.forEach(doc => projects.push({ id: doc.id, ...doc.data() }));

        const bank = [];
        bankSnap.forEach(doc => bank.push({ id: doc.id, ...doc.data() }));

        // פונקציות המקור שלך (נשמרו במלואן)
        updateTopStats(projects, bank);
        renderUrgentAlerts(projects);
        renderRoadmapSummary(projects);
        runMatchmaker(projects, bank);

        // תוספות השדרוג (בלי לפגוע במקור)
        renderAIInsights(projects);
        renderHotProperties(projects);
        renderVisualRoadmap(projects);

    } catch (error) {
        console.error("Dashboard Init Error:", error);
    }
}

function updateTopStats(projects, bank) {
    document.getElementById('count-active').innerText = projects.filter(p => p.status !== 'DONE' && p.status !== 'CANCELLED').length;
    
    const assignedIds = new Set();
    projects.forEach(p => {
        if (p.properties) p.properties.forEach(prop => assignedIds.add(prop.propertyId || prop.id));
    });
    const unassignedCount = bank.filter(b => !assignedIds.has(b.id)).length;
    document.getElementById('count-unsold').innerText = unassignedCount;
}

function renderUrgentAlerts(projects) {
    const container = document.getElementById('alerts-container');
    if (!container) return;
    container.innerHTML = "";
    const today = new Date().toISOString().split('T')[0];
    let followUpCount = 0;

    projects.forEach(p => {
        if (p.followUpDate && p.followUpDate <= today && p.status !== 'DONE' && p.status !== 'CANCELLED') {
            addAlertItem(container, {
                title: `מעקב דחוף: ${p.clientName}`,
                desc: `היה אמור להתבצע ב-${p.followUpDate}. הלקוח ממתין לשיחה.`,
                type: 'urgent',
                id: p.id
            });
            followUpCount++;
        }

        if (p.tourNotes) {
            const hasRecentTour = Object.values(p.tourNotes).some(note => {
                const tourDate = new Date(note.timestamp);
                return (new Date() - tourDate) / (1000 * 60 * 60) < 48;
            });

            if (hasRecentTour) {
                addAlertItem(container, {
                    title: `תובנה חדשה מהשטח: ${p.clientName}`,
                    desc: `הלקוח מילא צ'ק-ליסט סיור לאחרונה. כדאי לבדוק את המשוב.`,
                    type: 'info',
                    id: p.id
                });
            }
        }
    });

    document.getElementById('count-followup').innerText = followUpCount;
    if (container.innerHTML === "") container.innerHTML = "<p>אין התראות דחופות כרגע. הכל בשליטה!</p>";
}

function renderRoadmapSummary(projects) {
    const counts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    projects.forEach(p => {
        if (p.roadmapStep && counts[p.roadmapStep] !== undefined) {
            counts[p.roadmapStep]++;
        }
    });

    const container = document.getElementById('roadmap-summary');
    if (!container) return;
    container.innerHTML = Object.entries(ROADMAP_LABELS).map(([step, label]) => `
        <div class="roadmap-item">
            <span>${label}</span>
            <span class="roadmap-count">${counts[step]}</span>
        </div>
    `).join('');
}

function runMatchmaker(projects, bank) {
    const container = document.getElementById('matches-container');
    if (!container) return;
    container.innerHTML = "";
    let matchCount = 0;

    bank.forEach(prop => {
        projects.forEach(proj => {
            if (proj.status === 'DONE' || proj.status === 'CANCELLED') return;
            const isAssigned = proj.properties && proj.properties.some(p => (p.propertyId || p.id) === prop.id);
            if (isAssigned) return;

            const budgetMatch = prop.price <= (proj.purchasePrice || Infinity);
            const floorMatch = proj.limitHighFloor ? prop.floor <= 4 : true;

            if (budgetMatch && floorMatch) {
                matchCount++;
                const div = document.createElement('div');
                div.className = "alert-item alert-success";
                div.innerHTML = `
                    <button class="btn-view" onclick="location.href='edit-project.html?id=${proj.id}'">שדכי כעת</button>
                    <strong>🎯 שידוך חכם: ${proj.clientName}</strong><br>
                    <span style="font-size:12px;">הנכס ב-<b>${prop.address}</b> מתאים לתקציב ולמגבלת הקומה.</span>
                `;
                container.appendChild(div);
            }
        });
    });

    document.getElementById('count-match').innerText = matchCount;
    if (container.innerHTML === "") container.innerHTML = "<p>לא נמצאו שידוכים חדשים כרגע.</p>";
}

function addAlertItem(container, data) {
    const div = document.createElement('div');
    div.className = `alert-item alert-${data.type}`;
    div.innerHTML = `
        <button class="btn-view" onclick="location.href='edit-project.html?id=${data.id}'">לתיק הלקוח</button>
        <strong>${data.title}</strong><br>
        <span style="font-size:12px; color:#555;">${data.desc}</span>
    `;
    container.appendChild(div);
}

// --- פונקציות השדרוג החדשות (התוספות) ---

function renderAIInsights(projects) {
    const aiText = document.getElementById('ai-text');
    if (!aiText) return;
    
    const overdue = projects.filter(p => p.followUpDate && new Date(p.followUpDate) < new Date()).length;
    if (overdue > 3) {
        aiText.innerText = `לי, יש לך ${overdue} לקוחות שממתינים למעקב מעבר לזמן. כדאי להקדיש את השעה הקרובה לסגירת פערים בשיחות טלפון.`;
    } else {
        aiText.innerText = `המערכת מנותחת: הכל נראה תקין. כדאי לעבור על הצעות השידוך החדשות בבנק הנכסים.`;
    }
}

function renderHotProperties(projects) {
    const container = document.getElementById('hot-properties');
    if (!container) return;
    
    const favMap = {};
    projects.forEach(p => {
        if (p.favorites) p.favorites.forEach(addr => favMap[addr] = (favMap[addr] || 0) + 1);
    });
    
    const sorted = Object.entries(favMap).sort((a,b) => b[1] - a[1]).slice(0, 3);
    container.innerHTML = sorted.map(hp => `
        <div style="font-size:13px; padding:10px 0; border-bottom:1px solid #eee;">
            <strong>${hp[0]}</strong> <span style="color:#e74c3c;">❤️ ${hp[1]} לקוחות</span>
        </div>
    `).join('') || "<p>אין עדיין נכסים פופולריים.</p>";
}

function renderVisualRoadmap(projects) {
    const container = document.getElementById('roadmap-viz');
    if (!container) return;
    
    const counts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    projects.forEach(p => {
        if (p.roadmapStep) counts[p.roadmapStep]++;
    });
    
    const total = projects.length || 1;
    container.innerHTML = `
        <div class="roadmap-bar" style="height:12px; background:#eee; border-radius:10px; display:flex; overflow:hidden;">
            ${Object.entries(counts).map(([step, count]) => `
                <div style="width:${(count/total)*100}%; background:${ROADMAP_COLORS[step]}"></div>
            `).join('')}
        </div>
    `;
}

initDashboard();