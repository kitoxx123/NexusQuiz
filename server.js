const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// KALICI AYARLAR VE KATEGORİ DEPOSU
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

// EKSİKSİZ SORU HAVUZU
const testPaketleri = {
    arabalar: [
        { text: "Logosunda şahlanan at bulunan, ünlü İtalyan spor otomobil markası hangisidir?", options: ["Porsche", "Ferrari", "Lamborghini", "Maserati"], correct: 1 },
        { text: "Forza Horizon serisinin 4. oyunu hangi ülkede geçmektedir?", options: ["Meksika", "Avustralya", "Büyük Britanya", "İtalya"], correct: 2 },
        { text: "Özellikle modifiye kültürüyle efsaneleşen Nissan serisi hangisidir?", options: ["Supra", "Skyline GT-R", "Lancer Evolution", "RX-7"], correct: 1 }
    ],
    oyun: [
        { text: "PUBG'de havadan atılan yardım paketine ne denir?", options: ["Supply", "AirDrop", "Paraşüt", "LootBox"], correct: 1 },
        { text: "Counter-Strike 2'de sis bombası (Smoke) yaklaşık kaç saniye boyunca aktif kalır?", options: ["9", "12", "15", "18"], correct: 2 },
        { text: "Europa Universalis IV (EU4) ana senaryosu hangi yılda başlar?", options: ["1444", "1453", "1492", "1500"], correct: 0 },
        { text: "Detroit: Become Human oyununda polis departmanı için çalışan androidin adı nedir?", options: ["Markus", "Kara", "Simon", "Connor"], correct: 3 }
    ],
    bilim: [
        { text: "Organik kimyada 'dibromo-sikloheksilbütan' molekülünde kaç adet brom (Br) atomu bulunur?", options: ["1", "2", "3", "4"], correct: 1 },
        { text: "Aşağıdakilerden hangisi bir 'polimer' malzeme örneğidir?", options: ["Cam", "Çelik", "Teflon", "Altın"], correct: 2 },
        { text: "Ekranların saniyedeki güncellenme hızı hangi birimle ifade edilir?", options: ["Fps", "Ping", "Hz", "Dpi"], correct: 2 }
    ],
    kediler: [
        { text: "Kedilerin anatomisini ve genetiğini inceleyen bilim dalına ne ad verilir?", options: ["Sitoloji", "Zooloji", "Felinoloji", "Ornitoloji"], correct: 2 },
        { text: "Yetişkin bir kedinin ortalama kaç dişi vardır?", options: ["24", "30", "32", "42"], correct: 1 }
    ],
    muzik: [
        { text: "Neue Deutsche Härte akımının en bilinen temsilcilerinden olan Alman metal grubu hangisidir?", options: ["Oomph!", "Scorpions", "Rammstein", "Eisbrecher"], correct: 2 },
        { text: "Hangi enstrüman tipik bir heavy metal grubunun demirbaşlarından değildir?", options: ["Elektro Gitar", "Bateri", "Saksafon", "Bas Gitar"], correct: 2 }
    ]
};

let odalar = {};
const SORU_SURESI = 15; 

io.on('connection', (socket) => {
    
    socket.on('oda-olustur', (data) => {
        const { username, secilenTest } = data;
        const odaKodu = Math.floor(1000 + Math.random() * 9000).toString();
        const orjinalSorular = testPaketleri[secilenTest] || [{text:"Bu kategoriye henüz soru eklenmedi!", options:["A","B","C","D"], correct:0}];

        // 1. ADIM: Orijinal havuzu bozmamak için soruların "Derin Kopyasını" alıyoruz
        let odaSorulari = JSON.parse(JSON.stringify(orjinalSorular));

        // 2. ADIM: Soruların Sırasını Karıştır (Fisher-Yates Algoritması)
        for (let i = odaSorulari.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [odaSorulari[i], odaSorulari[j]] = [odaSorulari[j], odaSorulari[i]];
        }

        // 3. ADIM: Her Sorunun Şıklarını Karıştır ve Doğru Cevabı Takip Et
        odaSorulari.forEach(soru => {
            let dogruCevapMetni = soru.options[soru.correct]; // Doğru cevabı hafızaya al
            
            // Şıkları Karıştır
            for (let i = soru.options.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [soru.options[i], soru.options[j]] = [soru.options[j], soru.options[i]];
            }
            
            // Doğru cevabın karıştırıldıktan sonraki yeni index'ini (0,1,2,3) bul ve sisteme kaydet
            soru.correct = soru.options.indexOf(dogruCevapMetni);
        });

        odalar[odaKodu] = { 
            hostId: socket.id,
            oyuncular: [], 
            aktifSoruIndex: 0, 
            cevapVerenler: new Set(),
            durum: 'bekliyor',
            timer: null,
            odaSoruları: odaSorulari // Artık dinamik ve tamamen rastgele soruları kullanıyoruz
        };
        
        socket.join(odaKodu);
        odalar[odaKodu].oyuncular.push({ id: socket.id, name: username, score: 0, streak: 0, sonKazanilan: 0, sonCevapDogruMu: false });
        socket.emit('oda-olusturuldu', { odaKodu, oyuncular: odalar[odaKodu].oyuncular, testAdi: secilenTest, isHost: true });
    });

    socket.on('oda-katil', (data) => {
        const { odaKodu, username } = data;
        const oda = odalar[odaKodu];
        if (!oda) return socket.emit('hata', 'Böyle bir oda bulunamadı!');
        
        socket.join(odaKodu);
        oda.oyuncular.push({ id: socket.id, name: username, score: 0, streak: 0, sonKazanilan: 0, sonCevapDogruMu: false });
        socket.emit('oda-olusturuldu', { odaKodu, oyuncular: oda.oyuncular, testAdi: "Özel", isHost: false });
        io.to(odaKodu).emit('oyuncu-listesi', oda.oyuncular);
    });

    function soruyuBitir(odaKodu) {
        const oda = odalar[odaKodu];
        if (!oda) return;
        clearInterval(oda.timer);
        oda.durum = 'geribildirim';
        const mevcutSoru = oda.odaSoruları[oda.aktifSoruIndex];
        
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
                oyuncu.streak += 1;
                let komboBonusu = oyuncu.streak >= 3 ? 200 : (oyuncu.streak > 1 ? 100 : 0);
                let kazanilanPuan = Math.round(500 + (500 * gecenSureOrani)) + komboBonusu;
                
                oyuncu.score += kazanilanPuan;
                oyuncu.sonKazanilan = kazanilanPuan;
                oyuncu.sonCevapDogruMu = true;
            } else {
                oyuncu.streak = 0; 
                oyuncu.sonKazanilan = 0;
                oyuncu.sonCevapDogruMu = false;
            }
        }

        if (oda.cevapVerenler.size >= oda.oyuncular.length) {
            soruyuBitir(odaKodu);
        }
    });
});

// ADMIN YOLLARI
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
    res.json({ status: "success", message: "Kaydedildi!" });
});

app.post('/api/soru-ekle', adminSecured, (req, res) => {
    const { kategori, text, options, correct } = req.body;
    if (!testPaketleri[kategori]) testPaketleri[kategori] = [];
    testPaketleri[kategori].push({ text, options, correct: parseInt(correct) });
    res.json({ status: "success", message: "Soru havuza eklendi!" });
});

const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => { console.log(`Sunucu ${PORT} portunda aktif.`); });
