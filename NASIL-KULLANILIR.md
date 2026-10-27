# Vampir Köylü: kurulum ve oynanış

## İnternette (Render)

Oyun Render'da çalışırken bilgisayar gerekmez.

- Oyuncular: `https://<servis-adı>.onrender.com`
- Yönetici: `https://<servis-adı>.onrender.com/yonetici` + Render'da `ADMIN_PIN` olarak girilen PIN
- Ücretsiz sunucu uzun süre kimse girmeyince uyur; ilk açılış ~1 dakika sürebilir. Toplantıdan 5 dakika önce yönetici ekranını açmak yeter.
- Sunucu uyursa ya da yeniden başlarsa oyun sıfırlanır. Oyun sırasında açık ekranlar sunucuyu uyanık tutar.
- Kodda değişiklik yapıp GitHub'a gönderince Render kendisi yeniden kurar (o sırada oyun sıfırlanır; oyun sırasında gönderme).

## Başlatma (laptop)

1. `baslat.bat` dosyasına çift tıkla. (Ya da terminalde: `node server.js`)
2. Windows Güvenlik Duvarı sorarsa **Özel ağlar** için izin ver.
3. Açılan pencerede iki şey yazar:
   - **Yönetici PIN'i** (4 hane, her açılışta değişir; sabit istersen `set ADMIN_PIN=2468` yazıp sonra başlat)
   - Oyuncuların gireceği adres, ör. `http://192.168.1.5:3000`
4. Laptopta `http://localhost:3000/yonetici` aç, PIN'i gir. Ekrandaki QR kodu büyütüp projeksiyona yansıt.

Yöneticiyi telefondan da yönetebilirsin: `http://<adres>:3000/yonetici`.

## Ağ sorunları

- Laptop ve telefonlar **aynı Wi-Fi'da** olmalı.
- Kurum/misafir Wi-Fi'ları cihazların birbirini görmesini engelleyebilir. O zaman:
  - Laptopu telefonun hotspot'una bağla, herkes o hotspot'a bağlansın, **ya da**
  - İnternetten erişim için tünel aç:
    `winget install Cloudflare.cloudflared` sonra `cloudflared tunnel --url http://localhost:3000`
    Verdiği `https://….trycloudflare.com` adresini yönetici ekranında "Oyuncular farklı bir adresten mi giriyor?" kısmına yapıştır; QR onu gösterir.

## Oyun akışı

| Aşama | Yönetici ne yapar | Oyuncular ne görür |
|---|---|---|
| Lobi | Herkes katılır, rol sayılarını ayarlar, **Rolleri dağıt** | İsim yazar, bekler |
| Roller | **Geceyi başlat** | Rol kartına dokunup gizlice bakar; vampirler birbirini görür |
| Gece | Herkes gözünü kapatsın der, seçimler canlı görünür, **Sabahı getir** | Vampir / Doktor / Gözcü / Cadı telefondan seçer, diğerleri uyur |
| Gündüz | Haberi okur, tartışma, **Oylamayı aç → kapat**, sonra **Geceye geç** | Canlı oylama |
| Bitiş | Kazanan otomatik belirlenir, **Yeni el** | Herkesin rolü açılır |

## Roller

- **Vampir**: her gece birlikte bir kurban seçerler (çoğunluk, eşitlikte rastgele).
- **Doktor**: her gece birini korur; aynı kişiyi iki gece üst üste koruyamaz.
- **Gözcü**: her gece bir kişinin vampir olup olmadığını öğrenir.
- **Cadı**: bir hayat iksiri (vampir kurbanını kurtarır) ve bir ölüm iksiri; her biri bir kez.
- **Avcı**: öldüğünde birini yanında götürür.
- **Deli**: gündüz asılırsa tek başına kazanır.
- **Köylü**: güç yok, oy ve tartışma.

30 kişi için otomatik öneri: 7 vampir, 1'er doktor, gözcü, avcı, cadı, deli, 18 köylü. Lobide +/- ile değiştirilebilir.

**Kazanma:** Vampirler hayattaki diğerlerine eşit veya fazla olursa vampirler; vampir kalmazsa köy kazanır.

## Bilmen gerekenler

- Oyun durumu laptopun hafızasında tutulur. Sunucuyu kapatırsan oyun sıfırlanır; oyuncular yeniden katılır.
- Telefon kapanıp açılırsa veya sayfa yenilenirse oyuncu kaldığı yerden devam eder (aynı tarayıcı).
- Yönetici ekranında **Rolleri gizle** düğmesi var; ekranı yansıtırken roller görünmesin.
- Yönetici gerektiğinde herhangi birini öldürebilir, diriltebilir veya oyundan çıkarabilir.
