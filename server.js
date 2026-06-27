const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const AYAR_DOSYASI = path.join(__dirname, 'ayarlar.json');

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

if (fs.existsSync(AYAR_DOSYASI)) {
    try { siteAyarlari = JSON.parse(fs.readFileSync(AYAR_DOSYASI, 'utf8')); } 
    catch (err) { console.log("Ayar okuma hatası, varsayılanlar devrede."); }
}

function verileriKaydet() {
    try { fs.writeFileSync(AYAR_DOSYASI, JSON.stringify(siteAyarlari, null, 2), 'utf8'); } 
    catch (err) { console.log("Dosya kayıt hatası:", err); }
}

const testPaketleri = {
    arabalar: [
        { text: "Logosunda şahlanan at bulunan, ünlü İtalyan spor otomobil markası hangisidir?", options: ["Porsche", "Ferrari", "Lamborghini", "Maserati"], correct: 1 },
        { text: "Forza Horizon serisinin 4. oyunu hangi ülkede geçmektedir?", options: ["Meksika", "Avustralya", "Büyük Britanya", "İtalya"], correct: 2 }
    ],
    ders: [ { text: "2+1 kaçtır?", options: ["1", "2", "3", "4"], correct: 2 } ],
    oyun: [
        { text: "Counter-Strike 2'de sis bombası (Smoke) yaklaşık kaç saniye boyunca aktif kalır?", options: ["9", "12", "15", "18"], correct: 2 },
        { text: "Detroit: Become Human oyununda polis için çalışan android kimdir?", options: ["Markus", "Kara", "Simon", "Connor"], correct: 3 }
    ]
};

let odalar = {};
const SORU_SURESI = 15; 

io.on('connection', (socket) => {
    
    // ODA KURMA (İlk kuran HOST olur)
    socket.on('oda-olustur', (data) => {
        const { username, secilenTest } = data;
        const odaKodu = Math.floor(1000 + Math.random() * 9000).toString();
        const sorular = testPaketleri[secilenTest] || [{text:"Soru yok!", options:["A","B","C","D"], correct:0}];

        odalar[odaKodu] = { 
            hostId: socket.id, // KURUCU KİMLİĞİ
            oyuncular: [], 
            aktifSoruIndex: 0, 
            cevapVerenler: new Set(),
            durum: 'bekliyor',
            timer: null,
            odaSoruları: sorular 
        };
        
        socket.join(odaKodu);
        // Yeni oyuncu modeli: streak (seri) ve sonKazanilan eklendi
        odalar[odaKodu].oyuncular.push({ id: socket.id, name: username, score: 0, streak: 0, sonKazanilan: 0, sonCevapDogruMu: false });
        
        // Sadece kurucuya 'sen hostsun' bilgisini gönderiyoruz
        socket.emit('oda-olusturuldu', { odaKodu, oyuncular: odalar[odaKodu].oyuncular, testAdi: secilenTest, isHost: true });
    });

    // ODAYA KATILMA
    socket.on('oda-katil', (data) => {
        const { odaKodu, username } = data;
        const oda = odalar[odaKodu];
        if (!oda) return socket.emit('hata', 'Böyle bir oda bulunamadı!');
        
        socket.join(odaKodu);
        oda.oyuncular.push({ id: socket.id, name: username, score: 0, streak: 0, sonKazanilan: 0, sonCevapDogruMu: false });
        
        // Katılana 'sen host DEĞİLSİN' diyoruz
        socket.emit('oda-olusturuldu', { odaKodu, oyuncular: oda.oyuncular, testAdi: "Özel", isHost: false });
        io.to(odaKodu).emit('oyuncu-listesi', oda.oyuncular);
    });

    function soruyuBitir(odaKodu) {
        const oda = odalar[odaKodu];
        if (!oda) return;
        clearInterval(oda.timer);
        oda.durum = 'geribildirim';
        
        const mevcutSoru = oda.odaSoruları[oda.aktifSoruIndex];
        
        // Herkese doğru cevabı ve güncel puanları gönder
        io.to(odaKodu).emit('soru-bitti', { 
            dogruCevapIndex: mevcutSoru.correct, 
            oyuncular: oda.oyuncular,
            isLastQuestion: oda.aktifSoruIndex === oda.odaSoruları.length - 1
        });
        
        oda.aktifSoruIndex++;
    }

    function soruGonder(odaKodu) {
        const oda = odalar[odaKodu];
        if (!oda) return;
        oda.durum = 'oyunda';
        oda.cevapVerenler.clear();
        
        // Tüm oyuncuların son el verilerini sıfırla (Cevap vermeyenler için)
        oda.oyuncular.forEach(p => { p.sonKazanilan = 0; p.sonCevapDogruMu = false; });

        if (oda.aktifSoruIndex >= oda.odaSoruları.length) {
            oda.oyuncular.sort((a,b) => b.score - a.score);
            io.to(odaKodu).emit('oyun-bitti', oda.oyuncular);
            delete odalar[odaKodu];
            return;
        }

        const mevcutSoru = oda.odaSoruları[oda.aktifSoruIndex];
        io.to(odaKodu).emit('yeni-soru', { 
            soru: { text: mevcutSoru.text, options: mevcutSoru.options }, 
            soruNo: oda.aktifSoruIndex + 1, 
            toplamSoru: oda.odaSoruları.length,
            sure: SORU_SURESI 
        });

        let kalanSure = SORU_SURESI * 10; 
        clearInterval(oda.timer);
        oda.timer = setInterval(() => {
            kalanSure--;
            io.to(odaKodu).emit('sure-guncelle', kalanSure);
            if (kalanSure <= 0) soruyuBitir(odaKodu);
        }, 100);
    }

    socket.on('oyunu-baslat', (odaKodu) => { soruGonder(odaKodu); });
    socket.on('sonraki-soru', (odaKodu) => { soruGonder(odaKodu); });

    socket.on('cevap-ver', (data) => {
        const { odaKodu, secilenIndex, gecenSureOrani } = data;
        const oda = odalar[odaKodu];
        if (!oda || oda.cevapVerenler.has(socket.id)) return;
        
        oda.cevapVerenler.add(socket.id);
        const mevcutSoru = oda.odaSoruları[oda.aktifSoruIndex];
        let oyuncu = oda.oyuncular.find(p => p.id === socket.id);
        
        if (oyuncu) {
            if (secilenIndex === mevcutSoru.correct) {
                // KOMBO SİSTEMİ EKLENDİ
                oyuncu.streak += 1;
                let komboBonusu = oyuncu.streak >= 3 ? 200 : (oyuncu.streak > 1 ? 100 : 0);
                let kazanilanPuan = Math.round(500 + (500 * gecenSureOrani)) + komboBonusu;
                
                oyuncu.score += kazanilanPuan;
                oyuncu.sonKazanilan = kazanilanPuan;
                oyuncu.sonCevapDogruMu = true;
            } else {
                oyuncu.streak = 0; // Yanlış bilince kombo sıfırlanır
                oyuncu.sonKazanilan = 0;
                oyuncu.sonCevapDogruMu = false;
            }
        }

        if (oda.cevapVerenler.size >= oda.oyuncular.length) {
            soruyuBitir(odaKodu);
        }
    });
});

// GÜVENLİ API YOLLARI
const ADMIN_USERNAME = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "Nexus123!";
function adminSecured(req, res, next) {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    if (login === ADMIN_USERNAME && password === ADMIN_PASSWORD) return next();
    res.header('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Giriş gerekli.');
}
app.get('/admin', adminSecured, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('/api/ayarlar', (req, res) => { res.json(siteAyarlari); });
app.post('/api/ayarlar', adminSecured, (req, res) => {
    const { isim, motif, renk, yeniKategori } = req.body;
    if (isim) siteAyarlari.isim = isim;
    if (motif) siteAyarlari.motif = motif;
    if (renk) siteAyarlari.renk = renk;
    if (yeniKategori && yeniKategori.trim() !== "") {
        const yeniId = yeniKategori.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!siteAyarlari.kategoriler.find(k => k.id === yeniId)) siteAyarlari.kategoriler.push({ id: yeniId, name: yeniKategori });
    }
    verileriKaydet();
    res.json({ status: "success", message: "Kaydedildi!" });
});
app.post('/api/soru-ekle', adminSecured, (req, res) => {
    const { kategori, text, options, correct } = req.body;
    if (!testPaketleri[kategori]) testPaketleri[kategori] = [];
    testPaketleri[kategori].push({ text, options, correct: parseInt(correct) });
    res.json({ status: "success", message: "Eklendi!" });
});

const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda aktif.`); });
