# Makes sample match photos with EXIF capture times for the photo-sorting tests.
#   python3 tests/make-photo-fixtures.py
# Times are local (the browser test runs in UTC). The "camera" runs 83.5 s fast.
import json, subprocess, os
from datetime import datetime, timedelta
from PIL import Image, ImageDraw

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'fixtures', 'photos')
os.makedirs(OUT, exist_ok=True)
OFFSET = timedelta(seconds=83.5)
DAY = datetime(2026, 10, 24)

def qr_matrix(text):
    js = "const q=require('qrcode-generator')(0,'M');q.addData(process.argv[1]);q.make();const n=q.getModuleCount();const m=[];for(let r=0;r<n;r++){let row='';for(let c=0;c<n;c++)row+=q.isDark(r,c)?'1':'0';m.push(row)}console.log(JSON.stringify(m))"
    return json.loads(subprocess.check_output(['node', '-e', js, text], cwd=os.path.join(HERE, '..')))

def save(name, true_time, colour, label, qr=None, exif=True):
    img = Image.new('RGB', (1200, 800), colour)
    d = ImageDraw.Draw(img)
    d.text((40, 40), label, fill='white')
    if qr:
        n = len(qr); cell = 16; ox = (1200 - n * cell) // 2; oy = (800 - n * cell) // 2
        d.rectangle([ox - 40, oy - 40, ox + n * cell + 40, oy + n * cell + 40], fill='white')
        for r, row in enumerate(qr):
            for c, v in enumerate(row):
                if v == '1': d.rectangle([ox + c * cell, oy + r * cell, ox + (c + 1) * cell - 1, oy + (r + 1) * cell - 1], fill='black')
    path = os.path.join(OUT, name)
    if exif:
        cam = true_time + OFFSET
        ex = Image.Exif()
        ex[0x010F] = 'Canon'; ex[0x0110] = 'EOS R6'
        sub = ex.get_ifd(0x8769)
        sub[0x9003] = cam.strftime('%Y:%m:%d %H:%M:%S')       # DateTimeOriginal
        sub[0x9291] = f'{cam.microsecond // 10000:02d}'        # SubSecTimeOriginal (hundredths)
        img.save(path, 'JPEG', quality=70, exif=ex)
    else:
        img.save(path, 'JPEG', quality=70)

shown = DAY + timedelta(hours=14)
shown_ms = int((shown - datetime(1970, 1, 1)).total_seconds() * 1000)
save('IMG_0001.JPG', shown, (20, 20, 20), 'clock photo', qr=qr_matrix(f'HBCLK:{shown_ms}'))
try_t = DAY + timedelta(hours=15, minutes=10)
kick_t = DAY + timedelta(hours=15, minutes=12, seconds=30)
save('IMG_0101.JPG', try_t - timedelta(seconds=3), (30, 90, 160), 'try burst 1')
save('IMG_0102.JPG', try_t - timedelta(seconds=2.7), (30, 100, 170), 'try burst 2')
save('IMG_0103.JPG', try_t + timedelta(seconds=1), (40, 110, 180), 'try celebration')
save('IMG_0201.JPG', kick_t + timedelta(seconds=2), (150, 60, 40), 'kick')
save('IMG_0301.JPG', DAY + timedelta(hours=15, minutes=20), (60, 60, 60), 'random')
save('NO_EXIF.JPG', None, (90, 40, 120), 'no exif', exif=False)
# A "RAW" file: a real TIFF (with EXIF time) followed by a small thumbnail JPEG and a big preview JPEG,
# like cameras embed. The extractor must pick the big one.
import io
def jpeg_bytes(size, colour, label):
    im = Image.new('RGB', size, colour); ImageDraw.Draw(im).text((20, 20), label, fill='white')
    b = io.BytesIO(); im.save(b, 'JPEG', quality=70); return b.getvalue()
raw_t = kick_t + timedelta(seconds=5)
tif = io.BytesIO()
ex = Image.Exif(); ex[0x010F] = 'Nikon'; ex[0x0110] = 'Z6'
ex[0x0132] = (raw_t + OFFSET).strftime('%Y:%m:%d %H:%M:%S')  # DateTime in IFD0 (Pillow can't write the EXIF sub-IFD into a TIFF)
ex.get_ifd(0x8769)[0x9003] = (raw_t + OFFSET).strftime('%Y:%m:%d %H:%M:%S')
Image.new('RGB', (16, 16), (50, 50, 50)).save(tif, 'TIFF', exif=ex)
with open(os.path.join(OUT, 'RAW_0401.NEF'), 'wb') as f:
    f.write(tif.getvalue() + b'\x00' * 512 + jpeg_bytes((160, 107), (90, 90, 90), 'thumb') + b'\x00' * 256 + jpeg_bytes((1200, 800), (150, 70, 30), 'RAW PREVIEW 1200x800'))

# A HEIC photo (iPhone style) a couple of seconds after the try.
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
    heic_t = try_t + timedelta(seconds=2)
    im = Image.new('RGB', (1200, 800), (20, 120, 90)); ImageDraw.Draw(im).text((40, 40), 'HEIC photo', fill='white')
    ex = Image.Exif(); ex[0x010F] = 'Apple'; ex[0x0110] = 'iPhone'
    ex.get_ifd(0x8769)[0x9003] = (heic_t + OFFSET).strftime('%Y:%m:%d %H:%M:%S')
    im.save(os.path.join(OUT, 'IMG_0501.HEIC'), format='HEIF', exif=ex.tobytes(), quality=60)
except ImportError:
    print('pillow-heif not installed: skipping the HEIC sample')

print(json.dumps({'shownMs': shown_ms, 'tryMs': int((try_t - datetime(1970, 1, 1)).total_seconds() * 1000), 'kickMs': int((kick_t - datetime(1970, 1, 1)).total_seconds() * 1000)}))
