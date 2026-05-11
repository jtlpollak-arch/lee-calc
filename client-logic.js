// client-logic.js - פורטל לקוח אינטראקטיבי
import { FinanceLogic } from './shared.js';
import { db } from './firebase-config.js';
import { doc, onSnapshot, updateDoc, getDoc, addDoc, collection, arrayUnion, arrayRemove, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const clientID = urlParams.get('id');
let currentData = {};
let currentCityFilter = 'הכל';
let financeSettings = { sellBroker: 2, sellLawyer: 0.5, buyBroker: 2, buyLawyer: 0.5 };
let isCatalogMode = false;
let chart, bankProperties = [], currentProjectData = null;
let currentSelectedId = ''

    window.switchTab = (tab) => {
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('tab-' + tab).classList.add('active');
        document.querySelectorAll('.tab-btn').forEach(btn => {
            if(btn.onclick.toString().includes(tab)) btn.classList.add('active');
        });
        lucide.createIcons();
    };

    window.shareExperience = () => {
        if (!currentProjectData) return;
//        const catalogUrl = `${window.location.origin}/catalog.html`;
        const currentPageUrl = window.location.href;
        const message = `היי, אני חייבת לשתף אותך - אני עובדת עכשיו עם לי אטדגי על העסקה שלי והיא משתמשת במערכת טכנולוגית מדהימה שנותנת לי שקט נפשי ונתונים בזמן אמת. כדאי לך לראות את רמת ניתוח הנכסים שלה כאן: ${currentPageUrl}`;
        const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
        window.open(waUrl, '_blank');
    };

    function initChart() {
        const canvas = document.getElementById('mainChart');
        if(!canvas) return;
        const ctx = canvas.getContext('2d');
        chart = new Chart(ctx, {
            type: 'doughnut', data: { labels: ['יתרה', 'הוצאות'], datasets: [{ data: [1,1], backgroundColor: ['#D4AF37','#e74c3c'], borderWidth: 0 }] },
            options: { cutout: '80%', plugins: { legend: { display: false } }, maintainAspectRatio: false }
        });
    }

    function startBankSync() {
        onSnapshot(collection(db, "property_bank"), (snap) => {
            bankProperties = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (currentProjectData) filterAndRender();
        }, (e) => console.error("Error syncing bank:", e));
    }

    function startProvidersSync() {
        onSnapshot(collection(db, "service_providers"), (snap) => {
            const list = document.getElementById('providers-list');
            if (!list) return;
            const providers = snap.docs.map(d => d.data());
            if (providers.length === 0) {
                list.innerHTML = `<p style="color: #7f8c8d; grid-column: 1/-1; text-align: center; padding: 40px; background: white; border-radius: 20px;">נבחרת המומחים מתעדכנת ברגעים אלו...</p>`;
                return;
            }
            list.innerHTML = providers.map(p => {
                const cleanPhone = p.phone.replace(/[^0-9]/g, '');
                const waNumber = cleanPhone.startsWith('0') ? '972' + cleanPhone.substring(1) : cleanPhone;
                const message = encodeURIComponent(`היי ${p.name}, הגעתי אליך דרך הפורטל של לי אטדגי, אשמח להתייעץ איתך.`);
                return `
                <div class="provider-card">
                    <div class="provider-category">${p.category}</div>
                    <div class="provider-name">${p.name}</div>
                    <div class="provider-desc">${p.description || 'מומלץ בחום על ידי לי כחלק מהמעטפת המקצועית של הפרויקט.'}</div>
                    <a href="https://wa.me/${waNumber}?text=${message}" target="_blank" class="btn-contact-provider">
                        <i data-lucide="message-circle" size="20"></i> פתיחת שיחת WhatsApp
                    </a>
                </div>`;
            }).join('');
            lucide.createIcons();
        });
    }

    function updateRoadmap(currentStep) {
        const steps = document.querySelectorAll('.step');
        steps.forEach(s => {
            const stepNum = parseInt(s.dataset.step);
            s.classList.remove('active', 'completed');
            if (stepNum < currentStep) s.classList.add('completed');
            if (stepNum === currentStep) s.classList.add('active');
        });
    }

    function calculatePropMatch(p, c) {
        if (!c) return 0;
        let weightedScore = 0;
        let totalWeight = 0;
        const metrics = [
            { propKey: 'scoreEdu', prefKey: 'prefEdu' },
            { propKey: 'scoreTrans', prefKey: 'prefTrans' },
            { propKey: 'scoreLeisure', prefKey: 'prefLeisure' },
            { propKey: 'scoreSea', prefKey: 'prefSea' }
        ];
        metrics.forEach(m => {
            const importance = c[m.prefKey] || 3;
            const score = p[m.propKey] || 0;
            weightedScore += (score * importance);
            totalWeight += (importance * 5);
        });
        let percent = Math.round((weightedScore / totalWeight) * 100);
        if (c.limitHighFloor && p.floor > 4) percent = Math.max(0, percent - 50);
        return percent;
    }

    window.filterAndRender = () => {
        if (!currentProjectData) return;
        const searchTerm = document.getElementById('prop-search').value.toLowerCase();
        const sortOrder = document.getElementById('sort-order').value;
        const maxTrain = parseInt(document.getElementById('filter-max-train').value) || Infinity;
        const maxSea = parseInt(document.getElementById('filter-max-sea').value) || Infinity;
        
        let props = (currentProjectData.properties || []).map(p => {
            const bankMatch = bankProperties.find(bp => 
                (p.propertyId && bp.id === p.propertyId) || (p.id && bp.id === p.id) || (bp.address === p.address)
            );
            const combined = bankMatch ? 
                { ...bankMatch, ...p, id: bankMatch.id } : 
                { ...p, status: 'ACTIVE' };
            return { ...combined, matchPercent: calculatePropMatch(combined, currentProjectData) };
        });

        let filtered = props.filter(p => {
            const matchesSearch = p.address.toLowerCase().includes(searchTerm);
            const matchesCity = (currentCityFilter === 'הכל' || (p.city || 'כללי') === currentCityFilter);
            const matchesTrain = (p.distTrain || 0) <= maxTrain;
            const matchesSea = (p.distSea || 0) <= maxSea;
            return matchesSearch && matchesCity && matchesTrain && matchesSea;
        });
        
        if(sortOrder === 'match-desc') filtered.sort((a,b) => b.matchPercent - a.matchPercent);
        if(sortOrder === 'price-asc') filtered.sort((a,b) => a.price - b.price);
        if(sortOrder === 'price-desc') filtered.sort((a,b) => b.price - a.price);
        if(sortOrder === 'newest') filtered.reverse();

        filtered.sort((a, b) => {
            if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
            if (a.status !== 'ACTIVE' && b.status === 'ACTIVE') return 1;
            return 0;
        });

        renderPropsGrid(filtered, bankProperties);
    };

    window.selectPropForCalc = async (price, id) => {
        if(!clientID) return;
        
        // 1. ניקוי המחיר למספר טהור
        const cleanPrice = FinanceLogic.cleanNumber(price);
        window.currentSelectedId = id;
        
        // 2. עדכון השדה של "מחיר מכירה" ב-Firebase (salePrice במקום purchasePrice)
        await updateDoc(doc(db, "projects", clientID), { 
            salePrice: cleanPrice 
        });
        
        // 3. עדכון ויזואלי של השדה בטאב "עסקת המכירה" (הימני בתמונה שלך)
        const saleInput = document.getElementById('in-salePrice');
        if (saleInput) {
            saleInput.value = FinanceLogic.formatNumber(cleanPrice);
        }
        
        alert(`הנכס נבחר והמחיר עודכן בטאב המכירה.`);
    };

    window.updateRating = async (id, rating) => {
        if(!clientID || !id) return;
        const newRatings = { ...(currentProjectData.ratings || {}) };
        newRatings[id] = rating; // שימוש ב-ID כמפתח ייחודי
        await updateDoc(doc(db, "projects", clientID), { ratings: newRatings });
    };

    function getSiteName(url) {
        if (!url) return 'קישור';
        if (url.includes('yad2.co.il')) return 'יד 2';
        if (url.includes('madlan.co.il')) return 'מדלן';
        if (url.includes('facebook.com')) return 'פייסבוק';
        if (url.includes('homeless.co.il')) return 'הומלס';
        return 'קישור לנכס';
    }

    function renderPropsGrid(props, allPropsForArchive) {
        const typeIcons = {
            'דירה': 'building-2', 'דירת גן': 'leaf', 'גג/פנטהאוז': 'arrow-up-circle',
            'דופלקס': 'layers', 'תיירות ונופש': 'palmtree', 'מרתף/פרטר': 'arrow-down-to-line',
            'טריפלקס': 'component', 'יחידת דיור': 'home', 'סטודיו/לופט': 'layout',
            'בית פרטי/קוטג\'': 'tent', 'דו משפחתי': 'split'
        };

        const list = document.getElementById('p-list');
        const archiveList = document.getElementById('archive-list');
        const archiveSection = document.getElementById('archive-section');
        if(!list) return;
        
        const favs = currentProjectData.favorites || [];
        const ratings = currentProjectData.ratings || {};
//        const currentSelectedPrice = FinanceLogic.cleanNumber(currentProjectData.purchasePrice);
        const adminSettings = {
            lawyerRateSale: currentProjectData.lawyerRateSale || 0.5,
            lawyerRatePurch: currentProjectData.lawyerRatePurch || 0.5,
            brokerageRateSale: currentProjectData.brokerageRateSale || 2,
            brokerageRatePurch: currentProjectData.brokerageRatePurch || 2
        };

        const activeProps = props.filter(p => p.status === 'ACTIVE');
        const archivedProps = (allPropsForArchive || bankProperties)
            .filter(p => p.status === 'SOLD' || p.status === 'BOUGHT')
            .map(p => ({ ...p, matchPercent: calculatePropMatch(p, currentProjectData) }));

        const mapFunction = (p, idx) => {
            const isInactive = p.status !== 'ACTIVE';
            const currentRating = ratings[p.id] || ratings[p.address] || 0; // תמיכה לאחור בכתובת וגישה ל-ID
            // יצירת נתונים נקיים לחישוב כדי למנוע מצב של Final=0
            // חישוב יתרה נזילה עבור הנכס הספציפי בכרטיס
            const totalIn = FinanceLogic.cleanNumber(currentProjectData.salePrice || 0);

            const saleFees = (
                (FinanceLogic.cleanNumber(currentProjectData.brokerageRateSale || 0) * totalIn / 100) + 
                (FinanceLogic.cleanNumber(currentProjectData.lawyerRateSale || 0) * totalIn / 100)
            ) * 1.18;

            // חישוב עמלות קנייה (תיווך + עו"ד) כולל מע"מ - לפי מחיר הנכס הספציפי p.price
            const purchasePriceClean = FinanceLogic.cleanNumber(currentProjectData.purchasePrice || 0);
            const purchaseFees = (
                (FinanceLogic.cleanNumber(currentProjectData.brokerageRatePurch || 0) * purchasePriceClean / 100) + 
                (FinanceLogic.cleanNumber(currentProjectData.lawyerRatePurch || 0) * purchasePriceClean / 100)
            ) * 1.18;
            
            const totalOut = 
                FinanceLogic.cleanNumber(currentProjectData.mortgageBalance || 0) + 
                FinanceLogic.cleanNumber(currentProjectData.purchasePrice || 0) + 
                FinanceLogic.cleanNumber(currentProjectData.renovationBudget || 0) + 
                saleFees + purchaseFees;

            const currentFinalBal = totalIn - totalOut;
            const targetBal = FinanceLogic.cleanNumber(currentProjectData.targetBalance || 0);
            
            const isOk = currentFinalBal >= targetBal;

            // הלוג המעודכן - עכשיו אתה אמור לראות מספרים אמיתיים
            console.log(`Property: ${p.address} | Final: ${currentFinalBal} | Target: ${targetBal} | Match: ${isOk}`);
            
            const matchScore = p.matchPercent || 0;
            const matchColor = matchScore > 80 ? 'var(--safe)' : (matchScore > 50 ? 'var(--primary)' : '#7f8c8d');

            let stars = '';
            for(let i=1; i<=5; i++) {
                stars += `<i data-lucide="star" size="18" class="star ${i <= currentRating ? 'filled' : ''}" onclick="window.updateRating('${p.id}', ${i})"></i>`;
            }
            
            let statusOverlay = p.status === 'SOLD' ? '<div class="prop-status-overlay"><div class="status-stamp">נמכר!</div></div>' : (p.status === 'BOUGHT' ? '<div class="prop-status-overlay"><div class="status-stamp status-bought">נקנה!</div></div>' : '');
    //            let featuredRibbon = p.featured ? '<div class="featured-ribbon"><span>נבחר השבוע</span></div>' : '';
    let featuredSeal = p.featured ? `
    <div class="featured-seal">
        <i data-lucide="award" size="20"></i>
        <span>נבחר<br>השבוע</span>
    </div>` : '';
            const links = p.links || (p.link ? [p.link] : []);
            let linkUI = '';
            
            if (links.length === 1) {
                linkUI = `<a href="${links[0]}" target="_blank" class="icon-btn"><i data-lucide="external-link" size="18"></i></a>`;
            } else if (links.length > 1) {
                const dropdownItems = links.map((l, i) => `
                    <a href="${l}" target="_blank" class="link-option">
                        <i data-lucide="link" size="14"></i>
                        <span>${getSiteName(l)}</span>
                    </a>`).join('');
                linkUI = `
                    <div style="position:relative;">
                        <button class="icon-btn link-trigger-btn" onclick="event.stopPropagation(); this.nextElementSibling.classList.toggle('active')">
                            <i data-lucide="external-link" size="18"></i>
                        </button>
                        <div class="links-dropdown">${dropdownItems}</div>
                    </div>`;
            }

            const mapQuery = encodeURIComponent(`${p.address}, ${p.city || ''}`);
            const simpleMap = `<iframe class="prop-map" frameborder="0" src="https://maps.google.com/maps?q=${mapQuery}&hl=he&z=15&output=embed"></iframe>`;

            const isSelected = p.id === currentSelectedId;

            return `
            <div class="prop-card ${p.featured ? 'is-featured' : ''} ${isSelected ? 'selected-for-calc' : ''}">
                ${statusOverlay}${featuredSeal}
                <div class="budget-badge ${isOk ? 'ok' : 'over'}">
                    <i data-lucide="${isOk ? 'check-circle' : 'alert-circle'}" size="14"></i> ${isOk ? 'מתאים' : 'חריגה'}
                </div>
                ${isSelected ? '<div class="selected-badge">במחשבון</div>' : ''}
                <div class="prop-main-info ${isInactive ? 'disabled-actions' : ''}">
                    ${p.type ? `<div class="type-badge"><i data-lucide="${typeIcons[p.type] || 'home'}" size="12"></i> ${p.type}</div>` : ''}
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:5px;">
                         <span style="font-size:11px; font-weight:bold; color:${matchColor}; display:flex; align-items:center; gap:4px;"><i data-lucide="zap" size="12"></i> התאמה אישית</span>
                         <span style="font-size:11px; font-weight:bold; color:${matchColor};">${matchScore}%</span>
                    </div>
                    <div class="match-progress-container"><div class="match-progress-bar" style="width:${matchScore}%; background-color:${matchColor};"></div></div>
                    <div class="prop-address">${p.featured ? '🌟 ' : ''}${p.address}, ${p.city || ''}</div>
                    <div class="prop-price" style="margin-top:10px;">₪${FinanceLogic.formatNumber(p.price)}</div>
                    <div class="prop-specs">
                        <div class="spec-item"><i data-lucide="maximize" size="14"></i> ${p.sqm} מ"ר</div>
                        <div class="spec-item"><i data-lucide="layout" size="14"></i> ${p.rooms} חד'</div>
                        <div class="spec-item"><i data-lucide="layers" size="14"></i> קומה ${p.floor || '?'}</div>
                    </div>
                    ${simpleMap}
                    <div class="lifestyle-mini-badges">
                        <div class="l-badge" title="חינוך"><i data-lucide="graduation-cap" size="12"></i> ${p.scoreEdu || '?'}/5</div>
                        <div class="l-badge" title="תחבורה"><i data-lucide="bus" size="12"></i> ${p.scoreTrans || '?'}/5</div>
                        <div class="l-badge" title="פנאי"><i data-lucide="coffee" size="12"></i> ${p.scoreLeisure || '?'}/5</div>
                        <div class="l-badge" title="ים"><i data-lucide="waves" size="12"></i> ${p.scoreSea || '?'}/5</div>
                    </div>
                    ${p.leeTip ? `<div class="lee-tip-box"><span>${p.leeTip}</span></div>` : ''}
                    <div class="rating-stars" style="${window.isCatalogMode ? 'pointer-events: none; opacity: 0.8;' : ''}">${stars}</div>
                </div>
                <div class="action-group ${isInactive ? 'disabled-actions' : ''}">
                    <div style="display:flex; gap:8px; justify-content: center; margin-bottom: 5px;">
                        <button class="icon-btn" onclick="window.openAi('${b64EncodeUnicode(p.aiAnalysis || "")}')"><i data-lucide="sparkles" size="18"></i></button>
                        ${linkUI}
                        <button class="icon-btn ${favs.includes(p.id) ? 'active-fav' : ''}" 
                                style="${window.isCatalogMode ? 'cursor: not-allowed; opacity: 0.6;' : ''}"
                                onclick="${window.isCatalogMode ? "alert('סימון מועדפים זמין ללקוחות בלבד')" : `window.tFav('${p.id}', ${favs.includes(p.id)})`}">
                            <i data-lucide="heart" size="18" fill="${favs.includes(p.id) ? '#e74c3c' : 'none'}"></i>
                        </button>
                    </div>
                    <button class="btn-quick-action btn-select-prop ${isSelected ? 'active' : ''}" onclick="window.selectPropForCalc(${p.price}, '${p.id}')">${isSelected ? 'נבחר' : 'בחר'}</button>
                    <button class="btn-quick-action" 
                            style="background:#f0f7ff; color:#0056b3; border:1px solid #c2dbff; ${window.isCatalogMode ? 'opacity:0.6; cursor:not-allowed;' : ''}" 
                            onclick="${window.isCatalogMode ? "alert('צק-ליסט סיור זמין ללקוחות בלבד')" : `window.openChecklist('${p.id}', '${p.address.replace(/'/g, "\\'")}')`}">
                        <i data-lucide="clipboard-check" size="14"></i> 
                        צ'ק-ליסט סיור
                    </button>
                    <button class="btn-quick-action btn-wa-tour" onclick="window.requestTourWA(\`${p.address}${p.city ? ', ' + p.city : ''}\`)">תאמי לי סיור 🏠</button>
                </div>
            </div>`;
        };

        list.innerHTML = activeProps.map((p, i) => mapFunction(p, i)).join('');
        if (archiveList && archiveSection) {
            if (archivedProps.length > 0) {
                const archiveContent = archivedProps.map((p, i) => mapFunction(p, i + 1000)).join('');
                archiveList.innerHTML = `<div class="archive-track">${archiveContent}${archiveContent}${archiveContent}</div>`;
                archiveSection.style.display = 'block';
            } else { archiveSection.style.display = 'none'; }
        }
        lucide.createIcons();
    }

    function b64EncodeUnicode(str) {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
            return String.fromCharCode('0x' + p1);
        }));
    }

    if (clientID) {
        initChart();
        startBankSync();
        startProvidersSync();
        onSnapshot(doc(db, "projects", clientID), (snap) => {
            if (!snap.exists()) return;
            currentProjectData = snap.data();

            window.isCatalogMode = currentProjectData.isCatalog === true;
            console.log("Is Catalog Mode Active:", window.isCatalogMode);

            const currentRoadmapStep = parseInt(currentProjectData.roadmapStep) || 1;
            updateRoadmap(currentRoadmapStep);
            const settings = {
                lawyerRateSale: currentProjectData.lawyerRateSale || 0.5,
                lawyerRatePurch: currentProjectData.lawyerRatePurch || 0.5,
                brokerageRateSale: currentProjectData.brokerageRateSale || 2,
                brokerageRatePurch: currentProjectData.brokerageRatePurch || 2
            };

            document.getElementById('label-brS').innerText = `דמי תיווך מכירה (${settings.brokerageRateSale}% + מע"מ)`;
            document.getElementById('label-lwS').innerText = `שכר טרחת עו"ד (${settings.lawyerRateSale}% + מע"מ)`;
            document.getElementById('label-brP').innerText = `דמי תיווך קנייה (${settings.brokerageRatePurch}% + מע"מ)`;
            document.getElementById('label-lwP').innerText = `שכר טרחת עו"ד (${settings.lawyerRatePurch}% + מע"מ)`;

            const res = FinanceLogic.calculateAll({...currentProjectData, ...settings});
            document.getElementById('c-name').innerText = currentProjectData.clientName;
            document.getElementById('c-status').innerText = FinanceLogic.STATUSES[currentProjectData.status] || currentProjectData.status;
            document.getElementById('final-bal').innerText = res.finalBalance.toLocaleString();
            const card = document.getElementById('main-summary-card');
            const warn = document.getElementById('balance-warning');
    const targetBal = FinanceLogic.cleanNumber(currentProjectData.targetBalance || 0);

    let mortgageSuggestion = '';

    if (res.finalBalance < targetBal) { 
        card.classList.add('negative-balance'); 
        warn.style.display = 'block'; 
        
        const gap = targetBal - res.finalBalance;

        // הזרקת אזהרה וכפתור ממורכזים
        warn.innerHTML = `
            <div style="text-align: center;">
                <div style="margin-bottom: 8px;">
                    <i data-lucide="alert-octagon" size="16" style="vertical-align: middle;"></i> 
                    שימו לב: פער מהיעד של ${gap.toLocaleString()} ₪
                </div>
                <button onclick="window.openMortgageCalc(${gap})" 
                        style="background: white; color: var(--danger); border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; font-weight: bold; box-shadow: 0 4px 10px rgba(0,0,0,0.1); margin-top: 5px;">
                    <i data-lucide="calculator" size="16"></i>
                    פתרון פער: בדיקת משכנתא
                </button>
            </div>
        `;

        if (window.lucide) window.lucide.createIcons();
    } else { 
        card.classList.remove('negative-balance'); 
        warn.style.display = 'none'; 
    }

// *** זה השינוי הקריטי ***
// אנחנו מחפשים את אזור התוכן בתוך הכרטיס המרכזי ומצמידים אליו את הכפתור
const cardContent = card.querySelector('.card-content') || card; 
const existingCalc = document.getElementById('mortgage-calc-container');

if (existingCalc) existingCalc.remove(); // מונע כפילות של הכפתור בריענון

if (mortgageSuggestion) {
    cardContent.insertAdjacentHTML('beforeend', mortgageSuggestion);
    // הפעלה מחדש של האייקונים כדי שהמחשבון ייראה
    if (window.lucide) window.lucide.createIcons();
}

// 3. הזרקה ל-HTML - וודא שיש לך אלמנט ייעודי בתוך הרובליקה בשביל זה
// למשל, אם לאלמנט של הרובליקה קוראים financeInfo:
const suggestionContainer = document.getElementById('mortgage-suggestion-container');
if (suggestionContainer) {
    suggestionContainer.innerHTML = mortgageSuggestion;
}

lucide.createIcons();
            document.getElementById('out-brS').value = FinanceLogic.formatNumber(res.brokerageFeeSale);
            document.getElementById('out-lwS').value = FinanceLogic.formatNumber(res.lawyerFeeSale);
            document.getElementById('out-brP').value = FinanceLogic.formatNumber(res.brokerageFeePurch);
            document.getElementById('out-lwP').value = FinanceLogic.formatNumber(res.lawyerFeePurch);
            document.getElementById('total-sale-costs').innerText = "₪" + res.totalSaleCosts.toLocaleString();
            document.getElementById('total-purch-costs').innerText = "₪" + res.totalPurchCosts.toLocaleString();
            if(chart) {
                chart.data.datasets[0].data = [Math.max(0, res.finalBalance), res.totalProjectCost || 1];
                chart.update();
            }
            ['salePrice','mortgageBalance','bettermentTax','purchasePrice','purchaseTax','renovationBudget', 'targetBalance'].forEach(f => {
                const el = document.getElementById('in-' + f);
                if (el && document.activeElement !== el) el.value = FinanceLogic.formatNumber(currentProjectData[f]);
            });
            const updatedPropsForFilter = (currentProjectData.properties || []).map(p => {
                const bankMatch = bankProperties.find(bp => (p.propertyId && bp.id === p.propertyId) || (p.id && bp.id === p.id) || (bp.address === p.address));
                return bankMatch ? { ...p, city: bankMatch.city } : p;
            });
            updateCityFilters(updatedPropsForFilter);
            filterAndRender();
        });
    }

    function updateCityFilters(props) {
        const container = document.getElementById('filters-container');
        if(!container) return;

        // הוספת השורות האלו תגרום לכפתורים לרדת שורה בצורה מסודרת
        container.style.display = "flex";
        container.style.flexWrap = "wrap";
        container.style.gap = "8px";

        const cities = [...new Set(props.map(p => p.city || 'כללי'))];
        let html = `<button class="tab-btn ${currentCityFilter === 'הכל' ? 'active' : ''}" onclick="window.setFilter('הכל')" style="max-width:80px; padding:10px;">הכל</button>`;
        html += cities.map(c => `<button class="tab-btn ${currentCityFilter === c ? 'active' : ''}" onclick="window.setFilter('${c}')" style="max-width:100px; padding:10px;">${c}</button>`).join('');
        container.innerHTML = html;
    }
    
    window.setFilter = (city) => { 
        currentCityFilter = city; 
        const updatedProps = (currentProjectData.properties || []).map(p => {
            const bankMatch = bankProperties.find(bp => (p.propertyId && bp.id === p.propertyId) || (p.id && bp.id === p.id) || (bp.address === p.address));
            return bankMatch ? { ...p, city: bankMatch.city } : p;
        });
        updateCityFilters(updatedProps);
        filterAndRender();
    };
    window.tFav = async (id, isFav) => {
        if(!clientID || !id) return;
        const ref = doc(db, "projects", clientID);
        await updateDoc(ref, { favorites: isFav ? arrayRemove(id) : arrayUnion(id) });
    };
    window.openAbout = () => document.getElementById('about-modal').style.display = 'flex';
    window.closeAbout = () => document.getElementById('about-modal').style.display = 'none';
    window.openAi = (b64) => { document.getElementById('ai-body').innerText = decodeURIComponent(escape(atob(b64))); document.getElementById('ai-modal').style.display = 'flex'; };
    window.closeAi = () => document.getElementById('ai-modal').style.display = 'none';

    window.analyzeExternal = async () => {
        const link = document.getElementById('external-link-input').value;
        if (!link) { alert("בבקשה תדביקי לינק קודם"); return; }
        try {
            await addDoc(collection(db, "consultation_requests"), { clientName: currentProjectData.clientName || "לקוח לא ידוע", url: link, timestamp: new Date().toISOString() });
            const message = `לי, שלום! מצאתי נכס חיצוני ב${link} שמעניין אותי, אשמח לניתוח שלך.`;
            window.open(`https://wa.me/972533386345?text=${encodeURIComponent(message)}`, '_blank');
            alert("הבקשה נשלחה בהצלחה!");
            document.getElementById('external-link-input').value = ""; 
        } catch (e) { alert("חלה שגיאה בשליחת הבקשה."); }
    };

    document.querySelectorAll('.u-input').forEach(i => {
        i.oninput = (e) => e.target.value = FinanceLogic.formatNumber(e.target.value.replace(/[^0-9]/g, ''));
        i.onblur = async (e) => {
            if(!clientID) return;
            await updateDoc(doc(db, "projects", clientID), { [e.target.id.replace('in-', '')]: FinanceLogic.cleanNumber(e.target.value) });
        };
    });

    let currentChecklistPropID = null;
    window.openChecklist = (id, addr) => {
        currentChecklistPropID = id;
        document.getElementById('checklist-title').innerText = `צ'ק-ליסט סיור: ${addr}`;
        const existing = currentProjectData.tourNotes?.[id] || {};
        document.getElementById('check-noise').value = existing.noise || 3;
        document.getElementById('check-condition').value = existing.condition || 3;
        document.getElementById('check-moisture').checked = existing.moisture || false;
        document.getElementById('check-renovated').checked = existing.renovated || false;
        document.getElementById('check-light').checked = existing.light || false;
        document.getElementById('check-notes').value = existing.notes || "";
        document.getElementById('checklist-modal').style.display = 'flex';
        lucide.createIcons();
    };

    window.closeChecklist = () => { document.getElementById('checklist-modal').style.display = 'none'; };

    window.saveChecklist = async () => {
        if (!clientID || !currentChecklistPropID) return;
        const checklistData = {
            noise: document.getElementById('check-noise').value,
            condition: document.getElementById('check-condition').value,
            moisture: document.getElementById('check-moisture').checked,
            renovated: document.getElementById('check-renovated').checked,
            light: document.getElementById('check-light').checked,
            notes: document.getElementById('check-notes').value,
            timestamp: new Date().toISOString()
        };
        const newTourNotes = { ...(currentProjectData.tourNotes || {}) };
        newTourNotes[currentChecklistPropID] = checklistData; // שימוש ב-ID להגנה על המידע
        await updateDoc(doc(db, "projects", clientID), { tourNotes: newTourNotes });
        alert("סיכום הסיור נשמר בהצלחה!");
        window.closeChecklist();
    };

    document.addEventListener('click', (event) => {
        const activeDropdowns = document.querySelectorAll('.links-dropdown.active');
        activeDropdowns.forEach(dropdown => {
            const isClickInside = dropdown.contains(event.target);
            const isTriggerBtn = event.target.closest('.link-trigger-btn');
            if (!isClickInside && !isTriggerBtn) { dropdown.classList.remove('active'); }
        });

        const modals = [
            { id: 'about-modal', closeFunc: window.closeAbout },
            { id: 'checklist-modal', closeFunc: window.closeChecklist },
            { id: 'ai-modal', closeFunc: window.closeAi }
        ];

        modals.forEach(modal => {
            const modalEl = document.getElementById(modal.id);
            if (modalEl && (window.getComputedStyle(modalEl).display === 'flex' || window.getComputedStyle(modalEl).display === 'block')) {
                if (event.target === modalEl) { modal.closeFunc(); }
            }
        });
    }, true);


    window.openMortgageCalc = function(gap) {
        console.log("פתיחת מחשבון עבור פער של:", gap);
        const modal = document.getElementById('mortgage-modal');
        const iframe = document.getElementById('mortgage-iframe');
        
        if (modal && iframe) {
            iframe.src = `mortgage-calc.html?gap=${gap}`;
            modal.style.display = 'flex';
        }
    };

    window.closeMortgageModal = function() {
        const modal = document.getElementById('mortgage-modal');
        if (modal) modal.style.display = 'none';
    };

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

    window.addEventListener('message', async function(event) {
        if (event.data.type === 'UPDATE_MORTGAGE') {
            const newAmount = event.data.amount;
            // עדכון השדה ב-UI
            document.getElementById('mortgageBalance').value = newAmount;
            // קריאה לפונקציית השמירה הקיימת שלך (למשל saveFinanceData)
            if (typeof saveFinanceData === "function") {
                await saveFinanceData();
            }
            window.closeMortgageModal();
        }
    });

    window.requestTourWA = (address) => {
    if (window.isCatalogMode) {
        const leadModal = document.getElementById('lead-modal');
        if (leadModal) {
            // שמירת הכתובת לצורך משלוח מאוחר יותר
            leadModal.dataset.interestedAddress = address;
            
            const modalTitle = leadModal.querySelector('h3');
            if (modalTitle) modalTitle.innerText = "מעוניינים בסיור בנכס " + address + "?";
            
            leadModal.style.display = 'flex';
        } else {
            alert("האופציה לתיאום סיור זמינה ללקוחות VIP בלבד.");
        }
        return;
    }

    // לוגיקת VIP מקורית - פתיחת וואטסאפ ישירה
    const waText = encodeURIComponent(`לי, שלום! ראיתי בפורטל האישי את הנכס ב${address} ואשמח מאוד לתאם בו סיור. תודה רבה!`);
    window.open(`https://wa.me/972533386345?text=${waText}`, '_blank');
};

// מאזין לשליחת טופס הלידים (מודאל קטלוג)
const leadForm = document.getElementById('lead-form');
if (leadForm) {
    leadForm.onsubmit = (e) => {
        e.preventDefault();

        const name = document.getElementById('lead-name').value;
        const phone = document.getElementById('lead-phone').value;
        const location = document.getElementById('lead-modal').dataset.interestedAddress || "נכס כללי";
        const method = leadForm.querySelector('input[name="contact-method"]:checked').value;

        const subject = `בקשת סיור בנכס: ${location}`;
        const bodyText = `היי לי, אני ${name}, מעוניין בסיור ב${location}. נא לחזור אליי ב${method === 'whatsapp' ? 'וואטסאפ' : method === 'phone' ? 'טלפון' : 'מייל'}. טלפון שלי: ${phone}`;

        if (method === 'whatsapp') {
            window.open(`https://wa.me/972533386345?text=${encodeURIComponent(bodyText)}`, '_blank');
        } 
        else if (method === 'phone') {
            // זה פשוט פותח את החייגן
            window.location.href = `tel:0533386345`;
        } 
        else if (method === 'email') {
            const myEmail = "leeatadgi@gmail.com"; // המייל שלך
            const subject = `בקשת סיור בנכס: ${location}`;
            const bodyText = `היי לי, אני ${name}, מעוניין בסיור ב${location}. נא לחזור אליי במייל. טלפון שלי: ${phone}`;

            // יצירת קישור ישיר ל-Gmail במקום mailto רגיל
            const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${myEmail}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
            
            window.open(gmailUrl, '_blank');
        }

        document.getElementById('lead-modal').style.display = 'none';
        leadForm.reset();
    };
}

lucide.createIcons();
