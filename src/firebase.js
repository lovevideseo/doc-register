import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCmBDm4zNslD-GuyUGYQK58K81x-eYPRqA",
  authDomain: "doc-register-35614.firebaseapp.com",
  projectId: "doc-register-35614",
  storageBucket: "doc-register-35614.firebasestorage.app",
  messagingSenderId: "973946957368",
  appId: "1:973946957368:web:68d3ebf7093a19cbffc0cd"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
