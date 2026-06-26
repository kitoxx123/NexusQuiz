const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// GÜNCELLENMİŞ ÇOKLU TEST HAVUZU
const testPaketleri = {
    arabalar: [
        { text: "Logosunda şahlanan at bulunan, ünlü İtalyan spor otomobil markası hangisidir?", options: ["Porsche", "Ferrari", "Lamborghini", "Maserati"], correct: 1 },
        { text: "Forza Horizon serisinin 4. oyunu hangi ülkede geçmektedir?", options: ["Meksika", "Avustralya", "Büyük Britanya", "İtalya"], correct: 2 },
        { text: "Özellikle modifiye kültürüyle efsaneleşen Nissan serisi hangisidir?", options: ["Supra", "Skyline GT-R", "Lancer Evolution", "RX-7"], correct: 1 }
    ],
    ders: [
        { text: "2+1 kaçtır?", options: ["1", "2", "3", "4"], correct: 2 }
    ],
    oyun: [
        { text: "pubg de havadan atılan yardım paketine ne denir", options: ["1", "airDrop", "havayastığı", "philips"], correct: 0 },
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
        { text: "Kedilerin anatomisini, genetiğini ve davranışlarını inceleyen bilim dalına ne ad verilir?", options: ["Sitoloji", "Zooloji", "Felinoloji", "Ornitoloji"], correct: 2 },
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
        if (oda.durum !== 'bekliyor') return socket.emit('hata', 'Bu odada oyun zaten başlamış!');

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
        const soruData = { text: mevcutSoru.text, options: mevcutSoru.options };
        io.to(odaKodu).emit('yeni-soru', { soru: soruData, soruNo: oda.aktifSoruIndex + 1, sure: SORU_SURESI });

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

    socket.on('oyunu-baslat', (odaKodu) => {
        soruGonder(odaKodu);
    });

    socket.on('cevap-ver', (data) => {
        const { odaKodu, secilenIndex, gecenSureOrani } = data;
        const oda = odalar[odaKodu];
        
        if (!oda || oda.cevapVerenler.has(socket.id)) return;
        oda.cevapVerenler.add(socket.id);

        const mevcutSoru = oda.odaSoruları[oda.aktifSoruIndex];
        
        if (secilenIndex === mevcutSoru.correct) {
            let kazanilanPuan = Math.round(500 + (500 * gecenSureOrani));
            let oyuncu = oda.oyuncular.find(p => p.id === socket.id);
            if (oyuncu) oyuncu.score += kazanilanPuan;
        }

        if (oda.cevapVerenler.size >= oda.oyuncular.length) {
            clearInterval(oda.timer);
            io.to(odaKodu).emit('skor-guncelle', oda.oyuncular);
            oda.aktifSoruIndex++;
        }
    });

    socket.on('sonraki-soru', (odaKodu) => {
        soruGonder(odaKodu);
    });
});

// ==========================================
// YÖNETİCİ PANELİ VE GÜVENLİK AYARLARI
// ==========================================

const ADMIN_USERNAME = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASS || "Nexus123!";

function adminSecured(req, res, next) {
    const auth = { login: ADMIN_USERNAME, password: ADMIN_PASSWORD };
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    if (login && password && login === auth.login && password === auth.password) {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="Admin Paneli Girişi"');
    return res.status(401).send('Giriş reddedildi. Yönetici bilgileri gerekli.');
}

app.get('/admin', adminSecured, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Sunucuyu Başlatma
const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda aktif.`);
});