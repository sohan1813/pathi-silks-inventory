require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const app = express();

// --- S3 CONFIG ---
const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

const S3_BUCKET = process.env.S3_BUCKET;

// --- LOCAL METADATA FILE FOR PHOTOS (on disk, but content survives via git/S3) ---
const PHOTOS_META_FILE = path.join(__dirname, 'uploads', 'photos.json');

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

// keep for sheets.json / photos.json if needed locally
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
    // If object missing, just start fresh
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

// --- SHEETS METADATA HELPERS (now via S3) ---
async function getSheetsMetadata() {
  return await loadSheetsFromS3();
}

async function saveSheetsMetadata(data) {
  await saveSheetsToS3(data);
}

// --- PHOTOS METADATA HELPERS (for S3 URLs, stored locally) ---
function getPhotosMetadata() {
  if (fs.existsSync(PHOTOS_META_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PHOTOS_META_FILE, 'utf8'));
    } catch (err) {
      console.error('Error reading photos.json:', err);
      return {};
    }
  }
  return {};
}

function savePhotosMetadata(data) {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  try {
    fs.writeFileSync(PHOTOS_META_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving photos.json:', err);
  }
}

// --- ROUTES ---

// Home -> redirect to login
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

// Handle upload (Brand -> Person -> Date -> Photos) TO S3
app.post('/upload', requireLogin('admin'), async (req, res) => {
  const brand = (req.body.brand || 'DefaultBrand').trim();
  const person = (req.body.person || 'DefaultPerson').trim();
  const date = (req.body.date || 'NoDate').trim();

  if (!req.files || !req.files.images) {
    return res.status(400).send('No files uploaded');
  }

  let images = req.files.images;
  if (!Array.isArray(images)) images = [images];

  const safeBrand = brand.replace(/\s+/g, '-');
  const safePerson = person.replace(/\s+/g, '-');
  const safeDate = date.replace(/\s+/g, '-');

  const photosMeta = getPhotosMetadata();
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
          // no ACL because bucket has ACLs disabled
        })
      );

      const url = `https://${S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com/${s3Key}`;

      photosMeta[safeBrand][safePerson][safeDate].push({
        name: fileName,
        url,
        s3Key,
      });
    }

    savePhotosMetadata(photosMeta);
    res.redirect('/upload');
  } catch (err) {
    console.error('S3 upload error:', err);
    res.status(500).send('Upload failed');
  }
});

// Admin rename photo (metadata only)
app.post('/rename-photo', requireLogin('admin'), (req, res) => {
  const { brand, person, date, oldfilename, newfilename } = req.body;
  if (!brand || !person || !date || !oldfilename || !newfilename) {
    return res.status(400).send('Missing data');
  }

  const safeBrand = brand.replace(/\s+/g, '-');
  const safePerson = person.replace(/\s+/g, '-');
  const safeDate = date.replace(/\s+/g, '-');

  const photosMeta = getPhotosMetadata();
  const files = photosMeta?.[safeBrand]?.[safePerson]?.[safeDate];
  if (!files) return res.redirect('/admin-gallery');

  const file = files.find((f) => f.name === oldfilename);
  if (file) {
    const ext = path.extname(file.name);
    file.name = newfilename.includes('.') ? newfilename : newfilename + ext;
    savePhotosMetadata(photosMeta);
    console.log(`Renamed (meta): ${oldfilename} → ${file.name}`);
  }

  res.redirect('/admin-gallery');
});

// Admin delete photo (delete from S3 + metadata)
app.post('/delete-photo', requireLogin('admin'), async (req, res) => {
  const { brand, person, date, filename } = req.body;
  if (!brand || !person || !date || !filename) {
    return res.status(400).send('Missing data');
  }

  const safeBrand = brand.replace(/\s+/g, '-');
  const safePerson = person.replace(/\s+/g, '-');
  const safeDate = date.replace(/\s+/g, '-');

  const photosMeta = getPhotosMetadata();
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
  savePhotosMetadata(photosMeta);
  console.log(`Deleted from metadata: ${filename}`);

  res.redirect('/admin-gallery');
});

// Add Google Sheet (now uses S3)
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

// Remove Google Sheet (now uses S3)
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

// Boss gallery view (Brand -> Person -> Date) from S3 metadata
app.get('/gallery', requireLogin('boss'), (req, res) => {
  const photosMeta = getPhotosMetadata();
  const brands = Object.keys(photosMeta).map((brandName) => {
    const personsMeta = photosMeta[brandName];
    const persons = Object.keys(personsMeta).map((personName) => {
      const datesMeta = personsMeta[personName];
      const dates = Object.keys(datesMeta).map((dateName) => {
        const files = datesMeta[dateName].map((f) => ({
          src: f.url,
          name: f.name,
        }));
        return { name: dateName, files };
      });
      return { name: personName, dates };
    });
    return { name: brandName, persons };
  });

  res.render('gallery', { brands, isAdmin: false });
});

// Admin gallery view (can delete and rename)
app.get('/admin-gallery', requireLogin('admin'), (req, res) => {
  const photosMeta = getPhotosMetadata();
  const brands = Object.keys(photosMeta).map((brandName) => {
    const personsMeta = photosMeta[brandName];
    const persons = Object.keys(personsMeta).map((personName) => {
      const datesMeta = personsMeta[personName];
      const dates = Object.keys(datesMeta).map((dateName) => {
        const files = datesMeta[dateName].map((f) => ({
          src: f.url,
          name: f.name,
        }));
        return { name: dateName, files };
      });
      return { name: personName, dates };
    });
    return { name: brandName, persons };
  });

  res.render('gallery', { brands, isAdmin: true });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
