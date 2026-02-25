// dashboard-logic.js - מרכז שליטה חכם
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
        
        // --- הוספת לוגיקת ימי ההולדת החדשה ---
        renderBirthdays(projects);

        // --- הוספת לוגיקת יום השנה לעסקה (מעודכן לרמת נכס) ---
        renderAnniversaries(projects);

    } catch (error) {
        console.error("Dashboard Init Error:", error);
    }
}

function updateTopStats(projects, bank) {
    // עדכון מונה תיקים פעילים
    const activeElem = document.getElementById('count-active');
    if (activeElem) {
        activeElem.innerText = projects.filter(p => p.status !== 'DONE' && p.status !== 'CANCELLED').length;
    }
    
    // עדכון מונה נכסים ללא שיוך
    const unsoldElem = document.getElementById('count-unsold');
    if (unsoldElem) {
        const assignedIds = new Set();
        projects.forEach(p => {
            if (p.properties) p.properties.forEach(prop => assignedIds.add(prop.propertyId || prop.id));
        });
        const unassignedCount = bank.filter(b => !assignedIds.has(b.id)).length;
        unsoldElem.innerText = unassignedCount;
    }
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

    const followUpElem = document.getElementById('count-followup');
    if (followUpElem) followUpElem.innerText = followUpCount;
    
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
            const budgetCheck = proj.purchasePrice ? prop.price <= proj.purchasePrice : true;
            const floorMatch = proj.limitHighFloor ? prop.floor <= 4 : true;

            if (budgetCheck && floorMatch) {
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

    const matchElem = document.getElementById('count-match');
    if (matchElem) matchElem.innerText = matchCount;
    
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

// --- פונקציית ימי הולדת משופרת עם הפרדה ויזואלית ---

function renderBirthdays(projects) {
    const container = document.getElementById('birthday-container');
    const section = document.getElementById('birthday-section');
    const countElem = document.getElementById('count-birthdays');
    
    if (!container || !section) return;

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentDate = today.getDate();

    const todayCelebs = [];
    const upcomingCelebs = [];

    projects.forEach(p => {
        if (!p.clientBirthday) return;
        
        const bdayDate = new Date(p.clientBirthday.replace(/-/g, '/'));
        if (isNaN(bdayDate.getTime())) return;

        if (bdayDate.getMonth() === currentMonth && bdayDate.getDate() === currentDate) {
            todayCelebs.push(p);
        } else {
            const nextBday = new Date(today.getFullYear(), bdayDate.getMonth(), bdayDate.getDate());
            if (nextBday < new Date().setHours(0,0,0,0)) {
                nextBday.setFullYear(today.getFullYear() + 1);
            }
            
            const diffTime = nextBday - new Date().setHours(0,0,0,0);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays > 0 && diffDays <= 14) {
                upcomingCelebs.push({...p, daysLeft: diffDays, bdayDate: bdayDate});
            }
        }
    });

    const totalCount = todayCelebs.length + upcomingCelebs.length;
    if (countElem) countElem.innerText = totalCount;

    if (totalCount === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    let html = "";

    if (todayCelebs.length > 0) {
        html += `<div class="bday-group-title">🎉 חוגגים ממש היום!</div>`;
        html += todayCelebs.map(p => {
            const cleanPhone = p.clientPhone ? p.clientPhone.replace(/\D/g, '') : '';
            const finalPhone = cleanPhone.startsWith('0') ? '972' + cleanPhone.substring(1) : cleanPhone;
            const waMsg = encodeURIComponent(`היי ${p.clientName}, המון מזל טוב ליום ההולדת! 🎂 מאחלת לך שנה נפלאה, מלאה בבתים שמחים ובשורות טובות. לי אטדגי.`);
            
            return `
                <div class="bday-card bday-today">
                    <div class="bday-icon">🎂</div>
                    <span class="bday-name">${p.clientName}</span>
                    <button class="btn-wa" onclick="window.open('https://wa.me/${finalPhone}?text=${waMsg}', '_blank')">
                        שלחי ברכה 💬
                    </button>
                </div>
            `;
        }).join('');
    }

    if (upcomingCelebs.length > 0) {
        html += `<div class="bday-group-title">🎈 בקרוב (בשבועיים הקרובים)</div>`;
        html += upcomingCelebs.sort((a,b) => a.daysLeft - b.daysLeft).map(p => {
            const displayDate = `${p.bdayDate.getDate()}/${p.bdayDate.getMonth() + 1}`;
            return `
                <div class="bday-card">
                    <div class="bday-icon">🎁</div>
                    <span class="bday-name">${p.clientName}</span>
                    <span class="bday-date">חל ב-${displayDate}</span>
                </div>
            `;
        }).join('');
    }

    container.innerHTML = html;
}

// --- פונקציה מעודכנת: יום השנה לעסקה (חיפוש בתוך מערך הנכסים של הלקוח) ---

function renderAnniversaries(projects) {
    const container = document.getElementById('anniversary-container');
    const section = document.getElementById('anniversary-section');
    const countElem = document.getElementById('count-anniversaries');
    
    if (!container || !section) {
        return;
    }

    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    let totalAnniversaries = 0;
    let htmlContent = "";

    projects.forEach(proj => {
        if (proj.properties && Array.isArray(proj.properties)) {
            proj.properties.forEach(prop => {
                if (prop.closingDate) {
                    const dateString = prop.closingDate.replace(/-/g, '/');
                    const cDate = new Date(dateString);
                    
                    if (!isNaN(cDate.getTime()) && cDate.getMonth() === currentMonth) {
                        const years = currentYear - cDate.getFullYear();
                        if (years >= 1) {
                            totalAnniversaries++;

                            const cleanPhone = proj.clientPhone ? proj.clientPhone.replace(/\D/g, '') : '';
                            const finalPhone = cleanPhone.startsWith('0') ? '972' + cleanPhone.substring(1) : cleanPhone;
                            
                            const roleText = prop.clientRole === 'SELLER' ? 'מכרתם את הנכס ב-' : 'קניתם את הבית ב-';
                            const waMsg = encodeURIComponent(`היי ${proj.clientName}, בדיוק קפצה לי תזכורת שעברו ${years > 1 ? years + ' שנים' : 'שנה'} מאז ש${roleText}${prop.address}! מקווה שהכל מצוין. לי אטדגי.`);

                            htmlContent += `
                                <div class="alert-item alert-info" style="border-right-color: #3498db; background: #f0f7ff; margin-bottom: 10px; display: block; overflow: hidden;">
                                    <div style="display:flex; justify-content:space-between; align-items:center; gap: 10px;">
                                        <div style="flex-grow: 1;">
                                            <strong style="color: #2c3e50;">📅 יום השנה לעסקה: ${proj.clientName}</strong><br>
                                            <span style="font-size:12px; color:#555;">${prop.address} (לפני ${years} שנים)</span>
                                        </div>
                                        <button class="btn-wa" style="width:auto; padding:8px 15px; background:#3498db; border:none; color:white; border-radius:6px; cursor:pointer; white-space:nowrap; font-size: 13px;" 
                                            onclick="window.open('https://wa.me/${finalPhone}?text=${waMsg}', '_blank')">
                                            שלחי ברכה 💬
                                        </button>
                                    </div>
                                </div>
                            `;
                        }
                    }
                }
            });
        }
    });

    if (countElem) countElem.innerText = totalAnniversaries;

    if (totalAnniversaries === 0) {
        section.style.display = 'none';
        container.innerHTML = "";
    } else {
        section.style.display = 'block';
        container.innerHTML = htmlContent;
    }
}

initDashboard();