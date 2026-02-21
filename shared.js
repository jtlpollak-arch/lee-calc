// shared.js - המוח הפיננסי המלא | גרסה מוגנת ומעודכנת
export const FinanceLogic = {
    VAT: 1.18, // מע"מ 18%

    STATUSES: {
		'INITIAL': 'בחינה ראשונית',
		'SEARCHING': 'בחיפוש פעיל', // לגיבוי
		'RESEARCH': 'בדיקות ומו"מ',
		'SIGNING': 'לקראת חתימה',
		'DELIVERY': 'קבלת מפתח/שיפוץ',
		'DONE': 'סגירה מוצלחת 🏠',
		'FROZEN': 'תיק בהקפאה ❄️',
		'CANCELLED': 'עסקה בוטלה ❌',
		'TOURS': 'סיור נכסים',
		'NEGOTIATION': 'מו"מ פעיל',
		'CLOSING': 'לקראת סגירה'
	},

    formatNumber: (num) => {
        if (num === null || num === undefined || num === '' || num === 0) return "";
        const clean = num.toString().replace(/[^0-9.]/g, '');
        return clean ? Number(clean).toLocaleString('en-US') : "";
    },

    cleanNumber: (str) => {
        if (typeof str === 'number') return str;
        if (!str) return 0;
        return Number(str.toString().replace(/,/g, '')) || 0;
    },

    formatPhone: (value) => {
        if (!value) return "";
        let x = value.replace(/\D/g, '').match(/(\d{0,3})(\d{0,3})(\d{0,4})/);
        if (!x) return value;
        return !x[1] ? "" : !x[2] ? x[1] : x[1] + '-' + x[2] + (x[3] ? '-' + x[3] : '');
    },

    calculateAll: (data) => {
        // ניקוי נתונים ראשוני
        const initialFunds = FinanceLogic.cleanNumber(data.initialFunds);
        const salePrice = FinanceLogic.cleanNumber(data.salePrice);
        const purchasePrice = FinanceLogic.cleanNumber(data.purchasePrice);

        // חישובי מכירה
        const brS = (salePrice * (FinanceLogic.cleanNumber(data.brokerageRateSale) / 100)) * FinanceLogic.VAT;
        const lwS = (salePrice * (FinanceLogic.cleanNumber(data.lawyerRateSale) / 100)) * FinanceLogic.VAT;
        const totalSaleCosts = brS + lwS + FinanceLogic.cleanNumber(data.mortgageBalance) + FinanceLogic.cleanNumber(data.bettermentTax);
        const netFromSale = salePrice > 0 ? (salePrice - totalSaleCosts) : 0;

        // חישובי קנייה
        const brP = (purchasePrice * (FinanceLogic.cleanNumber(data.brokerageRatePurch) / 100)) * FinanceLogic.VAT;
        const lwP = (purchasePrice * (FinanceLogic.cleanNumber(data.lawyerRatePurch) / 100)) * FinanceLogic.VAT;
        const totalPurchCosts = purchasePrice > 0 ? (purchasePrice + brP + lwP + FinanceLogic.cleanNumber(data.purchaseTax) + FinanceLogic.cleanNumber(data.renovationBudget)) : 0;

        // שקלול סופי
        const finalBalance = initialFunds + netFromSale - totalPurchCosts;

        return {
            // סכומי ביניים להצגה בשדות הנעולים (זה מה שהיה חסר!)
            brokerageFeeSale: Math.round(brS),
            lawyerFeeSale: Math.round(lwS),
            brokerageFeePurch: Math.round(brP),
            lawyerFeePurch: Math.round(lwP),

            // סכומים כוללים
            totalSaleCosts: Math.round(totalSaleCosts),
            totalPurchCosts: Math.round(totalPurchCosts),
            netFromSale: Math.round(netFromSale),
            totalProjectCost: Math.round(totalPurchCosts),
            finalBalance: Math.round(finalBalance)
        };
    }
};