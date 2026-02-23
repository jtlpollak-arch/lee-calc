import { FinanceLogic } from './shared.js';
import { db } from './firebase-config.js';
import { doc, onSnapshot, updateDoc, getDoc, collection, getDocs, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const clientID = urlParams.get('id');

let currentData = {};
let bankProperties = [];
let chart = null;
let currentCityFilter = 'הכל';
let financeSettings = { sellBroker: 2, sellLawyer: 0.5, buyBroker: 2, buyLawyer: 0.5 };

// --- 1. אתחול נתונים ---

async function loadFinanceSettings() {
    const snap = await getDoc(doc(db, "settings", "finance_config"));
    if (snap.exists()) financeSettings = snap.data();
}

async function fetchBankData() {
    const snap = await getDocs(collection(db, "property_bank"));
    bankProperties = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function updateChartData(res) {
    if (chart && res) {
        chart.data.datasets[0].data = [Math.max(0, res.finalBalance), (res.totalProjectCost || 1)];
        chart.update();
    }
}

function initMobileChart(res) {
    const ctx = document.getElementById('mobileChart');
    if (!ctx) return;
    if (chart) { updateChartData(res); return; }
    chart = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['יתרה', 'הוצאות'],
            datasets: [{ 
                data: res ? [Math.max(0, res.finalBalance), (res.totalProjectCost || 1)] : [1, 1], 
                backgroundColor: ['#D4AF37', '#e74c3c'], 
                borderWidth: 0 
            }]
        },
        options: { cutout: '75%', plugins: { legend: { display: false } }, maintainAspectRatio: false }
    });
}

// --- 2. לוגיקת רינדור מרכזית ---

function renderMobilePortal() {
    const res = FinanceLogic.calculateAll({
        ...currentData,
        brokerageRateSale: financeSettings.sellBroker,
        lawyerRateSale: financeSettings.sellLawyer,
        brokerageRatePurch: financeSettings.buyBroker,
        lawyerRatePurch: financeSettings.buyLawyer
    });

    const nameEl = document.getElementById('mobile-client-name');
    const statusEl = document.getElementById('mobile-client-status');
    if(nameEl) nameEl.innerText = currentData.clientName || 'לקוח';
    if(statusEl) statusEl.innerText = FinanceLogic.STATUSES[currentData.status] || currentData.status;

    const finalBalEl = document.getElementById('m-final-bal');
    if (finalBalEl) {
        finalBalEl.innerText = "₪" + res.finalBalance.toLocaleString();
        finalBalEl.style.color = res.finalBalance < 0 ? "#e74c3c" : "#D4AF37";
    }

    if (!chart) initMobileChart(res);
    else updateChartData(res);

    updateRoadmapUI(parseInt(currentData.roadmapStep) || 1);
    updateCityFilters(currentData.properties || []);
    renderMobileProps(currentData.properties || [], currentData.favorites || []);
    renderFinanceTabDetails(res);
}

// --- 3. ניהול נכסים (מבנה דו-טורי משופר) ---

function renderMobileProps(props, favs) {
    const list = document.getElementById('m-p-list');
    if (!list) return;

    const updatedProps = props.map(p => {
        const bankMatch = bankProperties.find(bp => bp.address === p.address);
        return bankMatch ? { ...p, ...bankMatch } : p;
    });

    let filtered = currentCityFilter === 'הכל' ? updatedProps : updatedProps.filter(p => (p.city || 'כללי') === currentCityFilter);
    list.innerHTML = filtered.map((p, idx) => createMobileCard(p, favs, idx)).join('');
    if (window.lucide) lucide.createIcons();
}

function createMobileCard(p, favs, idx) {
    const isFav = (favs || []).includes(p.address);
    const ratings = currentData.ratings || {};
    const currentRating = ratings[p.address] || 0;
    const isSelected = FinanceLogic.cleanNumber(p.price) === FinanceLogic.cleanNumber(currentData.purchasePrice);
    const sim = FinanceLogic.calculateAll({ ...currentData, purchasePrice: p.price });
    const isOk = sim.finalBalance >= 0;
    
    const matchScore = calculatePropMatch(p, currentData);
    const matchColor = matchScore > 80 ? '#D4AF37' : '#7f8c8d';

    let starsHtml = '';
    for(let i=1; i<=5; i++) {
        starsHtml += `<i data-lucide="star" size="10" class="star ${i <= currentRating ? 'filled' : ''}" 
                        onclick="event.stopPropagation(); window.updateRating('${p.address}', ${i})"></i>`;
    }

    const mapQuery = encodeURIComponent(`${p.address}, ${p.city || ''}`);

    return `
        <div class="prop-card compact ${isSelected ? 'selected-for-calc' : ''}">
            ${p.featured ? '<div class="featured-ribbon"><span>נבחר השבוע</span></div>' : ''}

            <div style="display:flex; justify-content:space-between; align-items:center; padding: 4px 10px; background: rgba(0,0,0,0.02);">
                <div class="budget-badge-mini ${isOk ? 'ok' : 'over'}">
                    <i data-lucide="${isOk ? 'check-circle' : 'alert-circle'}" size="10"></i> ${isOk ? 'מתאים' : 'חריגה'}
                </div>
                <div class="rating-stars" style="display:flex; gap:2px;">${starsHtml}</div>
            </div>

            <div class="prop-main-info" style="padding: 8px 10px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
                    <div class="prop-address" style="font-size: 13px; font-weight: 800; max-width: 65%; line-height:1.2; ${p.featured ? 'padding-left: 20px;' : ''}">
                        ${p.address}${p.city ? ', ' + p.city : ''}
                    </div>
                    <div class="prop-price" style="font-size: 15px; font-weight: 900; color: #1a1a1a;">₪${FinanceLogic.formatNumber(p.price)}</div>
                </div>

                <div style="margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:10px; font-weight:bold; color:${matchColor}; margin-bottom:2px;">
                        <span><i data-lucide="zap" size="10" style="display:inline; vertical-align:middle;"></i> התאמה אישית</span>
                        <span>${matchScore}%</span>
                    </div>
                    <div class="match-bar-container">
                        <div style="width:${matchScore}%; height:100%; background:${matchColor}; transition:0.5s;"></div>
                    </div>
                </div>

                <div class="card-middle-section">
                    <div class="side-actions">
                        <button class="action-circle-mini ${isFav ? 'active-fav' : ''}" onclick="window.tFav('${p.address}', ${isFav})">
                            <i data-lucide="heart" size="14" fill="${isFav ? 'var(--danger)' : 'none'}"></i>
                        </button>
                        <button class="action-circle-mini" onclick="window.toggleMobileLinks('${idx}')">
                            <i data-lucide="link" size="14"></i>
                        </button>
                        <button class="action-circle-mini" onclick="window.openAiMobile('${b64EncodeUnicode(p.aiAnalysis || "")}')">
                            <i data-lucide="sparkles" size="14"></i>
                        </button>
                        <button class="btn-select-mini ${isSelected ? 'active' : ''}" onclick="window.selectPropForCalc(${p.price}, '${p.address}')">
                            ${isSelected ? 'נבחר' : 'בחר'}
                        </button>
                    </div>

                    <div class="map-container-mini">
                        <iframe style="width:100%; height:100%; border:none;" src="https://maps.google.com/maps?q=$${mapQuery}&hl=he&z=14&output=embed"></iframe>
                    </div>
                </div>

                <div class="lifestyle-row-mini">
                    <div>🏠 ${p.rooms} | 🏢 ק' ${p.floor || '?'} | 📐 ${p.sqm}</div>
                    <div style="display:flex; gap:4px;">
                        <span>🎓${p.scoreEdu || '?'}</span>
                        <span>🚌${p.scoreTrans || '?'}</span>
                        <span>☕${p.scoreLeisure || '?'}</span>
                        <span style="color:#0077be;">🌊${p.scoreSea || '?'}</span>
                    </div>
                </div>

                ${p.leeTip ? `<div class="lee-tip-mini"><b>לי:</b> ${p.leeTip}</div>` : ''}

                <div class="card-bottom-actions">
                    <button class="btn-bottom-mini" onclick="window.openChecklist('${p.address}')">
                        <i data-lucide="clipboard-check" size="12"></i> צ'ק-ליסט
                    </button>
                    <button class="btn-bottom-mini tour" onclick="window.requestTourWA('${p.address}')">
                        תאמי לי סיור 🏠
                    </button>
                </div>
            </div>
        </div>
    `;
}

// --- פונקציות תומכות ---

function updateRoadmapUI(currentStep) {
    document.querySelectorAll('.step').forEach(s => {
        const stepNum = parseInt(s.dataset.step);
        s.classList.remove('active', 'completed');
        if (stepNum < currentStep) s.classList.add('completed');
        if (stepNum === currentStep) s.classList.add('active');
    });
}

function updateCityFilters(props) {
    const container = document.getElementById('m-filters-container');
    if (!container) return;
    const cities = ['הכל', ...new Set(props.map(p => p.city || 'כללי'))];
    container.innerHTML = cities.map(city => `
        <button class="tab-btn ${currentCityFilter === city ? 'active' : ''}" 
            onclick="window.setMobileFilter('${city}')" style="min-width:max-content; padding:8px 15px; border-radius:20px; border:1px solid #ddd; background:white; font-size:12px;">
            ${city}
        </button>
    `).join('');
}

function calculatePropMatch(p, c) {
    if (!c) return 0;
    let weightedScore = 0, totalWeight = 0;
    const metrics = [
        {pk:'scoreEdu', prk:'prefEdu'}, 
        {pk:'scoreTrans', prk:'prefTrans'}, 
        {pk:'scoreLeisure', prk:'prefLeisure'},
        {pk:'scoreSea', prk:'prefSea'}
    ];
    metrics.forEach(m => {
        const importance = c[m.prk] || 3;
        weightedScore += ((p[m.pk] || 0) * importance);
        totalWeight += (importance * 5);
    });
    return Math.round((weightedScore / (totalWeight || 1)) * 100);
}

function renderFinanceTabDetails(res) {
    const container = document.getElementById('mobile-finance-calculator');
    if (!container) return;
    container.innerHTML = `
        <div class="finance-card" style="background:white; padding:15px; border-radius:15px; margin-bottom:15px; box-shadow:0 4px 10px rgba(0,0,0,0.05);">
            <h4 style="color:#D4AF37; margin-top:0;">📤 מקורות (הון נכנס)</h4>
            <div class="input-wrapper" style="margin-bottom:10px;">
                <label style="display:block; font-size:12px; margin-bottom:4px;">הון עצמי</label>
                <input type="text" class="finance-input u-input" id="in-initialFunds" value="${FinanceLogic.formatNumber(currentData.initialFunds)}" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd;">
            </div>
            <div style="display:flex; justify-content:space-between; font-size:14px;">
                <span>נטו ממכירה:</span>
                <strong>₪${res.netFromSale.toLocaleString()}</strong>
            </div>
        </div>
    `;
}

// --- פונקציות Window ---

window.setMobileFilter = (city) => { currentCityFilter = city; renderMobilePortal(); };
window.selectPropForCalc = async (price, address) => { await updateDoc(doc(db, "projects", clientID), { purchasePrice: price }); };
window.updateRating = async (address, rating) => {
    const newRatings = { ...(currentData.ratings || {}) };
    newRatings[address] = rating;
    await updateDoc(doc(db, "projects", clientID), { ratings: newRatings });
};
window.tFav = async (addr, isFav) => {
    const ref = doc(db, "projects", clientID);
    await updateDoc(ref, { favorites: isFav ? arrayRemove(addr) : arrayUnion(addr) });
};
window.toggleMobileLinks = (idx) => {
    alert("פתיחת קישורים חיצוניים...");
};
window.openAiMobile = (b64) => {
    const text = decodeURIComponent(escape(atob(b64)));
    document.getElementById('ai-body').innerText = text;
    document.getElementById('ai-modal').style.display = 'flex';
};
window.requestTourWA = (addr) => {
    window.open(`https://wa.me/972533386345?text=${encodeURIComponent('אשמח לסיור ב: ' + addr)}`, '_blank');
};
window.saveChecklist = async () => {
    if (!clientID || !currentData) return;
    const titleText = document.getElementById('checklist-title').innerText;
    const addr = titleText.replace("סיור בנכס: ", "");
    const checklistData = {
        noise: document.getElementById('check-noise').value,
        condition: document.getElementById('check-condition').value,
        moisture: document.getElementById('check-moisture').checked,
        notes: document.getElementById('check-notes').value,
        timestamp: new Date().toISOString()
    };
    const newTourNotes = { ...(currentData.tourNotes || {}) };
    newTourNotes[addr] = checklistData;
    try {
        await updateDoc(doc(db, "projects", clientID), { tourNotes: newTourNotes });
        alert("סיכום הסיור נשמר בהצלחה!");
        window.closeChecklist();
    } catch (e) { alert("חלה שגיאה בשמירה."); }
};

function b64EncodeUnicode(str) { return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1))); }

// --- האתחול ---

async function initMobile() {
    if (!clientID) return;
    try {
        await Promise.all([loadFinanceSettings(), fetchBankData()]);
        onSnapshot(doc(db, "projects", clientID), (snap) => {
            if (snap.exists()) {
                currentData = snap.data();
                renderMobilePortal();
            }
        });
    } catch (e) { console.error(e); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMobile);
else initMobile();