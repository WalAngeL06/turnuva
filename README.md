# Masa Tenisi Turnuvası

Masa tenisi turnuvası için tek eleme tablosu uygulaması: **erkekler 128 kişilik**, **kadınlar 16 kişilik**,
ikisinde de 3.lük maçı var. Python (sadece standart kütüphane) yerel bir sunucu açar, arayüz tarayıcıda çalışır.

## Çalıştırma

`Turnuva.command` dosyasına çift tıkla ya da:

```bash
python3 turnuva.py
```

Tarayıcıda `http://127.0.0.1:8765` açılır. Kapatmak için Terminal'de `Ctrl+C`.

## Kullanım

- Soldaki **Erkekler / Kadınlar** sekmesi hangi tablonun açık olduğunu belirler.
- İsme tıklayınca kazanan bir üst tura geçer; skor kutularına yazılan skordan da kazanan seçilir.
- 1. turda oyuncuları sürükleyerek ya da numara kutusuna tıklayıp yer değiştirebilirsin.
- **Kaydet** (⌘S) iki tabloyu birlikte `kayit.json` dosyasına yazar. İlk kayıttan sonra uygulama her açılışta
  bu dosyayı yükler, rastgele kura çekmez.
- Sağ üstteki mavi düğme: tabloyu PNG olarak indirme ve WhatsApp için eşleşme listesi.

## Dosyalar

| Dosya | Açıklama |
| --- | --- |
| `turnuva.py` | Sunucu, kayıt/yedek, kura, CSV okuma ve isimden cinsiyet tahmini |
| `web/logic.js` | Tablo mantığı (kazananlar, BAY, 3.lük maçı); arayüzden bağımsız |
| `web/app.js`, `web/index.html`, `web/style.css` | Arayüz |
| `kayit.json` | Turnuva verisi (**depoda yok**: telefon numaraları içerir) |
| `../temiz_liste.csv` | Katılımcı listesi; ilk açılışta ve "CSV'den yeni kişileri al" ile okunur (**depoda yok**) |

Her kayıtta önceki hali `~/Desktop/turnuva_yedekler/` klasörüne yedeklenir (son 50 yedek tutulur;
`TURNUVA_YEDEK_DIR` ortam değişkeniyle değiştirilebilir).
