console.log('ENV REGION =', process.env.AWS_REGION);
require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const app = express();

// --- S3 CONFIG ---
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const S3_BUCKET = process.env.S3_BUCKET_NAME;

// --- CONFIG ---
const PORT = process.env.PORT || 3000;
const ADMIN_USER = 'you';
const ADMIN_PASS = 'yourpassword';
const BOSS_USER = 'boss';
const BOSS_PASS = 'bosspassword';

// --- MIDDLEWARE ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(fileUpload());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(
  session({
    secret: 'supersecret',
    resave: false,
    saveUninitialized: false,
  })
);

// --- AUTH HELPERS ---
function requireLogin(role) {
  return (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (role && req.session.role !== role) return res.status(403).send('Forbidden');
    next();
  };
}

// --- S3 HELPERS FOR SHEETS METADATA ---
async function loadSheetsFromS3() {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: 'metadata/sheets.json',
    });
    const response = await s3.send(command);

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const json = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      console.error('loadSheetsFromS3 error:', err);
    }
    return {};
  }
}

async function saveSheetsToS3(data) {
  const body = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'metadata/sheets.json',
    Body: body,
    ContentType: 'application/json',
  });
  await s3.send(command);
}

async function getSheetsMetadata() {
  return await loadSheetsFromS3();
}

async function saveSheetsMetadata(data) {
  await saveSheetsToS3(data);
}

// --- S3 HELPERS FOR PURCHASES METADATA ---
async function loadPurchasesFromS3() {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: 'metadata/purchases.json',
    });
    const response = await s3.send(command);

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const json = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      console.error('loadPurchasesFromS3 error:', err);
    }
    return {};
  }
}

async function savePurchasesToS3(data) {
  const body = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'metadata/purchases.json',
    Body: body,
    ContentType: 'application/json',
  });
  await s3.send(command);
}

async function getPurchasesMetadata() {
  return await loadPurchasesFromS3();
}

async function savePurchasesMetadata(data) {
  await savePurchasesToS3(data);
}

// --- PHOTOS METADATA HELPERS (S3 JSON) ---
async function loadPhotosFromS3() {
  try {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: 'metadata/photos.json',
    });
    const response = await s3.send(command);

    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const json = Buffer.concat(chunks).toString('utf8');
    return JSON.parse(json);
  } catch (err) {
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      console.error('loadPhotosFromS3 error:', err);
    }
    return {};
  }
}

async function savePhotosToS3(data) {
  const body = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: 'metadata/photos.json',
    Body: body,
    ContentType: 'application/json',
  });
  await s3.send(command);
}

// normalize metadata so every file has galleryType
async function getPhotosMetadata() {
  const meta = await loadPhotosFromS3();

  Object.values(meta).forEach((persons) => {
    Object.values(persons).forEach((dates) => {
      Object.values(dates).forEach((files) => {
        files.forEach((f) => {
          if (!f.galleryType) f.galleryType = 'main';
        });
      });
    });
  });

  return meta;
}

async function savePhotosMetadata(data) {
  await savePhotosToS3(data);
}

// --- ROUTES ---

app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.user = username;
    req.session.role = 'admin';
    return res.redirect('/upload');
  }
  if (username === BOSS_USER && password === BOSS_PASS) {
    req.session.user = username;
    req.session.role = 'boss';
    return res.redirect('/gallery');
  }
  res.render('login', { error: 'Invalid credentials' });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Admin upload page
app.get('/upload', requireLogin('admin'), (req, res) => {
  res.render('upload');
});

// Handle upload TO S3 (supports main / other / other2 / sales)
app.post('/upload', requireLogin('admin'), async (req, res) => {
  let { brand, person, date, galleryType } = req.body;
  brand = (brand || 'DefaultBrand').trim();
  person = (person || 'DefaultPerson').trim();
  date = (date || 'NoDate').trim();

  if (!['main', 'other', 'other2', 'sales'].includes(galleryType)) {
    galleryType = 'main';
  }

  if (!req.files || !req.files.images) {
    return res.status(400).send('No files uploaded');
  }

  let images = req.files.images;
  if (!Array.isArray(images)) images = [images];

  const safeBrand = brand.replace(/\s+/g, '-');
  const safePerson = person.replace(/\s+/g, '-');
  const safeDate = date.replace(/\s+/g, '-');

  const photosMeta = await getPhotosMetadata();
  if (!photosMeta[safeBrand]) photosMeta[safeBrand] = {};
  if (!photosMeta[safeBrand][safePerson]) photosMeta[safeBrand][safePerson] = {};
  if (!photosMeta[safeBrand][safePerson][safeDate]) {
    photosMeta[safeBrand][safePerson][safeDate] = [];
  }

  try {
    for (const img of images) {
      const timestamp = Date.now();
      const fileName = `${timestamp}_${img.name}`;
      const s3Key = `photos/${safeBrand}/${safePerson}/${safeDate}/${fileName}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: img.data,
          ContentType: img.mimetype,
          CacheControl: 'public, max-age=31536000',
        })
      );

      const url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

      photosMeta[safeBrand][safePerson][safeDate].push({
        name: fileName,
        url,
        s3Key,
        galleryType, // main / other / other2 / sales
      });
    }

    await savePhotosMetadata(photosMeta);
    return res.redirect('/upload');
  } catch (err) {
    console.error('S3 upload error:', err);
    res.status(500).send('Upload failed');
  }
});

// Helper to upload a single file to S3 and return URL
async function uploadToS3AndGetUrl(file, keyPrefix) {
  const ext = path.extname(file.name) || '.jpg';
  const key = `${keyPrefix}${ext}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: file.data,
      ContentType: file.mimetype,
      CacheControl: 'public, max-age=31536000',
    })
  );
  return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// Handle stock purchase upload (MULTIPLE invoice + product photos + metadata)
app.post('/admin/upload-purchase', requireLogin('admin'), async (req, res) => {
  const { date, supplier, purchaseIds, returnInfo, totalPurchase } = req.body;

  if (!date || !supplier) {
    return res.status(400).send('Missing date or supplier');
  }

  // Prepare arrays from express-fileupload
  const invoiceFiles = Array.isArray(req.files?.invoicePhotos)
    ? req.files.invoicePhotos
    : req.files?.invoicePhotos
      ? [req.files.invoicePhotos]
      : [];

  const productFiles = Array.isArray(req.files?.productPhotos)
    ? req.files.productPhotos
    : req.files?.productPhotos
      ? [req.files.productPhotos]
      : [];

  if (!productFiles.length) {
    return res.status(400).send('At least one product photo is required');
  }

  const timestamp = Date.now();
  const safeSupplier = supplier.trim().replace(/\s+/g, '-');
  const id = `${date}-${safeSupplier}-${timestamp}`;

  const invoicePhotoUrls = [];
  const productPhotoUrls = [];

  try {
    // upload product photos
    for (let i = 0; i < productFiles.length; i++) {
      const f = productFiles[i];
      const url = await uploadToS3AndGetUrl(
        f,
        `purchases/${id}-product-${i + 1}`
      );
      productPhotoUrls.push(url);
    }

    // upload invoice photos (if any)
    for (let i = 0; i < invoiceFiles.length; i++) {
      const f = invoiceFiles[i];
      const url = await uploadToS3AndGetUrl(
        f,
        `purchases/${id}-invoice-${i + 1}`
      );
      invoicePhotoUrls.push(url);
    }

    const purchasesMeta = await getPurchasesMetadata();
    purchasesMeta[id] = {
      id,
      date,
      supplier: supplier.trim(),
      purchaseIds: purchaseIds || '',
      invoicePhotoUrls,   // array of strings
      productPhotoUrls,   // array of strings
      totalPurchase: totalPurchase || '',
      returnInfo: returnInfo || '',
    };
    await savePurchasesMetadata(purchasesMeta);

    res.redirect('/purchases');
  } catch (err) {
    console.error('Upload purchase error:', err);
    res.status(500).send('Upload purchase failed');
  }
});

// Admin rename photo
app.post('/rename-photo', requireLogin('admin'), async (req, res) => {
  const { brand, person, date, oldfilename, newfilename } = req.body;
  if (!brand || !person || !date || !oldfilename || !newfilename) {
    return res.status(400).send('Missing data');
  }

  const safeBrand = brand.replace(/\s+/g, '-');
  const safePerson = person.replace(/\s+/g, '-');
  const safeDate = date.replace(/\s+/g, '-');

  const photosMeta = await getPhotosMetadata();
  const files = photosMeta?.[safeBrand]?.[safePerson]?.[safeDate];
  if (!files) return res.redirect('/admin-gallery');

  const file = files.find((f) => f.name === oldfilename);
  if (file) {
    const ext = path.extname(file.name);
    file.name = newfilename.includes('.') ? newfilename : newfilename + ext;
    await savePhotosMetadata(photosMeta);
    console.log(`Renamed (meta): ${oldfilename} → ${file.name}`);
  }

  res.redirect('/admin-gallery');
});

// Admin delete photo
app.post('/delete-photo', requireLogin('admin'), async (req, res) => {
  const { brand, person, date, filename } = req.body;
  if (!brand || !person || !date || !filename) {
    return res.status(400).send('Missing data');
  }

  const safeBrand = brand.replace(/\s+/g, '-');
  const safePerson = person.replace(/\s+/g, '-');
  const safeDate = date.replace(/\s+/g, '-');

  const photosMeta = await getPhotosMetadata();
  const files = photosMeta?.[safeBrand]?.[safePerson]?.[safeDate];
  if (!files) return res.redirect('/admin-gallery');

  const index = files.findIndex((f) => f.name === filename);
  if (index === -1) return res.redirect('/admin-gallery');

  const file = files[index];

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: file.s3Key,
      })
    );
    console.log(`Deleted from S3: ${file.s3Key}`);
  } catch (err) {
    console.error('S3 delete error:', err);
  }

  files.splice(index, 1);
  await savePhotosMetadata(photosMeta);
  console.log(`Deleted from metadata: ${filename}`);

  res.redirect('/admin-gallery');
});

// Add Google Sheet
app.post('/add-sheet', requireLogin('admin'), async (req, res) => {
  const { brand, person, date, sheetId, sheetName } = req.body;
  if (!brand || !person || !date || !sheetId) {
    return res.status(400).send('Missing data');
  }

  const sheetsData = await getSheetsMetadata();
  const key = `${brand}/${person}/${date}`;

  if (!sheetsData[key]) {
    sheetsData[key] = {};
  }

  sheetsData[key].sheetId = sheetId;
  sheetsData[key].sheetName = sheetName || 'Sales Data';
  sheetsData[key].embedUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

  await saveSheetsMetadata(sheetsData);
  console.log(`Added sheet: ${key}`);

  res.redirect('/admin-sheets');
});

// Remove Google Sheet
app.post('/remove-sheet', requireLogin('admin'), async (req, res) => {
  const { brand, person, date } = req.body;
  if (!brand || !person || !date) {
    return res.status(400).send('Missing data');
  }

  const sheetsData = await getSheetsMetadata();
  const key = `${brand}/${person}/${date}`;

  if (sheetsData[key]) {
    delete sheetsData[key].sheetId;
    delete sheetsData[key].sheetName;
    delete sheetsData[key].embedUrl;
  }

  await saveSheetsMetadata(sheetsData);
  console.log(`Removed sheet: ${key}`);

  res.redirect('/admin-sheets');
});

// Boss sheets view
app.get('/sheets', requireLogin('boss'), async (req, res) => {
  const sheetsMetadata = await getSheetsMetadata();

  const sheets = Object.entries(sheetsMetadata)
    .filter(([_, data]) => data.sheetId)
    .map(([key, data]) => {
      const [brand, person, date] = key.split('/');
      return {
        brand,
        person,
        date,
        sheetId: data.sheetId,
        sheetName: data.sheetName || 'Sales Data',
        embedUrl: data.embedUrl,
      };
    });

  res.render('sheets-album', { sheets, isAdmin: false });
});

// Admin sheets view
app.get('/admin-sheets', requireLogin('admin'), async (req, res) => {
  const sheetsMetadata = await getSheetsMetadata();

  const sheets = Object.entries(sheetsMetadata)
    .filter(([_, data]) => data.sheetId)
    .map(([key, data]) => {
      const [brand, person, date] = key.split('/');
      return {
        brand,
        person,
        date,
        sheetId: data.sheetId,
        sheetName: data.sheetName || 'Sales Data',
        embedUrl: data.embedUrl,
      };
    });

  res.render('sheets-album', { sheets, isAdmin: true });
});

// Admin gallery view (all photos, with edit/delete)
app.get('/admin-gallery', requireLogin('admin'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const brands = Object.keys(photosMeta)
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName].map((f) => ({
              src: f.url,
              name: f.name,
            }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: true, galleryTitle: 'Admin – All Photos' });
});

// Admin OTHER ALBUMS gallery (only other)
app.get('/admin-other-gallery', requireLogin('admin'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const brands = Object.keys(photosMeta)
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName]
              .filter((f) => f.galleryType === 'other')
              .map((f) => ({
                src: f.url,
                name: f.name,
              }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: true, galleryTitle: 'Admin – Other Albums' });
});

// Admin OTHER ALBUMS 2 gallery (only other2)
app.get('/admin-other2-gallery', requireLogin('admin'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const brands = Object.keys(photosMeta)
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName]
              .filter((f) => f.galleryType === 'other2')
              .map((f) => ({
                src: f.url,
                name: f.name,
              }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: true, galleryTitle: 'Admin – Other Albums 2' });
});

// Admin SALES gallery (only sales)
app.get('/admin-sales-gallery', requireLogin('admin'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const brands = Object.keys(photosMeta)
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName]
              .filter((f) => f.galleryType === 'sales')
              .map((f) => ({
                src: f.url,
                name: f.name,
              }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: true, galleryTitle: 'Admin – Sales Gallery' });
});

// Boss main gallery (main photos only, hide some brands)
app.get('/gallery', requireLogin('boss'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const HIDE_BRANDS_FROM_MAIN = ['Salem/Sathyamangalam'];

  const brands = Object.keys(photosMeta)
    .filter((brandName) => !HIDE_BRANDS_FROM_MAIN.includes(brandName))
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName]
              .filter((f) => !f.galleryType || f.galleryType === 'main')
              .map((f) => ({
                src: f.url,
                name: f.name,
              }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: false, galleryTitle: 'Your Gallery' });
});

// Boss OTHER ALBUMS gallery (only other)
app.get('/other-gallery', requireLogin('boss'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const brands = Object.keys(photosMeta)
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName]
              .filter((f) => f.galleryType === 'other')
              .map((f) => ({
                src: f.url,
                name: f.name,
              }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: false, galleryTitle: 'Other Albums' });
});

// Boss OTHER ALBUMS 2 gallery (only other2)
app.get('/other-gallery-2', requireLogin('boss'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const brands = Object.keys(photosMeta)
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName]
              .filter((f) => f.galleryType === 'other2')
              .map((f) => ({
                src: f.url,
                name: f.name,
              }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: false, galleryTitle: 'Other Albums 2' });
});

// Boss SALES gallery (only sales)
app.get('/sales-gallery', requireLogin('boss'), async (req, res) => {
  const photosMeta = await getPhotosMetadata();

  const brands = Object.keys(photosMeta)
    .map((brandName) => {
      const personsMeta = photosMeta[brandName];
      const persons = Object.keys(personsMeta).map((personName) => {
        const datesMeta = personsMeta[personName];
        const dates = Object.keys(datesMeta)
          .map((dateName) => {
            const files = datesMeta[dateName]
              .filter((f) => f.galleryType === 'sales')
              .map((f) => ({
                src: f.url,
                name: f.name,
              }));
            return { name: dateName, files };
          })
          .filter((d) => d.files.length > 0);
        return { name: personName, dates };
      }).filter((p) => p.dates.length > 0);
      return { name: brandName, persons };
    }).filter((b) => b.persons.length > 0);

  res.render('gallery', { brands, isAdmin: false, galleryTitle: 'Sales Gallery' });
});

// Stock Purchase page (boss + admin)
app.get('/purchases', requireLogin(), async (req, res) => {
  const purchasesMeta = await getPurchasesMetadata();
  const purchases = Object.values(purchasesMeta).sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  res.render('purchases', { purchases });
});

// View all invoice photos for one purchase
app.get('/purchases/:id/invoice-photos', requireLogin(), async (req, res) => {
  const purchasesMeta = await getPurchasesMetadata();
  const purchase = purchasesMeta[req.params.id];
  if (!purchase) return res.status(404).send('Purchase not found');

  res.render('purchase-photos', {
    title: 'Invoice photos',
    photos: purchase.invoicePhotoUrls || [],
  });
});

// View all product photos for one purchase
app.get('/purchases/:id/product-photos', requireLogin(), async (req, res) => {
  const purchasesMeta = await getPurchasesMetadata();
  const purchase = purchasesMeta[req.params.id];
  if (!purchase) return res.status(404).send('Purchase not found');

  res.render('purchase-photos', {
    title: 'Product photos',
    photos: purchase.productPhotoUrls || [],
  });
});

// Admin delete purchase (deletes first product image only; can be extended)
app.post('/admin/delete-purchase', requireLogin('admin'), async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).send('Missing id');

  const purchasesMeta = await getPurchasesMetadata();
  const purchase = purchasesMeta[id];

  // Optional: delete first product photo from S3 (old behaviour)
  if (purchase && purchase.productPhotoUrls && purchase.productPhotoUrls.length) {
    const firstUrl = purchase.productPhotoUrls[0];
    const split = firstUrl.split('.amazonaws.com/');
    if (split[1]) {
      const key = split[1];
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
          })
        );
        console.log('Deleted purchase image from S3:', key);
      } catch (err) {
        console.error('Delete purchase image error:', err);
      }
    }
  }

  delete purchasesMeta[id];
  await savePurchasesMetadata(purchasesMeta);

  res.redirect('/purchases');
});

// Boss invoices page (placeholder)
app.get('/invoices', requireLogin('boss'), (req, res) => {
  res.render('invoices', { title: 'Invoices' });
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
