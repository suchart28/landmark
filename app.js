const SHEET_ID = '1W2Yj2aR6dsv0GHOIYwIPA-B9d9RAN9jOgKoDAXkbb70'; 
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let locations = [];
let announcedPlaces = new Set();
let watchId = null;

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
            document.getElementById('status').innerText = 'เกิดข้อผิดพลาดในการโหลดข้อมูล โปรดตรวจสอบสิทธิ์การเข้าถึงไฟล์';
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

// 4. เริ่มระบบพิกัด
function startTracking() {
    if (!navigator.geolocation) {
        alert("เบราว์เซอร์ของคุณไม่รองรับ GPS");
        return;
    }

    document.getElementById('status').innerText = "กำลังค้นหาตำแหน่งของคุณ...";
    
    // ปลดล็อค Audio ใน Browser
    speak(" ", "th-TH");

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            
            document.getElementById('status').innerHTML = `พิกัดปัจจุบัน:<br>Lat: ${userLat.toFixed(5)}<br>Lng: ${userLng.toFixed(5)}`;

            locations.forEach(loc => {
                const distance = getDistance(userLat, userLng, parseFloat(loc.lat), parseFloat(loc.lng));
                
                // ถ้าระยะไม่เกิน 500m และยังไม่ได้อ่าน
                if (distance <= 500 && !announcedPlaces.has(loc.id)) {
                    announcedPlaces.add(loc.id); 
                    
                    speak(loc.info_th, 'th-TH');
                    speak(loc.info_en, 'en-US');
                    speak(loc.info_cn, 'zh-CN');
                }
                
                // ถ้าระยะเกิน 1000m ให้ลบออกจากประวัติ เพื่อให้กลับมาอ่านซ้ำได้
                if (distance > 1000 && announcedPlaces.has(loc.id)) {
                    announcedPlaces.delete(loc.id);
                }
            });
        },
        (error) => {
            document.getElementById('status').innerText = "ไม่สามารถหาตำแหน่งได้ กรุณาเปิด GPS";
        },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );
}

document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startBtn').style.display = 'none';
    startTracking();
});

fetchLocations();
