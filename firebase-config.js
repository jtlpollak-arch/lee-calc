// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
export const firebaseConfig = {
  apiKey: "AIzaSyBteA8_KMXtFWKXXcp0Ckzxa8p-PVF0-2U",
  authDomain: "li-calc-21cc7.firebaseapp.com",
  projectId: "li-calc-21cc7",
  storageBucket: "li-calc-21cc7.firebasestorage.app",
  messagingSenderId: "862152050544",
  appId: "1:862152050544:web:837cc61b4eacbaf4b0f1b5",
  measurementId: "G-H71W1WT155"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
//export const analytics = getAnalytics(app);

// ייצוא המשתנה db כך שיהיה נגיש לקבצים אחרים
export const db = getFirestore(app);