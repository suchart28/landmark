// Import Firebase Functions 
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Firebase Config ของคุณ 
const firebaseConfig = {
    apiKey: "AIzaSyCJ-E8bN9nz_BWKTNofz7ccuVoo6m8LyAU",
    authDomain: "suchart-915bd.firebaseapp.com",
    projectId: "suchart-915bd",
    storageBucket: "suchart-915bd.firebasestorage.app",
    messagingSenderId: "94380768305",
    appId: "1:94380768305:web:c4705ea3e0d53e1b61a910",
    measurementId: "G-2LNYQS3M52"
};

// เริ่มต้น Firebase App และ Database (Firestore)
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Google Sheet Setup
const SHEET_ID = '1W2Yj2aR6dsv0GHOIYwIPA-B9d9RAN9jOgKoDAXkbb70'; 
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let locations = [];
let announcedPlaces = new Set();
let watchId = null;

// ตัวแปรสำหรับเก็บข้อมูล Firebase Session
let sessionDocRef = null;
let sessionStartTime = null;
let currentLat = null;
let currentLng = null;

// 1. โหลดข้อมูลจาก Google Sheet
function fetchLocations() {
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        complete: function(results) {
            locations = results.data.filter(loc => loc.lat && loc.lng);
            document.getElementById('status').innerText = `โหลดข้อมูลสำเร็จ ${locations.length} สถานที่`;
        },
        error: function(err) {
            document.getElementById('status').innerText = 'เกิดข้อผิดพลาดในการโหลดข้อมูล โปรดตรวจสอบการแชร์ไฟล์';
        }
    });
}

// 2. คำนวณระยะทาง
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// 3. ฟังก์ชันอ่านออกเสียง 3 ภาษา
function speak(text, lang) {
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.9; 
    window.speechSynthesis.speak(utterance);
}

// ระบบสร้าง Document ใน Firebase เมื่อเริ่มใช้งาน
async function startFirebaseSession() {
    sessionStartTime = new Date();
    try {
        const docRef = await addDoc(collection(db, "visitor_logs"), {
            start_time: sessionStartTime.toISOString(),
            device_info: navigator.userAgent,
            last_lat: null,
            last_lng: null,
            duration_seconds: 0
        });
        sessionDocRef = docRef;
    } catch (e) {
        console.error("Firebase Error: ไม่สามารถบันทึกข้อมูลได้", e);
    }
}

// ระบบอัปเดตข้อมูลพิกัดและระยะเวลาการใช้งานลง Firebase ทุกๆ 15 วินาที
setInterval(async () => {
    if (sessionDocRef && currentLat && currentLng && sessionStartTime) {
        const duration = Math.floor((new Date() - sessionStartTime) / 1000); 
        try {
            await updateDoc(sessionDocRef, {
                last_lat: currentLat,
                last_lng: currentLng,
                duration_seconds: duration
            });
        } catch (e) {
            console.error("Firebase Sync Error: ", e);
        }
    }
}, 15000);

// 4. เริ่มระบบพิกัด
function startTracking() {
    if (!navigator.geolocation) {
        alert("เบราว์เซอร์ของคุณไม่รองรับ GPS");
        return;
    }

    document.getElementById('status').innerText = "กำลังค้นหาตำแหน่งของคุณ...";
    
    // ปลดล็อค Audio ใน Browser
    speak(" ", "th-TH");

    // บันทึก Session ลง Firebase
    startFirebaseSession();

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            currentLat = position.coords.latitude;
            currentLng = position.coords.longitude;
            
            document.getElementById('status').innerHTML = `พิกัดปัจจุบัน:<br>Lat: ${currentLat.toFixed(5)}<br>Lng: ${currentLng.toFixed(5)}`;

            let closestLocation = null;
            let minDistance = Infinity;

            // ค้นหาสถานที่ที่อยู่ในระยะและใกล้ที่สุด
            locations.forEach(loc => {
                const distance = getDistance(currentLat, currentLng, parseFloat(loc.lat), parseFloat(loc.lng));
                
                // --- ปรับระยะที่ 1: ตรวจสอบรัศมี 50 เมตร ---
                if (distance <= 50) {
                    if (distance < minDistance) {
                        minDistance = distance;
                        closestLocation = loc;
                    }
                }
                
                // --- ปรับระยะที่ 2: ล้างความจำเมื่อห่างออกไปเกิน 80 เมตร ---
                // หากยังอยู่ในระยะ 50m (หรือแกว่งไปมาไม่เกิน 80m) จะไม่อ่านซ้ำเด็ดขาด
                if (distance > 80 && announcedPlaces.has(loc.id)) {
                    announcedPlaces.delete(loc.id);
                }
            });

            // หากพบสถานที่ที่ใกล้ที่สุดในระยะ 50m และยังไม่ได้อ่าน
            if (closestLocation && !announcedPlaces.has(closestLocation.id)) {
                // บันทึกไว้ใน Set เพื่อกันการอ่านซ้ำตราบใดที่ยังไม่เดินออกนอกระยะ 80m
                announcedPlaces.add(closestLocation.id); 
                
                // ยกเลิกข้อความเก่าที่ยังพูดไม่จบออกก่อน ค่อยเริ่มอ่านสถานที่ใหม่ที่ใกล้กว่า
                window.speechSynthesis.cancel(); 
                
                speak(closestLocation.info_th, 'th-TH');
                speak(closestLocation.info_en, 'en-US');
                speak(closestLocation.info_cn, 'zh-CN');
            }
        },
        (error) => {
            document.getElementById('status').innerText = "ไม่สามารถหาตำแหน่งได้ กรุณาเปิด GPS";
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
}

// ผูก Event ปุ่มกด
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startBtn').style.display = 'none';
    startTracking();
});

// เริ่มดึงข้อมูล Sheet
fetchLocations();
