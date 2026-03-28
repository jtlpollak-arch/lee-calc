// formatters.js
window.formatPhone = function(input) {
    if (!input) return;
    
    // ניקוי תווים שאינם מספרים
    let value = input.value.replace(/\D/g, '');
    
    // הגבלה ל-10 ספרות
    value = value.substring(0, 10);
    
    let finalValue = "";
    if (value.length > 0) {
        finalValue = value.substring(0, 3);
        if (value.length > 3) {
            finalValue += '-' + value.substring(3, 6);
        }
        if (value.length > 6) {
            finalValue += '-' + value.substring(6, 10);
        }
    }
    
    input.value = finalValue;
};


window.cleanPhone = function(phoneStr) {
    if (!phoneStr) return "";
    return phoneStr.replace(/\D/g, ''); // מסיר כל תו שאינו מספר
};