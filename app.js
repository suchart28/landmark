// ใช้ ID จาก URL ของ Google Sheet ที่คุณให้มา
const SHEET_ID = '1W2Yj2aR6dsv0GHOIYwIPA-B9d9RAN9jOgKoDAXkbb70'; 
// แปลงเป็นลิงก์ Export CSV เพื่อให้ดึงด้วย JavaScript ได้ตรงๆ
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

let locations = [];
let announcedPlaces = new Set(); // เก็บ ID สถานที่ที่อ่านไปแล้ว จะได้ไม่อ่านซ้ำ
let watchId = null;

// 1. ดึงข้อมูลจาก Google Sheet
function fetchLocations() {
    Papa.parse(CSV_URL, {
        download: true,
        header: true,
        complete: function(results) {
            locations = results.data.filter(loc => loc.lat && loc.lng); // กรองบรรทัดที่ว่างทิ้ง
            document.getElementById('status').innerText = `โหลดข้อมูลสำเร็จ ${locations.length} สถานที่`;
        },
        error: function(err) {
            document.getElementById('status').innerText = 'เกิดข้อผิดพลาดในการโหลดข้อมูล';
        }
    });
}

// 2. คำนวณระยะทางระหว่างพิกัด 2 จุด (Haversine formula) ผลลัพธ์เป็นเมตร
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // รัศมีโลกเป็นเมตร
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

// 3. ฟังก์ชันอ่านออกเสียง (Web Speech API)
function speak(text, lang) {
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    // ปรับความเร็วหรือระดับเสียงได้
    utterance.rate = 0.9; 
    window.speechSynthesis.speak(utterance);
}

// 4. เริ่มระบบติดตาม GPS
function startTracking() {
    if (!navigator.geolocation) {
        alert("เบราว์เซอร์ของคุณไม่รองรับ GPS");
        return;
    }

    document.getElementById('status').innerText = "กำลังค้นหาตำแหน่งของคุณ...";

    // เพื่อเป็นการปลดล็อค Audio API ของ Browser ให้สร้างเสียงเงียบๆ ขึ้นมาก่อน 1 ครั้ง
    speak(" ", "th-TH");

    watchId = navigator.geolocation.watchPosition(
        (position) => {
            const userLat = position.coords.latitude;
            const userLng = position.coords.longitude;
            
            document.getElementById('status').innerHTML = `พิกัดปัจจุบัน:<br>Lat: ${userLat.toFixed(5)}, Lng: ${userLng.toFixed(5)}`;

            // ตรวจสอบทุกสถานที่
            locations.forEach(loc => {
                const distance = getDistance(userLat, userLng, parseFloat(loc.lat), parseFloat(loc.lng));
                
                // หากอยู่ในระยะ 500 เมตร และยังไม่ได้อ่านออกเสียง
                if (distance <= 500 && !announcedPlaces.has(loc.id)) {
                    announcedPlaces.add(loc.id); // บันทึกว่าอ่านแล้ว
                    
                    // สั่งให้อ่าน 3 ภาษา (ระบบจะทำการเข้าคิว (Queue) อ่านต่อกันอัตโนมัติ)
                    speak(loc.info_th, 'th-TH'); // ไทย
                    speak(loc.info_en, 'en-US'); // อังกฤษ
                    speak(loc.info_cn, 'zh-CN'); // จีน
                }
                
                // ถ้าระยะห่างเกิน 1000 เมตร ให้รีเซ็ตสถานะ เพื่อให้สามารถวนกลับมาอ่านใหม่ได้หากเดินกลับมา
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

// ผูก Event ปุ่มเริ่มต้น
document.getElementById('startBtn').addEventListener('click', () => {
    document.getElementById('startBtn').style.display = 'none';
    startTracking();
});

// โหลดข้อมูลทันทีที่เปิดเว็บ
fetchLocations();