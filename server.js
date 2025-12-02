const express = require('express');
const fileUpload = require('express-fileupload');
const session = require('express-session');
const fs = require('fs');
const path = require('path');

const app = express();

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

// --- SHEETS METADATA HELPERS ---
function getSheetsMetadata() {
  const metaFile = path.join(__dirname, 'uploads', 'sheets.json');
  if (fs.existsSync(metaFile)) {
    try {
      return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    } catch (err) {
      console.error('Error reading sheets.json:', err);
      return {};
    }
  }
  return {};
}

function saveSheetsMetadata(data) {
  const metaFile = path.join(__dirname, 'uploads', 'sheets.json');
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  try {
    fs.writeFileSync(metaFile, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error saving sheets.json:', err);
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

// Handle upload (Brand -> Person -> Date -> Photos)
app.post('/upload', requireLogin('admin'), (req, res) => {
  const brand = req.body.brand || 'DefaultBrand';
  const person = req.body.person || 'DefaultPerson';
  const date = req.body.date || 'NoDate';

  if (!req.files || !req.files.images) {
    return res.status(400).send('No files uploaded');
  }

  let images = req.files.images;
  if (!Array.isArray(images)) images = [images];

  const albumDir = path.join(__dirname, 'uploads', brand, person, date);
  if (!fs.existsSync(albumDir)) {
    fs.mkdirSync(albumDir, { recursive: true });
  }

  images.forEach((img) => {
    const fileName = Date.now() + '_' + img.name;
    img.mv(path.join(albumDir, fileName));
  });

  res.redirect('/upload');
});

// Admin rename photo
app.post('/rename-photo', requireLogin('admin'), (req, res) => {
  const { brand, person, date, oldfilename, newfilename } = req.body;
  if (!brand || !person || !date || !oldfilename || !newfilename) {
    return res.status(400).send('Missing data');
  }

  const oldPath = path.join(__dirname, 'uploads', brand, person, date, oldfilename);
  
  // Get file extension from oldfilename
  const fileExt = path.extname(oldfilename);
  const newNameWithExt = newfilename.includes('.') ? newfilename : newfilename + fileExt;
  const newPath = path.join(__dirname, 'uploads', brand, person, date, newNameWithExt);

  try {
    if (fs.existsSync(oldPath)) {
      fs.renameSync(oldPath, newPath);
      console.log(`Renamed: ${oldfilename} → ${newNameWithExt}`);
    } else {
      console.log(`File not found: ${oldPath}`);
    }
  } catch (err) {
    console.error('Rename error:', err);
  }

  res.redirect('/admin-gallery');
});

// Admin delete photo
app.post('/delete-photo', requireLogin('admin'), (req, res) => {
  const { brand, person, date, filename } = req.body;
  if (!brand || !person || !date || !filename) return res.status(400).send('Missing data');

  const filePath = path.join(__dirname, 'uploads', brand, person, date, filename);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted: ${filename}`);
    }
  } catch (err) {
    console.error('Delete error:', err);
  }

  res.redirect('/admin-gallery');
});

// Add Google Sheet
app.post('/add-sheet', requireLogin('admin'), (req, res) => {
  const { brand, person, date, sheetId, sheetName } = req.body;
  if (!brand || !person || !date || !sheetId) {
    return res.status(400).send('Missing data');
  }

  const sheetsData = getSheetsMetadata();
  const key = `${brand}/${person}/${date}`;
  
  if (!sheetsData[key]) {
    sheetsData[key] = {};
  }
  
  sheetsData[key].sheetId = sheetId;
  sheetsData[key].sheetName = sheetName || 'Sales Data';
  sheetsData[key].embedUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
  
  saveSheetsMetadata(sheetsData);
  console.log(`Added sheet: ${key}`);
  
  res.redirect('/admin-sheets');
});

// Remove Google Sheet
app.post('/remove-sheet', requireLogin('admin'), (req, res) => {
  const { brand, person, date } = req.body;
  if (!brand || !person || !date) {
    return res.status(400).send('Missing data');
  }

  const sheetsData = getSheetsMetadata();
  const key = `${brand}/${person}/${date}`;
  
  if (sheetsData[key]) {
    delete sheetsData[key].sheetId;
    delete sheetsData[key].sheetName;
    delete sheetsData[key].embedUrl;
  }
  
  saveSheetsMetadata(sheetsData);
  console.log(`Removed sheet: ${key}`);
  
  res.redirect('/admin-sheets');
});

// Boss sheets view
app.get('/sheets', requireLogin('boss'), (req, res) => {
  const sheetsMetadata = getSheetsMetadata();
  
  const sheets = Object.entries(sheetsMetadata)
    .filter(([_, data]) => data.sheetId) // Only show entries with sheetId
    .map(([key, data]) => {
      const [brand, person, date] = key.split('/');
      return {
        brand,
        person,
        date,
        sheetId: data.sheetId,
        sheetName: data.sheetName || 'Sales Data',
        embedUrl: data.embedUrl
      };
    });

  res.render('sheets-album', { sheets, isAdmin: false });
});

// Admin sheets view
app.get('/admin-sheets', requireLogin('admin'), (req, res) => {
  const sheetsMetadata = getSheetsMetadata();
  
  const sheets = Object.entries(sheetsMetadata)
    .filter(([_, data]) => data.sheetId) // Only show entries with sheetId
    .map(([key, data]) => {
      const [brand, person, date] = key.split('/');
      return {
        brand,
        person,
        date,
        sheetId: data.sheetId,
        sheetName: data.sheetName || 'Sales Data',
        embedUrl: data.embedUrl
      };
    });

  res.render('sheets-album', { sheets, isAdmin: true });
});

// Boss gallery view (Brand -> Person -> Date)
app.get('/gallery', requireLogin('boss'), (req, res) => {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    return res.render('gallery', { brands: [], isAdmin: false });
  }

  const brands = fs
    .readdirSync(uploadsDir)
    .filter((brandName) => brandName !== 'sheets.json' && fs.statSync(path.join(uploadsDir, brandName)).isDirectory())
    .map((brandName) => {
      const brandPath = path.join(uploadsDir, brandName);
      const persons = fs
        .readdirSync(brandPath)
        .filter((personName) => fs.statSync(path.join(brandPath, personName)).isDirectory())
        .map((personName) => {
          const personPath = path.join(brandPath, personName);
          const dates = fs
            .readdirSync(personPath)
            .filter((dateName) => fs.statSync(path.join(personPath, dateName)).isDirectory())
            .map((dateName) => {
              const datePath = path.join(personPath, dateName);
              const files = fs
                .readdirSync(datePath)
                .filter((f) => /\.(png|jpe?g|gif)$/i.test(f))
                .map((f) => ({
                  src: `/uploads/${brandName}/${personName}/${dateName}/${f}`,
                  name: f,
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
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    return res.render('gallery', { brands: [], isAdmin: true });
  }

  const brands = fs
    .readdirSync(uploadsDir)
    .filter((brandName) => brandName !== 'sheets.json' && fs.statSync(path.join(uploadsDir, brandName)).isDirectory())
    .map((brandName) => {
      const brandPath = path.join(uploadsDir, brandName);
      const persons = fs
        .readdirSync(brandPath)
        .filter((personName) => fs.statSync(path.join(brandPath, personName)).isDirectory())
        .map((personName) => {
          const personPath = path.join(brandPath, personName);
          const dates = fs
            .readdirSync(personPath)
            .filter((dateName) => fs.statSync(path.join(personPath, dateName)).isDirectory())
            .map((dateName) => {
              const datePath = path.join(personPath, dateName);
              const files = fs
                .readdirSync(datePath)
                .filter((f) => /\.(png|jpe?g|gif)$/i.test(f))
                .map((f) => ({
                  src: `/uploads/${brandName}/${personName}/${dateName}/${f}`,
                  name: f,
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
