#!/usr/bin/env python3
"""Masa tenisi turnuva tablosu: 128 kişilik tek eleme + 3.lük maçı (erkekler).

Çalıştırma:
    python3 turnuva.py            -> tarayıcıda http://127.0.0.1:8765 açılır
    python3 turnuva.py --port 9000 --no-browser

İlk açılışta katılımcılar temiz_liste.csv dosyasından okunur ve erkekler
128'lik tabloya rastgele yerleştirilir (eksik yerler BAY olur). Arayüzde
"Kaydet" denildiği andan itibaren tablo kayit.json dosyasından yüklenir ve
bir daha rastgele kura çekilmez.

Sadece Python standart kütüphanesi kullanılır.
"""

import argparse
import csv
import io
import json
import os
import random
import re
import shutil
import socket
import sys
import threading
import urllib.request
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

BASE = Path(__file__).resolve().parent
WEB = BASE / "web"
KAYIT = BASE / "kayit.json"
# Yedekler proje klasöründe değil, Masaüstünde durur (TURNUVA_YEDEK_DIR ile değiştirilebilir)
YEDEK_DIR = Path(os.environ.get("TURNUVA_YEDEK_DIR") or Path.home() / "Desktop" / "turnuva_yedekler")
ESKI_YEDEK_DIR = BASE / "yedekler"
YEDEK_SAYISI = 50
CSV_ADAYLARI = [BASE / "temiz_liste.csv", BASE.parent / "temiz_liste.csv"]
TABLO_BOYUTU = 128
KADIN_TABLO_BOYUTU = 16
VARSAYILAN_BASLIK = "Masa Tenisi Turnuvası — Erkekler"
KADIN_BASLIK = "Masa Tenisi Turnuvası — Kadınlar"
SURUM = 1

# --------------------------------------------------------------------------
# Cinsiyet tahmini (listede cinsiyet sütunu olmadığı için isimden tahmin)
# --------------------------------------------------------------------------

KADIN_ISIMLERI = set("""
ayşe ayse fatma emine hatice zeynep elif meryem şeyma seyma esra büşra busra merve
ebru ece ezgi eda ela esma esmanur sena selin selen seda sude sudenaz sıla sila
simge sinem sevgi sevda sevil sevim şevval sevval şule şura tuba tuğba tugba tuana
zehra zerrin zeren zübeyde yağmur yaren yasemin yeliz yeşim gamze gizem gül gülay
gülşen gülsüm gülten gonca gökçe gözde hande hilal hira hümeyra ilayda ilknur irem
ipek kübra kubra lale leyla melike melis melisa meltem mine miray nazlı nazli nehir
nesrin nihal nil nilay nilsu nisa nisanur nur nuray nurcan pelin pınar pinar rabia
rümeysa rumeysa saliha sanem selda serap serra sevde sibel songül su sueda sultan
tülay ümran ülkü buse burcu berna beren berfin betül betul beyza bilge burçin cansu
ceren ceyda cemre damla defne derin derya didem dilan dilara dilek duygu dilay ecrin
eylül eylul elçin emel esin feyza figen filiz fatmanur hacer hale havva hazal helin
ilke işıl isil kevser melek mira nazan neslihan nermin oya özge özlem öykü oyku rana
reyhan sema semra serpil sevinç sezen şirin tuğçe tugce tülin yonca zuhal aslı asli
aslıhan aybüke aybuke ayça ayca aylin ayşegül aysegul ayşenur aysenur azra bahar banu
başak basak belgin belinay berra beste buket cennet çağla cagla çiğdem cigdem dicle
dila duru elanur elifnur emine erva esila esin eslem hiranur ilknur kardelen lara
mihrimah naz nazife nergis nesibe nihan nur nurhan nurseli öznur rukiye sare selma
semanur serenay sevgül şebnem şükran tülay tuğçe ümmühan yağmur zara zeliha zümra
asude aleyna alara almila arzu ayten aynur aysel aysu beril berrak bihter cansel
canan ceylin damla deniznur derin dilber dolunay ebrar ecem ecrin elvan esen gülcan
gülnur güler hülya iclal ilksen ilkim inci jale kamile kumru lal mehtap melda melisa
merve meryem müge nagehan necla nesli nilgün nihal nurten pakize perihan rüya sahra
saadet sevinç sinem tülin ulviye vildan yaprak yeter zeynepnur zişan
ada ahu alya asya asel ayla aysun bade bengü berrin beyzanur buğlem cemile ceyla çisem
dilşad elisa elmas esengül eylem fadime feride gülbahar gülizar gülsen hamiyet hanife
havvanur hayriye ikra ılgın kezban lina lütfiye mahinur medine mehlika melahat meral
mina mislina mukaddes münevver nalan nazenin nazlıcan nazmiye nebahat nefise nevin
nilüfer nimet nurdan nurgül nursel nursena pelinsu pembe rahime sabiha safiye saniye
sebahat sedef seher selcan selvi semiha seren sevilay sıdıka simay solmaz sudenur
şaziye şenay şerife şükriye türkan yıldız yüsra zekiye zerda zehranur zühal
""".split())

# İki cinsiyette de kullanılan isimler: varsayılan tahmin + "kontrol et" işareti
IKI_CINSIYETLI = {
    "deniz": "E", "doğa": "K", "umut": "E", "evren": "E", "özgür": "E", "ilgaz": "E",
    "seha": "E", "kayra": "E", "ilkay": "K", "aydan": "K", "derin": "K", "nur": "K",
    "çağ": "E", "ilgın": "K", "yüksel": "E", "sevgin": "K", "gökay": "E", "bilge": "K",
    "derya": "K", "ümran": "K", "ülkü": "K", "esen": "K", "elvan": "K", "gökçe": "K",
    "elçin": "K", "ekin": "K", "irmak": "K", "umay": "K", "kader": "K", "sultan": "K",
}


def tr_kucuk(s: str) -> str:
    return s.replace("İ", "i").replace("I", "ı").lower()


_KATLA = str.maketrans("ışğüöçâîû", "isguocaiu")


def katla(s: str) -> str:
    """Karşılaştırma anahtarı: Türkçe harfleri ve büyük/küçük harfi yok sayar
    (ör. 'IREM', 'İrem' ve 'irem' aynı olur)."""
    return s.replace("İ", "i").replace("I", "i").lower().translate(_KATLA)


KADIN_KATLI = {katla(a) for a in KADIN_ISIMLERI}
IKI_KATLI = {katla(a): c for a, c in IKI_CINSIYETLI.items()}


def cinsiyet_tahmin(ad_soyad: str):
    """('E' | 'K', emin_degil_mi) döndürür. Son kelime soyad kabul edilir;
    ilk kesin isim belirler, sonraki isimler çelişirse kontrol işareti konur."""
    kelimeler = [katla(k) for k in re.split(r"\s+", ad_soyad.strip()) if k]
    if not kelimeler:
        return "E", True
    adlar = kelimeler[:-1] if len(kelimeler) > 1 else kelimeler
    sonuc, belirsiz, celiski = None, None, False
    for ad in adlar:
        if ad in IKI_KATLI:
            belirsiz = belirsiz or IKI_KATLI[ad]
            continue
        cins = "K" if ad in KADIN_KATLI else "E"
        if sonuc is None:
            sonuc = cins
        elif cins != sonuc and cins == "K":
            celiski = True
    if sonuc:
        return sonuc, celiski
    return (belirsiz or "E"), True


# --------------------------------------------------------------------------
# Veri
# --------------------------------------------------------------------------

def csv_yolu():
    for yol in CSV_ADAYLARI:
        if yol.exists():
            return yol
    return None


def csv_metni(yol):
    """CSV'yi UTF-8 olarak, olmazsa Excel'in Türkçe kodlamasıyla (cp1254) okur."""
    ham = yol.read_bytes()
    for kod in ("utf-8-sig", "cp1254"):
        try:
            return ham.decode(kod)
        except UnicodeDecodeError:
            continue
    return ham.decode("utf-8", errors="replace")


def ara_baslik_mi(satir, ad):
    """'NUMARASI OLMAYANLAR' gibi bölüm başlıklarını tanır (Excel satırı
    5 sütuna tamamlasa bile)."""
    if len(satir) < 2:
        return True
    if any(h.strip() for h in satir[1:]):
        return False
    return "olmayan" in katla(ad) or (ad == ad.upper() and bool(re.search(r"(LAR|LER)\b", ad)))


def csv_oku():
    """temiz_liste.csv dosyasındaki kişileri sırasıyla döndürür."""
    yol = csv_yolu()
    if yol is None:
        return []
    metin = csv_metni(yol)
    ornek = metin[:4096]
    ayrac = ";" if ornek.count(";") >= ornek.count(",") else ","
    satirlar = list(csv.reader(io.StringIO(metin, newline=""), delimiter=ayrac))
    kisiler, gorulen = [], set()
    for satir in satirlar[1:]:
        if not satir or not satir[0].strip():
            continue
        ad = re.sub(r"\s+", " ", satir[0]).strip()
        if ara_baslik_mi(satir, ad):
            continue
        anahtar = katla(ad)
        if anahtar in gorulen:
            continue
        gorulen.add(anahtar)
        tel = satir[1].strip() if len(satir) > 1 else ""
        if not re.search(r"\d", tel):
            tel = ""
        cins, kontrol = cinsiyet_tahmin(ad)
        kisiler.append({
            "id": f"p{len(kisiler) + 1:03d}",
            "name": ad,
            "phone": tel,
            "gender": cins,
            "check": kontrol,
            "src": anahtar,
        })
    return kisiler


def bay_dagilimi(bay_sayisi, mac_sayisi, rng):
    """Her maçta en fazla bir BAY olacak şekilde BAY'ları tabloya eşit yayar."""
    sayac = [0] * mac_sayisi
    kalan = bay_sayisi
    while kalan > 0:
        tur = min(kalan, mac_sayisi)
        bos = [m for m in range(mac_sayisi) if sayac[m] < 2]
        tur = min(tur, len(bos))
        if tur == 0:
            break
        # Uygun maçları "tur" kadar eşit bölüme ayır, her bölümden rastgele bir maç
        for i in range(tur):
            lo = (i * len(bos)) // tur
            hi = ((i + 1) * len(bos)) // tur
            sayac[bos[rng.randrange(lo, hi)]] += 1
        kalan -= tur
    return sayac


def kura_cek(oyuncu_idleri, boyut=TABLO_BOYUTU, rng=None):
    """Oyuncuları tabloya rastgele yerleştirir. (slots, yedekler) döndürür."""
    rng = rng or random.SystemRandom()
    idler = list(dict.fromkeys(oyuncu_idleri))
    rng.shuffle(idler)
    yerlesen, yedek = idler[:boyut], idler[boyut:]
    mac_sayisi = boyut // 2
    bay_sayac = bay_dagilimi(boyut - len(yerlesen), mac_sayisi, rng)
    slots, sira = [None] * boyut, iter(yerlesen)
    for m in range(mac_sayisi):
        if bay_sayac[m] == 0:
            slots[2 * m], slots[2 * m + 1] = next(sira), next(sira)
        elif bay_sayac[m] == 1:
            slots[2 * m + rng.randrange(2)] = next(sira)
    return slots, yedek


def yeni_turnuva_bos():
    durum = {"version": SURUM, "title": VARSAYILAN_BASLIK, "participants": [],
             "slots": [None] * TABLO_BOYUTU, "results": {}, "savedAt": None, "rev": 0,
             "women": {"title": KADIN_BASLIK, "slots": [None] * KADIN_TABLO_BOYUTU, "results": {}},
             "createdAt": datetime.now().isoformat(timespec="seconds")}
    return durum


def yeni_turnuva():
    kisiler = csv_oku()
    erkekler = [k["id"] for k in kisiler if k["gender"] == "E"]
    slots, _ = kura_cek(erkekler)
    kadinlar = [k["id"] for k in kisiler if k["gender"] == "K"]
    kadin_slots, _ = kura_cek(kadinlar, KADIN_TABLO_BOYUTU)
    simdi = datetime.now().isoformat(timespec="seconds")
    return {
        "version": SURUM,
        "title": VARSAYILAN_BASLIK,
        "participants": kisiler,
        "slots": slots,
        "results": {},
        "women": {"title": KADIN_BASLIK, "slots": kadin_slots, "results": {}},
        "createdAt": simdi,
        "savedAt": None,
        "rev": 0,
    }


MAC_ANAHTARI = re.compile(r"^(R\d+-\d+|3RD)$")


def dogrula(durum):
    """Kaydedilecek veriyi kontrol eder; sorun varsa ValueError fırlatır."""
    if not isinstance(durum, dict):
        raise ValueError("Veri bir nesne olmalı.")
    kisiler = durum.get("participants")
    if not isinstance(kisiler, list):
        raise ValueError("Katılımcı listesi eksik.")
    idler = set()
    for k in kisiler:
        if not isinstance(k, dict) or not isinstance(k.get("id"), str) or not k["id"]:
            raise ValueError("Geçersiz katılımcı kaydı.")
        if k["id"] in idler:
            raise ValueError(f"Aynı kimlik iki kez kullanılmış: {k['id']}")
        idler.add(k["id"])
        if not isinstance(k.get("name"), str) or not k["name"].strip():
            raise ValueError("İsmi boş olan bir katılımcı var.")
        if len(k["name"]) > 120:
            raise ValueError(f"İsim çok uzun: {k['name'][:40]}…")
        if k.get("gender") not in ("E", "K"):
            raise ValueError(f"Geçersiz cinsiyet: {k['name']}")
    tablo_dogrula(durum.get("slots"), durum.get("results", {}), idler, "Erkekler")
    kadin = durum.get("women")
    if kadin is not None:
        if not isinstance(kadin, dict):
            raise ValueError("Kadınlar tablosu geçersiz.")
        tablo_dogrula(kadin.get("slots"), kadin.get("results", {}), idler, "Kadınlar")
        if not isinstance(kadin.get("title", ""), str):
            raise ValueError("Kadınlar tablosunun başlığı geçersiz.")
    if not isinstance(durum.get("title", ""), str):
        raise ValueError("Başlık geçersiz.")


def tablo_dogrula(slots, sonuclar, idler, ad):
    if not isinstance(slots, list) or len(slots) < 2 or len(slots) & (len(slots) - 1):
        raise ValueError(f"{ad} tablosunun boyutu 2'nin kuvveti olmalı.")
    gorulen = set()
    for s in slots:
        if s is None:
            continue
        if not isinstance(s, str) or s not in idler:
            raise ValueError(f"{ad} tablosunda listede olmayan bir oyuncu var.")
        if s in gorulen:
            raise ValueError(f"{ad} tablosunda bir oyuncu iki kez yer alıyor.")
        gorulen.add(s)
    if not isinstance(sonuclar, dict):
        raise ValueError(f"{ad} tablosunun sonuçları geçersiz.")
    for anahtar, deger in sonuclar.items():
        if not MAC_ANAHTARI.match(anahtar) or not isinstance(deger, dict):
            raise ValueError(f"{ad} tablosunda geçersiz maç sonucu: {anahtar}")


def yedek_al():
    if not KAYIT.exists():
        return
    YEDEK_DIR.mkdir(parents=True, exist_ok=True)
    damga = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    shutil.copy2(KAYIT, YEDEK_DIR / f"kayit_{damga}.json")
    yedekler = sorted(YEDEK_DIR.glob("kayit_*.json"))
    for eski in yedekler[:-YEDEK_SAYISI]:
        eski.unlink(missing_ok=True)


class Cakisma(Exception):
    """Başka bir pencere/uygulama bu arada daha yeni bir kayıt yaptı."""


def kayitli_rev():
    """kayit.json'daki kayıt numarası; dosya yoksa 0, okunamıyorsa None."""
    if not KAYIT.exists():
        return 0
    try:
        with open(KAYIT, encoding="utf-8") as f:
            rev = json.load(f).get("rev", 0)
        return rev if isinstance(rev, int) else 0
    except Exception:
        return None


def eski_yedekleri_tasi():
    """Eski sürümün proje klasörüne (turnuva/yedekler) yazdığı yedekleri Masaüstüne taşır."""
    if not ESKI_YEDEK_DIR.is_dir() or ESKI_YEDEK_DIR.resolve() == YEDEK_DIR.resolve():
        return 0
    YEDEK_DIR.mkdir(parents=True, exist_ok=True)
    tasinan = 0
    for dosya in sorted(ESKI_YEDEK_DIR.glob("kayit_*.json")):
        hedef = YEDEK_DIR / dosya.name
        if not hedef.exists():
            shutil.move(str(dosya), hedef)
            tasinan += 1
    try:
        ESKI_YEDEK_DIR.rmdir()  # sadece boşsa silinir
    except OSError:
        pass
    return tasinan


def kaydet(durum, temel_rev=None, zorla=False):
    dogrula(durum)
    mevcut = kayitli_rev()
    if not zorla and mevcut is not None and isinstance(temel_rev, int) and temel_rev != mevcut:
        raise Cakisma()
    durum = dict(durum)
    durum["version"] = SURUM
    durum["savedAt"] = datetime.now().isoformat(timespec="seconds")
    durum["rev"] = max(mevcut or 0, temel_rev if isinstance(temel_rev, int) else 0) + 1
    yedek_al()
    gecici = KAYIT.with_suffix(".json.tmp")
    with open(gecici, "w", encoding="utf-8") as f:
        json.dump(durum, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.replace(gecici, KAYIT)
    return durum


def kayit_yukle():
    """(durum | None, uyarı | None) döndürür. Bozuk dosyada en yeni yedeğe döner."""
    if not KAYIT.exists():
        return None, None
    try:
        with open(KAYIT, encoding="utf-8") as f:
            durum = json.load(f)
        dogrula(durum)
        return durum, None
    except Exception as hata:  # bozuk ya da elle bozulmuş dosya
        sorun = f"kayit.json okunamadı ({hata})."
    for yedek in sorted(YEDEK_DIR.glob("kayit_*.json"), reverse=True):
        try:
            with open(yedek, encoding="utf-8") as f:
                durum = json.load(f)
            dogrula(durum)
            return durum, f"{sorun} En son yedek yüklendi: {yedek.name}. Kaydet'e basınca düzelir."
        except Exception:
            continue
    return None, f"{sorun} Yedek de bulunamadı; yeni kura çekildi. Kaydetmeden önce kontrol et."


# --------------------------------------------------------------------------
# HTTP sunucusu
# --------------------------------------------------------------------------

KILIT = threading.Lock()
TASLAK = None  # kaydedilmemiş ilk rastgele kura (sunucu açık kaldıkça aynı kalır)

ICERIK_TIPLERI = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


class Isleyici(BaseHTTPRequestHandler):
    server_version = "Turnuva/1.0"

    def log_message(self, fmt, *args):
        if "--verbose" in sys.argv:
            super().log_message(fmt, *args)

    def _json(self, veri, kod=HTTPStatus.OK):
        govde = json.dumps(veri, ensure_ascii=False).encode("utf-8")
        self.send_response(kod)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(govde)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(govde)

    def _govde_oku(self):
        uzunluk = int(self.headers.get("Content-Length") or 0)
        if uzunluk < 0 or uzunluk > 10 * 1024 * 1024:
            raise ValueError("İstek boyutu geçersiz.")
        ham = self.rfile.read(uzunluk) if uzunluk else b"{}"
        veri = json.loads(ham.decode("utf-8"))
        if not isinstance(veri, dict):
            raise ValueError("JSON nesnesi bekleniyordu.")
        return veri

    def _yerel_istek_mi(self):
        # Başka sitelerin tarayıcı üzerinden kayıt dosyasına yazmasını engelle
        kaynak = self.headers.get("Origin")
        if not kaynak:
            return True
        try:
            host = urlparse(kaynak).hostname
        except ValueError:
            return False
        return host in ("127.0.0.1", "localhost", "::1")

    def do_GET(self):
        try:
            self._get()
        except Exception as hata:  # beklenmeyen hata: bağlantıyı koparmak yerine JSON dön
            self._json({"error": f"Sunucu hatası: {hata}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        try:
            self._post()
        except Exception as hata:
            self._json({"error": f"Sunucu hatası: {hata}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _get(self):
        global TASLAK
        yol = urlparse(self.path).path
        if yol == "/api/ping":
            return self._json({"app": "turnuva", "kayit": str(KAYIT)})
        if yol == "/api/state":
            with KILIT:
                durum, uyari = kayit_yukle()
                if durum is not None:
                    return self._json({"state": durum, "saved": uyari is None, "warning": uyari})
                if TASLAK is None:
                    try:
                        TASLAK = yeni_turnuva()
                    except Exception as hata:
                        TASLAK = yeni_turnuva_bos()
                        uyari = f"temiz_liste.csv okunamadı ({hata}); katılımcıları elle ekleyebilirsin."
                if csv_yolu() is None and not uyari:
                    uyari = "temiz_liste.csv bulunamadı; katılımcıları elle ekleyebilirsin."
                return self._json({"state": TASLAK, "saved": False, "warning": uyari})
        if yol == "/api/csv":
            try:
                kisiler = csv_oku()
            except Exception as hata:
                return self._json({"error": f"temiz_liste.csv okunamadı: {hata}"},
                                  HTTPStatus.INTERNAL_SERVER_ERROR)
            return self._json({"participants": kisiler, "file": str(csv_yolu() or "")})
        self._statik(yol)

    def _post(self):
        global TASLAK
        yol = urlparse(self.path).path
        if not self._yerel_istek_mi():
            return self._json({"error": "İzin verilmeyen kaynak."}, HTTPStatus.FORBIDDEN)
        try:
            veri = self._govde_oku()
        except (ValueError, UnicodeDecodeError, RecursionError) as hata:
            return self._json({"error": f"Geçersiz istek: {hata}"}, HTTPStatus.BAD_REQUEST)
        if yol == "/api/state":
            try:
                with KILIT:
                    durum = kaydet(veri.get("state"), veri.get("baseRev"), veri.get("force") is True)
                    TASLAK = None
            except Cakisma:
                return self._json({"error": "Başka bir pencerede daha yeni bir kayıt yapılmış.",
                                   "conflict": True}, HTTPStatus.CONFLICT)
            except (ValueError, TypeError, RecursionError) as hata:
                return self._json({"error": str(hata)}, HTTPStatus.BAD_REQUEST)
            except OSError as hata:
                return self._json({"error": f"Dosyaya yazılamadı: {hata}"},
                                  HTTPStatus.INTERNAL_SERVER_ERROR)
            return self._json({"ok": True, "savedAt": durum["savedAt"], "rev": durum["rev"]})
        if yol == "/api/draw":
            idler = veri.get("ids")
            boyut = veri.get("size", TABLO_BOYUTU)
            if (not isinstance(idler, list) or not all(isinstance(i, str) for i in idler)
                    or not isinstance(boyut, int) or boyut < 2 or boyut & (boyut - 1)):
                return self._json({"error": "Geçersiz kura isteği."}, HTTPStatus.BAD_REQUEST)
            slots, yedek = kura_cek(idler, boyut)
            return self._json({"slots": slots, "reserves": yedek})
        self._json({"error": "Bulunamadı."}, HTTPStatus.NOT_FOUND)

    def _statik(self, yol):
        if yol in ("", "/"):
            yol = "/index.html"
        try:
            hedef = (WEB / unquote(yol).lstrip("/")).resolve()
            bulundu = WEB.resolve() in hedef.parents and hedef.is_file()
        except (ValueError, OSError):
            bulundu = False
        if not bulundu:
            return self._json({"error": "Bulunamadı."}, HTTPStatus.NOT_FOUND)
        govde = hedef.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", ICERIK_TIPLERI.get(hedef.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(govde)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(govde)


def calisan_ornek(port):
    """Bu portta aynı kayıt dosyasını kullanan bir turnuva uygulaması açık mı?"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1.5) as yanit:
            veri = json.loads(yanit.read().decode("utf-8"))
        return veri.get("app") == "turnuva" and veri.get("kayit") == str(KAYIT)
    except Exception:
        return False


def bos_port(baslangic):
    for port in range(baslangic, baslangic + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            # Az önce kapanan uygulamanın portu (TIME_WAIT) tekrar kullanılabilsin
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    raise SystemExit("Boş port bulunamadı.")


def main():
    ap = argparse.ArgumentParser(description="128 kişilik masa tenisi turnuva tablosu")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true", help="Tarayıcıyı otomatik açma")
    ap.add_argument("--verbose", action="store_true", help="İstekleri ekrana yaz")
    args = ap.parse_args()

    if calisan_ornek(args.port):
        adres = f"http://127.0.0.1:{args.port}"
        print("Uygulama zaten açık:", adres)
        if not args.no_browser:
            webbrowser.open(adres)
        return
    tasinan = eski_yedekleri_tasi()
    port = bos_port(args.port)
    sunucu = ThreadingHTTPServer(("127.0.0.1", port), Isleyici)
    adres = f"http://127.0.0.1:{port}"
    print("=" * 60)
    print("  Turnuva tablosu çalışıyor:", adres)
    print("  Kayıt dosyası:", KAYIT)
    print("  Yedekler:", YEDEK_DIR, f"({tasinan} eski yedek buraya taşındı)" if tasinan else "")
    yol_csv = csv_yolu()
    print("  Katılımcı listesi:", yol_csv or "bulunamadı (temiz_liste.csv)")
    print("  Kapatmak için bu pencerede Ctrl+C")
    print("=" * 60)
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(adres)).start()
    try:
        sunucu.serve_forever()
    except KeyboardInterrupt:
        print("\nKapatılıyor…")
    finally:
        sunucu.server_close()


if __name__ == "__main__":
    main()
