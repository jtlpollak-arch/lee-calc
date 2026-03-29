// formatters.js
window.formatPhone = function(input) {
    // 1. חילוץ הערך: אם זה אלמנט HTML קח את ה-value, אם לא - התייחס לזה כטקסט
    let val = (input && input.value !== undefined) ? input.value : (input || "");
    
    // 2. ניקוי תווים שאינם מספרים (הפיכה למחרוזת ליתר ביטחון)
    let cleaned = val.toString().replace(/\D/g, '');
    
    // 3. הגבלה ל-10 ספרות
    cleaned = cleaned.substring(0, 10);
    
    // 4. בניית הפורמט 05x-xxx-xxxx
    let finalValue = "";
    if (cleaned.length > 0) {
        finalValue = cleaned.substring(0, 3);
        if (cleaned.length > 3) {
            finalValue += '-' + cleaned.substring(3, 6);
        }
        if (cleaned.length > 6) {
            finalValue += '-' + cleaned.substring(6, 10);
        }
    }
    
    // 5. החזרה ליעד הנכון:
    if (input && input.value !== undefined) {
        // אם זה Input - עדכן את השדה על המסך
        input.value = finalValue;
    } else {
        // אם זה לשימוש בטבלה - החזר את הטקסט המעובד
        return finalValue;
    }
};

window.cleanPhone = function(phoneStr) {
    if (!phoneStr) return "";
    return phoneStr.replace(/\D/g, ''); // מסיר כל תו שאינו מספר
};


window.formatNumberWithCommas = function(input) {
    // 1. חילוץ הערך (מתוך Input או כמחרוזת ישירה)
    let val = (input && input.value !== undefined) ? input.value : (input || "");
    
    // 2. ניקוי כל מה שאינו מספר
    let cleaned = val.toString().replace(/\D/g, '');
    
    // 3. הוספת פסיקים (שימוש ב-Regex חכם שמפריד כל 3 ספרות)
    let formatted = cleaned.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    
    // 4. החזרה ליעד הרלוונטי
    if (input && input.value !== undefined) {
        input.value = formatted;
    } else {
        return formatted;
    }
};

// מחזיר את התאריך של היום בפורמט YYYY-MM-DD לפי שעון מקומי (ישראל)
window.getTodayLocal = function() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000; // הפרש דקות במילישניות
    const localISOTime = (new Date(now - offset)).toISOString().slice(0, 10);
    return localISOTime;
};

// פונקציה לעיצוב תאריך ושעה לפורמט ישראלי
window.formatDateTime = function(isoString, includeTime = true) {
    if (!isoString) return "";
    
    const date = new Date(isoString);
    
    // בדיקה אם התאריך תקין
    if (isNaN(date.getTime())) return isoString;

    const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    };

    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }

    return date.toLocaleString('he-IL', options).replace(',', '');
};