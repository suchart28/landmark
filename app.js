// Import Firebase Functions (Version 12.13.0)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getFirestore, collection, addDoc, updateDoc } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-analytics.js";

// Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyDMptdLpLEdbeVFKZj82M0gyoV2m_2y5Pk",
    authDomain: "suchartstudio-9a78d.firebaseapp.com",
    databaseURL: "https://suchartstudio-9a78d-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "suchartstudio-9a78d",
    storageBucket: "suchartstudio-9a78d.firebasestorage.app",
    messagingSenderId: "953369646185",
    appId: "1:953369646185:web:33c814ecf964b7c96ebef8",
    measurementId: "G-BPSW8BJCTQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const analytics = getAnalytics(app);

// Google Sheet Setup
const SHEET_ID = '1WQ790i1c8STFzWZEDtuK_NXg202lqEIh4OHfQ8qYGHo'; 
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let locations = [];
let announcedPlaces = new Set(); 
let checkedInPlaces = new Set(); 
let watchId = null;

// Lock State ป้องกันการทำงานซ้ำ
let isCheckingIn = false;

// Firebase Session
let sessionDocRef = null;
let sessionStartTime = null;
let currentLat = null;
let currentLng = null;

// เข็มทิศและตำแหน่งเป้าหมาย
let currentHeading = 0;
let targetLat = null;
let targetLng = null;
let activeCheckInLocation = null; 

// โหลดข้อมูลจาก Google Sheet
function fetchLocations() {
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        complete: function(results) {
            locations = results.data.filter(loc => loc.lat && loc.lng);
            document.getElementById('status').innerText = `โหลดข้อมูลพร้อมแล้ว ${locations.length} จุด`;
            
            const totalEl = document.getElementById('totalCount');
            if(totalEl) totalEl.innerText = locations.length;
        },
        error: function(err) {
            document.getElementById('status').innerText = 'เกิดข้อผิดพลาดในการโหลดข้อมูล';
        }
    });
}

// คำนวณระยะทาง (Haversine Formula)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
}

// คำนวณองศาทิศทาง
function getBearing(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLon = (lon2 - lon1) * toRad;
    lat1 = lat1 * toRad;
    lat2 = lat2 * toRad;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let bearing = Math.atan2(y, x) * toDeg;
    return (bearing + 360) % 360; 
}

// หมุนลูกศรเข็มทิศ
function updateArrow() {
    if (targetLat === null || targetLng === null || currentLat === null || currentLng === null) return;
    const bearing = getBearing(currentLat, currentLng, targetLat, targetLng);
    let arrowAngle = bearing - currentHeading;
    const navArrow = document.getElementById('navArrow');
    if (navArrow) {
        navArrow.style.transform = `rotate(${arrowAngle}deg)`;
    }
}

// ระบบพูดออกเสียง
function speak(text, lang) {
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.9; 
    window.speechSynthesis.speak(utterance);
}

// ฟังก์ชันตรวจสอบและคำนวณสถานะเวลาของนิทรรศการ
function getExhibitionStatus(loc) {
    if (!loc.start_date || !loc.end_date || !loc.open_time || !loc.close_time) return null;

    const now = new Date();
    const currentTimeStr = now.toTimeString().substring(0, 5); // ได้ค่า "HH:MM"

    const startDate = new Date(loc.start_date);
    const endDate = new Date(loc.end_date);
    endDate.setHours(23, 59, 59, 999); // ให้นับถึงสิ้นสุดวันของ end_date

    if (now < startDate) {
        return `🗓️ เริ่มจัดแสดงวันที่ ${loc.start_date}`;
    } else if (now > endDate) {
        return `⛔ สิ้นสุดการจัดแสดงแล้ว`;
    } else {
        // อยู่ในช่วงวันที่จัดแสดง เช็คเวลาเปิด-ปิดต่อ
        if (currentTimeStr < loc.open_time) {
            return `🔴 ยังไม่เปิด (รอบถัดไปเวลา ${loc.open_time} น.)`;
        } else if (currentTimeStr > loc.close_time) {
            return `🔴 ปิดแล้ววันนี้ (เปิดอีกครั้งพรุ่งนี้เวลา ${loc.open_time} น.)`;
        } else {
            return `🟢 กำลังจัดแสดง (จนถึงเวลา ${loc.close_time} น.)`;
        }
    }
}

// สร้างเซสชันใน Firebase
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
        console.error("Firebase Connection Error: ", e);
    }
}

// อัปเดตตำแหน่งผู้ใช้งานลง Firebase ทุก ๆ 15 วินาที
setInterval(async () => {
    if (sessionDocRef && currentLat && currentLng && sessionStartTime) {
        const duration = Math.floor((new Date() - sessionStartTime) / 1000); 
        try {
            await updateDoc(sessionDocRef, {
                last_lat: currentLat,
                last_lng: currentLng,
                duration_seconds: duration
            });
        } catch (e) {}
    }
}, 15000);

// ระบบติดตามพิกัด GPS ของผู้ใช้
function startTracking() {
    if (!navigator.geolocation) {
        alert("เบราว์เซอร์ไม่รองรับระบบระบุตำแหน่ง GPS");
        return;
    }

    document.getElementById('status').innerText = "กำลังค้นหาตำแหน่งของท่าน...";
    speak(" ", "th-TH");
    startFirebaseSession();

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            currentLat = position.coords.latitude;
            currentLng = position.coords.longitude;
            
            document.getElementById('status').innerHTML = `พิกัดปัจจุบัน:<br>Lat: ${currentLat.toFixed(5)}<br>Lng: ${currentLng.toFixed(5)}`;

            let closestLocation = null;
            let absoluteNearestLoc = null; 
            let minDistance = Infinity;
            let minAbsoluteDistance = Infinity;

            locations.forEach(loc => {
                const distance = getDistance(currentLat, currentLng, parseFloat(loc.lat), parseFloat(loc.lng));
                
                // ค้นหาจุดกิจกรรมที่อยู่ใกล้ที่สุดและยังไม่ได้กดเช็คอิน
                if (!checkedInPlaces.has(loc.id)) {
                    if (distance < minAbsoluteDistance) {
                        minAbsoluteDistance = distance;
                        absoluteNearestLoc = loc;
                    }
                    
                    if (distance <= 50) {
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestLocation = loc;
                        }
                    }
                }
                
                // รีเซ็ตสถานะการประกาศเสียงพูดเมื่อห่างเกิน 80 เมตร
                if (distance > 80 && announcedPlaces.has(loc.id)) {
                    announcedPlaces.delete(loc.id);
                }
            });

            const compassWrap = document.getElementById('compassWrap');

            // อัปเดต UI ทิศทางและระยะทางไปยังเป้าหมายที่อยู่ใกล้ที่สุด
            if (absoluteNearestLoc) {
                targetLat = parseFloat(absoluteNearestLoc.lat);
                targetLng = parseFloat(absoluteNearestLoc.lng);
                
                if (compassWrap && !compassWrap.classList.contains('active')) compassWrap.classList.add('active');
                updateArrow(); 
                
                const nameEl = document.getElementById('targetName');
                if (nameEl) {
                    window.currentTargetNameString = absoluteNearestLoc.name_th || absoluteNearestLoc.name || absoluteNearestLoc.title_th || "จุดกิจกรรม";
                    nameEl.innerText = window.currentTargetNameString;
                }

                const distEl = document.getElementById('distanceValue');
                if (distEl) {
                    if (minAbsoluteDistance >= 1000) {
                        distEl.innerText = (minAbsoluteDistance / 1000).toFixed(2) + " กม.";
                    } else {
                        distEl.innerText = Math.round(minAbsoluteDistance) + " ม.";
                    }
                }

                // อัปเดตลิงก์รูปภาพปกกิจกรรม
                const coverImgEl = document.getElementById('eventCover');
                if (coverImgEl) {
                    const imageUrl = absoluteNearestLoc.image_url; 
                    if (imageUrl) {
                        coverImgEl.src = imageUrl;
                        coverImgEl.style.display = 'block';
                    } else {
                        coverImgEl.style.display = 'none'; 
                    }
                }
                
                // อัปเดตสถานะเวลาจัดแสดง
                const statusEl = document.getElementById('eventStatus');
                if (statusEl) {
                    const statusText = getExhibitionStatus(absoluteNearestLoc);
                    if (statusText) {
                        // เปลี่ยนสีข้อความตามสถานะ
                        if (statusText.includes('🟢')) {
                            statusEl.style.color = '#a5d6a7'; // สีเขียว
                            statusEl.style.border = '1px solid #4caf50';
                        } else if (statusText.includes('🔴') || statusText.includes('⛔')) {
                            statusEl.style.color = '#ffab91'; // สีแดง/ส้ม
                            statusEl.style.border = '1px solid #ff5722';
                        } else {
                            statusEl.style.color = '#fff';
                            statusEl.style.border = '1px solid #aaa';
                        }
                        
                        statusEl.innerText = statusText;
                        statusEl.style.display = 'block';
                    } else {
                        statusEl.style.display = 'none'; 
                    }
                }

            } else {
                // กรณีเดินครบทุกจุดกิจกรรมในระบบแล้ว
                if (compassWrap) compassWrap.classList.remove('active');
                
                const nameEl = document.getElementById('targetName');
                if (nameEl) nameEl.innerText = "🎉 สำรวจครบทุกจุดแล้ว!";
                
                const distEl = document.getElementById('distanceValue');
                if (distEl) distEl.innerText = "-";

                const coverImgEl = document.getElementById('eventCover');
                if (coverImgEl) coverImgEl.style.display = 'none';
                
                const statusEl = document.getElementById('eventStatus');
                if (statusEl) statusEl.style.display = 'none';
            }

            // จัดการเงื่อนไขเมื่อเดินเข้ามาในระยะรัศมี 50 เมตร
            if (closestLocation) {
                activeCheckInLocation = closestLocation;
                const checkInBtn = document.getElementById('checkInBtn');
                
                if (checkInBtn && !isCheckingIn) {
                    checkInBtn.classList.add('active');
                    const locName = closestLocation.name_th || closestLocation.name || closestLocation.title_th || "จุดกิจกรรม";
                    
                    const targetText = `✅ กดเพื่อเช็คอินที่: ${locName}`;
                    if (checkInBtn.innerText !== targetText) {
                        checkInBtn.innerText = targetText;
                        checkInBtn.disabled = false;
                    }
                }

                // สั่งการกระพริบหน้าจอสีเขียวและแสดงข้อมูลเสียงพูดเมื่อเข้าพิกัดครั้งแรก
                if (!announcedPlaces.has(closestLocation.id)) {
                    announcedPlaces.add(closestLocation.id); 

                    window.speechSynthesis.cancel(); 
                    
                    document.body.classList.add('found-location');
                    document.getElementById('main-container').classList.add('found-location');
                    
                    setTimeout(() => {
                        document.body.classList.remove('found-location');
                        document.getElementById('main-container').classList.remove('found-location');
                    }, 1500);
                    
                    speak(closestLocation.info_th, 'th-TH');
                    speak(closestLocation.info_en, 'en-US');
                    speak(closestLocation.info_cn, 'zh-CN');
                }
            } else {
                activeCheckInLocation = null;
                const checkInBtn = document.getElementById('checkInBtn');
                if (checkInBtn && !isCheckingIn) {
                    checkInBtn.classList.remove('active');
                }
            }
        },
        (error) => {
            document.getElementById('status').innerText = "โปรดอนุญาตและเปิดระบบระบุตำแหน่ง GPS";
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
}

// บันทึกรายงานการเช็คอินพิกัดสถานที่ลงในระบบ Firebase
document.getElementById('checkInBtn').addEventListener('click', async () => {
    if (!activeCheckInLocation || isCheckingIn) return;
    
    isCheckingIn = true;
    const checkInBtn = document.getElementById('checkInBtn');
    checkInBtn.disabled = true;
    checkInBtn.innerText = "⏳ กำลังบันทึกการเช็คอิน...";

    const locId = activeCheckInLocation.id;
    const locName = activeCheckInLocation.name_th || activeCheckInLocation.name || activeCheckInLocation.title_th || "ไม่ระบุชื่อ";

    try {
        await addDoc(collection(db, "checkins"), {
            session_id: sessionDocRef ? sessionDocRef.id : "anonymous_session",
            location_id: locId,
            location_name: locName,
            timestamp: new Date().toISOString(),
            checkin_lat: currentLat,
            checkin_lng: currentLng
        });

        checkedInPlaces.add(locId);
        
        const visitedEl = document.getElementById('visitedCount');
        if(visitedEl) visitedEl.innerText = checkedInPlaces.size;

        checkInBtn.innerText = "🎉 เช็คอินสำเร็จ!";
        
        setTimeout(() => {
            checkInBtn.classList.remove('active');
            isCheckingIn = false;
        }, 1500);
        
    } catch (error) {
        console.error("Firebase Store Checkin Error: ", error);
        checkInBtn.innerText = "❌ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
        checkInBtn.disabled = false;
        isCheckingIn = false;
    }
});

// เริ่มทำงานเมื่อกดปุ่ม "เริ่มต้นนำทาง"
document.getElementById('startBtn').addEventListener('click', async () => {
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('compassWrap')?.classList.add('active');
    document.getElementById('radarWrap')?.classList.add('active');
    document.getElementById('distanceDisplay')?.classList.add('active');
    document.getElementById('progressWrap')?.classList.add('active');

    function handleOrientation(event) {
        let heading = event.webkitCompassHeading || Math.abs(event.alpha - 360);
        if (heading) {
            currentHeading = heading;
            updateArrow();
        }
    }

    try {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            const permissionState = await DeviceOrientationEvent.requestPermission();
            if (permissionState === 'granted') {
                window.addEventListener('deviceorientation', handleOrientation);
            }
        } else {
            window.addEventListener('deviceorientationabsolute', handleOrientation) || 
            window.addEventListener('deviceorientation', handleOrientation);
        }
    } catch (error) {
        console.warn("ไม่สามารถตรวจจับฮาร์ดแวร์เข็มทิศได้");
    }

    startTracking();
});

fetchLocations();
