// client-logic.js - פורטל לקוח אינטראקטיבי
import { FinanceLogic } from './shared.js';
import { db } from './firebase-config.js';
import { doc, onSnapshot, updateDoc, getDoc, addDoc, collection, arrayUnion, arrayRemove, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const clientID = urlParams.get('id');
let currentData = {};
let bankProperties = [];
let chart, mChart;
let currentCityFilter = 'הכל';
let financeSettings = { sellBroker: 2, sellLawyer: 0.5, buyBroker: 2, buyLawyer: 0.5 };

async function loadFinanceSettings() {
    const snap = await getDoc(doc(db, "settings", "finance_config"));
    if (snap.exists()) financeSettings = snap.data();
}

async function fetchBankData() {
    const snap = await getDocs(collection(db, "property_bank"));
    bankProperties = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

function initCharts() {
    const config = {
        type: 'doughnut',
        data: {
            labels: ['יתרה', 'הוצאות'],
            datasets: [{ data: [1,1], backgroundColor: ['#FFD700','#e74c3c'], borderWidth: 0 }]
        },
        options: { cutout: '75%', plugins: { legend: { display: false } }, maintainAspectRatio: false }
    };
    const ctx = document.getElementById('mainChart');
    const mCtx = document.getElementById('mobileChart');
    if(ctx) chart = new Chart(ctx.getContext('2d'), config);
    if(mCtx) mChart = new Chart(mCtx.getContext('2d'), config);
}

if (clientID) {
    initCharts();
    loadFinanceSettings().then(() => {
        fetchBankData().then(() => {
            onSnapshot(doc(db, "projects", clientID), (snap) => {
                if (snap.exists()) {
                    currentData = snap.data();
                    renderPortal();
                }
            });
        });
    });
}

function renderPortal() {
    const res = FinanceLogic.calculateAll({
        ...currentData,
        brokerageRateSale: financeSettings.sellBroker,
        lawyerRateSale: financeSettings.sellLawyer,
        brokerageRatePurch: financeSettings.buyBroker,
        lawyerRatePurch: financeSettings.buyLawyer
    });

    // עדכון שדות קלט
    const fields = ['salePrice','mortgageBalance','bettermentTax','logistics','purchasePrice','purchaseTax','renovationBudget','initialFunds','unexpectedPurch'];
    fields.forEach(f => {
        const el = document.getElementById('in-' + f);
        if (el && document.activeElement !== el) {
            el.value = currentData[f] ? FinanceLogic.formatNumber(currentData[f]) : (f === 'unexpectedPurch' ? FinanceLogic.formatNumber(res.unexpectedPurch) : "");
        }
    });

    if(document.getElementById('in-isAdditionalProp')) {
        document.getElementById('in-isAdditionalProp').value = currentData.isAdditionalProp ? "true" : "false";
    }

    // עדכון שדות פלט עמלות
    const sP = FinanceLogic.cleanNumber(currentData.salePrice);
    const pP = FinanceLogic.cleanNumber(currentData.purchasePrice);
    const bFS = Math.round((sP * (financeSettings.sellBroker / 100)) * 1.18);
    const lFS = Math.round((sP * (financeSettings.sellLawyer / 100)) * 1.18);
    const bFP = Math.round((pP * (financeSettings.buyBroker / 100)) * 1.18);
    const lFP = Math.round((pP * (financeSettings.buyLawyer / 100)) * 1.18);

    if(document.getElementById('out-brS')) document.getElementById('out-brS').value = FinanceLogic.formatNumber(bFS);
    if(document.getElementById('out-lwS')) document.getElementById('out-lwS').value = FinanceLogic.formatNumber(lFS);
    if(document.getElementById('out-brP')) document.getElementById('out-brP').value = FinanceLogic.formatNumber(bFP);
    if(document.getElementById('out-lwP')) document.getElementById('out-lwP').value = FinanceLogic.formatNumber(lFP);

    // עדכון מקורות ושימושים
    const initFunds = FinanceLogic.cleanNumber(currentData.initialFunds) || 0;
    const netSale = res.netFromSale || 0;
    if(document.getElementById('view-total-sources')) document.getElementById('view-total-sources').innerText = "₪" + (initFunds + netSale).toLocaleString();
    if(document.getElementById('view-total-cost')) document.getElementById('view-total-cost').innerText = "₪" + res.totalProjectCost.toLocaleString();
    if(document.getElementById('view-final-net')) document.getElementById('view-final-net').innerText = "₪" + res.finalBalance.toLocaleString();

    // יתרה סופית
    const finalStr = res.finalBalance.toLocaleString();
    if(document.getElementById('final-bal')) document.getElementById('final-bal').innerText = finalStr;
    if(document.getElementById('m-final-bal')) document.getElementById('m-final-bal').innerText = finalStr;

    // צבע יתרה
    const color = res.finalBalance < 0 ? "#e74c3c" : "#FFD700";
    if(document.getElementById('final-bal')) document.getElementById('final-bal').style.color = color;

    // עדכון גרף
    const chartData = [Math.max(0, res.finalBalance), (res.totalProjectCost || 1)];
    if (chart) { chart.data.datasets[0].data = chartData; chart.update(); }
    if (mChart) { mChart.data.datasets[0].data = chartData; mChart.update(); }

    document.getElementById('c-name').innerText = currentData.clientName || 'לקוח';
    document.getElementById('c-status').innerText = FinanceLogic.STATUSES[currentData.status] || currentData.status;

    updateCityFilters(currentData.properties || []);
    renderProps(currentData.properties || [], currentData.favorites || []);
}

function updateCityFilters(props) {
    const container = document.getElementById('filters-container');
    const cities = ['הכל', ...new Set(props.map(p => p.city || 'כללי'))];
    if (cities.length <= 1) { if(container) container.innerHTML = ''; return; }
    if(container) {
        container.innerHTML = cities.map(city => `
            <button class="filter-btn ${currentCityFilter === city ? 'active' : ''}" onclick="window.setFilter('${city}')">${city}</button>
        `).join('');
    }
}

window.setFilter = (city) => {
    currentCityFilter = city;
    renderPortal();
};

// פונקציית עזר לזיהוי אתרים
function getSiteName(url) {
    if (url.includes('yad2.co.il')) return 'Yad2';
    if (url.includes('madlan.co.il')) return 'Madlan';
    if (url.includes('facebook.com')) return 'Facebook';
    if (url.includes('homeless.co.il')) return 'Homeless';
    return 'Link';
}

// שליטה בדרופדאון הלינקים
window.toggleLinksDropdown = (id) => {
    const el = document.getElementById(`dropdown-${id}`);
    const isActive = el.classList.contains('active');
    document.querySelectorAll('.links-dropdown').forEach(d => d.classList.remove('active'));
    if (!isActive) el.classList.add('active');
};

function renderProps(props, favs) {
    const list = document.getElementById('p-list');
    if(!list) return;
    
    const updatedProps = props.map(p => {
        const bankMatch = bankProperties.find(bp => bp.address === p.address);
        return bankMatch ? { ...p, ...bankMatch } : p;
    });

    let filtered = currentCityFilter === 'הכל' ? updatedProps : updatedProps.filter(p => (p.city || 'כללי') === currentCityFilter);
    filtered.sort((a, b) => (a.featured ? -1 : 1));

    list.innerHTML = filtered.map((p, idx) => {
        const isFav = (favs || []).includes(p.address);
        const isInactive = p.status === 'SOLD' || p.status === 'BOUGHT';
        
        let stampHtml = '';
        if (p.status === 'SOLD') stampHtml = '<div class="sold-overlay"><div class="sold-stamp">נמכר!</div></div>';
        if (p.status === 'BOUGHT') stampHtml = '<div class="sold-overlay"><div class="sold-stamp bought-stamp">נקנה!</div></div>';

        // לוגיקת לינקים חכמה לתיקון הבעיה שלך
        const links = p.links || (p.link ? [p.link] : []);
        let linkAreaHtml = '';

        if (links.length === 1) {
            // לינק בודד - פתיחה ישירה
            linkAreaHtml = `
                <a href="${links[0]}" target="_blank">
                    <div class="prop-img">
                        <i data-lucide="external-link" size="24"></i>
                        <span style="font-size:11px; margin-top:5px;">לפרטים</span>
                    </div>
                </a>`;
        } else if (links.length > 1) {
            // לינקים מרובים - דרופדאון
            const dropdownItems = links.map(l => `
                <a href="${l}" target="_blank" class="link-option">
                    <i data-lucide="link" size="14"></i>
                    <span>${getSiteName(l)}</span>
                </a>`).join('');

            linkAreaHtml = `
                <div class="prop-link-area" onclick="window.toggleLinksDropdown('${idx}')" style="cursor:pointer; position:relative;">
                    <div class="prop-img">
                        <i data-lucide="external-link" size="24"></i>
                        <span style="font-size:11px; margin-top:5px;">לינקים</span>
                    </div>
                    <div id="dropdown-${idx}" class="links-dropdown">${dropdownItems}</div>
                </div>`;
        } else {
            // אין לינקים
            linkAreaHtml = `
                <div class="prop-img" style="opacity:0.3; cursor:not-allowed;">
                    <i data-lucide="link-2-off" size="24"></i>
                </div>`;
        }

        return `
        <div class="prop-card ${p.featured ? 'is-featured' : ''} ${isInactive ? 'is-inactive' : ''}">
            ${stampHtml}
            <div class="prop-link-area">
                ${linkAreaHtml}
            </div>
            <div class="prop-content">
                <div style="flex-grow:1;">
                    ${p.featured ? '<span class="badge badge-featured">🌟 נבחר השבוע</span>' : ''}
                    <div class="prop-address">${p.address}</div>
                    <div style="font-size:12px; color:#666; margin:8px 0;">${p.rooms} חד' | קומה ${p.floor} | ${p.sqm} מ"ר</div>
                    <div style="display:flex; gap:8px;">
                        <button class="ai-btn" onclick="window.openAi('${btoa(unescape(encodeURIComponent(p.aiAnalysis || "בבנייה...")))}')" ${isInactive ? 'disabled' : ''}>ניתוח מומחית</button>
                        <button class="btn-load-prop" onclick="window.loadToCalc(${p.price}, ${p.taxImprovement || 0}, 0, ${p.logistics || 0}, ${p.renovation || 0})" ${isInactive ? 'disabled' : ''}>
                            <i data-lucide="refresh-cw" size="14"></i> טען
                        </button>
                    </div>
                </div>
                <div style="text-align:left;">
                    <button class="heart-btn ${isFav ? 'active' : ''}" onclick="window.tFav('${p.address}', ${isFav})">
                        <i data-lucide="heart" size="18"></i>
                    </button>
                    <div class="prop-price">₪${FinanceLogic.formatNumber(p.price)}</div>
                </div>
            </div>
        </div>`;
    }).join('');
    lucide.createIcons();
}

window.loadToCalc = async (price, taxImp, survey, logis, reno) => {
    if (!confirm("לטעון נתוני נכס למחשבון?")) return;
    await updateDoc(doc(db, "projects", clientID), { 
        purchasePrice: price, 
        bettermentTax: taxImp || currentData.bettermentTax || 0,
        logistics: logis || currentData.logistics || 0,
        renovationBudget: reno || currentData.renovationBudget || 0 
    });
};

window.tFav = async (addr, isFav) => {
    const ref = doc(db, "projects", clientID);
    if (isFav) await updateDoc(ref, { favorites: arrayRemove(addr) });
    else await updateDoc(ref, { favorites: arrayUnion(addr) });
};

window.openAi = (b64) => {
    document.getElementById('ai-body').innerText = decodeURIComponent(escape(atob(b64)));
    document.getElementById('ai-modal').style.display = 'flex';
};
window.closeAi = () => document.getElementById('ai-modal').style.display = 'none';
window.openAbout = () => document.getElementById('about-modal').style.display = 'flex';
window.closeAbout = () => document.getElementById('about-modal').style.display = 'none';

window.sendConsultation = async () => {
    const input = document.getElementById('consult-url');
    if (!input.value.trim()) return alert("הזינו כתובת");
    await addDoc(collection(db, "consultation_requests"), {
        clientID: clientID, clientName: currentData.clientName, url: input.value,
        timestamp: new Date().toISOString(), status: "PENDING"
    });
    alert("נשלח!");
    input.value = "";
};

document.querySelectorAll('.u-input').forEach(i => {
    i.onblur = async (e) => {
        const val = FinanceLogic.cleanNumber(e.target.value);
        await updateDoc(doc(db, "projects", clientID), { [e.target.id.replace('in-', '')]: val });
    };
});

const addPropSelect = document.getElementById('in-isAdditionalProp');
if(addPropSelect) {
    addPropSelect.onchange = async (e) => {
        await updateDoc(doc(db, "projects", clientID), { isAdditionalProp: e.target.value === "true" });
    };
}

// סגירת דרופדאונים בלחיצה מחוץ להם
window.addEventListener('click', (e) => {
    if (!e.target.closest('.prop-link-area')) {
        document.querySelectorAll('.links-dropdown').forEach(d => d.classList.remove('active'));
    }
});

lucide.createIcons();