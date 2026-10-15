# 🏓 Masa Tenisi Turnuva Portalı & Canlı Fikstür

Üniversite Masa Tenisi Topluluğu için geliştirilmiş; **Erkekler 128 kişilik** ve **Kadınlar 16 kişilik** tek eleme (+ 3.lük maçı) turnuva yönetim ve canlı takip platformu.

Sistem hem **GitHub Pages** üzerinde 7/24 ücretsiz, kesintisiz ve sunucusuz olarak yayınlanır; hem de istenirse yerel Python sunucusu (`turnuva.py`) ile çalıştırılabilir.

---

## 🌐 1. Canlı Yayın (GitHub Pages)

Sitenin GitHub Pages üzerinde yayına girmesi için:
1. GitHub reponuzda **Settings (Ayarlar) → Pages** menüsüne gidin.
2. **Build and deployment** altında:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` / `master` — Klasör: `/ (root)` seçip **Save** butonuna tıklayın.
3. 1-2 dakika içinde siteniz `https://faruk-ortakoyluoglu.github.io/turnuva/` adresinde canlıya geçer!

Oyuncular ve seyirciler sayfayı yenilemelerine gerek kalmadan **20 saniyede bir otomatik canlı tazelemeyle (polling)** skorları ve masaları ceplerinden takip edebilir.

---

## 🔒 2. Yönetim Modu (Admin Panel - Doğrudan Web Üzerinden!)

Komite üyeleri (Faruk Başkan, Serdar, Arda vb.) turnuva değişikliklerini doğrudan site üzerinden yapar:
1. Sitenin sağ üstündeki **🔒 Yönetim** butonuna tıklayın.
2. Komite PIN kodunu girin: **`1923`**
3. Yönetici Modu aktifleştiğinde:
   - **⚡ Maç Düzenleme:** Her maç kartındaki "Düzenle" butonundan saat (`14:30`), masa (`Masa 1`), set skorları (`3 - 1`) anında girilir.
   - **🚫 Hükmen Galip / BAY Geçirme:** Bir oyuncu rahatsızlandığında veya gelemediğinde tek tıkla rakibi hükmen galip yapılır ve turnuva ağacında otomatik olarak bir üst tura taşınır.
   - **⏳ Maç Erteleme:** Maç durumu tek tıkla "Ertelendi" yapılır.
   - **📢 Canlı Duyuru Yayınlama:** Üst bardaki "Duyuru Yaz" ile sitenin tepesindeki anons bandına canlı mesaj basılır.
   - **📱 WhatsApp Eşleşme Metni:** Tur seçilerek tek tıkla formatlı ve emojili WhatsApp mesajı kopyalanır.
   - **🚀 Sıfır Buton Canlı Bulut Senkronizasyonu & Kalıcı Kayıt:** 
     - **⚡ Sıfır Buton Canlı Akış:** Yapılan her dokunuş (kart tıklama, saat, masa vb.) 0.5 saniyede salondaki tüm telefonlara otomatik olarak canlı akar; butona basmaya veya token girmeye gerek yoktur.
     - **GitHub API (İsteğe Bağlı):** Turnuva sonunda repoya kalıcı snapshot commit'i atmak için kullanılabilir.
     - **JSON İndir / Yükle:** Çevrimdışı yedekleme için JSON indirilebilir ve yüklenebilir.

---

## 🛡️ 3. KVKK & Kişisel Veri Güvenliği

Faruk Başkan'ın da belirttiği güvenlik hassasiyetine istinaden:
* Public repodaki `data/turnuva_public.json` dosyasında **asla** telefon numarası, öğrenci numarası veya özel kişisel veriler tutulmaz; sadece oyuncu Adı-Soyadı ve maç sonuçları yer alır.
* Özel katılımcı listeleri (`temiz_liste.csv`, `kayit.json`) `.gitignore` tarafından otomatik olarak korunur ve depoya aktarılmaz.

---

## 💻 4. Yerel Olarak Çalıştırma (Python)

İstenirse yerel bilgisayarda Python standart kütüphanesiyle de çalıştırılabilir:

```bash
# Windows
py turnuva.py

# macOS / Linux
python3 turnuva.py
```

Tarayıcıda otomatik olarak `http://127.0.0.1:8765` açılır.

---

## 📁 Dosya Yapısı

| Dosya / Klasör | Açıklama |
| --- | --- |
| `index.html` | GitHub Pages ana canlı arayüzü (Modern Tailwind CSS, karanlık mod, responsive) |
| `data/turnuva_public.json` | Herkese açık, KVKK uyumlu canlı turnuva ve fikstür verisi |
| `web/logic.js` | Turnuva ağacı motoru (128 Erkekler, 16 Kadınlar, 3.lük maçı hesaplamaları) |
| `web/sync.js` | Sıfır buton gerçek zamanlı bulut senkronizasyon motoru (MQTT WebSocket & PIN doğrulama) |
| `turnuva.py` | Yerel Python HTTP sunucusu ve yedekleme sistemi |
| `Turnuva.command` | macOS için çift tıkla çalıştırma betiği |
