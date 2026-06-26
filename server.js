const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs'); // Kalıcı dosya kaydı için gerekli kütüphane

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Kalıcı veri dosyasının yolu
const AYAR_DOSYASI = path.join(__dirname, 'ayarlar.json');

// VAYSAYILAN DEPO (Eğer dosya yoksa ilk açılışta bu yüklenecek)
let siteAyarlari = {
    isim: "NexusQuiz",
    motif: "grid",
    renk: "#0b0c10",
    kategoriler: [
        { id: "oyun", name: "Oyun Kültürü" },
        { id: "bilim", name: "Bilim ve Mühendislik" },
        { id: "arabalar", name: "Otomobil ve Hız" },
        { id: "kediler", name: "Felinoloji (Kediler)" },
        { id: "muzik", name: "Ağır Metal" }
    ]
};

// Sunucu açılırken eski kayıtlı verileri dosyadan oku
if (fs.existsSync(AYAR_DOSYASI)) {
    try {
        const data = fs.readFileSync(AYAR_DOSYASI, 'utf8');
        siteAyarlari = JSON.parse(data);
        console.log("Kayıtlı site ayarları başarıyla yüklendi.");
    } catch (err) {
        console.log("Ayar dosyası okunurken hata oluştu, varsayılanlar yükleniyor.");
    }
}

// Verileri dosyaya kalıcı kaydeden fonksiyon
function verileriKaydet() {
    try {
        fs.writeFileSync(AYAR_DOSYASI, JSON.stringify(siteAyarlari, null, 2), 'utf8');
    } catch (err) {
        console.log("Dosya kaydedilirken hata oluştu:", err);
    }
}

const testPaketleri = {
    arabalar: [
        { text: "Logosunda şahlanan at bulunan, ünlü İtalyan spor otomobil markası hangisidir?", options: ["Porsche", "Ferrari", "Lamborghini", "Maserati"], correct: 1 },
        { text: "Forza Horizon serisinin 4. oyunu hangi ülkede geçmektedir?", options: ["Meksika", "Avustralya", "Büyük Britanya", "İtalya"], correct: 2 }
    ],
    ders: [
        { text: "2+1 kaçtır?", options: ["1", "2", "3", "4"], correct: 2 }
    ],
    oyun: [
        { text: "pubg de havadan atılan yardım paketine ne denir", options: ["1", "airDrop", "havayastığı", "philips"], correct: 0 },
        { text: "Counter-Strike 2'de sis bombası (Smoke) yaklaşık kaç saniye boyunca aktif kalır?", options: ["9", "12", "15", "18"], correct: 2 }
    ]
};

let odalar = {};
const SORU_SURESI = 15; 

io.on('connection', (socket) => {
    socket.on('oda-olustur', (data) => {
        const { username, secilenTest } = data;
        const odaKodu = Math.floor(1000 + Math.random() * 9000).toString();
        const sorular = testPaketleri[secilenTest] || [{text:"Bu kategoriye henüz soru eklenmedi!", options:["A","B","C","D"], correct:0}];

        odalar[odaKodu] = { 
            oyuncular: [], 
            aktifSoruIndex: 0, 
            cevapVerenler: new Set(),
            durum: 'bekliyor',
            timer: null,
            odaSoruları: sorular 
        };
        
        socket.join(odaKodu);
        odalar[odaKodu].oyuncular.push({ id: socket.id, name: username, score: 0 });
        socket.emit('oda-olusturuldu', { odaKodu, oyuncular: odalar[odaKodu].oyuncular, testAdi: secilenTest });
    });

    socket.on('oda-katil', (data) => {
        const { odaKodu, username } = data;
        const oda = odalar[odaKodu];
        if (!oda) return socket.emit('hata', 'Böyle bir oda bulunamadı!');
        socket.join(odaKodu);
        oda.oyuncular.push({ id: socket.id, name: username, score: 0 });
        io.to(odaKodu).emit('oyuncu-listesi', oda.oyuncular);
    });

    function soruGonder(odaKodu) {
        const oda = odalar[odaKodu];
        if (!oda) return;
        oda.durum = 'oyunda';
        oda.cevapVerenler.clear();
        if (oda.aktifSoruIndex >= oda.odaSoruları.length) {
            oda.oyuncular.sort((a,b) => b.score - a.score);
            io.to(odaKodu).emit('oyun-bitti', oda.oyuncular);
            delete odalar[odaKodu];
            return;
        }
        const mevcutSoru = oda.odaSoruları[oda.aktifSoruIndex];
        io.to(odaKodu).emit('yeni-soru', { soru: { text: mevcutSoru.text, options: mevcutSoru.options }, soruNo: oda.aktifSoruIndex + 1, sure: SORU_SURESI });
        let kalanSure = SORU_SURESI * 10; 
        clearInterval(oda.timer);
        oda.timer = setInterval(() => {
            kalanSure--;
            io.to(odaKodu).emit('sure-guncelle', kalanSure);
            if (kalanSure <= 0) {
                clearInterval(oda.timer);
                io.to(odaKodu).emit('skor-guncelle', oda.oyuncular);
                oda.aktifSoruIndex++;
            }
        }, 100);
    }
    socket.on('oyunu-baslat', (odaKodu) => { soruGonder(odaKodu); });
    socket.on('cevap-ver', (data) => {
        const { odaKodu, secilenIndex, gecenSureOrani } = data;
        const oda = odalar[odaKodu];
        if (!oda || oda.cevapVerenler.has(socket.id)) return;
        oda.cevapVerenler.add(socket.id);
        const mevcutSoru = oda.odaSoruları[oda.aktifSoruIndex];
        if (secilenIndex === mevcutSoru.correct) {
            let oyuncu = oda.oyuncular.find(p => p.id === socket.id);
            if (oyuncu) oyuncu.score += Math.round(500 + (500 * gecenSureOrani));
        }
        if (oda.cevapVerenler.size >= oda.oyuncular.length) {
            clearInterval(oda.timer);
            io.to(odaKodu).emit('skor-guncelle', oda.oyuncular);
            oda.aktifSoruIndex++;
        }
    });
    socket.on('sonraki-soru', (odaKodu) => { soruGonder(odaKodu); });
});

// ==========================================
// ŞİFRE KORUMA SİSTEMİ
// ==========================================
const ADMIN_USERNAME = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "Nexus123!";

function adminSecured(req, res, next) {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    if (login === ADMIN_USERNAME && password === ADMIN_PASSWORD) return next();
    res.header('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Giriş gerekli.');
}

// Güvenli Sayfa Yönlendirmesi
app.get('/admin', adminSecured, (req, res) => { 
    res.sendFile(path.join(__dirname, 'public', 'admin.html')); 
});

app.get('/api/ayarlar', (req, res) => { 
    res.json(siteAyarlari); 
});

app.post('/api/ayarlar', adminSecured, (req, res) => {
    const { isim, motif, renk, yeniKategori } = req.body;
    if (isim) siteAyarlari.isim = isim;
    if (motif) siteAyarlari.motif = motif;
    if (renk) siteAyarlari.renk = renk;
    
    if (yeniKategori && yeniKategori.trim() !== "") {
        const yeniId = yeniKategori.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!siteAyarlari.kategoriler.find(k => k.id === yeniId)) {
            siteAyarlari.kategoriler.push({ id: yeniId, name: yeniKategori });
        }
    }
    
    // Değişiklik olunca dosyaya kalıcı olarak yaz
    verileriKaydet();
    res.json({ status: "success", message: "Değişiklikler kalıcı olarak kaydedildi!" });
});

app.post('/api/soru-ekle', adminSecured, (req, res) => {
    const { kategori, text, options, correct } = req.body;
    if (!testPaketleri[kategori]) testPaketleri[kategori] = [];
    testPaketleri[kategori].push({ text, options, correct: parseInt(correct) });
    res.json({ status: "success", message: "Soru havuza eklendi!" });
});

const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda aktif.`); });
